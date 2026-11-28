const $ = (id) => document.getElementById(id);
let selectedFile = null, originalURL = null, masteredURL = null, busy = false;
const profiles = {
  auto: {name:"Adaptativo EC", target:-14, hp:28, low:0, body:0, presence:0.5, air:0.5, threshold:-20, ratio:2.3},
  urban:{name:"Urbano / Reggaetón",target:-10.5,hp:30,low:0.8,body:0.2,presence:0.4,air:0.8,threshold:-19,ratio:2.8},
  rap:{name:"Rap / Hip-hop",target:-11,hp:28,low:0.5,body:0.4,presence:0.8,air:0.4,threshold:-20,ratio:2.6},
  pop:{name:"Pop",target:-12,hp:30,low:0.2,body:0.2,presence:0.7,air:0.8,threshold:-21,ratio:2.4},
  rock:{name:"Rock",target:-11.5,hp:35,low:0.2,body:0.4,presence:0.5,air:0.2,threshold:-22,ratio:3},
  worship:{name:"Adoración",target:-14,hp:28,low:0.1,body:0.3,presence:0.4,air:0.5,threshold:-21,ratio:2.1},
  ballad:{name:"Balada",target:-14,hp:25,low:0,body:0.4,presence:0.3,air:0.6,threshold:-23,ratio:2},
  electronic:{name:"Electrónica",target:-9.5,hp:30,low:0.5,body:0.1,presence:0.4,air:0.5,threshold:-18,ratio:3},
  acoustic:{name:"Acústica",target:-15,hp:35,low:0,body:0.2,presence:0.5,air:0.5,threshold:-23,ratio:1.9}
};
function formatBytes(n){return n<1048576?(n/1024).toFixed(0)+" KB":(n/1048576).toFixed(1)+" MB";}
function showError(message){$("errorBox").textContent=message;$("errorBox").classList.add("show");}
function clearError(){$("errorBox").textContent="";$("errorBox").classList.remove("show");}
function setProgress(value,label){$("status").classList.add("show");$("statusText").textContent=label;$("statusPercent").textContent=Math.round(value)+"%";$("progressBar").style.width=value+"%";}
function db(v){return v>0?20*Math.log10(v):-120;}
function stats(buffer){
  let sum=0, count=0, peak=0;
  for(let c=0;c<buffer.numberOfChannels;c++){const a=buffer.getChannelData(c);for(let i=0;i<a.length;i++){const v=a[i];sum+=v*v;count++;peak=Math.max(peak,Math.abs(v));}}
  return {rms:Math.sqrt(sum/Math.max(1,count)),peak};
}
function clearMaster(){if(masteredURL)URL.revokeObjectURL(masteredURL);masteredURL=null;$("result").classList.remove("show");$("emptyResult").hidden=false;$("resultState").textContent="ESPERANDO AUDIO";$("resultState").style.color="var(--muted)";}
function setFile(file){
  clearError();
  if(!file){selectedFile=null;$("fileLine").hidden=true;$("originalPlayer").hidden=true;if(originalURL)URL.revokeObjectURL(originalURL);originalURL=null;$("masterButton").disabled=true;clearMaster();return;}
  const ext=(file.name.split(".").pop()||"").toLowerCase();
  if(!["wav","wave","mp3","flac","aif","aiff","m4a","aac","ogg","opus"].includes(ext)){showError("Formato no compatible. Prueba con WAV, MP3, FLAC, AIFF, M4A, AAC, OGG u OPUS.");return;}
  if(file.size>80*1024*1024){showError("Para procesar de forma estable desde el navegador, el límite actual es 80 MB. Prueba exportar una versión WAV o MP3 más ligera.");return;}
  selectedFile=file;$("fileName").textContent=file.name;$("fileSize").textContent=formatBytes(file.size);$("fileLine").hidden=false;
  if(originalURL)URL.revokeObjectURL(originalURL);originalURL=URL.createObjectURL(file);$("originalPlayer").src=originalURL;$("originalPlayer").hidden=false;$("masterButton").disabled=false;clearMaster();
}
$("audioFile").addEventListener("change",e=>setFile(e.target.files?.[0]));
$("removeFile").addEventListener("click",()=>{$("audioFile").value="";setFile(null);});
const drop=$("dropzone");
drop.addEventListener("dragover",e=>{e.preventDefault();drop.classList.add("drag");});
drop.addEventListener("dragleave",()=>drop.classList.remove("drag"));
drop.addEventListener("drop",e=>{e.preventDefault();drop.classList.remove("drag");const f=e.dataTransfer.files?.[0];if(f)setFile(f);});
function encodeWav24(buffer){
  const channels=buffer.numberOfChannels, frames=buffer.length, bytesPerSample=3;
  const dataSize=frames*channels*bytesPerSample, out=new ArrayBuffer(44+dataSize), view=new DataView(out);
  const write=(offset,str)=>{for(let i=0;i<str.length;i++)view.setUint8(offset+i,str.charCodeAt(i));};
  write(0,"RIFF");view.setUint32(4,36+dataSize,true);write(8,"WAVE");write(12,"fmt ");view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,channels,true);view.setUint32(24,buffer.sampleRate,true);view.setUint32(28,buffer.sampleRate*channels*bytesPerSample,true);view.setUint16(32,channels*bytesPerSample,true);view.setUint16(34,24,true);write(36,"data");view.setUint32(40,dataSize,true);
  const source=Array.from({length:channels},(_,c)=>buffer.getChannelData(c));let offset=44;
  for(let i=0;i<frames;i++)for(let c=0;c<channels;c++){let s=Math.max(-1,Math.min(1,source[c][i]));let n=Math.round(s<0?s*8388608:s*8388607);view.setUint8(offset,n&255);view.setUint8(offset+1,(n>>8)&255);view.setUint8(offset+2,(n>>16)&255);offset+=3;}
  return new Blob([out],{type:"audio/wav"});
}
async function renderMaster(input,profile,onProgress){
  const rate=48000,channels=Math.min(2,input.numberOfChannels),frames=Math.ceil(input.duration*rate);
  if(!Number.isFinite(frames)||frames<1||frames>rate*600)throw new Error("La canción supera el límite de 10 minutos para el procesamiento local.");
  const offline=new OfflineAudioContext(channels,frames,rate);
  const source=offline.createBufferSource();source.buffer=input;
  let node=source;
  const connectFilter=(type,freq,gain,q=0.707)=>{
    const f=offline.createBiquadFilter();f.type=type;f.frequency.value=freq;f.Q.value=q;if(type==="lowshelf"||type==="highshelf"||type==="peaking")f.gain.value=gain;node.connect(f);node=f;
  };
  connectFilter("highpass",profile.hp,0,0.707);
  if(profile.low)connectFilter("lowshelf",100,profile.low,0.7);
  if(profile.body)connectFilter("peaking",260,profile.body,0.85);
  if(profile.presence)connectFilter("peaking",3200,profile.presence,0.9);
  if(profile.air)connectFilter("highshelf",10500,profile.air,0.7);
  const compressor=offline.createDynamicsCompressor();compressor.threshold.value=profile.threshold;compressor.knee.value=12;compressor.ratio.value=profile.ratio;compressor.attack.value=0.012;compressor.release.value=0.18;node.connect(compressor);node=compressor;
  const limiter=offline.createDynamicsCompressor();limiter.threshold.value=-3;limiter.knee.value=0;limiter.ratio.value=16;limiter.attack.value=0.002;limiter.release.value=0.08;node.connect(limiter);node=limiter;
  const gain=offline.createGain();gain.gain.value=1;node.connect(gain);gain.connect(offline.destination);source.start(0);
  onProgress(32,"Aplicando ecualización y control dinámico…");
  const rendered=await offline.startRendering();onProgress(76,"Midiendo loudness y pico…");
  const s=stats(rendered);const targetRms=Math.pow(10,profile.target/20);
  let multiplier=s.rms>0?targetRms/s.rms:1;multiplier=Math.min(multiplier,Math.pow(10,12/20));
  const ceiling=Math.pow(10,-1/20);if(s.peak*multiplier>ceiling)multiplier=ceiling/Math.max(s.peak,1e-9);
  const normalized=new OfflineAudioContext(channels,rendered.length,rate);const src=normalized.createBufferSource();src.buffer=rendered;const g=normalized.createGain();g.gain.value=multiplier;src.connect(g);g.connect(normalized.destination);src.start(0);
  const finalBuffer=await normalized.startRendering();onProgress(92,"Preparando WAV de 24 bits…");
  const finalStats=stats(finalBuffer);
  return {blob:encodeWav24(finalBuffer),inputPeak:db(stats(input).peak),outputPeak:db(finalStats.peak),profile:profile.name,target:profile.target};
}
$("masterButton").addEventListener("click",async()=>{
  if(!selectedFile||busy)return;clearError();busy=true;$("masterButton").disabled=true;$("resultState").textContent="PROCESANDO";
  let context;
  try{
    if(!window.AudioContext&&!window.webkitAudioContext)throw new Error("Este navegador no admite procesamiento de audio. Abre EC Audio desde Chrome o Safari actualizado.");
    const AudioCtx=window.AudioContext||window.webkitAudioContext;context=new AudioCtx();
    setProgress(5,"Leyendo archivo de audio…");
    const bytes=await selectedFile.arrayBuffer();setProgress(14,"Analizando la mezcla…");
    const decoded=await context.decodeAudioData(bytes.slice(0));
    if(decoded.duration>600)throw new Error("La canción supera el límite de 10 minutos para el procesamiento local.");
    if(decoded.numberOfChannels>2)throw new Error("El archivo tiene más de dos canales. Exporta una mezcla estéreo e inténtalo de nuevo.");
    const profile=profiles[$("genre").value]||profiles.auto;
    const result=await renderMaster(decoded,profile,setProgress);
    if(masteredURL)URL.revokeObjectURL(masteredURL);masteredURL=URL.createObjectURL(result.blob);
    $("masteredPlayer").src=masteredURL;$("downloadLink").href=masteredURL;
    $("downloadLink").download=(selectedFile.name.replace(/\.[^.]+$/,"")||"EC-Audio")+"-EC-AI-Mastered-24bit.wav";
    $("profileValue").textContent=result.profile;$("lufsValue").textContent=result.target+" LUFS aprox.";$("peakValue").textContent=result.inputPeak+" dBFS";$("outputPeakValue").textContent=result.outputPeak+" dBFS";
    $("result").classList.add("show");$("emptyResult").hidden=true;$("resultState").textContent="MASTER COMPLETADA";$("resultState").style.color="var(--lime)";setProgress(100,"Master terminada");
  }catch(error){showError(error.message||"No se pudo masterizar esta canción.");$("resultState").textContent="ERROR";$("resultState").style.color="#ffabb7";}
  finally{if(context)try{await context.close();}catch{}busy=false;$("masterButton").disabled=!selectedFile;$("status").classList.remove("show");}
});
if(!window.AudioContext&&!window.webkitAudioContext){showError("Tu navegador no admite el procesamiento de audio. Actualiza Chrome o Safari para usar EC AI Mastering.");}
