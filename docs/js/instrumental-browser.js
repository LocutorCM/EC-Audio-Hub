const $ = id => document.getElementById(id);
let busy = false, referenceBuffer = null, outputUrl = null, referenceEnergy = "media";

function setMessage(text) { $("cloudAuthMessage").textContent = text; }
function setProgress(value, text) {
  $("cloudProgress").classList.add("show");
  $("cloudProgressPct").textContent = value + "%";
  $("cloudProgressBar").style.width = value + "%";
  $("cloudProgressText").textContent = text;
}
function fail(text) { $("cloudError").textContent = text; $("cloudError").classList.add("show"); }
function clearFail() { $("cloudError").textContent = ""; $("cloudError").classList.remove("show"); }
function updateButton() {
  $("generateCloud").disabled = busy;
  $("generateCloud").textContent = busy ? "CREANDO LOOPS…" : "✦ CREAR LOOPS Y ARMAR INSTRUMENTAL";
}
setMessage("Motor integrado listo · funciona directamente en este navegador, sin servidor ni inicio de sesión.");

const voiceInput = $("voiceFile");
voiceInput.addEventListener("change", async () => {
  referenceBuffer = null;
  const file = voiceInput.files?.[0];
  if (!file) { setMessage("Motor integrado listo · sin audio de referencia."); return; }
  try {
    setMessage("Analizando audio localmente…");
    const ctx = new AudioContext();
    referenceBuffer = await ctx.decodeAudioData(await file.arrayBuffer());
    const analysis = analyzeReference(referenceBuffer, ctx.sampleRate);
    if (analysis.bpm) $("bpm").value = analysis.bpm;
    setMessage("Audio analizado en este dispositivo · tempo estimado " + (analysis.bpm || "no detectado") + " BPM · energía " + analysis.energy + ". No se ha subido.");
    await ctx.close();
  } catch (e) {
    setMessage("No se pudo analizar el archivo; puedes generar igualmente sin referencia.");
  }
});

function analyzeReference(buffer, sampleRate) {
  const data = buffer.getChannelData(0);
  const hop = Math.max(1, Math.floor(sampleRate / 100));
  const env = [];
  for (let i = 0; i < data.length; i += hop) {
    let sum = 0, n = Math.min(hop, data.length - i);
    for (let j = 0; j < n; j++) sum += data[i+j] * data[i+j];
    env.push(Math.sqrt(sum / Math.max(1,n)));
  }
  const mean = env.reduce((a,b)=>a+b,0) / Math.max(1,env.length);
  let variance = 0;
  for (const v of env) variance += (v-mean)*(v-mean);
  const energy = mean < .035 ? "suave" : mean < .12 ? "media" : "alta";
  const centered = env.map(v=>v-mean);
  let bestLag = 0, best = -Infinity;
  for (let bpm=65;bpm<=170;bpm++) {
    const lag = Math.round(6000 / bpm);
    if (lag < 2 || lag >= centered.length/2) continue;
    let corr=0;
    for(let i=0;i<centered.length-lag;i+=2) corr += centered[i]*centered[i+lag];
    if(corr>best){best=corr;bestLag=lag;}
  }
  let bpm = bestLag ? Math.round(6000/bestLag) : null;
  if (bpm && bpm > 150) bpm = Math.round(bpm/2);
  return {bpm, energy};
}

