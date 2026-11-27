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
const { installCustomerAccountApi } = require('./customer-accounts');

const PORT = Number(process.env.PORT || 8080);
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', 'data'));
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const TEMP_DIR = path.join(DATA_DIR, 'tmp');
const DB_FILE = path.join(DATA_DIR, 'ec-audio.sqlite');
const JWT_SECRET = process.env.JWT_SECRET;
const ADMIN_EMAIL = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
const ADMIN_PASSWORD = String(process.env.ADMIN_PASSWORD || '');
const FIREBASE_API_KEY = String(process.env.FIREBASE_API_KEY || '');
const FIREBASE_PROJECT_ID = String(process.env.FIREBASE_PROJECT_ID || '');
const MAX_UPLOAD = Math.max(1, Number(process.env.MAX_UPLOAD_GB || 2)) * 1024 * 1024 * 1024;

if (!JWT_SECRET || JWT_SECRET.length < 40) throw new Error('JWT_SECRET must contain at least 40 characters.');
if (!ADMIN_EMAIL || ADMIN_PASSWORD.length < 14) throw new Error('Set ADMIN_EMAIL and an ADMIN_PASSWORD of at least 14 characters.');

fs.mkdirSync(UPLOAD_DIR, { recursive: true, mode: 0o750 });
fs.mkdirSync(TEMP_DIR, { recursive: true, mode: 0o750 });

const db = new Database(DB_FILE);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role = 'admin'),
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS uploads (
    id TEXT PRIMARY KEY,
    file_name TEXT NOT NULL,
    disk_name TEXT NOT NULL UNIQUE,
    content_type TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    sha256 TEXT NOT NULL,
    uploaded_by TEXT NOT NULL,
    uploaded_at TEXT NOT NULL,
    FOREIGN KEY(uploaded_by) REFERENCES users(id)
  );
  CREATE INDEX IF NOT EXISTS idx_uploads_date ON uploads(uploaded_at DESC);
`);

const adminHash = bcrypt.hashSync(ADMIN_PASSWORD, 12);
const existingAdmin = db.prepare('SELECT id FROM users WHERE email=?').get(ADMIN_EMAIL);
if (!existingAdmin) {
  db.prepare('INSERT INTO users(id,email,password_hash,role,created_at) VALUES(?,?,?,?,?)')
    .run(crypto.randomUUID(), ADMIN_EMAIL, adminHash, 'admin', new Date().toISOString());
} else if (process.env.RESET_ADMIN_PASSWORD === 'true') {
  db.prepare('UPDATE users SET password_hash=?,active=1 WHERE id=?').run(adminHash, existingAdmin.id);
}

const app = express();
app.disable('x-powered-by');
app.use(helmet());
app.use(compression());
app.use(express.json({ limit: '32kb' }));

const allowedOrigins = new Set(
  String(process.env.CORS_ORIGINS || 'https://locutorcm.github.io')
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean)
);
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && allowedOrigins.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(origin && allowedOrigins.has(origin) ? 204 : 403);
  return next();
});

installCustomerAccountApi(app, { db, jwt, bcrypt, jwtSecret: JWT_SECRET, firebaseApiKey: FIREBASE_API_KEY, firebaseProjectId: FIREBASE_PROJECT_ID, loginLimiter: rateLimit({ windowMs: 15 * 60 * 1000, limit: 12, standardHeaders: 'draft-7', legacyHeaders: false }) });

app.get('/health', (_req, res) => res.json({ ok: true, service: 'EC Audio Cloud API', customerAccounts: true, firebaseConfigured: Boolean(FIREBASE_API_KEY && FIREBASE_PROJECT_ID), demoTrialSeconds: 60 }));

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 12,
  standardHeaders: 'draft-7',
  legacyHeaders: false
});

function issueToken(user) {
  return jwt.sign(
    { sub: user.id, role: 'admin' },
    JWT_SECRET,
    { expiresIn: '12h', issuer: 'ec-audio-cloud', audience: 'ec-audio-admin' }
  );
}

function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return res.status(401).json({ error: 'Admin sign-in required.' });
  try {
    const payload = jwt.verify(token, JWT_SECRET, {
      issuer: 'ec-audio-cloud',
      audience: 'ec-audio-admin'
    });
    const user = db.prepare('SELECT id,email,role,active FROM users WHERE id=?').get(payload.sub);
    if (!user || user.role !== 'admin' || !user.active) {
      return res.status(403).json({ error: 'Administrator access required.' });
    }
    req.user = user;
    return next();
  } catch {
    return res.status(401).json({ error: 'Session expired. Sign in again.' });
  }
}

app.post('/api/auth/login', loginLimiter, (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  const user = db.prepare('SELECT * FROM users WHERE email=? AND active=1').get(email);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Email or password is incorrect.' });
  }
  return res.json({
    token: issueToken(user),
    user: { id: user.id, email: user.email, role: 'admin' }
  });
});

const allowedExtensions = new Set([
  '.vst3', '.component', '.aaxplugin', '.pkg', '.dmg', '.zip',
  '.tar', '.gz', '.7z', '.rar', '.exe', '.msi', '.app', '.au',
  '.clap', '.vst', '.dll', '.so', '.deb', '.rpm'
]);

const receiveOneFile = multer({
  dest: TEMP_DIR,
  limits: { fileSize: MAX_UPLOAD, files: 1, fields: 0 },
  fileFilter: (_req, file, callback) => {
    const extension = path.extname(file.originalname).toLowerCase();
    if (!allowedExtensions.has(extension)) {
      return callback(new Error('File type not supported. Upload a plugin or installer archive.'));
    }
    return callback(null, true);
  }
}).single('installer');

function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', chunk => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

app.post('/api/admin/files', auth, (req, res, next) => {
  receiveOneFile(req, res, error => {
    if (error) return res.status(400).json({ error: error.message || 'Upload failed.' });
    return next();
  });
}, async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Select one file to upload.' });

  const id = crypto.randomUUID();
  const extension = path.extname(req.file.originalname).toLowerCase();
  const diskName = id + extension;
  const destination = path.join(UPLOAD_DIR, diskName);

  try {
    fs.renameSync(req.file.path, destination);
    const sha256 = await sha256File(destination);
    const fileName = path.basename(req.file.originalname);
    const uploadedAt = new Date().toISOString();

    db.prepare(`
      INSERT INTO uploads(id,file_name,disk_name,content_type,size_bytes,sha256,uploaded_by,uploaded_at)
      VALUES(?,?,?,?,?,?,?,?)
    `).run(
      id,
      fileName,
      diskName,
      req.file.mimetype || 'application/octet-stream',
      req.file.size,
      sha256,
      req.user.id,
      uploadedAt
    );

    return res.status(201).json({ id, fileName, sizeBytes: req.file.size, sha256, uploadedAt });
  } catch (error) {
    fs.rmSync(req.file.path, { force: true });
    fs.rmSync(destination, { force: true });
    return res.status(500).json({ error: 'The file could not be stored on the server.' });
  }
});

const server = http.createServer(app);
server.listen(PORT, '0.0.0.0', () => {
  console.log(`EC Audio Upload Server listening on :${PORT}`);
});

function shutdown() {
  server.close(() => {
    db.close();
    process.exit(0);
  });
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
