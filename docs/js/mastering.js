import { initializeApp } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";
import { firebaseConfig } from "./firebase-config.js";
import { API_BASE_URL } from "./api-config.js";

const app=initializeApp(firebaseConfig);
const auth=getAuth(app);
const $=id=>document.getElementById(id);
let selectedFile=null, originalURL=null, masteredURL=null, signedInUser=null;

function formatBytes(bytes){if(bytes<1024*1024)return (bytes/1024).toFixed(0)+" KB";return (bytes/1024/1024).toFixed(1)+" MB";}
function showError(message){$("errorBox").textContent=message;$("errorBox").classList.add("show");}
function clearError(){$("errorBox").textContent="";$("errorBox").classList.remove("show");}
function clearMaster(){if(masteredURL)URL.revokeObjectURL(masteredURL);masteredURL=null;$("result").classList.remove("show");$("emptyResult").hidden=false;$("resultState").textContent="ESPERANDO AUDIO";}
function setFile(file){
  clearError();
  if(!file){selectedFile=null;$("fileLine").hidden=true;$("originalPlayer").hidden=true;if(originalURL)URL.revokeObjectURL(originalURL);originalURL=null;$("masterButton").disabled=true;clearMaster();return;}
  const ext=(file.name.split(".").pop()||"").toLowerCase();
  if(!["wav","wave","mp3","flac","aif","aiff","m4a","aac","ogg","opus"].includes(ext)){showError("Este formato no es compatible. Selecciona WAV, MP3, FLAC, AIFF, M4A, AAC, OGG u OPUS.");return;}
  if(file.size>150*1024*1024){showError("El archivo supera el límite de 150 MB.");return;}
  selectedFile=file;$("fileName").textContent=file.name;$("fileSize").textContent=formatBytes(file.size);$("fileLine").hidden=false;
  if(originalURL)URL.revokeObjectURL(originalURL);originalURL=URL.createObjectURL(file);$("originalPlayer").src=originalURL;$("originalPlayer").hidden=false;$("masterButton").disabled=!API_BASE_URL;clearMaster();
}
$("audioFile").addEventListener("change",e=>setFile(e.target.files?.[0]));
$("removeFile").addEventListener("click",()=>{$("audioFile").value="";setFile(null);});
const drop=$("dropzone");
drop.addEventListener("dragover",e=>{e.preventDefault();drop.classList.add("drag");});
drop.addEventListener("dragleave",()=>drop.classList.remove("drag"));
drop.addEventListener("drop",e=>{e.preventDefault();drop.classList.remove("drag");const file=e.dataTransfer.files?.[0];if(file)setFile(file);});
function progress(value,label){$("status").classList.add("show");$("statusText").textContent=label;$("statusPercent").textContent=Math.round(value)+"%";$("progressBar").style.width=value+"%";}
function xhrMaster(file,token){
  return new Promise((resolve,reject)=>{
    const xhr=new XMLHttpRequest();xhr.open("POST",API_BASE_URL+"/api/mastering/process");xhr.responseType="blob";xhr.setRequestHeader("Authorization","Bearer "+token);
    xhr.upload.onprogress=e=>{if(e.lengthComputable)progress(Math.min(55,e.loaded/e.total*55),"Subiendo canción…");};
    xhr.upload.onload=()=>progress(62,"Analizando y masterizando…");
    xhr.onload=()=>{if(xhr.status>=200&&xhr.status<300){progress(100,"Master terminada");resolve({blob:xhr.response,headers:xhr.getAllResponseHeaders()});return;}const reader=new FileReader();reader.onload=()=>{try{reject(new Error(JSON.parse(reader.result).error||"No se pudo procesar el audio."));}catch{reject(new Error("No se pudo procesar el audio. Código "+xhr.status));}};reader.readAsText(xhr.response);};
    xhr.onerror=()=>reject(new Error("No se pudo conectar con el servidor de masterización."));
    xhr.ontimeout=()=>reject(new Error("El procesamiento tardó demasiado. Inténtalo nuevamente."));
    xhr.timeout=20*60*1000;
    const form=new FormData();form.append("audio",file,file.name);form.append("genre",$("genre").value);form.append("format",$("format").value);xhr.send(form);
  });
}
$("masterButton").addEventListener("click",async()=>{
  clearError();if(!selectedFile)return;
  if(!signedInUser){window.location.href="./account.html?return=mastering";return;}
  if(!API_BASE_URL){showError("El servidor EC Audio todavía no está conectado. Completa el despliegue del servicio Cloud API para habilitar la masterización.");return;}
  $("masterButton").disabled=true;$("resultState").textContent="PROCESANDO";$("status").classList.add("show");progress(1,"Preparando canción…");
  try{
    const token=await signedInUser.getIdToken();const result=await xhrMaster(selectedFile,token);
    if(masteredURL)URL.revokeObjectURL(masteredURL);masteredURL=URL.createObjectURL(result.blob);
    $("masteredPlayer").src=masteredURL;$("downloadLink").href=masteredURL;
    const ext=$("format").value;$("downloadLink").download=(selectedFile.name.replace(/\.[^.]+$/,"")||"EC-Audio")+"-EC-AI-Mastered."+ext;
    const headers=new Headers(result.headers);const profile=decodeURIComponent(headers.get("x-ec-mastering-profile")||"Perfil adaptativo");const target=headers.get("x-ec-mastering-target-lufs")||"—";const peak=headers.get("x-ec-mastering-input-peak");
    $("profileValue").textContent=profile;$("lufsValue").textContent=target+" LUFS";$("peakValue").textContent=peak&&peak!=="unknown"?peak+" dBFS":"No disponible";
    $("result").classList.add("show");$("emptyResult").hidden=true;$("resultState").textContent="MASTER COMPLETADA";$("resultState").style.color="var(--lime)";
  }catch(error){showError(error.message||"Ocurrió un error durante la masterización.");$("resultState").textContent="ERROR";$("resultState").style.color="#ffabb7";}
  finally{$("masterButton").disabled=!selectedFile||!signedInUser;$("status").classList.remove("show");}
});
onAuthStateChanged(auth,user=>{
  signedInUser=user;
  $("masterButton").disabled=!selectedFile||!API_BASE_URL;
  $("masterButton").textContent=!user?"INICIA SESIÓN PARA MASTERIZAR":(API_BASE_URL?"✦ MASTERIZAR MI CANCIÓN":"SERVIDOR EN CONFIGURACIÓN");
  if(!API_BASE_URL)showError("El servidor de procesamiento aún no está desplegado o configurado.");
});
