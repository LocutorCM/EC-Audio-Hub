'use strict';
const multer = require('multer');

const MAX_BYTES = 50 * 1024 * 1024;
const MODEL = 'fal-ai/ace-step/audio-to-audio';
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES, files: 1, fields: 4 },
  fileFilter(_req, file, cb) {
    const ext = require('node:path').extname(file.originalname || '').toLowerCase();
    if (!['.wav','.mp3','.m4a','.aac','.ogg'].includes(ext)) {
      return cb(new Error('Formato no compatible. Usa WAV, MP3, M4A, AAC u OGG.'));
    }
    cb(null, true);
  }
}).single('voice');

const STYLES = {
  worship: { label:'Adoración / Worship', tags:'christian worship, cinematic worship, emotional piano, warm pads, ambient electric guitars, live drums, bass, uplifting arrangement' },
  ballad: { label:'Balada', tags:'emotional pop ballad, piano, acoustic guitar, warm strings, soft drums, melodic bass, cinematic arrangement' },
  acoustic: { label:'Acústico', tags:'acoustic pop, fingerpicked acoustic guitar, warm piano, subtle bass, brushed percussion, intimate organic arrangement' },
  pop: { label:'Pop', tags:'modern pop, bright piano, synth layers, punchy drums, melodic bass, polished radio production' },
  urban: { label:'Urbano / Reggaetón', tags:'latin urban, reggaeton groove, dembow drums, deep bass, atmospheric synths, rhythmic guitar, modern production' },
  rap: { label:'Rap / Hip-hop', tags:'hip hop, boom bap drums, deep bass, soulful piano, atmospheric samples, head nod groove' },
  trap: { label:'Trap', tags:'melodic trap, 808 bass, crisp hi hats, punchy kick, atmospheric pads, dark piano, modern trap production' },
  rock: { label:'Rock', tags:'alternative rock, electric guitars, live drums, electric bass, wide guitars, energetic band arrangement' },
  rnb: { label:'R&B / Soul', tags:'modern rnb, soulful keys, warm bass, laid back drums, lush chords, subtle guitar textures' },
  cinematic: { label:'Cinemático', tags:'cinematic orchestral, piano, strings, atmospheric pads, deep percussion, emotional dynamic build' }
};

function installInstrumentalApi(app, { customerAuth }) {
  const limiter = require('express-rate-limit')({
    windowMs: 60 * 60 * 1000, limit: 3, standardHeaders: 'draft-7', legacyHeaders: false,
    message: { error: 'Has alcanzado el límite de 3 generaciones por hora. Inténtalo más tarde.' }
  });

  app.get('/api/instrumental/status', customerAuth, (_req, res) => {
    res.json({ available: Boolean(process.env.FAL_KEY), provider: 'fal.ai', model: MODEL, maxUploadBytes: MAX_BYTES, styles: Object.entries(STYLES).map(([id, style]) => ({ id, name: style.label })) });
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
    const style = STYLES[styleId];
    if (!style) return res.status(400).json({ error: 'Selecciona un estilo musical válido.' });
    const mood = String(req.body?.mood || '').trim().slice(0, 120);
    const tempo = String(req.body?.tempo || 'natural').trim().toLowerCase();
    const tempoText = ({ slow:'slow tempo, spacious arrangement', medium:'mid-tempo groove', fast:'up-tempo energetic groove', natural:'follow the vocal phrasing and natural tempo' })[tempo] || 'follow the vocal phrasing and natural tempo';
    const notes = String(req.body?.notes || '').trim().slice(0, 500);
    try {
      const { fal } = await import('@fal-ai/client');
      fal.config({ credentials: process.env.FAL_KEY });
      const voiceFile = new File([req.file.buffer], req.file.originalname, { type: req.file.mimetype || 'audio/wav' });
      const audioUrl = await fal.storage.upload(voiceFile);
      const prompt = [
        'Create a complete instrumental backing track for the uploaded solo a cappella human singing voice.',
        'Use the uploaded voice as the timing, melody, phrasing and emotional reference. Keep the singer out of the generated result: instrumental only, absolutely no vocals, no choir, no spoken words.',
        'Make the accompaniment fit the vocal melody and phrasing; do not replace or reinterpret the singer.',
        style.tags, tempoText, mood ? 'Mood: ' + mood : '', notes ? 'Additional direction: ' + notes : '',
        'Professional studio arrangement, musical intro and ending, clean mix, balanced frequency spectrum.'
      ].filter(Boolean).join('. ');
      const result = await fal.subscribe(MODEL, {
        input: {
          audio_url: audioUrl,
          edit_mode: 'remix',
          original_tags: 'solo a cappella lead singing voice, unaccompanied vocal recording',
          original_lyrics: '',
          tags: prompt,
          lyrics: '[inst]',
          enable_safety_checker: true
        },
        logs: false
      });
      const audio = result?.data?.audio;
      const outputUrl = typeof audio === 'string' ? audio : audio?.url;
      if (!outputUrl || !/^https:\/\//i.test(outputUrl)) throw new Error('El motor de IA no devolvió un archivo de audio válido.');
      const remote = await fetch(outputUrl, { signal: AbortSignal.timeout(90000) });
      if (!remote.ok) throw new Error('La IA generó el audio, pero no se pudo recuperar el archivo final.');
      const contentType = remote.headers.get('content-type') || 'audio/mpeg';
      if (!contentType.startsWith('audio/')) throw new Error('El motor devolvió un formato inesperado.');
      const bytes = Buffer.from(await remote.arrayBuffer());
      if (!bytes.length || bytes.length > 100 * 1024 * 1024) throw new Error('El archivo generado está vacío o supera el límite de descarga.');
      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Length', bytes.length);
      res.setHeader('Content-Disposition', 'attachment; filename="EC-AI-Instrumental.' + (contentType.includes('wav') ? 'wav' : 'mp3') + '"');
      res.setHeader('Cache-Control', 'no-store');
      return res.send(bytes);
    } catch (error) {
      console.error('[instrumental] Generation failed:', error.message);
      const message = /401|403|unauthorized|invalid.*key/i.test(error.message) ? 'La conexión con el proveedor de IA no es válida. Revisa FAL_KEY en Render.' :
        /timeout|timed out|abort/i.test(error.message) ? 'La generación tardó demasiado. Inténtalo nuevamente con una grabación más corta.' :
        error.message || 'No se pudo generar la instrumental.';
      return res.status(502).json({ error: message });
    }
  });
}

module.exports = { installInstrumentalApi };
