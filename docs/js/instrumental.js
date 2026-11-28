const $ = id => document.getElementById(id);
let file=null,inputUrl=null,outputUrl=null,signedIn=true,busy=false;

function bytes(n){return n<1048576?(n/1024).toFixed(0)+" KB":(n/1048576).toFixed(1)+" MB";}
function error(message){$("errorBox").textContent=message;$("errorBox").classList.add("show");}
function clearError(){$("errorBox").textContent="";$("errorBox").classList.remove("show");}
function setProgress(percent,label){$("status").classList.add("show");$("statusText").textContent=label;$("statusPercent").textContent=Math.round(percent)+"%";$("progressBar").style.width=percent+"%";}
function updateButton(){$("generateButton").disabled=!file||!signedIn||busy;}
function setFile(next){
 clearError();
 if(!next){file=null;$("fileLine").hidden=true;$("voicePlayer").hidden=true;if(inputUrl)URL.revokeObjectURL(inputUrl);inputUrl=null;updateButton();return;}
 const ext=(next.name.split(".").pop()||"").toLowerCase();
 if(!["wav","mp3","m4a","aac","ogg","flac","aif","aiff"].includes(ext))return error("Formato no compatible. Usa WAV, MP3, M4A, AAC, OGG o FLAC.");
 if(next.size>80*1024*1024)return error("El archivo supera el límite de 80 MB.");
 file=next;$("fileName").textContent=next.name;$("fileSize").textContent=bytes(next.size);$("fileLine").hidden=false;
 if(inputUrl)URL.revokeObjectURL(inputUrl);inputUrl=URL.createObjectURL(next);$("voicePlayer").src=inputUrl;$("voicePlayer").hidden=false;
 $("result").classList.remove("ready");$("resultTitle").textContent="Tu instrumental aparecerá aquí";$("resultText").textContent="La nueva generación reemplazará el resultado anterior.";
 $("resultPlayer").hidden=true;$("downloadLink").classList.remove("show");if(outputUrl)URL.revokeObjectURL(outputUrl);outputUrl=null;updateButton();
}
$("voiceFile").addEventListener("change",e=>setFile(e.target.files?.[0]));
$("removeFile").addEventListener("click",()=>{$("voiceFile").value="";setFile(null);});
const drop=$("dropzone");
drop.addEventListener("dragover",e=>{e.preventDefault();drop.classList.add("drag");});
drop.addEventListener("dragleave",()=>drop.classList.remove("drag"));
drop.addEventListener("drop",e=>{e.preventDefault();drop.classList.remove("drag");if(e.dataTransfer.files?.[0])setFile(e.dataTransfer.files[0]);});

