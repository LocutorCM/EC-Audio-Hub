'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const multer = require('multer');
const { Client, handle_file } = require('@gradio/client');

const MAX_BYTES = 50 * 1024 * 1024;
const JOBS = new Map();
const WORK_DIR = path.join(os.tmpdir(), 'ec-audio-instrumental');
fs.mkdirSync(WORK_DIR, { recursive: true, mode: 0o700 });

const STYLES = {
  worship: { label: 'Adoración / Worship', tags: 'christian worship, cinematic worship, emotional piano, warm pads, ambient electric guitars, live drums, bass, uplifting arrangement' },
  ballad: { label: 'Balada', tags: 'emotional pop ballad, piano, acoustic guitar, warm strings, soft drums, melodic bass' },
  acoustic: { label: 'Acústico', tags: 'acoustic pop, fingerpicked acoustic guitar, warm piano, subtle bass, brushed percussion' },
  pop: { label: 'Pop', tags: 'modern pop, bright piano, synth layers, punchy drums, melodic bass' },
  urban: { label: 'Urbano / Reggaetón', tags: 'latin urban, reggaeton groove, dembow drums, deep bass, atmospheric synths' },
  reggaeton: { label: 'Reggaetón clásico', tags: 'classic reggaeton, dembow rhythm, punchy kick and snare, syncopated percussion' },
  rap: { label: 'Rap / Hip-hop', tags: 'hip hop, boom bap drums, deep bass, soulful piano, atmospheric samples' },
  boom_bap: { label: 'Boom bap', tags: 'classic boom bap hip hop, dusty piano, chopped soul textures, punchy kick, crisp snare' },
  trap: { label: 'Trap', tags: 'melodic trap, 808 bass, crisp hi hats, punchy kick, atmospheric pads' },
  drill: { label: 'Drill', tags: 'dark drill, sliding 808 bass, syncopated kick, sharp snare, rapid hi hats' },
  afrobeat: { label: 'Afrobeat', tags: 'modern afrobeat, syncopated percussion, warm bass guitar, bright plucked guitar' },
  house: { label: 'House / Dance', tags: 'modern house, four on the floor kick, deep bass, bright piano chords, rhythmic synths' },
  rock: { label: 'Rock', tags: 'alternative rock, electric guitars, live drums, electric bass, energetic band arrangement' },
  rnb: { label: 'R&B / Soul', tags: 'modern rnb, soulful keys, warm bass, laid back drums, lush chords' },
  cinematic: { label: 'Cinemático', tags: 'cinematic orchestral, piano, strings, atmospheric pads, deep percussion' }
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES, files: 1, fields: 5 },
  fileFilter(_req, file, cb) {
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (!['.wav', '.mp3', '.m4a', '.aac', '.ogg'].includes(ext)) return cb(new Error('Formato no compatible. Usa WAV, MP3, M4A, AAC u OGG.'));
    cb(null, true);
  }
}).single('voice');

