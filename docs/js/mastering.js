import { initializeApp } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";
import { firebaseConfig } from "./firebase-config.js";
import { analyzeAndRecommend } from "./mix-doctor.js";
const firebaseApp = initializeApp(firebaseConfig);
const auth = getAuth(firebaseApp);
const $ = (id) => document.getElementById(id);
let selectedFile = null, originalURL = null, masteredURL = null, busy = false, signedInUser = null, autoMasterBuffer = null;
const profiles = {
  auto: {name:"Adaptativo EC", target:-14, hp:28, low:0, body:0, presence:0.5, air:0.5, threshold:-16, ratio:1.8},
  urban:{name:"Urbano / Reggaetón",target:-10.5,hp:30,low:0.8,body:0.2,presence:0.4,air:0.8,threshold:-15,ratio:2.1},
  rap:{name:"Rap / Hip-hop",target:-11,hp:28,low:0.5,body:0.4,presence:0.8,air:0.4,threshold:-16,ratio:2},
  pop:{name:"Pop",target:-12,hp:30,low:0.2,body:0.2,presence:0.7,air:0.8,threshold:-16,ratio:1.9},
  rock:{name:"Rock",target:-11.5,hp:35,low:0.2,body:0.4,presence:0.5,air:0.2,threshold:-17,ratio:2.2},
  worship:{name:"Adoración",target:-14,hp:28,low:0.1,body:0.3,presence:0.4,air:0.5,threshold:-16,ratio:1.8},
  ballad:{name:"Balada",target:-14,hp:25,low:0,body:0.4,presence:0.3,air:0.6,threshold:-17,ratio:1.7},
  electronic:{name:"Electrónica",target:-9.5,hp:30,low:0.5,body:0.1,presence:0.4,air:0.5,threshold:-14,ratio:2.2},
  acoustic:{name:"Acústica",target:-15,hp:35,low:0,body:0.2,presence:0.5,air:0.5,threshold:-17,ratio:1.6}
};
function formatBytes(n){return n<1048576?(n/1024).toFixed(0)+" KB":(n/1048576).toFixed(1)+" MB";}
function showError(message){$("errorBox").textContent=message;$("errorBox").classList.add("show");}
function clearError(){$("errorBox").textContent="";$("errorBox").classList.remove("show");}
function setProgress(value,label){$("status").classList.add("show");$("statusText").textContent=label;$("statusPercent").textContent=Math.round(value)+"%";$("progressBar").style.width=value+"%";}
function db(v){return v>0?20*Math.log10(v):-120;}
function biquadCoeffs(type,frequency,Q,gainDb,rate){
  const A=Math.pow(10,(gainDb||0)/40),w=2*Math.PI*frequency/rate,c=Math.cos(w),s=Math.sin(w),alpha=s/(2*(Q||.707));
  let b0,b1,b2,a0,a1,a2;
  if(type==="highpass"){b0=(1+c)/2;b1=-(1+c);b2=(1+c)/2;a0=1+alpha;a1=-2*c;a2=1-alpha;}
  else{
    const beta=2*Math.sqrt(A)*alpha;
    b0=A*((A+1)+(A-1)*c+beta);b1=-2*A*((A-1)+(A+1)*c);b2=A*((A+1)+(A-1)*c-beta);
    a0=(A+1)-(A-1)*c+beta;a1=2*((A-1)-(A+1)*c);a2=(A+1)-(A-1)*c-beta;
  }
  return [b0/a0,b1/a0,b2/a0,a1/a0,a2/a0];
}
function runBiquad(data,coeffs){
  const [b0,b1,b2,a1,a2]=coeffs,out=new Float64Array(data.length);let x1=0,x2=0,y1=0,y2=0;
  for(let i=0;i<data.length;i++){const x=data[i],y=b0*x+b1*x1+b2*x2-a1*y1-a2*y2;out[i]=y;x2=x1;x1=x;y2=y1;y1=y;}
  return out;
}
function measureIntegratedLUFS(buffer){
  const rate=buffer.sampleRate,n=buffer.length,channels=buffer.numberOfChannels;
  if(!n)return -120;
  const shelf=biquadCoeffs("shelf",1681,0.707,4,rate),hp=biquadCoeffs("highpass",38,0.5,0,rate);
  const weighted=[];
  for(let c=0;c<channels;c++){let data=Float64Array.from(buffer.getChannelData(c));data=runBiquad(data,shelf);data=runBiquad(data,hp);weighted.push(data);}
  const block=Math.max(1,Math.round(rate*.4)),hop=Math.max(1,Math.round(rate*.1)),energies=[];
  const weights=channels===1?[1]:Array.from({length:channels},()=>1);
  for(let start=0;start+block<=n;start+=hop){
    let energy=0;
    for(let c=0;c<channels;c++){let sum=0,a=weighted[c];for(let i=start;i<start+block;i++)sum+=a[i]*a[i];energy+=weights[c]*sum/block;}
    if(energy>0)energies.push(energy);
  }
  if(!energies.length)return -120;
  const loud=e=>-.691+10*Math.log10(Math.max(e,1e-20)),mean=a=>a.reduce((s,x)=>s+x,0)/a.length;
  const absolute=energies.filter(e=>loud(e)>-70);if(!absolute.length)return -120;
  const relativeGate=loud(mean(absolute))-10,gated=absolute.filter(e=>loud(e)>relativeGate);
  return gated.length?loud(mean(gated)):-120;
}
function measureTruePeak(buffer){
  let peak=0;
  for(let c=0;c<buffer.numberOfChannels;c++){
    const a=buffer.getChannelData(c),n=a.length;
    for(let i=0;i<n;i++){
      const p0=a[Math.max(0,i-1)],p1=a[i],p2=a[Math.min(n-1,i+1)],p3=a[Math.min(n-1,i+2)];
      peak=Math.max(peak,Math.abs(p1));
      for(let k=1;k<4;k++){const t=k/4,t2=t*t,t3=t2*t;const y=.5*((2*p1)+(-p0+p2)*t+(2*p0-5*p1+4*p2-p3)*t2+(-p0+3*p1-3*p2+p3)*t3);peak=Math.max(peak,Math.abs(y));}
    }
  }
  return db(peak);
}
async function applyGain(buffer,gainDb){
  const ctx=new OfflineAudioContext(buffer.numberOfChannels,buffer.length,buffer.sampleRate),src=ctx.createBufferSource(),g=ctx.createGain();
  src.buffer=buffer;g.gain.value=Math.pow(10,gainDb/20);src.connect(g);g.connect(ctx.destination);src.start(0);return ctx.startRendering();
}
function stats(buffer){
  let sum=0, count=0, peak=0;
  for(let c=0;c<buffer.numberOfChannels;c++){const a=buffer.getChannelData(c);for(let i=0;i<a.length;i++){const v=a[i];sum+=v*v;count++;peak=Math.max(peak,Math.abs(v));}}
  return {rms:Math.sqrt(sum/Math.max(1,count)),peak};
}
function showMixDoctor(a){
  const panel=$("mixDoctor");panel.style.display="block";
  $("mixDoctorSummary").innerHTML=a.issues.map(x=>"• "+x).join("<br>");
  $("mixDoctorMetrics").textContent=
    "LOW "+(a.lowShare*100).toFixed(1)+"%  ·  MID "+(a.midShare*100).toFixed(1)+"%  ·  HIGH "+(a.highShare*100).toFixed(1)+"%  ·  CREST "+a.crestDb.toFixed(1)+" dB  ·  CLIP "+a.clippingPct.toFixed(3)+"%  ·  CORR "+a.correlation.toFixed(2);
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
function applyStereoWidth(buffer,width){
  if(buffer.numberOfChannels<2||Math.abs(width-1)<0.001)return buffer;
  const left=buffer.getChannelData(0),right=buffer.getChannelData(1);
  for(let i=0;i<left.length;i++){const mid=(left[i]+right[i])*0.5;const side=(left[i]-right[i])*0.5*width;left[i]=mid+side;right[i]=mid-side;}
  return buffer;
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
  const limiter=offline.createDynamicsCompressor();limiter.threshold.value=-1.2;limiter.knee.value=3;limiter.ratio.value=5;limiter.attack.value=0.004;limiter.release.value=0.14;node.connect(limiter);node=limiter;
  const gain=offline.createGain();gain.gain.value=1;node.connect(gain);gain.connect(offline.destination);source.start(0);
  onProgress(32,"Aplicando ecualización y control dinámico…");
  const rendered=await offline.startRendering();onProgress(76,"Midiendo nivel y preparando limitación final…");
  const stereoAdjusted=applyStereoWidth(rendered,profile.width ?? 1);
  const beforeLufs=measureIntegratedLUFS(stereoAdjusted);
  const ceilingDb=Number($("truePeakTarget").value),ceiling=Math.pow(10,ceilingDb/20);
  let gainDb=Number.isFinite(beforeLufs)?profile.target-beforeLufs:0;
  gainDb=Math.max(-18,Math.min(18,gainDb));
  const predictedTP=measureTruePeak(stereoAdjusted)+gainDb;
  if(predictedTP>ceilingDb)gainDb-=predictedTP-ceilingDb;
  onProgress(86,"Ajustando sonoridad integrada y True Peak…");
  const normalizedBuffer=await applyGain(stereoAdjusted,gainDb);
  onProgress(94,"Verificando LUFS y picos reales…");
  const finalLufs=measureIntegratedLUFS(normalizedBuffer),finalTP=measureTruePeak(normalizedBuffer);
  return {blob:encodeWav24(normalizedBuffer),buffer:normalizedBuffer,inputPeak:db(stats(input).peak),outputPeak:db(stats(normalizedBuffer).peak),inputLufs:measureIntegratedLUFS(input),outputLufs:finalLufs,truePeak:finalTP,profile:profile.name,target:profile.target,analysis:profile.analysis};
}
function updateFinishLabels(){
  $("widthValue").textContent=$("widthControl").value+"%";
  $("bassValue").textContent=Number($("bassControl").value).toFixed(1)+" dB";
  $("midValue").textContent=Number($("midControl").value).toFixed(1)+" dB";
  $("highValue").textContent=Number($("highControl").value).toFixed(1)+" dB";
}
async function renderFinishing(input,bass,mid,high,width){
  const rate=input.sampleRate,channels=input.numberOfChannels;
  const ctx=new OfflineAudioContext(channels,input.length,rate),src=ctx.createBufferSource();src.buffer=input;
  let node=src;
  const addFilter=(type,freq,gain,q=.8)=>{const f=ctx.createBiquadFilter();f.type=type;f.frequency.value=freq;f.Q.value=q;f.gain.value=gain;node.connect(f);node=f;};
  if(bass)addFilter("lowshelf",110,bass);
  if(mid)addFilter("peaking",1100,mid,.75);
  if(high)addFilter("highshelf",9000,high);
  if(channels>1&&width!==100){
    const split=ctx.createChannelSplitter(2),merge=ctx.createChannelMerger(2);
    const l=ctx.createGain(),r=ctx.createGain();node.connect(split);split.connect(l,0);split.connect(r,1);
    const w=Math.max(0,Math.min(1.5,width/100));
    const ll=ctx.createGain(),lr=ctx.createGain(),rl=ctx.createGain(),rr=ctx.createGain();
    ll.gain.value=.5+.5*w;lr.gain.value=.5-.5*w;rl.gain.value=.5-.5*w;rr.gain.value=.5+.5*w;
    l.connect(ll);r.connect(lr);l.connect(rl);r.connect(rr);
    ll.connect(merge,0,0);lr.connect(merge,0,0);rl.connect(merge,0,1);rr.connect(merge,0,1);node=merge;
  }
  const out=ctx.createGain();node.connect(out);out.connect(ctx.destination);src.start(0);
  const rendered=await ctx.startRendering(),s=stats(rendered),ceiling=Math.pow(10,-1/20);
  const gain=s.peak>ceiling?ceiling/s.peak:1;
  if(gain<.999){const safe=new OfflineAudioContext(channels,rendered.length,rate),ss=safe.createBufferSource(),gg=safe.createGain();ss.buffer=rendered;gg.gain.value=gain;ss.connect(gg);gg.connect(safe.destination);ss.start(0);return encodeWav24(await safe.startRendering());}
  return encodeWav24(rendered);
}
["widthControl","bassControl","midControl","highControl"].forEach(id=>$(id).addEventListener("input",updateFinishLabels));
$("applyFinish").addEventListener("click",async()=>{
  if(!autoMasterBuffer)return;
  const button=$("applyFinish");button.disabled=true;button.textContent="APLICANDO…";
  try{
    const blob=await renderFinishing(autoMasterBuffer,Number($("bassControl").value),Number($("midControl").value),Number($("highControl").value),Number($("widthControl").value));
    if(masteredURL)URL.revokeObjectURL(masteredURL);masteredURL=URL.createObjectURL(blob);
    $("masteredPlayer").src=masteredURL;$("downloadLink").href=masteredURL;$("resultState").textContent="AJUSTES APLICADOS";
  }catch(e){showError("No se pudieron aplicar los ajustes: "+(e.message||"error de procesamiento"));}
  finally{button.disabled=false;button.textContent="APLICAR AJUSTES";}
});
$("resetFinish").addEventListener("click",()=>{
  if(!autoMasterBuffer)return;
  $("widthControl").value=100;$("bassControl").value=0;$("midControl").value=0;$("highControl").value=0;updateFinishLabels();$("applyFinish").click();
});
$("masterButton").addEventListener("click",async()=>{
  if(!selectedFile||busy)return;clearError();if(!signedInUser){window.location.href="./account.html?return=mastering";return;}busy=true;$("masterButton").disabled=true;$("resultState").textContent="PROCESANDO";
  let context;
  try{
    if(!window.AudioContext&&!window.webkitAudioContext)throw new Error("Este navegador no admite procesamiento de audio. Abre EC Audio desde Chrome o Safari actualizado.");
    const AudioCtx=window.AudioContext||window.webkitAudioContext;context=new AudioCtx();
    setProgress(5,"Leyendo archivo de audio…");
    const bytes=await selectedFile.arrayBuffer();setProgress(14,"Analizando la mezcla…");
    const decoded=await context.decodeAudioData(bytes.slice(0));
    if(decoded.duration>600)throw new Error("La canción supera el límite de 10 minutos para el procesamiento local.");
    if(decoded.numberOfChannels>2)throw new Error("El archivo tiene más de dos canales. Exporta una mezcla estéreo e inténtalo de nuevo.");
    setProgress(20,"EC Mix Doctor: analizando espectro, dinámica y estéreo…");
    const analysis=await analyzeAndRecommend(decoded);
    showMixDoctor(analysis);
    const base=profiles[$("genre").value]||profiles.auto;
    const profile={...base};
    profile.target=Number($("targetLufs").value);
    // The analysis drives the mastering decisions; genre is only a gentle tonal starting point.
    profile.low=Math.max(-2.5,Math.min(2.5,base.low+analysis.lowDb));
    profile.air=Math.max(-2.5,Math.min(2.5,base.air+analysis.highDb));
    profile.ratio=Math.max(1.5,Math.min(2.2,analysis.crestDb>12?2.1:analysis.crestDb>8?1.9:1.6));
    profile.threshold=Math.max(-19,Math.min(-13,base.threshold+(analysis.crestDb>12?1:analysis.crestDb<7?-1:0)));
    profile.width=Math.max(.75,Math.min(1.12,analysis.width/100));
    if($("genre").value==="auto")profile.target=analysis.crestDb>12?-13:-12.5;
    profile.analysis=analysis;
    const result=await renderMaster(decoded,profile,setProgress);
    autoMasterBuffer=result.buffer;
    ["widthControl","bassControl","midControl","highControl"].forEach(id=>$(id).value=id==="widthControl"?100:0);
    updateFinishLabels();
    const finalBlob=await renderFinishing(autoMasterBuffer,0,0,0,100);
    masteredURL=URL.createObjectURL(finalBlob);
    $("masteredPlayer").src=masteredURL;$("downloadLink").href=masteredURL;
    $("downloadLink").download=(selectedFile.name.replace(/\.[^.]+$/,"")||"EC-Audio")+"-EC-AI-Mastered-24bit.wav";
    $("profileValue").textContent=result.profile;$("lufsValue").textContent=result.outputLufs.toFixed(1)+" LUFS-I";$("peakValue").textContent=result.inputLufs.toFixed(1)+" LUFS-I";$("outputPeakValue").textContent=result.truePeak.toFixed(1)+" dBTP";
    $("result").classList.add("show");$("emptyResult").hidden=true;$("resultState").textContent="MASTER COMPLETADA";$("resultState").style.color="var(--lime)";setProgress(100,"Master automática terminada · ajustes finales disponibles");
  }catch(error){showError(error.message||"No se pudo masterizar esta canción.");$("resultState").textContent="ERROR";$("resultState").style.color="#ffabb7";}
  finally{if(context)try{await context.close();}catch{}busy=false;$("masterButton").disabled=!selectedFile;$("status").classList.remove("show");}
});
if(!window.AudioContext&&!window.webkitAudioContext){showError("Tu navegador no admite el procesamiento de audio. Actualiza Chrome o Safari para usar EC AI Mastering.");}

onAuthStateChanged(auth,user=>{signedInUser=user;$("masterButton").disabled=!selectedFile||busy;$("masterButton").textContent=!user?"INICIA SESIÓN PARA MASTERIZAR":"✦ MASTERIZAR MI CANCIÓN";});