function encodeWav24(buffer){
 const channels=buffer.numberOfChannels,frames=buffer.length,bps=3,dataSize=frames*channels*bps,out=new ArrayBuffer(44+dataSize),v=new DataView(out);
 const write=(o,s)=>{for(let i=0;i<s.length;i++)v.setUint8(o+i,s.charCodeAt(i));};
 write(0,"RIFF");v.setUint32(4,36+dataSize,true);write(8,"WAVE");write(12,"fmt ");v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,channels,true);v.setUint32(24,buffer.sampleRate,true);v.setUint32(28,buffer.sampleRate*channels*bps,true);v.setUint16(32,channels*bps,true);v.setUint16(34,24,true);write(36,"data");v.setUint32(40,dataSize,true);
 const data=Array.from({length:channels},(_,c)=>buffer.getChannelData(c));let o=44;
 for(let i=0;i<frames;i++)for(let c=0;c<channels;c++){const s=Math.max(-1,Math.min(1,data[c][i]));const n=Math.round(s<0?s*8388608:s*8388607);v.setUint8(o,n&255);v.setUint8(o+1,(n>>8)&255);v.setUint8(o+2,(n>>16)&255);o+=3;}
 return new Blob([out],{type:"audio/wav"});
}
const NOTES=["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
function estimateKey(buffer){
 const mono=buffer.getChannelData(0),sr=buffer.sampleRate,step=Math.max(1,Math.floor(sr/11025)),rate=sr/step;
 const hist=Array(12).fill(0),frame=Math.floor(rate*.075),hop=Math.floor(rate*.12);
 const analysisEnd=Math.min(mono.length,Math.floor(sr*60));
 for(let start=0;start+frame<analysisEnd;start+=hop){
  let energy=0;for(let i=0;i<frame;i+=3)energy+=mono[start*step+i*step]**2;
  if(energy/frame<0.000002)continue;
  let bestLag=0,best=-1;const min=Math.floor(rate/700),max=Math.min(Math.floor(rate/75),Math.floor(frame/2));
  for(let lag=min;lag<=max;lag++){let corr=0,n=0;for(let i=0;i<frame-lag;i+=4){corr+=mono[(start+i)*step]*mono[(start+i+lag)*step];n++;}corr/=Math.max(1,n);if(corr>best){best=corr;bestLag=lag;}}
  if(bestLag){const hz=rate/bestLag;if(hz>70&&hz<700){const midi=Math.round(69+12*Math.log2(hz/440));hist[((midi%12)+12)%12]+=Math.max(0,best);}}
 }
 const key=hist.indexOf(Math.max(...hist));
 return {root:key>=0?key:0,name:NOTES[key>=0?key:0],confidence:Math.max(...hist)/(hist.reduce((a,b)=>a+b,0)||1)};
}
const scales={major:[0,2,4,5,7,9,11],minor:[0,2,3,5,7,8,10]};
function chordProgression(style){return ["rap","urban","trap","rnb"].includes(style)?[0,5,3,4]:style==="rock"?[0,3,5,0]:[0,4,5,3];}
function midiHz(n){return 440*Math.pow(2,(n-69)/12);}
function finiteNumber(value,fallback=0){return Number.isFinite(value)?value:fallback;}
function safeTime(ctx,value){const end=Number.isFinite(ctx.length)&&Number.isFinite(ctx.sampleRate)?ctx.length/ctx.sampleRate:Infinity;return Math.max(0,Math.min(finiteNumber(value,0),end));}
function addTone(ctx,when,duration,freq,type,gain,pan=0,detune=0){
 when=safeTime(ctx,when);duration=finiteNumber(duration,0);freq=finiteNumber(freq,0);gain=finiteNumber(gain,0);pan=finiteNumber(pan,0);detune=finiteNumber(detune,0);
 if(duration<=0||freq<=0||gain<=0||when>=ctx.length/ctx.sampleRate)return;
 const end=Math.min(ctx.length/ctx.sampleRate,when+duration),osc=ctx.createOscillator(),amp=ctx.createGain(),p=ctx.createStereoPanner();
 osc.type=type;osc.frequency.setValueAtTime(freq,when);osc.detune.setValueAtTime(detune,when);
 amp.gain.setValueAtTime(.0001,when);amp.gain.exponentialRampToValueAtTime(Math.max(.0002,gain),Math.min(end,when+.018));
 amp.gain.setTargetAtTime(.0001,Math.min(end,when+Math.max(.04,duration*.68)),Math.max(.025,duration*.12));
 p.pan.setValueAtTime(Math.max(-1,Math.min(1,pan)),when);osc.connect(amp);amp.connect(p);p.connect(ctx.__mixBus||ctx.destination);osc.start(when);osc.stop(Math.min(ctx.length/ctx.sampleRate,end+.15));
}
function addKick(ctx,t,level=.7){
 t=safeTime(ctx,t);level=finiteNumber(level,0);if(level<=0||t>=ctx.length/ctx.sampleRate)return;
 const end=ctx.length/ctx.sampleRate,o=ctx.createOscillator(),g=ctx.createGain();o.type="sine";o.frequency.setValueAtTime(115,t);o.frequency.exponentialRampToValueAtTime(42,Math.min(end,t+.16));g.gain.setValueAtTime(level,t);g.gain.exponentialRampToValueAtTime(.0001,Math.min(end,t+.22));o.connect(g);g.connect(ctx.__mixBus||ctx.destination);o.start(t);o.stop(Math.min(end,t+.23));
}
function addNoise(ctx,t,duration,level,highpass=5000){
 t=safeTime(ctx,t);duration=finiteNumber(duration,0);level=finiteNumber(level,0);highpass=finiteNumber(highpass,5000);if(duration<=0||level<=0||t>=ctx.length/ctx.sampleRate)return;
 duration=Math.min(duration,ctx.length/ctx.sampleRate-t);const size=Math.max(1,Math.ceil(ctx.sampleRate*duration)),b=ctx.createBuffer(1,size,ctx.sampleRate),d=b.getChannelData(0);for(let i=0;i<size;i++)d[i]=Math.random()*2-1;
 const src=ctx.createBufferSource(),f=ctx.createBiquadFilter(),g=ctx.createGain();src.buffer=b;f.type="highpass";f.frequency.setValueAtTime(Math.max(10,Math.min(highpass,ctx.sampleRate/2)),t);g.gain.setValueAtTime(level,t);g.gain.exponentialRampToValueAtTime(.0001,t+duration);src.connect(f);f.connect(g);g.connect(ctx.__mixBus||ctx.destination);src.start(t);src.stop(t+duration);
}
function addChord(ctx,t,dur,root,quality,style,pianoLike=false){
 const intervals=quality==="minor"?[0,3,7]:[0,4,7];
 const pad=["worship","ballad","cinematic","acoustic"].includes(style);
 intervals.forEach((iv,i)=>{const note=root+iv+ (pad?0:12);addTone(ctx,t,dur,midiHz(note),pianoLike?"triangle":(pad?"sawtooth":"triangle"),pad?.035:.022,i===0?-.22:.22,i===1?4:0);});
 if(pad)addTone(ctx,t,dur,midiHz(root+12),"triangle",.018,0,-5);
}
async function buildArrangement(input,style,tempoMode,mood,notes,onProgress){
 const rate=44100,channels=2,duration=Math.min(input.duration,300),frames=Math.ceil(duration*rate);
 if(!frames||duration>300)throw new Error("La grabación debe durar 5 minutos o menos para generar el acompañamiento local.");
 const AudioCtx=window.OfflineAudioContext||window.webkitOfflineAudioContext;
 if(!AudioCtx)throw new Error("Este navegador no admite síntesis de audio local. Actualiza Chrome o Safari.");
 const key=estimateKey(input),moodText=(mood||"").toLowerCase(),minorMood=/triste|oscura|oscuro|melanc|dram[aá]tic|nost[aá]lgic/.test(moodText),majorMood=/feliz|alegre|esperan|luminos|victor|triunf/.test(moodText),scale=minorMood?scales.minor:majorMood?scales.major:(style==="ballad"||style==="worship"||style==="cinematic"?scales.major:scales.minor),notesText=(notes||"").toLowerCase(),noDrums=/sin bater[ií]a|no drums|sin percusi[oó]n/.test(notesText),pianoLike=/piano|teclas/.test(notesText);
 const bpm=tempoMode==="slow"?76:tempoMode==="medium"?100:tempoMode==="fast"?124:96;
 const beat=60/bpm,bar=beat*4,ctx=new AudioCtx(channels,frames,rate);
 const master=ctx.createGain();master.gain.value=.72;
 const comp=ctx.createDynamicsCompressor();comp.threshold.value=-12;comp.knee.value=8;comp.ratio.value=2.5;comp.attack.value=.012;comp.release.value=.2;master.connect(comp);comp.connect(ctx.destination);
 const oldDestination=ctx.destination;
 // All voices are scheduled into the offline context destination through a shared mix bus.
 const bus=ctx.createGain();bus.gain.value=.78;const limiter=ctx.createDynamicsCompressor();limiter.threshold.value=-4;limiter.ratio.value=12;limiter.attack.value=.003;limiter.release.value=.12;bus.connect(limiter);limiter.connect(oldDestination);
 // Route synth helpers to the shared bus.
 const originalCreateOsc=ctx.createOscillator.bind(ctx);
 const bars=Math.ceil(duration/bar),progression=chordProgression(style);
 // Variaciones aleatorias para que cada generación tenga una estructura y groove distintos.
 const variation=Math.floor(Math.random()*6);
 if(variation===1)progression.reverse();
 else if(variation===2)progression.splice(0,progression.length,...[0,3,4,5]);
 else if(variation===3)progression.splice(0,progression.length,...[0,5,4,3]);
 else if(variation===4)progression.splice(0,progression.length,...[5,3,0,4]);
 const groove=Math.floor(Math.random()*4);
 const drumChance=[.72,.88,.62,.95][groove];
 ctx.__mixBus=bus;
 const baseMidi=48+key;
 for(let b=0;b<bars;b++){
  const t=b*bar;if(t>=duration)break;const degree=progression[b%progression.length],root=baseMidi+scale[degree%7]+(degree>=5?12:0)+((variation===5&&b%2)?12:0);
  const quality=(degree===1||degree===2||degree===5)&&scale===scales.minor?"minor":"major";
  addChord(ctx,t,Math.min(bar+.1,duration-t),root,quality,style,pianoLike);
  for(let q=0;q<4;q++){
   const bt=t+q*beat;if(bt>=duration)continue;
   addTone(ctx,bt,Math.min(beat*.85,duration-bt),midiHz(root-12),"triangle",.09,0);
   if(!noDrums&&(q===0||q===2||(groove===1&&q===3&&Math.random()<.45)))addKick(ctx,bt,style==="trap"?.85:.65);
   if(!noDrums&&(q===1||q===3)&&Math.random()<drumChance)addNoise(ctx,bt,.13,style==="rock"?.25:.16,1800);
   if(["urban","rap","trap","pop","rock","rnb"].includes(style)){
    if(!noDrums&&(q===0||q===2||groove===2&&q===1)&&Math.random()<drumChance)addNoise(ctx,bt+beat*(groove===3?.25:.5),.055,.07,7000);
   }
  }
  if(["worship","ballad","acoustic","cinematic"].includes(style)){
   for(let eighth=0;eighth<8;eighth++){
    const at=t+eighth*beat/2;if(at>=duration)continue;
    const note=root+scale[(eighth%3)*2%7]+12+(Math.random()<.22?12:0);
    addTone(ctx,at,Math.min(.22,duration-at),midiHz(note),"triangle",.035,eighth%2?-.25:.25);
   }
  }else{
   for(let eighth=0;eighth<8;eighth++){
    const at=t+eighth*beat/2;if(at>=duration)continue;
    addTone(ctx,at,Math.min(.09,duration-at),midiHz(root+12+(eighth%3===1?7:0)+(Math.random()<.18?12:0)),"square",.012,eighth%2?-.3:.3);
   }
  }
  if(b%4===0)onProgress(18+Math.round(55*b/Math.max(1,bars)),"Componiendo acordes, bajo y ritmo…");
 }
 // Reduce harsh high-frequency content and render.
 const rendered=await ctx.startRendering();onProgress(86,"Finalizando y exportando WAV estéreo…");
 // Normalize conservatively without clipping.
 let peak=0;for(let c=0;c<rendered.numberOfChannels;c++){const d=rendered.getChannelData(c);for(let i=0;i<d.length;i++)peak=Math.max(peak,Math.abs(d[i]));}
 const gain=peak>.92?.92/peak:1;
 if(gain!==1){for(let c=0;c<rendered.numberOfChannels;c++){const d=rendered.getChannelData(c);for(let i=0;i<d.length;i++)d[i]*=gain;}}
 return {blob:encodeWav24(rendered),key:key.name,bpm};
}
$("generateButton").addEventListener("click",async()=>{
 if(!file||!signedIn||busy)return;clearError();

 busy=true;updateButton();$("resultTitle").textContent="Creando tu acompañamiento…";$("resultText").textContent="El audio se está procesando dentro de tu navegador."; $("result").classList.add("ready");
 let context;
 try{
  setProgress(2,"Iniciando el generador…");
  // Permite que el navegador pinte el estado antes de comenzar a decodificar.
  await new Promise(resolve=>requestAnimationFrame(()=>resolve()));
  if(!window.AudioContext&&!window.webkitAudioContext)throw new Error("Este navegador no admite procesamiento de audio. Abre EC Audio desde Chrome actualizado.");
  const AudioCtx=window.AudioContext||window.webkitAudioContext;context=new AudioCtx();
  if(context.state==="suspended")await context.resume();
  setProgress(6,"Leyendo tu grabación…");
  await new Promise(resolve=>requestAnimationFrame(()=>resolve()));
  const data=await file.arrayBuffer();const decoded=await context.decodeAudioData(data.slice(0));
  if(decoded.duration>300)throw new Error("La grabación supera el límite de 5 minutos para este generador local.");
  if(decoded.numberOfChannels>2)throw new Error("Usa una grabación mono o estéreo.");
  setProgress(14,"Analizando tonalidad aproximada…");
  await new Promise(resolve=>requestAnimationFrame(()=>resolve()));
  const result=await buildArrangement(decoded,$("style").value,$("tempo").value,$("mood").value,$("notes").value,setProgress);
  if(outputUrl)URL.revokeObjectURL(outputUrl);outputUrl=URL.createObjectURL(result.blob);
  $("resultPlayer").src=outputUrl;$("resultPlayer").hidden=false;$("downloadLink").href=outputUrl;$("downloadLink").download=(file.name.replace(/\.[^.]+$/,"")||"EC-Audio")+"-Instrumental-"+result.key+"-"+result.bpm+"BPM.wav";$("downloadLink").classList.add("show");
  $("resultTitle").textContent="¡Tu instrumental está lista!";$("resultText").textContent="Tonalidad estimada: "+result.key+" · Tempo: "+result.bpm+" BPM · WAV estéreo 24 bits / 44.1 kHz.";
  setProgress(100,"Instrumental creada en tu dispositivo");
 }catch(e){
  console.error("EC Audio Instrumental:",e);
  $("resultTitle").textContent="No se pudo crear el acompañamiento";
  $("resultText").textContent="El navegador detuvo el procesamiento. Consulta el detalle del error.";
  const detail=e&&e.message?e.message:String(e||"Error desconocido");
  error((e&&e.name?e.name+": ":"")+detail);
 }
 finally{if(context)try{await context.close();}catch{}busy=false;updateButton();setTimeout(()=>$("status").classList.remove("show"),1800);}
});
$("generateButton").textContent="✦ CREAR MI INSTRUMENTAL";updateButton();
