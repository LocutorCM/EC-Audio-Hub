'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const { execFile } = require('node:child_process');
const multer = require('multer');
const run = promisify(execFile);

const MAX_AUDIO_BYTES = Math.min(Math.max(10, Number(process.env.MASTERING_MAX_UPLOAD_MB || 150)), 500) * 1024 * 1024;
const WORK_DIR = path.join(os.tmpdir(), 'ec-audio-mastering');
fs.mkdirSync(WORK_DIR, { recursive: true, mode: 0o700 });

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_AUDIO_BYTES, files: 1, fields: 2 },
  fileFilter(_req, file, cb) {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const allowed = new Set(['.wav', '.wave', '.mp3', '.flac', '.aif', '.aiff', '.m4a', '.aac', '.ogg', '.opus']);
    if (!allowed.has(ext)) return cb(new Error('Formato no compatible. Usa WAV, MP3, FLAC, AIFF, M4A, AAC, OGG u OPUS.'));
    cb(null, true);
  }
}).single('audio');

const GENRES = {
  auto: { name: 'Auto / equilibrado', target: -14, tp: -1.0, lra: 11, eq: 'highpass=f=25,equalizer=f=110:t=q:w=0.8:g=0.4,equalizer=f=3200:t=q:w=1.0:g=0.5' },
  pop: { name: 'Pop', target: -14, tp: -1.0, lra: 10, eq: 'highpass=f=28,equalizer=f=90:t=q:w=0.8:g=0.6,equalizer=f=3500:t=q:w=1.0:g=0.7,equalizer=f=11000:t=q:w=0.7:g=0.5' },
  urban: { name: 'Urbano / reggaetón', target: -11, tp: -1.0, lra: 8, eq: 'highpass=f=25,equalizer=f=65:t=q:w=0.8:g=0.8,equalizer=f=250:t=q:w=1.0:g=-0.5,equalizer=f=4500:t=q:w=1.0:g=0.6' },
  rap: { name: 'Rap / hip-hop', target: -10, tp: -1.0, lra: 9, eq: 'highpass=f=25,equalizer=f=75:t=q:w=0.8:g=0.7,equalizer=f=250:t=q:w=1.0:g=-0.4,equalizer=f=4200:t=q:w=1.0:g=0.6' },
  rock: { name: 'Rock', target: -11, tp: -1.0, lra: 9, eq: 'highpass=f=30,equalizer=f=100:t=q:w=0.8:g=0.4,equalizer=f=280:t=q:w=1.0:g=-0.5,equalizer=f=3000:t=q:w=1.0:g=0.6' },
  worship: { name: 'Adoración / música cristiana', target: -14, tp: -1.0, lra: 12, eq: 'highpass=f=28,equalizer=f=120:t=q:w=0.8:g=0.3,equalizer=f=2800:t=q:w=1.0:g=0.4,equalizer=f=10000:t=q:w=0.7:g=0.3' },
  ballad: { name: 'Balada', target: -16, tp: -1.0, lra: 13, eq: 'highpass=f=25,equalizer=f=100:t=q:w=0.8:g=0.2,equalizer=f=3000:t=q:w=1.0:g=0.3,equalizer=f=12000:t=q:w=0.7:g=0.3' },
  electronic: { name: 'Electrónica', target: -10, tp: -1.0, lra: 8, eq: 'highpass=f=25,equalizer=f=60:t=q:w=0.8:g=0.7,equalizer=f=5000:t=q:w=1.0:g=0.4' },
  acoustic: { name: 'Acústica', target: -15, tp: -1.0, lra: 12, eq: 'highpass=f=35,equalizer=f=180:t=q:w=0.8:g=-0.2,equalizer=f=3500:t=q:w=1.0:g=0.4,equalizer=f=10000:t=q:w=0.7:g=0.3' }
};

async function probe(file) {
  const { stdout } = await run('ffprobe', ['-v','error','-show_entries','format=duration,size:stream=codec_name,sample_rate,channels','-of','json',file], { timeout:20000, maxBuffer:2*1024*1024 });
  const data = JSON.parse(stdout);
  const stream = (data.streams || []).find(item => item.codec_name);
  if (!stream) throw new Error('No se encontró una pista de audio válida.');
  const duration = Number(data.format?.duration);
  if (!Number.isFinite(duration) || duration <= 0 || duration > 3600) throw new Error('El audio debe durar menos de 60 minutos.');
  return { duration, sampleRate:Number(stream.sample_rate||0), channels:Number(stream.channels||0), codec:stream.codec_name };
}
async function measure(file) {
  try {
    const { stderr } = await run('ffmpeg', ['-hide_banner','-i',file,'-map','0:a:0','-vn','-af','volumedetect','-f','null','-'], { timeout:120000, maxBuffer:4*1024*1024 });
    const mean = stderr.match(/mean_volume:\s*(-?[\d.]+)\s*dB/i);
    const peak = stderr.match(/max_volume:\s*(-?[\d.]+)\s*dB/i);
    return { meanDb:mean?Number(mean[1]):null, peakDb:peak?Number(peak[1]):null, clippingRisk:peak?Number(peak[1])>=-0.1:false };
  } catch { return { meanDb:null, peakDb:null, clippingRisk:false }; }
}

