'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const http = require('node:http');
const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Database = require('better-sqlite3');
const { WebSocketServer, WebSocket } = require('ws');

const PORT = Number(process.env.PORT || 8080);
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', 'data'));
const FILE_DIR = path.join(DATA_DIR, 'installers');
const DB_FILE = path.join(DATA_DIR, 'ec-audio.sqlite');
const JWT_SECRET = process.env.JWT_SECRET;
const ADMIN_EMAIL = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
const ADMIN_PASSWORD = String(process.env.ADMIN_PASSWORD || '');
const MAX_UPLOAD = Math.max(1, Number(process.env.MAX_UPLOAD_GB || 2)) * 1024 * 1024 * 1024;

if (!JWT_SECRET || JWT_SECRET.length < 40) throw new Error('JWT_SECRET must be set to at least 40 characters.');
if (!ADMIN_EMAIL || ADMIN_PASSWORD.length < 14) throw new Error('Set ADMIN_EMAIL and an ADMIN_PASSWORD of at least 14 characters.');
fs.mkdirSync(FILE_DIR, { recursive: true, mode: 0o750 });
fs.mkdirSync(path.join(DATA_DIR, 'tmp'), { recursive: true, mode: 0o750 });

const db = new Database(DB_FILE);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('admin','customer')), active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS plugins (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, manufacturer TEXT NOT NULL, version TEXT NOT NULL,
    category TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', changelog TEXT NOT NULL DEFAULT '',
    file_name TEXT NOT NULL, disk_name TEXT NOT NULL, content_type TEXT NOT NULL,
    size_bytes INTEGER NOT NULL, sha256 TEXT NOT NULL, published INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_plugins_published ON plugins(published, updated_at);
`);

const adminHash = bcrypt.hashSync(ADMIN_PASSWORD, 12);
const existingAdmin = db.prepare('SELECT id,password_hash FROM users WHERE email=?').get(ADMIN_EMAIL);
if (!existingAdmin) {
  db.prepare('INSERT INTO users(id,email,password_hash,role,created_at) VALUES(?,?,?,?,?)')
    .run(crypto.randomUUID(), ADMIN_EMAIL, adminHash, 'admin', new Date().toISOString());
} else if (process.env.RESET_ADMIN_PASSWORD === 'true') {
  db.prepare('UPDATE users SET password_hash=?,role=?,active=1 WHERE id=?').run(adminHash, 'admin', existingAdmin.id);
}

const app = express();
app.disable('x-powered-by');
app.use(helmet({ crossOriginResourcePolicy: { policy: 'same-site' }, contentSecurityPolicy: {
  directives: { defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"], connectSrc: ["'self'", 'ws:', 'wss:'], imgSrc: ["'self'", 'data:'], objectSrc: ["'none'"], baseUri: ["'self'"], frameAncestors: ["'none'"] }
} }));
app.use(compression());
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, '..', 'public'), { extensions: ['html'] }));
app.get('/health', (_req, res) => res.json({ ok: true, service: 'EC Audio Cloud', version: '1.0.0' }));

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 12, standardHeaders: 'draft-7', legacyHeaders: false });
function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return res.status(401).json({ error: 'Sign in required.' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = db.prepare('SELECT id,email,role,active FROM users WHERE id=?').get(payload.sub);
    if (!user || !user.active) return res.status(401).json({ error: 'Account is inactive.' });
    req.user = user;
    next();
  } catch { return res.status(401).json({ error: 'Session expired. Sign in again.' }); }
}
function adminOnly(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Administrator permission required.' });
  next();
}
function issueToken(user) {
  return jwt.sign({ sub: user.id, role: user.role }, JWT_SECRET, { expiresIn: `${Math.min(90, Math.max(1, Number(process.env.TOKEN_DAYS || 30)) )}d`, issuer: 'ec-audio-cloud', audience: 'ec-audio-hub' });
}
const publicFields = `id,name,manufacturer,version,category,description,changelog,file_name AS fileName,
 content_type AS contentType,size_bytes AS sizeBytes,sha256,published,created_at AS createdAt,updated_at AS updatedAt`;

app.post('/api/auth/login', loginLimiter, (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  const user = db.prepare('SELECT * FROM users WHERE email=? AND active=1').get(email);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) return res.status(401).json({ error: 'Email or password is incorrect.' });
  res.json({ token: issueToken(user), user: { id: user.id, email: user.email, role: user.role } });
});
app.get('/api/auth/me', auth, (req, res) => res.json({ user: req.user }));
app.get('/api/catalog', auth, (_req, res) => {
  const plugins = db.prepare(`SELECT ${publicFields} FROM plugins WHERE published=1 ORDER BY category,name`).all();
  res.json({ plugins: plugins.map(plugin => ({ ...plugin, published: Boolean(plugin.published) })) });
});
app.get('/api/admin/users', auth, adminOnly, (_req, res) => {
  const users = db.prepare("SELECT id,email,role,active,created_at AS createdAt FROM users ORDER BY created_at DESC").all();
  res.json({ users });
});
app.post('/api/admin/users', auth, adminOnly, (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 12) {
    return res.status(400).json({ error: 'Provide a valid email and a password of at least 12 characters.' });
  }
  if (db.prepare('SELECT id FROM users WHERE email=?').get(email)) return res.status(409).json({ error: 'That email already has an account.' });
  const id = crypto.randomUUID();
  db.prepare('INSERT INTO users(id,email,password_hash,role,created_at) VALUES(?,?,?,?,?)')
    .run(id, email, bcrypt.hashSync(password, 12), 'customer', new Date().toISOString());
  res.status(201).json({ ok: true, user: { id, email, role: 'customer' } });
});
app.patch('/api/admin/users/:id', auth, adminOnly, (req, res) => {
  const user = db.prepare('SELECT id,role FROM users WHERE id=?').get(req.params.id);
  if (!user || user.role === 'admin') return res.status(404).json({ error: 'Customer not found.' });
  db.prepare('UPDATE users SET active=? WHERE id=?').run(req.body?.active === false ? 0 : 1, user.id);
  res.json({ ok: true });
});
\napp.get('/api/admin/plugins', auth, adminOnly, (_req, res) => {
  const plugins = db.prepare(`SELECT ${publicFields} FROM plugins ORDER BY updated_at DESC`).all();
  res.json({ plugins: plugins.map(plugin => ({ ...plugin, published: Boolean(plugin.published) })) });
});

const upload = multer({
  dest: path.join(DATA_DIR, 'tmp'),
  limits: { fileSize: MAX_UPLOAD, files: 1, fields: 12 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const allowed = new Set(['.vst3','.component','.aaxplugin','.pkg','.dmg','.zip','.tar','.gz','.7z','.exe','.msi','.app','.au']);
    if (!allowed.has(ext)) return cb(new Error('Unsupported installer extension.'));
    cb(null, true);
  }
});
const clean = value => String(value || '').trim().slice(0, 4000);
const publishClients = () => {
  const message = JSON.stringify({ type: 'catalog.changed', at: new Date().toISOString() });
  for (const socket of wss.clients) if (socket.readyState === WebSocket.OPEN && socket.userId) socket.send(message);
};
function saveUpload(req, res, next) {
  upload.single('installer')(req, res, err => {
    if (err) return res.status(400).json({ error: err.message || 'Upload failed.' });
    next();
  });
}
app.post('/api/admin/plugins', auth, adminOnly, saveUpload, async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Select an installer file.' });
  const name = clean(req.body.name), manufacturer = clean(req.body.manufacturer), version = clean(req.body.version);
  if (!name || !manufacturer || !version) {
    fs.rmSync(req.file.path, { force: true });
    return res.status(400).json({ error: 'Name, manufacturer and version are required.' });
  }
  const id = crypto.randomUUID();
  const ext = path.extname(req.file.originalname).toLowerCase();
  const diskName = id + ext;
  const destination = path.join(FILE_DIR, diskName);
  try {
    fs.renameSync(req.file.path, destination);
    const hash = await new Promise((resolve, reject) => {\n      const digest = crypto.createHash('sha256');\n      const stream = fs.createReadStream(destination);\n      stream.on('data', chunk => digest.update(chunk));\n      stream.on('error', reject);\n      stream.on('end', () => resolve(digest.digest('hex')));\n    });
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO plugins(id,name,manufacturer,version,category,description,changelog,file_name,disk_name,content_type,size_bytes,sha256,published,created_at,updated_at)
      VALUES(@id,@name,@manufacturer,@version,@category,@description,@changelog,@fileName,@diskName,@contentType,@sizeBytes,@sha256,@published,@now,@now)`)
      .run({
        id, name, manufacturer, version, category: clean(req.body.category) || 'Other',
        description: clean(req.body.description), changelog: clean(req.body.changelog),
        fileName: path.basename(req.file.originalname), diskName,
        contentType: req.file.mimetype || 'application/octet-stream', sizeBytes: req.file.size,
        sha256: hash, published: req.body.published === 'false' ? 0 : 1, now
      });
  } catch (e) {
    fs.rmSync(destination, { force: true });
    return res.status(500).json({ error: 'Could not save installer metadata.' });
  }
  publishClients();
  res.status(201).json({ ok: true, id });
});
app.patch('/api/admin/plugins/:id', auth, adminOnly, (req, res) => {
  const current = db.prepare('SELECT * FROM plugins WHERE id=?').get(req.params.id);
  if (!current) return res.status(404).json({ error: 'Plugin not found.' });
  const fields = ['name','manufacturer','version','category','description','changelog'];
  const updates = {};
  for (const field of fields) if (req.body[field] !== undefined) updates[field] = clean(req.body[field]);
  if (req.body.published !== undefined) updates.published = req.body.published ? 1 : 0;
  if (Object.keys(updates).length) {
    const sql = Object.keys(updates).map(key => `${key}=@${key}`).join(',');
    db.prepare(`UPDATE plugins SET ${sql},updated_at=@updatedAt WHERE id=@id`).run({ ...updates, updatedAt: new Date().toISOString(), id: current.id });
    publishClients();
  }
  res.json({ ok: true });
});
app.delete('/api/admin/plugins/:id', auth, adminOnly, (req, res) => {
  const result = db.prepare('UPDATE plugins SET published=0,updated_at=? WHERE id=?').run(new Date().toISOString(), req.params.id);
  if (!result.changes) return res.status(404).json({ error: 'Plugin not found.' });
  publishClients();
  res.json({ ok: true, hidden: true });
});
app.get('/api/plugins/:id/download', auth, (req, res) => {
  const plugin = db.prepare('SELECT * FROM plugins WHERE id=? AND published=1').get(req.params.id);
  if (!plugin) return res.status(404).json({ error: 'Plugin is not available.' });
  const filePath = path.join(FILE_DIR, plugin.disk_name);
  if (!fs.existsSync(filePath)) return res.status(410).json({ error: 'Installer file is missing on server.' });
  res.setHeader('Content-Type', plugin.content_type);
  res.setHeader('Content-Length', plugin.size_bytes);
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(plugin.file_name)}`);
  res.setHeader('X-Checksum-SHA256', plugin.sha256);
  res.setHeader('Cache-Control', 'private, no-store');
  fs.createReadStream(filePath).pipe(res);
});

const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true, maxPayload: 2048 });
server.on('upgrade', (request, socket, head) => {
  const parsed = new URL(request.url, 'http://localhost');
  if (parsed.pathname !== '/api/live') return socket.destroy();
  try {
    const payload = jwt.verify(parsed.searchParams.get('token') || '', JWT_SECRET);
    const user = db.prepare('SELECT id,active FROM users WHERE id=?').get(payload.sub);
    if (!user || !user.active) return socket.destroy();
    wss.handleUpgrade(request, socket, head, ws => {
      ws.userId = user.id;
      ws.send(JSON.stringify({ type: 'connected' }));
    });
  } catch { socket.destroy(); }
});
wss.on('connection', socket => {
  socket.isAlive = true;
  socket.on('pong', () => { socket.isAlive = true; });
});
const heartbeat = setInterval(() => {
  for (const socket of wss.clients) {
    if (!socket.isAlive) { socket.terminate(); continue; }
    socket.isAlive = false; socket.ping();
  }
}, 30000);
server.listen(PORT, '0.0.0.0', () => console.log(`EC Audio Cloud listening on :${PORT}`));
process.on('SIGTERM', () => { clearInterval(heartbeat); server.close(() => { db.close(); process.exit(0); }); });
