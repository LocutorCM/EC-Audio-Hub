'use strict';

const crypto = require('node:crypto');
const path = require('node:path');
const multer = require('multer');

const DEFAULT_SPACE = 'https://ace-step-ace-step-v1-5.hf.space';
const HOURLY_LIMIT = 3;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024, files: 1, fields: 12 },
  fileFilter(_req, file, cb) {
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (!new Set(['.wav', '.mp3', '.m4a', '.flac', '.ogg', '.aac']).has(ext)) return cb(new Error('Formato de audio no compatible.'));
    cb(null, true);
  }
});

function installInstrumentalApi(app, { db, customerAuth, adminEmail = '' }) {
  const space = String(process.env.HF_MUSIC_SPACE || DEFAULT_SPACE).replace(/\/+$/, '');
  const hfToken = String(process.env.HF_TOKEN || '').trim();
  const allowlist = new Set(String(process.env.INSTRUMENTAL_ALLOWLIST || adminEmail).split(',').map(x => x.trim().toLowerCase()).filter(Boolean));
  db.exec("CREATE TABLE IF NOT EXISTS instrumental_jobs (id TEXT PRIMARY KEY, provider_job_id TEXT NOT NULL, customer_id TEXT NOT NULL, customer_email TEXT NOT NULL, prompt TEXT NOT NULL, status TEXT NOT NULL, progress INTEGER NOT NULL DEFAULT 5, audio_path TEXT, error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL); CREATE INDEX IF NOT EXISTS idx_instrumental_jobs_customer ON instrumental_jobs(customer_id, created_at DESC);");

  function authorized(req, res) {
    const email = String(req.customer?.email || '').toLowerCase();
    if (!email || !allowlist.has(email)) {
      res.status(403).json({ error: 'Tu cuenta todavía no está autorizada para generar instrumentales online. Solicita al administrador que agregue tu correo a INSTRUMENTAL_ALLOWLIST.' });
      return false;
    }
    return true;
  }
  function headers(extra = {}) {
    const h = { ...extra };
    if (hfToken) h.Authorization = 'Bearer ' + hfToken;
    return h;
  }
  function providerFetch(pathname, options = {}) {
    return fetch(space + pathname, { ...options, headers: headers(options.headers || {}), signal: options.signal || AbortSignal.timeout(45000) });
  }

  app.get('/api/instrumental/status', customerAuth, async (req, res) => {
    if (!authorized(req, res)) return;
    try {
      const r = await providerFetch('/health', { signal: AbortSignal.timeout(12000) });
      if (!r.ok) return res.json({ available: false, provider: 'ACE-Step ZeroGPU', message: r.status === 503 ? 'ACE-Step está iniciando o temporalmente ocupado. Vuelve a comprobar en un momento.' : 'El motor online respondió con HTTP ' + r.status + '.' });
      return res.json({ available: true, provider: 'ACE-Step ZeroGPU', hourlyLimit: HOURLY_LIMIT });
    } catch {
      return res.json({ available: false, provider: 'ACE-Step ZeroGPU', message: 'No se pudo conectar con el motor gratuito. Puede estar iniciando o temporalmente fuera de servicio.' });
    }
  });

  app.post('/api/instrumental/generate', customerAuth, (req, res, next) => {
    upload.single('voice')(req, res, err => {
      if (err) return res.status(400).json({ error: err.message || 'No se pudo recibir el audio.' });
      next();
    });
  }, async (req, res) => {
    if (!authorized(req, res)) return;
    const caption = String(req.body?.prompt || req.body?.caption || '').trim().slice(0, 900);
    if (caption.length < 4) return res.status(400).json({ error: 'Escribe una descripción musical de al menos 4 caracteres.' });
    const duration = Math.min(60, Math.max(10, Number(req.body?.duration || 30)));
    const bpm = Math.min(300, Math.max(30, Number(req.body?.bpm || 90)));
    const since = new Date(Date.now() - 3600000).toISOString();
    const recent = db.prepare('SELECT COUNT(*) AS count FROM instrumental_jobs WHERE customer_id=? AND created_at>=?').get(req.customer.id, since).count;
    if (recent >= HOURLY_LIMIT) return res.status(429).json({ error: 'Alcanzaste el límite gratuito de 3 generaciones por hora. Inténtalo más tarde.' });
    const payload = { caption, lyrics: '[Instrumental]', instrumental: true, thinking: false, audio_duration: duration, bpm, audio_format: 'mp3', inference_steps: 8, batch_size: 1, task_type: 'text2music' };
    try {
      let r;
      if (req.file) {
        const form = new FormData();
        for (const [key, value] of Object.entries(payload)) form.append(key, String(value));
        form.set('task_type', 'cover');
        form.set('audio_cover_strength', '0.35');
        form.append('src_audio', new Blob([req.file.buffer], { type: req.file.mimetype || 'audio/wav' }), req.file.originalname);
        r = await providerFetch('/v1/music/generate', { method: 'POST', body: form });
      } else {
        r = await providerFetch('/v1/music/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      }
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data.job_id) return res.status(r.status === 429 ? 429 : 502).json({ error: String(data.detail || data.error || 'El proveedor no aceptó la generación.').slice(0, 500) });
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      db.prepare("INSERT INTO instrumental_jobs(id,provider_job_id,customer_id,customer_email,prompt,status,progress,created_at,updated_at) VALUES(?,?,?,?,?,'queued',5,?,?)").run(id, data.job_id, req.customer.id, req.customer.email, caption, now, now);
      return res.status(202).json({ jobId: id, status: 'queued', hourlyLimit: HOURLY_LIMIT });
    } catch (err) {
      return res.status(502).json({ error: err.name === 'TimeoutError' ? 'El motor online tardó demasiado en responder. Inténtalo de nuevo.' : 'No se pudo conectar con ACE-Step online: ' + String(err.message || err).slice(0, 250) });
    }
  });

  app.get('/api/instrumental/jobs/:jobId', customerAuth, async (req, res) => {
    if (!authorized(req, res)) return;
    const job = db.prepare('SELECT * FROM instrumental_jobs WHERE id=? AND customer_id=?').get(req.params.jobId, req.customer.id);
    if (!job) return res.status(404).json({ error: 'No se encontró esta generación.' });
    if (job.status === 'failed') return res.json({ jobId: job.id, status: 'failed', progress: job.progress, error: job.error });
    if (job.status === 'completed' && job.audio_path) return res.json({ jobId: job.id, status: 'completed', progress: 100, stage: 'done', stageLabel: 'Instrumental lista', audioExtension: '.mp3' });
    try {
      const r = await providerFetch('/v1/jobs/' + encodeURIComponent(job.provider_job_id), { signal: AbortSignal.timeout(20000) });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.detail || 'No se pudo consultar el estado del proveedor.');
      const status = String(data.status || '').toLowerCase();
      const now = new Date().toISOString();
      if (status === 'failed') {
        const msg = String(data.error || 'ACE-Step no pudo completar la generación.').slice(0, 500);
        db.prepare("UPDATE instrumental_jobs SET status='failed',error=?,updated_at=? WHERE id=?").run(msg, now, job.id);
        return res.json({ jobId: job.id, status: 'failed', progress: 100, error: msg });
      }
      if (status === 'succeeded' || status === 'completed') {
        const result = data.result || {};
        const audioPath = result.first_audio_path || (Array.isArray(result.audio_paths) ? result.audio_paths[0] : null);
        if (!audioPath) throw new Error('El proveedor terminó, pero no devolvió el archivo de audio.');
        db.prepare("UPDATE instrumental_jobs SET status='completed',progress=100,audio_path=?,updated_at=? WHERE id=?").run(String(audioPath), now, job.id);
        return res.json({ jobId: job.id, status: 'completed', progress: 100, stage: 'done', stageLabel: 'Instrumental lista', audioExtension: '.mp3' });
      }
      const progress = status === 'running' ? 55 : Math.max(5, Math.min(45, 10 + Number(data.queue_position || 0) * 3));
      db.prepare("UPDATE instrumental_jobs SET status=?,progress=?,updated_at=? WHERE id=?").run(status === 'running' ? 'running' : 'queued', progress, now, job.id);
      return res.json({ jobId: job.id, status: status === 'running' ? 'running' : 'queued', progress, stage: status === 'running' ? 'composition' : 'queued', stageLabel: status === 'running' ? 'ACE-Step está generando el audio…' : 'En cola de generación online…', queuePosition: Number(data.queue_position || 0), etaSeconds: Number(data.eta_seconds || 0) });
    } catch (err) {
      return res.status(502).json({ error: String(err.message || err).slice(0, 500) });
    }
  });

  app.get('/api/instrumental/jobs/:jobId/audio', customerAuth, async (req, res) => {
    if (!authorized(req, res)) return;
    const job = db.prepare('SELECT * FROM instrumental_jobs WHERE id=? AND customer_id=?').get(req.params.jobId, req.customer.id);
    if (!job || job.status !== 'completed' || !job.audio_path) return res.status(404).json({ error: 'El audio todavía no está disponible.' });
    try {
      const audioURL = new URL(job.audio_path, space);
      if (audioURL.origin !== new URL(space).origin || !audioURL.pathname.startsWith('/v1/audio')) return res.status(400).json({ error: 'La ruta de audio devuelta por el proveedor no es válida.' });
      const r = await providerFetch(audioURL.pathname + audioURL.search, { signal: AbortSignal.timeout(60000) });
      if (!r.ok) return res.status(502).json({ error: 'No se pudo descargar el audio generado desde ACE-Step.' });
      const buffer = Buffer.from(await r.arrayBuffer());
      if (!buffer.length || buffer.length > 120 * 1024 * 1024) return res.status(502).json({ error: 'El archivo de audio recibido no tiene un tamaño válido.' });
      res.setHeader('Content-Type', r.headers.get('content-type') || 'audio/mpeg');
      res.setHeader('Content-Length', String(buffer.length));
      res.setHeader('Content-Disposition', 'attachment; filename="EC-Audio-Instrumental.mp3"');
      return res.status(200).send(buffer);
    } catch (err) {
      return res.status(502).json({ error: 'No se pudo recuperar el audio: ' + String(err.message || err).slice(0, 250) });
    }
  });
}

module.exports = { installInstrumentalApi };
