'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const { execFile } = require('node:child_process');
const multer = require('multer');

const run = promisify(execFile);
const MAX_BYTES = 50 * 1024 * 1024;
const MODEL = 'fal-ai/ace-step/audio-to-audio';
const STEM_MODEL = 'mureka/api/song/stem';
const JOBS = new Map();
const WORK_DIR = path.join(os.tmpdir(), 'ec-audio-instrumental');
fs.mkdirSync(WORK_DIR, { recursive: true, mode: 0o700 });

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES, files: 1, fields: 5 },
  fileFilter(_req, file, cb) {
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (!['.wav', '.mp3', '.m4a', '.aac', '.ogg'].includes(ext)) {
      return cb(new Error('Formato no compatible. Usa WAV, MP3, M4A, AAC u OGG.'));
    }
    cb(null, true);
  }
}).single('voice');

const STYLES = {
  worship: { label: 'Adoración / Worship', tags: 'christian worship, cinematic worship, emotional piano, warm pads, ambient electric guitars, live drums, bass, uplifting arrangement' },
  ballad: { label: 'Balada', tags: 'emotional pop ballad, piano, acoustic guitar, warm strings, soft drums, melodic bass, cinematic arrangement' },
  acoustic: { label: 'Acústico', tags: 'acoustic pop, fingerpicked acoustic guitar, warm piano, subtle bass, brushed percussion, intimate organic arrangement' },
  pop: { label: 'Pop', tags: 'modern pop, bright piano, synth layers, punchy drums, melodic bass, polished radio production' },
  urban: { label: 'Urbano / Reggaetón', tags: 'latin urban, reggaeton groove, dembow drums, deep bass, atmospheric synths, rhythmic guitar, modern production' },
  reggaeton: { label: 'Reggaetón clásico', tags: 'classic reggaeton, dembow rhythm, punchy kick and snare, syncopated percussion, deep bass, bright synths' },
  rap: { label: 'Rap / Hip-hop', tags: 'hip hop, boom bap drums, deep bass, soulful piano, atmospheric samples, head nod groove' },
  boom_bap: { label: 'Boom bap', tags: 'classic boom bap hip hop, dusty sampled piano, chopped soul textures, punchy kick, crisp snare, warm bass' },
  trap: { label: 'Trap', tags: 'melodic trap, 808 bass, crisp hi hats, punchy kick, atmospheric pads, dark piano, modern trap production' },
  drill: { label: 'Drill', tags: 'dark drill, sliding 808 bass, syncopated kick, sharp snare, rapid hi hats, ominous piano and strings' },
  afrobeat: { label: 'Afrobeat', tags: 'modern afrobeat, syncopated percussion, warm bass guitar, bright plucked guitar, marimba keys, danceable groove' },
  house: { label: 'House / Dance', tags: 'modern house, four on the floor kick, deep bass, bright piano chords, rhythmic synths, dance groove' },
  rock: { label: 'Rock', tags: 'alternative rock, electric guitars, live drums, electric bass, wide guitars, energetic band arrangement' },
  rnb: { label: 'R&B / Soul', tags: 'modern rnb, soulful keys, warm bass, laid back drums, lush chords, subtle guitar textures' },
  cinematic: { label: 'Cinemático', tags: 'cinematic orchestral, piano, strings, atmospheric pads, deep percussion, emotional dynamic build' }
};

