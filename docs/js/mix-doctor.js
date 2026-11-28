// EC Audio Mix Doctor: análisis de señal local y recomendaciones adaptativas.
// Analiza directamente las muestras: no crea OfflineAudioContext adicionales.
export async function analyzeAndRecommend(input){
  const rate=Number(input?.sampleRate),frames=Number(input?.length),channels=Number(input?.numberOfChannels);
  if(!Number.isFinite(rate)||rate<8000||rate>192000||!Number.isSafeInteger(frames)||frames<1||!Number.isFinite(channels)||channels<1){
    throw new Error("El audio decodificado tiene parámetros inválidos. Vuelve a cargarlo o expórtalo como WAV estéreo.");
  }
  const left=input.getChannelData(0),right=channels>1?input.getChannelData(1):left;
  const analysisFrames=Math.min(frames,Math.max(1,Math.floor(rate*8)));
  const start=Math.max(0,Math.floor((frames-analysisFrames)/2));
  let peak=0,sum=0,clip=0,corrXY=0,corrXX=0,corrYY=0;
  const stride=Math.max(1,Math.floor(frames/120000));
  for(let i=0;i<frames;i++){
    const x=left[i],y=right[i];
    if(!Number.isFinite(x)||!Number.isFinite(y))continue;
    peak=Math.max(peak,Math.abs(x),Math.abs(y));sum+=(x*x+y*y)*.5;
    if(Math.abs(x)>=.999||Math.abs(y)>=.999)clip++;
    if(i%stride===0){corrXY+=x*y;corrXX+=x*x;corrYY+=y*y;}
  }
  const rms=Math.sqrt(sum/frames),crest=20*Math.log10(Math.max(peak,1e-9)/Math.max(rms,1e-9));
  const correlation=channels>1?corrXY/Math.sqrt(Math.max(corrXX*corrYY,1e-12)):1;

  // Separación de bandas mediante filtros pasa-bajos de un polo.
  // Evita construir OfflineAudioContext de 3 canales (incompatible en algunos navegadores).
  const alpha150=1-Math.exp(-2*Math.PI*150/rate);
  const alpha5000=1-Math.exp(-2*Math.PI*5000/rate);
  let lp150=0,lp5000=0,lowEnergy=0,midEnergy=0,highEnergy=0;
  for(let i=start;i<start+analysisFrames;i++){
    const x=(left[i]+right[i])*.5;
    lp150+=alpha150*(x-lp150);
    lp5000+=alpha5000*(x-lp5000);
    const low=lp150,mid=lp5000-lp150,high=x-lp5000;
    lowEnergy+=low*low;midEnergy+=mid*mid;highEnergy+=high*high;
  }
  const denom=Math.max(1,analysisFrames);
  const energy=[lowEnergy/denom,midEnergy/denom,highEnergy/denom];
  const total=energy.reduce((a,b)=>a+b,0)||1;
  const shares=energy.map(x=>x/total);
  const clippingPct=clip/(frames*(channels>1?2:1))*100;
  const lowDb=shares[0]>.56?-1.5:shares[0]<.13?.8:0;
  const highDb=shares[2]>.34?-1.2:shares[2]<.075?.8:0;
  const ratio=crest>12?3.4:crest>9?2.8:crest>6?2.3:1.8;
  const width=channels<2?100:correlation<.05?80:correlation>.92?112:100;
  const issues=[];
  if(clippingPct>.01)issues.push("Se detectó clipping: conviene reducir nivel antes de la etapa final.");
  if(shares[0]>.56)issues.push("Exceso de energía en graves: se aplicará un recorte suave.");
  else if(shares[0]<.13)issues.push("Poca energía en graves: se añadirá un realce moderado.");
  if(shares[2]>.34)issues.push("Agudos dominantes: se suavizará el brillo.");
  else if(shares[2]<.075)issues.push("Poca energía en agudos: se añadirá presencia con moderación.");
  if(crest>12)issues.push("Dinámica muy amplia: se aumentará la compresión de forma controlada.");
  if(channels>1&&correlation<.05)issues.push("Correlación estéreo baja: se reducirá la amplitud para mejorar compatibilidad mono.");
  if(!issues.length)issues.push("Balance tonal y estéreo sin anomalías evidentes; se aplicarán ajustes suaves.");
  return {lowShare:shares[0],midShare:shares[1],highShare:shares[2],crestDb:crest,peakDb:20*Math.log10(Math.max(peak,1e-9)),rmsDb:20*Math.log10(Math.max(rms,1e-9)),clippingPct,correlation,lowDb,highDb,ratio,width,issues};
}