function seeded(seed) {
  let x = seed >>> 0;
  return () => { x = (x * 1664525 + 1013904223) >>> 0; return x / 4294967296; };
}
function midi(n) { return 440 * Math.pow(2,(n-69)/12); }
function addGain(ctx, destination, value, time, duration) {
  const g=ctx.createGain(); g.gain.setValueAtTime(0,time);
  g.gain.linearRampToValueAtTime(value,time+.012);
  g.gain.setTargetAtTime(.0001,time+Math.max(.03,duration-.06),.035);
  g.connect(destination); return g;
}
function tone(ctx, dest, freq, time, duration, type, volume, filterFreq) {
  const osc=ctx.createOscillator(); osc.type=type; osc.frequency.setValueAtTime(freq,time);
  const gain=addGain(ctx,dest,volume,time,duration);
  if(filterFreq){const f=ctx.createBiquadFilter();f.type="lowpass";f.frequency.value=filterFreq;osc.connect(f);f.connect(gain);}
  else osc.connect(gain);
  osc.start(time);osc.stop(time+duration+.08);
}
function kick(ctx,dest,t,vol) {
  const o=ctx.createOscillator(),g=ctx.createGain();o.type="sine";
  o.frequency.setValueAtTime(135,t);o.frequency.exponentialRampToValueAtTime(43,t+.16);
  g.gain.setValueAtTime(vol,t);g.gain.exponentialRampToValueAtTime(.001,t+.24);
  o.connect(g);g.connect(dest);o.start(t);o.stop(t+.25);
}
function noiseHit(ctx,dest,t,duration,vol,kind,random) {
  const n=Math.max(1,Math.floor(ctx.sampleRate*duration)),buf=ctx.createBuffer(1,n,ctx.sampleRate),d=buf.getChannelData(0);
  for(let i=0;i<n;i++)d[i]=(random()*2-1)*(1-i/n);
  const src=ctx.createBufferSource();src.buffer=buf;
  const f=ctx.createBiquadFilter();f.type="highpass";f.frequency.value=kind==="hat"?6500:kind==="snare"?900:1800;
  const g=ctx.createGain();g.gain.setValueAtTime(vol,t);g.gain.exponentialRampToValueAtTime(.001,t+duration);
  src.connect(f);f.connect(g);g.connect(dest);src.start(t);src.stop(t+duration);
}
function encodeWav(buffer) {
  const channels=buffer.numberOfChannels, frames=buffer.length, bytes=frames*channels*2;
  const ab=new ArrayBuffer(44+bytes),v=new DataView(ab);
  const write=(o,s)=>{for(let i=0;i<s.length;i++)v.setUint8(o+i,s.charCodeAt(i));};
  write(0,"RIFF");v.setUint32(4,36+bytes,true);write(8,"WAVE");write(12,"fmt ");v.setUint32(16,16,true);
  v.setUint16(20,1,true);v.setUint16(22,channels,true);v.setUint32(24,buffer.sampleRate,true);
  v.setUint32(28,buffer.sampleRate*channels*2,true);v.setUint16(32,channels*2,true);v.setUint16(34,16,true);
  write(36,"data");v.setUint32(40,bytes,true);
  let offset=44;
  for(let i=0;i<frames;i++)for(let c=0;c<channels;c++){
    const s=Math.max(-1,Math.min(1,buffer.getChannelData(c)[i]));
    v.setInt16(offset,s<0?s*32768:s*32767,true);offset+=2;
  }
  return new Blob([ab],{type:"audio/wav"});
}
async function compose() {
  const bpm=Math.max(60,Math.min(180,Number($("bpm").value)||90));
  const seconds=Math.max(15,Math.min(60,Number($("duration").value)||60));
  const genre=$("genre").value, mood=$("mood").value;
  const seedText=$("prompt").value+genre+mood+bpm;
  let seed=0;for(let i=0;i<seedText.length;i++)seed=(seed*31+seedText.charCodeAt(i))>>>0;
  const random=seeded(seed||12345);
  const sr=44100, frames=Math.ceil(seconds*sr);
  const ctx=new OfflineAudioContext(2,frames,sr);
  const master=ctx.createGain();master.gain.value=.72;
  const comp=ctx.createDynamicsCompressor();comp.threshold.value=-18;comp.ratio.value=3;comp.attack.value=.008;comp.release.value=.18;
  master.connect(comp);comp.connect(ctx.destination);
  const drum=ctx.createGain(),bass=ctx.createGain(),harmony=ctx.createGain(),lead=ctx.createGain(),pad=ctx.createGain();
  drum.gain.value=genre==="lofi"?.7:1;bass.gain.value=.72;harmony.gain.value=.28;lead.gain.value=.2;pad.gain.value=.14;
  [drum,bass,harmony,lead,pad].forEach(x=>x.connect(master));
  const beat=60/bpm, step=beat/2, bar=beat*4;
  const roots=genre==="trap"?[36,36,39,34]:genre==="reggaeton"?[36,36,41,34]:genre==="rock"?[40,43,45,38]:genre==="jazz"?[41,46,43,48]:[38,34,41,36];
  const chordQual=genre==="jazz"?[0,3,7,10]:genre==="trap"||genre==="r&b soul"?[0,3,7]:[0,3,7,10];
  const totalBars=Math.ceil(seconds/bar);
  const scale=genre==="jazz"?[0,2,3,5,7,9,10]:[0,2,3,5,7,8,10];
  const prompt=$("prompt").value.toLowerCase();
  const bright= /alegre|feliz|bright|energetic|dance/.test(prompt+" "+mood);
  const dark= /oscuro|dark|sad|triste|minor/.test(prompt+" "+mood);
  for(let b=0;b<totalBars;b++){
    const start=b*bar, root=roots[b%roots.length];
    const intro=b===0, chorus=b>=Math.floor(totalBars*.45)&&b<Math.ceil(totalBars*.8);
    for(let s=0;s<8;s++){
      const t=start+s*step;if(t>=seconds)continue;
      const kickOn=genre==="reggaeton"?(s===0||s===3||s===4||s===7):(s===0||((genre==="trap"||genre==="hip hop")&&s===5));
      if(kickOn)kick(ctx,drum,t,chorus ? .85*energyScale : .68*energyScale);
      if(s===2||s===6)noiseHit(ctx,drum,t,.17,(genre==="lofi"?.19:.27)*energyScale,"snare",random);
      if(genre!=="cinematic orchestral" && (s%2===1||genre==="trap"&&s===3))noiseHit(ctx,drum,t,.045,(genre==="lofi"?.07:.12)*energyScale,"hat",random);
      if(s%2===0){
        const note=root+(s===4?12:0);
        tone(ctx,bass,midi(note),t,step*.82,"sawtooth",.16,genre==="lofi"?180:260);
      }
    }
    const chord=[root+12,root+12+chordQual[1],root+19,root+24];
    for(let n=0;n<chord.length;n++)tone(ctx,genre==="cinematic orchestral"?pad:harmony,midi(chord[n]),start,Math.min(bar*.94,seconds-start),"triangle",chorus?.075:.055,1200);
    if(genre==="worship cristiano"||genre==="cinematic orchestral"||genre==="pop"){
      for(let n=0;n<3;n++)tone(ctx,pad,midi(chord[n]+12),start,Math.min(bar*.96,seconds-start),"sine",.025,1600);
    }
    if(!intro||totalBars<3){
      for(let s=0;s<8;s++){
        const t=start+s*step;if(t>=seconds)continue;
        if(random()>(chorus?.2:.48))continue;
        const degree=scale[Math.floor(random()*scale.length)];
        const octave=random()>.72?24:12;
        tone(ctx,lead,midi(root+octave+degree),t,step*.42,genre==="lofi"?"triangle":"sine",.065,3000);
      }
    }
  }
  // Gentle arrangement swell and fade keep the generated loop sequence musical.
  const fade=ctx.createGain(); // master automation
  master.gain.setValueAtTime(.0001,0);master.gain.linearRampToValueAtTime(.72,Math.min(1.2,seconds*.12));
  master.gain.setValueAtTime(.72,Math.max(1.21,seconds-.9));master.gain.linearRampToValueAtTime(.0001,seconds);
  setProgress(62,"Renderizando loops y capas musicales…");
  const rendered=await ctx.startRendering();
  return encodeWav(rendered);
}
$("generateCloud").addEventListener("click",async()=>{
  if(busy)return;clearFail();
  if($("prompt").value.trim().length<3){fail("Escribe una idea musical para orientar los loops.");$("prompt").focus();return;}
  busy=true;updateButton();
  $("resultAudio").hidden=true;$("download").classList.remove("show");
  $("resultTitle").textContent="Construyendo tu instrumental…";
  $("resultText").textContent="Creando loops de batería, bajo, armonía y melodía en este dispositivo.";
  setProgress(5,"Preparando el motor musical del navegador…");
  try{
    await new Promise(r=>setTimeout(r,40));
    const bpm=Number($("bpm").value)||90;
    setProgress(20,"Diseñando patrones para "+$("genre").value+" a "+bpm+" BPM…");
    const blob=await compose();
    if(outputUrl)URL.revokeObjectURL(outputUrl);
    outputUrl=URL.createObjectURL(blob);
    $("resultAudio").src=outputUrl;$("resultAudio").hidden=false;
    $("download").href=outputUrl;$("download").download="EC-Audio-Browser-Instrumental.wav";$("download").classList.add("show");
    $("result").classList.add("ready");
    $("resultTitle").textContent="¡Tu instrumental está lista!";
    $("resultText").textContent="Loops sintetizados y arreglados en tu navegador · WAV · "+$("duration").value+" segundos · "+bpm+" BPM.";
    setProgress(100,"Instrumental creada en tu dispositivo.");
  }catch(e){console.error(e);fail("No se pudo renderizar el audio en este dispositivo. Cierra otras pestañas y vuelve a intentarlo. Detalle: "+(e.message||"error desconocido"));$("resultTitle").textContent="No se pudo completar";$("resultText").textContent="El navegador no pudo reservar memoria suficiente para renderizar el audio.";}
  finally{busy=false;updateButton();}
});
updateButton();