function setJob(job, values) {
  Object.assign(job, values, { updatedAt: new Date().toISOString() });
}
function publicJob(job) {
  return {
    jobId: job.id,
    status: job.status,
    stage: job.stage,
    stageLabel: job.stageLabel,
    progress: job.progress,
    message: job.message || '',
    audioReady: Boolean(job.audioPath && fs.existsSync(job.audioPath)),
    audioExtension: job.audioExtension || '.mp3',
    stemsReady: Boolean(job.stemsUrl),
    audioDownloadUrl: job.audioPath ? '/api/instrumental/jobs/' + job.id + '/audio' : null,
    stemsDownloadUrl: job.stemsUrl || null,
    warning: job.warning || null,
    error: job.error || null
  };
}
function ownedJob(req, res) {
  const job = JOBS.get(String(req.params.jobId || ''));
  if (!job || job.userId !== req.customer.id) {
    res.status(404).json({ error: 'No se encontró esta generación.' });
    return null;
  }
  return job;
}
async function downloadAudio(url, destination) {
  const response = await fetch(url, { signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error('No se pudo descargar el audio generado por el proveedor.');
  const type = response.headers.get('content-type') || '';
  if (!type.startsWith('audio/')) throw new Error('El proveedor no devolvió un archivo de audio válido.');
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length || bytes.length > 150 * 1024 * 1024) throw new Error('El audio generado está vacío o supera el límite permitido.');
  fs.writeFileSync(destination, bytes, { mode: 0o600, flag: 'wx' });
  return { bytes: bytes.length, contentType: type };
}
async function runJob(job, voice, options) {
  let voicePath = null;
  let mp3Path = null;
  try {
    const { fal } = await import('@fal-ai/client');
    fal.config({ credentials: process.env.FAL_KEY });
    setJob(job, { status: 'running', stage: 'upload', stageLabel: 'Preparando tu voz', progress: 8, message: 'Subiendo tu referencia de voz al motor de IA.' });
    const voiceFile = new File([voice.buffer], voice.name, { type: voice.type || 'audio/wav' });
    const voiceUrl = await fal.storage.upload(voiceFile);

    const style = STYLES[options.style];
    const bpmText = options.bpm ? 'target tempo approximately ' + options.bpm + ' BPM' : 'follow the natural vocal tempo';
    const prompt = [
      'Create a complete, polished, professional instrumental backing track for the uploaded solo a cappella human singing voice.',
      'Use the uploaded voice as the timing, melody, phrasing and emotional reference. The generated result must be instrumental only: absolutely no lead vocals, no choir, no spoken words.',
      'Build a full musical arrangement with a clear intro, verses, choruses, transitions, dynamic development and a musical ending where appropriate.',
      'Keep the accompaniment supportive of the vocal melody and leave clear space for the singer.',
      style.tags,
      bpmText,
      options.mood ? 'Mood and emotion: ' + options.mood : '',
      options.notes ? 'Arrangement directions: ' + options.notes : '',
      'Studio-quality production, balanced frequency spectrum, controlled low end, natural dynamics, coherent harmony and musical arrangement.'
    ].filter(Boolean).join('. ');

    setJob(job, { stage: 'composition', stageLabel: 'Componiendo la instrumental completa', progress: 18, message: 'ACE-Step está creando el acompañamiento a partir de tu voz.' });
    const generated = await fal.subscribe(MODEL, {
      input: {
        audio_url: voiceUrl,
        edit_mode: 'remix',
        original_tags: 'solo a cappella lead singing voice, unaccompanied vocal recording',
        original_lyrics: '',
        tags: prompt,
        lyrics: '[inst]',
        enable_safety_checker: true
      },
      logs: false,
      onQueueUpdate(update) {
        if (update.status === 'IN_QUEUE') {
          setJob(job, { stage: 'composition', stageLabel: 'En cola de generación musical', progress: 20, message: 'El proveedor está preparando los recursos de IA.' });
        } else if (update.status === 'IN_PROGRESS') {
          setJob(job, { stage: 'composition', stageLabel: 'Componiendo instrumental con IA', progress: 32, message: 'Generando armonía, ritmo, bajo y arreglos en una sola composición.' });
        }
      }
    });
    const audio = generated?.data?.audio;
    const audioUrl = typeof audio === 'string' ? audio : audio?.url;
    if (!audioUrl || !/^https:\/\//i.test(audioUrl)) throw new Error('El motor de IA no devolvió un archivo de audio válido.');

    const idDir = path.join(WORK_DIR, job.id);
    fs.mkdirSync(idDir, { recursive: true, mode: 0o700 });
    voicePath = path.join(idDir, 'voice-reference');
    const outputExt = (audio?.content_type || '').includes('wav') ? '.wav' : '.mp3';
    job.audioPath = path.join(idDir, 'EC-AI-Instrumental' + outputExt);
    const downloaded = await downloadAudio(audioUrl, job.audioPath);
    job.audioExtension = path.extname(job.audioPath);
    setJob(job, { stage: 'mix', stageLabel: 'Instrumental completa lista', progress: 52, message: 'La composición completa está lista. Preparando la separación de pistas.' });

    setJob(job, { stage: 'separation', stageLabel: 'Separando pistas individuales', progress: 60, message: 'La IA está identificando y separando las capas instrumentales disponibles.' });
    mp3Path = path.join(idDir, 'instrumental-for-stems.mp3');
    await run('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-y', '-i', job.audioPath,
      '-vn', '-ac', '2', '-ar', '44100', '-b:a', '192k', '-f', 'mp3', mp3Path
    ], { timeout: 180000, maxBuffer: 4 * 1024 * 1024 });
    const mp3Stat = fs.statSync(mp3Path);
    if (mp3Stat.size > 10 * 1024 * 1024) {
      throw new Error('La instrumental supera el límite de 10 MB del servicio de separación. Descarga la mezcla completa; las pistas separadas no pudieron procesarse.');
    }
    const stemFile = new File([fs.readFileSync(mp3Path)], 'EC-AI-Instrumental.mp3', { type: 'audio/mpeg' });
    const stemAudioUrl = await fal.storage.upload(stemFile);
    const stemModel = String(process.env.FAL_STEM_MODEL || 'audio-separation-3');
    const separated = await fal.subscribe(STEM_MODEL, {
      input: { model: stemModel, audio_url: stemAudioUrl },
      logs: false,
      onQueueUpdate(update) {
        if (update.status === 'IN_QUEUE') {
          setJob(job, { stage: 'separation', stageLabel: 'Pistas en cola de separación', progress: 64, message: 'La instrumental está en espera para separar sus capas.' });
        } else if (update.status === 'IN_PROGRESS') {
          setJob(job, { stage: 'separation', stageLabel: 'Separando batería, bajo y demás capas', progress: 76, message: 'El modelo está procesando los stems detectables de la instrumental.' });
        }
      }
    });
    const zipUrl = separated?.data?.zip_url;
    if (typeof zipUrl !== 'string' || !/^https:\/\//i.test(zipUrl)) {
      throw new Error('El servicio de separación no devolvió el paquete de pistas.');
    }
    setJob(job, {
      status: 'completed',
      stage: 'done',
      stageLabel: 'Generación terminada',
      progress: 100,
      message: 'La instrumental completa y el paquete de pistas separadas están listos.',
      stemsUrl: zipUrl,
      audioBytes: downloaded.bytes,
      audioContentType: downloaded.contentType
    });
  } catch (error) {
    console.error('[instrumental] Generation failed:', error.message);
    if (job.audioPath && fs.existsSync(job.audioPath)) {
      setJob(job, {
        status: 'partial',
        stage: 'mix',
        stageLabel: 'Instrumental completa lista',
        progress: 55,
        message: 'La instrumental se creó, pero la separación de pistas no terminó.',
        warning: error.message || 'No se pudieron generar las pistas separadas.'
      });
    } else {
      setJob(job, {
        status: 'failed',
        stage: 'error',
        stageLabel: 'No se pudo completar la generación',
        progress: 0,
        error: /401|403|unauthorized|invalid.*key/i.test(error.message)
          ? 'La conexión con el proveedor de IA no es válida. Revisa FAL_KEY en Render.'
          : error.message || 'No se pudo generar la instrumental.'
      });
    }
  } finally {
    if (mp3Path) fs.rm(mp3Path, { force: true }, () => {});
    if (voicePath) fs.rm(voicePath, { force: true }, () => {});
    setTimeout(() => {
      const current = JOBS.get(job.id);
      if (current && current.finishedAt && Date.now() - current.finishedAt > 60 * 60 * 1000) {
        if (current.audioPath) fs.rm(path.dirname(current.audioPath), { recursive: true, force: true }, () => {});
        JOBS.delete(job.id);
      }
    }, 60 * 60 * 1000).unref?.();
    job.finishedAt = Date.now();
  }
}

function installInstrumentalApi(app, { customerAuth }) {
  const limiter = require('express-rate-limit')({
    windowMs: 60 * 60 * 1000,
    limit: 3,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Has alcanzado el límite de 3 generaciones por hora. Inténtalo más tarde.' }
  });

  app.get('/api/instrumental/status', customerAuth, (_req, res) => {
    res.json({
      available: Boolean(process.env.FAL_KEY),
      provider: 'fal.ai',
      model: MODEL,
      stemModel: STEM_MODEL,
      maxUploadBytes: MAX_BYTES,
      stemSeparation: true,
      styles: Object.entries(STYLES).map(([id, style]) => ({ id, name: style.label }))
    });
  });

  app.post('/api/instrumental/generate', customerAuth, limiter, (req, res, next) => {
    upload(req, res, error => {
      if (error) return res.status(400).json({ error: error.message || 'No se pudo recibir la voz.' });
      next();
    });
  }, async (req, res) => {
    if (!process.env.FAL_KEY) return res.status(503).json({ error: 'El motor de IA musical aún no está conectado. Falta configurar FAL_KEY en el servidor EC Audio.' });
    if (!req.file) return res.status(400).json({ error: 'Sube una grabación de tu voz antes de generar.' });
    const styleId = String(req.body?.style || 'worship').toLowerCase();
    if (!STYLES[styleId]) return res.status(400).json({ error: 'Selecciona un estilo musical válido.' });
    const mood = String(req.body?.mood || '').trim().slice(0, 120);
    const notes = String(req.body?.notes || '').trim().slice(0, 500);
    const bpmValue = Number(req.body?.bpm);
    const bpm = Number.isFinite(bpmValue) && bpmValue >= 60 && bpmValue <= 200 ? Math.round(bpmValue) : null;
    const job = {
      id: crypto.randomUUID(),
      userId: req.customer.id,
      status: 'queued',
      stage: 'queued',
      stageLabel: 'Preparando generación',
      progress: 4,
      message: 'Tu solicitud fue recibida.',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      audioPath: null,
      stemsUrl: null
    };
    JOBS.set(job.id, job);
    const voice = {
      buffer: Buffer.from(req.file.buffer),
      name: req.file.originalname || 'voice.wav',
      type: req.file.mimetype || 'audio/wav'
    };
    setImmediate(() => runJob(job, voice, { style: styleId, mood, notes, bpm }));
    return res.status(202).json({ jobId: job.id, status: job.status, progress: job.progress, message: job.message });
  });

  app.get('/api/instrumental/jobs/:jobId', customerAuth, (req, res) => {
    const job = ownedJob(req, res);
    if (!job) return;
    return res.json(publicJob(job));
  });

  app.get('/api/instrumental/jobs/:jobId/audio', customerAuth, (req, res) => {
    const job = ownedJob(req, res);
    if (!job) return;
    if (!job.audioPath || !fs.existsSync(job.audioPath)) return res.status(404).json({ error: 'La instrumental todavía no está disponible.' });
    const contentType = job.audioContentType || (job.audioPath.endsWith('.wav') ? 'audio/wav' : 'audio/mpeg');
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', 'attachment; filename="EC-AI-Instrumental' + path.extname(job.audioPath) + '"');
    res.setHeader('Cache-Control', 'private, no-store');
    return fs.createReadStream(job.audioPath).pipe(res);
  });
}

module.exports = { installInstrumentalApi };
