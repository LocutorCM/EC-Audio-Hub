// EC Audio Mix Doctor: análisis de señal local y recomendaciones adaptativas.
// No descarga audio ni llama a servicios externos.
export async function analyzeAndRecommend(input){
  const rate=input.sampleRate,frames=input.length;
  const mono=new AudioBuffer({length:frames,numberOfChannels:1,sampleRate:rate});
  const out=mono.getChannelData(0);
  const left=input.getChannelData(0),right=input.numberOfChannels>1?input.getChannelData(1):left;
  let peak=0,sum=0,clip=0,corrXY=0,corrXX=0,corrYY=0;
  const stride=Math.max(1,Math.floor(frames/120000));
  for(let i=0;i<frames;i++){
    const x=left[i],y=right[i],m=(x+y)*.5;
    out[i]=m;peak=Math.max(peak,Math.abs(x),Math.abs(y));sum+=(x*x+y*y)*.5;
    if(Math.abs(x)>=.999||Math.abs(y)>=.999)clip++;
    if(i%stride===0){corrXY+=x*y;corrXX+=x*x;corrYY+=y*y;}
  }
  const rms=Math.sqrt(sum/frames),crest=20*Math.log10(Math.max(peak,1e-9)/Math.max(rms,1e-9));
  const correlation=input.numberOfChannels>1?corrXY/Math.sqrt(Math.max(corrXX*corrYY,1e-12)):1;
  const ctx=new OfflineAudioContext(3,frames,rate),src=ctx.createBufferSource();src.buffer=mono;
  const merger=ctx.createChannelMerger(3);
  const low=ctx.createBiquadFilter();low.type="lowpass";low.frequency.value=150;low.Q.value=.707;
  const midHP=ctx.createBiquadFilter();midHP.type="highpass";midHP.frequency.value=150;midHP.Q.value=.707;
  const midLP=ctx.createBiquadFilter();midLP.type="lowpass";midLP.frequency.value=5000;midLP.Q.value=.707;
  const high=ctx.createBiquadFilter();high.type="highpass";high.frequency.value=5000;high.Q.value=.707;
  src.connect(low);low.connect(merger,0,0);
  src.connect(midHP);midHP.connect(midLP);midLP.connect(merger,0,1);
  src.connect(high);high.connect(merger,0,2);
  merger.connect(ctx.destination);src.start(0);
  const bands=await ctx.startRendering();
  const energy=[];
  for(let c=0;c<3;c++){const a=bands.getChannelData(c);let e=0;for(let i=0;i<a.length;i++)e+=a[i]*a[i];energy.push(e/Math.max(1,a.length));}
  const total=energy.reduce((a,b)=>a+b,0)||1;
  const shares=energy.map(x=>x/total);
  const clippingPct=clip/(frames*(input.numberOfChannels>1?2:1))*100;
  const lowDb=shares[0]>.56?-1.5:shares[0]<.13?.8:0;
  const highDb=shares[2]>.34?-1.2:shares[2]<.075?.8:0;
  const ratio=crest>12?3.4:crest>9?2.8:crest>6?2.3:1.8;
  const width=input.numberOfChannels<2?100:correlation<.05?80:correlation>.92?112:100;
  const issues=[];
  if(clippingPct>.01)issues.push("Se detectó clipping: conviene reducir nivel antes de la etapa final.");
  if(shares[0]>.56)issues.push("Exceso de energía en graves: se aplicará un recorte suave.");
  else if(shares[0]<.13)issues.push("Poca energía en graves: se añadirá un realce moderado.");
  if(shares[2]>.34)issues.push("Agudos dominantes: se suavizará el brillo.");
  else if(shares[2]<.075)issues.push("Poca energía en agudos: se añadirá presencia con moderación.");
  if(crest>12)issues.push("Dinámica muy amplia: se aumentará la compresión de forma controlada.");
  if(input.numberOfChannels>1&&correlation<.05)issues.push("Correlación estéreo baja: se reducirá la amplitud para mejorar compatibilidad mono.");
  if(!issues.length)issues.push("Balance tonal y estéreo sin anomalías evidentes; se aplicarán ajustes suaves.");
  return {lowShare:shares[0],midShare:shares[1],highShare:shares[2],crestDb:crest,peakDb:20*Math.log10(Math.max(peak,1e-9)),rmsDb:20*Math.log10(Math.max(rms,1e-9)),clippingPct,correlation,lowDb,highDb,ratio,width,issues};
}