function setJob(job, values) { Object.assign(job, values, { updatedAt: new Date().toISOString() }); }
function publicJob(job) {
  return {
    jobId: job.id, status: job.status, stage: job.stage, stageLabel: job.stageLabel,
    progress: job.progress, message: job.message || '',
    audioReady: Boolean(job.audioPath && fs.existsSync(job.audioPath)),
    audioExtension: job.audioExtension || '.wav',
    stemsReady: Boolean(job.stemsPath && fs.existsSync(job.stemsPath)),
    audioDownloadUrl: job.audioPath ? '/api/instrumental/jobs/' + job.id + '/audio' : null,
    stemsDownloadUrl: job.stemsPath ? '/api/instrumental/jobs/' + job.id + '/stems' : null,
    warning: job.warning || null, error: job.error || null
  };
}
function ownedJob(req, res) {
  const job = JOBS.get(String(req.params.jobId || ''));
  if (!job || job.userId !== req.customer.id) { res.status(404).json({ error: 'No se encontró esta generación.' }); return null; }
  return job;
}
async function saveGradioFile(file, destination, kind) {
  const url = typeof file === 'string' ? file : file && (file.url || file.path);
  if (!url) throw new Error('El motor de IA no devolvió el archivo solicitado.');
  if (/^https:\/\//i.test(url)) {
    const response = await fetch(url, { signal: AbortSignal.timeout(240000) });
    if (!response.ok) throw new Error('No se pudo descargar el archivo generado.');
    const data = Buffer.from(await response.arrayBuffer());
    if (!data.length || data.length > 300 * 1024 * 1024) throw new Error('El archivo generado está vacío o supera el límite.');
    fs.writeFileSync(destination, data, { mode: 0o600, flag: 'wx' });
  } else if (typeof url === 'string' && path.isAbsolute(url) && fs.existsSync(url)) {
    fs.copyFileSync(url, destination, fs.constants.COPYFILE_EXCL);
  } else {
    throw new Error('El espacio de IA devolvió una ruta de archivo no accesible.');
  }
  const stat = fs.statSync(destination);
  if (kind === 'audio' && stat.size < 1024) throw new Error('El audio generado está vacío.');
  if (kind === 'zip') {
    const fd = fs.openSync(destination, 'r');
    const signature = Buffer.alloc(4);
    fs.readSync(fd, signature, 0, 4, 0);
    fs.closeSync(fd);
    if (signature.toString('hex') !== '504b0304') throw new Error('El archivo de pistas no es un ZIP válido.');
  }
}
async function runJob(job, voice, options) {
  const dir = path.join(WORK_DIR, job.id);
  const voicePath = path.join(dir, 'voice' + path.extname(voice.name));
  try {
    const space = String(process.env.HF_MUSIC_SPACE || '').trim();
    const token = String(process.env.HF_TOKEN || '').trim();
    if (!space || !token) throw new Error('Falta configurar HF_MUSIC_SPACE y HF_TOKEN en el servidor EC Audio.');
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(voicePath, voice.buffer, { mode: 0o600, flag: 'wx' });
    setJob(job, { status: 'running', stage: 'upload', stageLabel: 'Conectando con EC Audio AI', progress: 10, message: 'Preparando tu voz para el motor de música.' });
    const client = await Client.connect(space, { hf_token: token });
    const style = STYLES[options.style];
    const prompt = [
      'Professional instrumental backing arrangement for the supplied solo human singing voice.',
      'INSTRUMENTAL ONLY: no lead vocals, no choir, no speech, no lyrics.',
      'Use the vocal recording as source context. Preserve phrasing and emotional character as much as possible.',
      style.tags,
      options.bpm ? 'Target tempo approximately ' + options.bpm + ' BPM' : 'Follow the natural vocal tempo',
      options.mood ? 'Mood: ' + options.mood : '',
      options.notes ? 'Arrangement directions: ' + options.notes : '',
      'Studio quality, coherent harmony, clear intro, supportive accompaniment and musical ending.'
    ].filter(Boolean).join('. ');
    setJob(job, { stage: 'composition', stageLabel: 'ACE-Step está componiendo', progress: 24, message: 'Enviando voz y dirección musical al espacio gratuito. Puede haber cola.' });
    const result = await client.predict('/generate', {
      voice: handle_file(voicePath),
      prompt,
      bpm: options.bpm || 0,
      duration: 60,
      separate_stems: true
    });
    const values = result && result.data || [];
    if (!values[0]) throw new Error('ACE-Step no devolvió una mezcla de audio.');
    setJob(job, { stage: 'separation', stageLabel: 'Preparando mezcla y pistas separadas', progress: 82, message: 'Descargando los archivos de salida.' });
    job.audioPath = path.join(dir, 'EC-AI-Instrumental.wav');
    await saveGradioFile(values[0], job.audioPath, 'audio');
    job.audioExtension = '.wav';
    if (values[1]) {
      job.stemsPath = path.join(dir, 'EC-AI-Stems.zip');
      await saveGradioFile(values[1], job.stemsPath, 'zip');
    }
    setJob(job, {
      status: job.stemsPath ? 'completed' : 'partial',
      stage: job.stemsPath ? 'done' : 'mix',
      stageLabel: job.stemsPath ? 'Generación terminada' : 'Mezcla completa lista',
      progress: 100,
      message: job.stemsPath ? 'La mezcla completa y las pistas separadas están listas.' : 'La mezcla está lista; no se pudo preparar el ZIP de pistas.',
      warning: job.stemsPath ? null : 'La separación de pistas no devolvió un ZIP.'
    });
  } catch (error) {
    console.error('[instrumental] Generation failed:', error.message);
    const hasMix = job.audioPath && fs.existsSync(job.audioPath);
    setJob(job, {
      status: hasMix ? 'partial' : 'failed',
      stage: hasMix ? 'mix' : 'error',
      stageLabel: hasMix ? 'Instrumental completa lista' : 'No se pudo completar la generación',
      progress: hasMix ? 55 : 0,
      message: hasMix ? 'La mezcla está lista, pero no se completó la separación de pistas.' : '',
      warning: hasMix ? error.message : null,
      error: hasMix ? null : error.message || 'No se pudo generar la instrumental.'
    });
  } finally {
    fs.rm(voicePath, { force: true }, () => {});
    job.finishedAt = Date.now();
    setTimeout(() => {
      const current = JOBS.get(job.id);
      if (current && current.finishedAt && Date.now() - current.finishedAt > 60 * 60 * 1000) {
        fs.rm(dir, { recursive: true, force: true }, () => {});
        JOBS.delete(job.id);
      }
    }, 60 * 60 * 1000).unref?.();
  }
}