function installMasteringApi(app, { customerAuth }) {
  const limiter = require('express-rate-limit')({ windowMs:3600000, limit:5, standardHeaders:'draft-7', legacyHeaders:false, message:{error:'Has alcanzado el límite temporal de masterizaciones. Inténtalo más tarde.'} });
  app.get('/api/mastering/status', customerAuth, (_req,res) => res.json({
    available:true, engine:'EC Audio Adaptive Mastering DSP', formats:['wav','mp3'], maxUploadBytes:MAX_AUDIO_BYTES,
    genres:Object.entries(GENRES).map(([id,profile])=>({id,name:profile.name}))
  }));
  app.post('/api/mastering/process', customerAuth, limiter, (req,res,next) => {
    upload(req,res,error => { if(error) return res.status(400).json({error:error.message||'No se pudo recibir el audio.'}); next(); });
  }, async (req,res) => {
    if (!req.file) return res.status(400).json({error:'Selecciona una canción para masterizar.'});
    const genreId=String(req.body?.genre||'auto').toLowerCase();
    const format=String(req.body?.format||'wav').toLowerCase();
    if(!GENRES[genreId]) return res.status(400).json({error:'Selecciona un género válido.'});
    if(!['wav','mp3'].includes(format)) return res.status(400).json({error:'El formato de salida debe ser WAV o MP3.'});
    const jobId=crypto.randomUUID();
    const inputPath=path.join(WORK_DIR,jobId+path.extname(req.file.originalname).toLowerCase());
    const outputPath=path.join(WORK_DIR,jobId+(format==='wav'?'.wav':'.mp3'));
    try {
      fs.writeFileSync(inputPath,req.file.buffer,{mode:0o600,flag:'wx'});
      const info=await probe(inputPath);
      const before=await measure(inputPath);
      const profile=GENRES[genreId];
      const preFilters=profile.eq+',acompressor=threshold=0.125:ratio=1.6:attack=25:release=220:makeup=1.0,alimiter=limit=0.891:attack=5:release=80:level=disabled';
      const loudnormBase='loudnorm=I='+profile.target+':TP='+profile.tp+':LRA='+profile.lra;
      let loudnorm=loudnormBase+':linear=true:print_format=summary';
      // Pass 1 measures integrated loudness and true peak after tone/dynamics processing.
      try {
        const analysis=await run('ffmpeg',['-hide_banner','-i',inputPath,'-map','0:a:0','-vn','-af',preFilters+','+loudnormBase+':print_format=json','-f','null','-'],{timeout:Math.max(180000,Math.ceil(info.duration*12000)),maxBuffer:8*1024*1024});
        const match=analysis.stderr.match(/\{[\s\S]*?"input_i"[\s\S]*?\}/);
        if(match) {
          const measured=JSON.parse(match[0]);
          const keys=['input_i','input_tp','input_lra','input_thresh','target_offset'];
          if(keys.every(key=>Number.isFinite(Number(measured[key])))) {
            loudnorm=loudnormBase+':measured_I='+measured.input_i+':measured_TP='+measured.input_tp+':measured_LRA='+measured.input_lra+':measured_thresh='+measured.input_thresh+':offset='+measured.target_offset+':linear=true:print_format=summary';
          }
        }
      } catch (analysisError) {
        console.warn('[mastering] Loudness analysis fallback:',analysisError.message);
      }
      // Pass 2 applies measured EBU R128 normalization for a more consistent target.
      const filters=preFilters+','+loudnorm;
      const args=['-hide_banner','-y','-i',inputPath,'-map','0:a:0','-vn','-af',filters,'-ar','48000'];
      if(format==='wav') args.push('-c:a','pcm_s24le','-f','wav');
      else args.push('-c:a','libmp3lame','-b:a','320k','-f','mp3');
      args.push(outputPath);
      await run('ffmpeg',args,{timeout:Math.max(180000,Math.ceil(info.duration*12000)),maxBuffer:8*1024*1024});
      const after=await measure(outputPath);
      const outputName=path.basename(req.file.originalname,path.extname(req.file.originalname)).replace(/[^a-zA-Z0-9._-]+/g,'-').slice(0,80)||'EC-Audio';
      const downloadName=outputName+'-EC-AI-Mastered.'+format;
      const stat=fs.statSync(outputPath);
      res.setHeader('Content-Type',format==='wav'?'audio/wav':'audio/mpeg');
      res.setHeader('Content-Length',stat.size);
      res.setHeader('Content-Disposition','attachment; filename="'+downloadName+'"');
      res.setHeader('X-EC-Mastering-Profile',encodeURIComponent(profile.name));
      res.setHeader('X-EC-Mastering-Target-LUFS',String(profile.target));
      res.setHeader('X-EC-Mastering-Input-Peak',before.peakDb==null?'unknown':String(before.peakDb));
      res.setHeader('X-EC-Mastering-Output-Peak',after.peakDb==null?'unknown':String(after.peakDb));
      res.setHeader('X-EC-Mastering-Duration',String(info.duration));
      const cleanup=()=>{fs.rm(inputPath,{force:true},()=>{});fs.rm(outputPath,{force:true},()=>{});};
      const stream=fs.createReadStream(outputPath);
      stream.on('close',cleanup);
      stream.on('error',()=>{if(!res.headersSent)res.status(500);cleanup();res.end();});
      req.on('aborted',cleanup);
      stream.pipe(res);
    } catch(error) {
      fs.rm(inputPath,{force:true},()=>{}); fs.rm(outputPath,{force:true},()=>{});
      console.error('[mastering]',error.message);
      const message=/ENOENT/.test(error.message)?'El motor de audio no está instalado en el servidor. Revisa el despliegue de FFmpeg.':(error.message||'No se pudo masterizar este archivo.');
      return res.status(422).json({error:message});
    }
  });
}
module.exports={installMasteringApi};
