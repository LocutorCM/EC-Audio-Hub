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
function addSnare(ctx,t,level=.22){
 t=safeTime(ctx,t);if(level<=0||t>=ctx.length/ctx.sampleRate)return;
 addNoise(ctx,t,.19,level,1200);
 addTone(ctx,t,.11,midiHz(48),"triangle",level*.22,0);
}
function addHat(ctx,t,level=.075,open=false){
 addNoise(ctx,t,open?.16:.045,level,8500);
}
function addPluck(ctx,t,dur,note,level=.045,pan=0){
 addTone(ctx,t,dur,midiHz(note),"triangle",level,pan);
 addTone(ctx,t,dur*.55,midiHz(note+12),"sine",level*.22,-pan);
}
function addChord(ctx,t,dur,root,quality,style,pianoLike=false){
 const intervals=quality==="minor"?[0,3,7]:[0,4,7];
 const pad=["worship","ballad","cinematic","acoustic"].includes(style);
 intervals.forEach((iv,i)=>{const note=root+iv+(pad?0:12);addTone(ctx,t,dur,midiHz(note),pianoLike?"triangle":(pad?"sawtooth":"triangle"),pad?.075:.052,i===0?-.28:.28,i===1?4:0);});
 addTone(ctx,t,dur,midiHz(root+12),"triangle",pad?.045:.032,0,-5);
 addTone(ctx,t,dur,midiHz(root+19),"sine",.018,.12,2);
}
function addPiano(ctx,t,dur,note,level=.12,pan=0){
 t=safeTime(ctx,t);if(dur<=0||t>=ctx.length/ctx.sampleRate)return;
 const end=Math.min(ctx.length/ctx.sampleRate,t+dur),osc=ctx.createOscillator(),harm=ctx.createOscillator(),g=ctx.createGain(),hg=ctx.createGain(),p=ctx.createStereoPanner();
 osc.type="triangle";osc.frequency.setValueAtTime(midiHz(note),t);
 harm.type="sine";harm.frequency.setValueAtTime(midiHz(note+12),t);
 g.gain.setValueAtTime(.0001,t);g.gain.exponentialRampToValueAtTime(Math.max(.0002,level),Math.min(end,t+.008));g.gain.exponentialRampToValueAtTime(.0001,Math.min(end,t+Math.max(.09,dur*.82)));
 hg.gain.setValueAtTime(.0001,t);hg.gain.exponentialRampToValueAtTime(Math.max(.0002,level*.28),Math.min(end,t+.012));hg.gain.exponentialRampToValueAtTime(.0001,Math.min(end,t+Math.max(.07,dur*.55)));
 p.pan.setValueAtTime(Math.max(-1,Math.min(1,pan)),t);osc.connect(g);harm.connect(hg);g.connect(p);hg.connect(p);p.connect(ctx.__mixBus||ctx.destination);
 osc.start(t);harm.start(t);osc.stop(Math.min(ctx.length/ctx.sampleRate,end+.02));harm.stop(Math.min(ctx.length/ctx.sampleRate,end+.02));
}
function add808(ctx,t,dur,note,level=.42,slide=0){
 t=safeTime(ctx,t);if(dur<=0||t>=ctx.length/ctx.sampleRate)return;
 const end=Math.min(ctx.length/ctx.sampleRate,t+dur),o=ctx.createOscillator(),g=ctx.createGain(),sh=ctx.createWaveShaper();
 const curve=new Float32Array(256);for(let i=0;i<256;i++){const x=i*2/255-1;curve[i]=Math.tanh(x*2.1);}
 sh.curve=curve;sh.oversample="2x";o.type="sine";o.frequency.setValueAtTime(midiHz(note),t);
 if(slide)o.frequency.exponentialRampToValueAtTime(midiHz(note+slide),Math.min(end,t+.12));
 g.gain.setValueAtTime(.0001,t);g.gain.exponentialRampToValueAtTime(Math.max(.0002,level),Math.min(end,t+.012));g.gain.setTargetAtTime(.0001,Math.min(end,t+Math.max(.08,dur*.68)),Math.max(.035,dur*.14));
 o.connect(sh);sh.connect(g);g.connect(ctx.__mixBus||ctx.destination);o.start(t);o.stop(Math.min(ctx.length/ctx.sampleRate,end+.04));
}
function addClap(ctx,t,level=.2){
 addNoise(ctx,t,.11,level,1500);addNoise(ctx,t+.012,.09,level*.55,1800);addNoise(ctx,t+.026,.075,level*.3,2200);
}
async function buildArrangement(input,style,bpmValue,mood,notes,onProgress){
 const rate=44100,channels=2,duration=Math.min(input.duration,300),frames=Math.ceil(duration*rate);
 if(!frames||duration>300)throw new Error("La grabación debe durar 5 minutos o menos para generar el acompañamiento local.");
 const AudioCtx=window.OfflineAudioContext||window.webkitOfflineAudioContext;
 if(!AudioCtx)throw new Error("Este navegador no admite síntesis de audio local. Actualiza Chrome o Safari.");
 const key=estimateKey(input),moodText=(mood||"").toLowerCase(),minorMood=/triste|oscura|oscuro|melanc|dram[aá]tic|nost[aá]lgic/.test(moodText),scale=minorMood?scales.minor:(style==="worship"||style==="pop"||style==="house"?scales.major:scales.minor);
 const notesText=(notes||"").toLowerCase(),noDrums=/sin bater[ií]a|no drums|sin percusi[oó]n/.test(notesText),pianoRequested=/piano|teclas/.test(notesText);
 const bpm=Math.max(60,Math.min(200,Math.round(Number(bpmValue)||96))),beat=60/bpm,bar=beat*4,step=bar/16;
 const ctx=new AudioCtx(channels,frames,rate);
 const master=ctx.createGain();master.gain.value=.82;
 const comp=ctx.createDynamicsCompressor();comp.threshold.value=-13;comp.knee.value=8;comp.ratio.value=2.8;comp.attack.value=.01;comp.release.value=.18;
 const bus=ctx.createGain();bus.gain.value=.88;
 const limiter=ctx.createDynamicsCompressor();limiter.threshold.value=-3;limiter.ratio.value=12;limiter.attack.value=.003;limiter.release.value=.12;
 bus.connect(master);master.connect(comp);comp.connect(limiter);limiter.connect(ctx.destination);ctx.__mixBus=bus;
 const profiles={
  urban:{kick:[0,6,8,14],snare:[4,12],hat:2,bass:"808",keys:"pluck",chord:"offbeat"},
  reggaeton:{kick:[0,6,8,14],snare:[4,12],hat:2,bass:"round",keys:"pluck",chord:"offbeat"},
  trap:{kick:[0,3,7,10,14],snare:[8],hat:1,bass:"808",keys:"pianoRoll",chord:"sparse"},
  drill:{kick:[0,3,7,11,14],snare:[8],hat:1,bass:"808slide",keys:"pianoRoll",chord:"dark"},
  rap:{kick:[0,7,10],snare:[4,12],hat:2,bass:"round",keys:"piano",chord:"sample"},
  boom_bap:{kick:[0,7,10,15],snare:[4,12],hat:2,bass:"round",keys:"sample",chord:"sample"},
  pop:{kick:[0,4,8,12],snare:[4,12],hat:2,bass:"round",keys:"piano",chord:"block"},
  rock:{kick:[0,8],snare:[4,12],hat:2,bass:"round",keys:"guitar",chord:"block"},
  worship:{kick:[0,8],snare:[4,12],hat:2,bass:"round",keys:"piano",chord:"wide"},
  ballad:{kick:[0,8],snare:[4,12],hat:4,bass:"round",keys:"piano",chord:"wide"},
  acoustic:{kick:[0,8],snare:[4,12],hat:2,bass:"round",keys:"guitar",chord:"wide"},
  rnb:{kick:[0,7,10],snare:[4,12],hat:2,bass:"round",keys:"pianoRoll",chord:"jazzy"},
  cinematic:{kick:[0,8],snare:[12],hat:4,bass:"round",keys:"piano",chord:"wide"},
  afrobeat:{kick:[0,5,8,13],snare:[4,12],hat:2,bass:"round",keys:"pluck",chord:"offbeat"},
  house:{kick:[0,4,8,12],snare:[4,12],hat:2,bass:"round",keys:"piano",chord:"offbeat"}
 };
 const profile=profiles[style]||profiles.pop,progression=style==="rock"?[0,3,4,0]:style==="worship"||style==="pop"||style==="ballad"?[0,4,5,3]:[0,5,3,4];
 const variation=Math.floor(Math.random()*4),baseMidi=48+key,bars=Math.ceil(duration/bar);
 const chordIntervals=(degree)=>{const root=baseMidi+scale[degree%7]+(degree>=5?12:0);const minor=[1,2,5].includes(degree);return {root,notes:[root,root+(minor?3:4),root+7,root+12]};};
 const bassPattern=profile.bass==="808"||profile.bass==="808slide"?[0,0,7,0,12,7,0,10]:[0,7,12,7,0,7,10,7];
 for(let b=0;b<bars;b++){
  const t=b*bar;if(t>=duration)break;
  const degree=progression[(b+variation)%progression.length],ch=chordIntervals(degree),root=ch.root,barEnd=Math.min(duration,t+bar);
  // Acordes y teclados: piano realista sintetizado, acordes cortos o pads según el estilo.
  const chordTimes=profile.chord==="offbeat"?[2,6,10,14]:profile.chord==="sparse"?[0,8]:profile.chord==="sample"?[0,6,12]:[0];
  for(const s of chordTimes){const at=t+s*step;if(at>=duration)continue;const dur=profile.chord==="offbeat"?step*2.7:profile.chord==="sparse"?beat*1.7:bar*.88;
   ch.notes.slice(0,profile.chord==="jazzy"?4:3).forEach((n,i)=>{
    const pitch=n+(profile.chord==="dark"&&i===1?-12:0);
    if(profile.keys==="piano"||profile.keys==="pianoRoll"||pianoRequested)addPiano(ctx,at,dur,pitch,profile.chord==="wide"?.105:.085,(i-1)*.22);
    else addPluck(ctx,at,dur,pitch,.055,(i-1)*.25);
   });
  }
  // Patrones de batería de 16 pasos, diferentes para cada género.
  if(!noDrums){
   for(let s=0;s<16;s++){
    const at=t+s*step;if(at>=duration)continue;
    if(profile.kick.includes(s))addKick(ctx,at,style==="trap"||style==="drill"?.88:.74);
    if(profile.snare.includes(s)){if(["urban","reggaeton","house","afrobeat"].includes(style))addClap(ctx,at,.19);else addSnare(ctx,at,style==="rock"?.32:.25);}
    if(s%profile.hat===0){
     const open=(style==="house"&&s%4===2)||(style==="trap"&&s===14);
     addHat(ctx,at,style==="rock"?.075:.052,open);
    }
    if((style==="trap"||style==="drill")&&[6,7,14,15].includes(s))addHat(ctx,at,.045);
   }
   // Golpes fantasma y fills variables al final de cada segundo compás.
   if(b%2===1){if(["rap","boom_bap","rnb"].includes(style))addSnare(ctx,t+bar-step*2,.09);if(["trap","drill"].includes(style))for(let j=0;j<4;j++)addHat(ctx,t+bar-step*4+j*step,.035);}
  }
  // Bajo: sub 808 con slides para trap/drill; bajo redondo para los demás estilos.
  for(let q=0;q<8;q++){
   const at=t+q*beat/2;if(at>=duration)continue;
   const shouldPlay=profile.bass==="808"||profile.bass==="808slide"?[0,3,4,6].includes(q):[0,2,4,6].includes(q);
   if(!shouldPlay)continue;
   const note=root-12+(bassPattern[(q+b+variation)%bassPattern.length]||0);
   const dur=Math.min(beat*(q%2?.42:.78),duration-at);
   if(profile.bass==="808"||profile.bass==="808slide")add808(ctx,at,dur,note,profile.bass==="808slide"?.38:.34,profile.bass==="808slide"&&q===6?7:0);
   else addTone(ctx,at,dur,midiHz(note),"triangle",.12,0);
  }
  // Arpegios y rolls melódicos: trap/drill usan semicorcheas; otros estilos usan figuras propias.
  if(profile.keys==="pianoRoll"){
   const roll=[0,2,4,7,4,2,7,4,0,2,4,7,9,7,4,2];
   for(let s=0;s<16;s++){const at=t+s*step;if(at<duration)addPiano(ctx,at,Math.min(step*1.7,duration-at),ch.notes[0]+12+roll[(s+variation)%roll.length],s%4===3?.075:.055,s%2?-.3:.3);}
  }else if(profile.keys==="piano"||profile.keys==="guitar"){
   for(let q=0;q<8;q++){const at=t+q*beat/2;if(at<duration){const n=ch.notes[(q+variation)%3]+12; if(profile.keys==="piano")addPiano(ctx,at,Math.min(beat*.38,duration-at),n,.07,q%2?-.3:.3);else addPluck(ctx,at,Math.min(beat*.42,duration-at),n,.045,q%2?-.3:.3);}}
  }else{
   for(let q=0;q<4;q++){const at=t+q*beat;if(at<duration)addPluck(ctx,at,Math.min(beat*.6,duration-at),ch.notes[(q+variation)%3]+12,.045,q%2?-.35:.35);}
  }
  if(b%3===0)onProgress(18+Math.round(55*b/Math.max(1,bars)),"Creando patrón de "+style+" · "+bpm+" BPM…");
 }
 const rendered=await ctx.startRendering();onProgress(86,"Finalizando y exportando WAV estéreo…");
 let peak=0;for(let c=0;c<rendered.numberOfChannels;c++){const d=rendered.getChannelData(c);for(let i=0;i<d.length;i++)peak=Math.max(peak,Math.abs(d[i]));}
 const gain=peak>.92?.92/peak:1;if(gain!==1)for(let c=0;c<rendered.numberOfChannels;c++){const d=rendered.getChannelData(c);for(let i=0;i<d.length;i++)d[i]*=gain;}
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