function installInstrumentalApi(app, { customerAuth }) {
  const limiter = require('express-rate-limit')({
    windowMs: 60 * 60 * 1000, limit: 3, standardHeaders: 'draft-7', legacyHeaders: false,
    message: { error: 'Has alcanzado el límite de 3 generaciones por hora. Inténtalo más tarde.' }
  });
  app.get('/api/instrumental/status', customerAuth, (_req, res) => {
    const configured = Boolean(process.env.HF_MUSIC_SPACE && process.env.HF_TOKEN);
    res.json({
      available: configured, provider: 'Hugging Face ZeroGPU · ACE-Step 1.5 + Demucs',
      model: 'ACE-Step 1.5', stemModel: 'Demucs htdemucs_6s',
      maxUploadBytes: MAX_BYTES, stemSeparation: true,
      setupRequired: !configured,
      styles: Object.entries(STYLES).map(([id, style]) => ({ id, name: style.label }))
    });
  });
  app.post('/api/instrumental/generate', customerAuth, limiter, (req, res, next) => {
    upload(req, res, error => { if (error) return res.status(400).json({ error: error.message || 'No se pudo recibir la voz.' }); next(); });
  }, async (req, res) => {
    if (!process.env.HF_MUSIC_SPACE || !process.env.HF_TOKEN) return res.status(503).json({ error: 'El motor gratuito aún necesita configuración. Añade HF_MUSIC_SPACE y HF_TOKEN en Render y configura los secretos de GitHub Actions.' });
    if (!req.file) return res.status(400).json({ error: 'Sube una grabación de tu voz antes de generar.' });
    const styleId = String(req.body?.style || 'worship').toLowerCase();
    if (!STYLES[styleId]) return res.status(400).json({ error: 'Selecciona un estilo musical válido.' });
    const bpmValue = Number(req.body?.bpm);
    const job = {
      id: crypto.randomUUID(), userId: req.customer.id, status: 'queued', stage: 'queued',
      stageLabel: 'Preparando generación', progress: 4, message: 'Solicitud recibida.',
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      audioPath: null, stemsPath: null, audioExtension: '.wav'
    };
    JOBS.set(job.id, job);
    const voice = { buffer: Buffer.from(req.file.buffer), name: req.file.originalname || 'voice.wav' };
    const options = {
      style: styleId, mood: String(req.body?.mood || '').trim().slice(0, 120),
      notes: String(req.body?.notes || '').trim().slice(0, 500),
      bpm: Number.isFinite(bpmValue) && bpmValue >= 60 && bpmValue <= 200 ? Math.round(bpmValue) : null
    };
    setImmediate(() => runJob(job, voice, options));
    return res.status(202).json({ jobId: job.id, status: job.status, progress: job.progress, message: job.message });
  });
  app.get('/api/instrumental/jobs/:jobId', customerAuth, (req, res) => {
    const job = ownedJob(req, res); if (!job) return; return res.json(publicJob(job));
  });
  app.get('/api/instrumental/jobs/:jobId/audio', customerAuth, (req, res) => {
    const job = ownedJob(req, res); if (!job) return;
    if (!job.audioPath || !fs.existsSync(job.audioPath)) return res.status(404).json({ error: 'La instrumental todavía no está disponible.' });
    res.setHeader('Content-Type', 'audio/wav');
    res.setHeader('Content-Disposition', 'attachment; filename="EC-AI-Instrumental.wav"');
    res.setHeader('Cache-Control', 'private, no-store');
    return fs.createReadStream(job.audioPath).pipe(res);
  });
  app.get('/api/instrumental/jobs/:jobId/stems', customerAuth, (req, res) => {
    const job = ownedJob(req, res); if (!job) return;
    if (!job.stemsPath || !fs.existsSync(job.stemsPath)) return res.status(404).json({ error: 'Las pistas separadas todavía no están disponibles.' });
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="EC-AI-Stems.zip"');
    res.setHeader('Cache-Control', 'private, no-store');
    return fs.createReadStream(job.stemsPath).pipe(res);
  });
}
module.exports = { installInstrumentalApi };
