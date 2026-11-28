import { initializeApp } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";
import { firebaseConfig } from "./firebase-config.js";
import { API_BASE_URL } from "./api-config.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const $ = id => document.getElementById(id);
let file = null, inputUrl = null, outputUrl = null, signedIn = false, busy = false;

function bytes(n) { return n < 1048576 ? (n/1024).toFixed(0)+" KB" : (n/1048576).toFixed(1)+" MB"; }
function error(message) { $("errorBox").textContent = message; $("errorBox").classList.add("show"); }
function clearError() { $("errorBox").textContent = ""; $("errorBox").classList.remove("show"); }
function setProgress(percent, label) {
  $("status").classList.add("show");
  $("statusText").textContent = label;
  $("statusPercent").textContent = Math.round(percent)+"%";
  $("progressBar").style.width = percent+"%";
}
function updateButton() { $("generateButton").disabled = !file || !signedIn || !$("consent").checked || busy; }
function setFile(next) {
  clearError();
  if (!next) {
    file = null;
    $("fileLine").hidden = true;
    $("voicePlayer").hidden = true;
    if (inputUrl) URL.revokeObjectURL(inputUrl);
    inputUrl = null;
    updateButton();
    return;
  }
  const ext = (next.name.split(".").pop() || "").toLowerCase();
  if (!["wav","mp3","m4a","aac","ogg"].includes(ext)) return error("Formato no compatible. Usa WAV, MP3, M4A, AAC u OGG.");
  if (next.size > 50*1024*1024) return error("El archivo supera el límite de 50 MB.");
  file = next;
  $("fileName").textContent = next.name;
  $("fileSize").textContent = bytes(next.size);
  $("fileLine").hidden = false;
  if (inputUrl) URL.revokeObjectURL(inputUrl);
  inputUrl = URL.createObjectURL(next);
  $("voicePlayer").src = inputUrl;
  $("voicePlayer").hidden = false;
  $("result").classList.remove("ready");
  $("resultTitle").textContent = "Tu instrumental aparecerá aquí";
  $("resultText").textContent = "La nueva generación reemplazará el resultado anterior.";
  $("resultPlayer").hidden = true;
  $("downloadLink").classList.remove("show");
  if (outputUrl) URL.revokeObjectURL(outputUrl);
  outputUrl = null;
  updateButton();
}
$("voiceFile").addEventListener("change", e => setFile(e.target.files?.[0]));
$("removeFile").addEventListener("click", () => { $("voiceFile").value = ""; setFile(null); });
$("consent").addEventListener("change", updateButton);
const drop = $("dropzone");
drop.addEventListener("dragover", e => { e.preventDefault(); drop.classList.add("drag"); });
drop.addEventListener("dragleave", () => drop.classList.remove("drag"));
drop.addEventListener("drop", e => { e.preventDefault(); drop.classList.remove("drag"); if (e.dataTransfer.files?.[0]) setFile(e.dataTransfer.files[0]); });

$("generateButton").addEventListener("click", async () => {
  if (!file || !signedIn || busy) return;
  clearError();
  const user = auth.currentUser;
  if (!user) { window.location.href = "./account.html?return=instrumental"; return; }
  busy = true; updateButton();
  $("resultTitle").textContent = "Creando tu acompañamiento…";
  $("resultText").textContent = "La IA está analizando tu interpretación y generando la instrumental.";
  $("result").classList.add("ready");
  setProgress(4, "Preparando tu grabación…");
  try {
    const token = await user.getIdToken();
    const body = new FormData();
    body.append("voice", file, file.name);
    body.append("style", $("style").value);
    body.append("tempo", $("tempo").value);
    body.append("mood", $("mood").value);
    body.append("notes", $("notes").value);
    setProgress(12, "Enviando audio de referencia al motor de IA…");
    const response = await fetch(API_BASE_URL + "/api/instrumental/generate", {
      method: "POST",
      headers: { Authorization: "Bearer " + token },
      body
    });
    if (!response.ok) {
      let message = "No se pudo generar la instrumental.";
      try { message = (await response.json()).error || message; } catch {}
      throw new Error(message);
    }
    setProgress(90, "Descargando la instrumental generada…");
    const blob = await response.blob();
    if (!blob.size || !blob.type.startsWith("audio/")) throw new Error("El servidor no devolvió un archivo de audio válido.");
    if (outputUrl) URL.revokeObjectURL(outputUrl);
    outputUrl = URL.createObjectURL(blob);
    $("resultPlayer").src = outputUrl;
    $("resultPlayer").hidden = false;
    $("downloadLink").href = outputUrl;
    $("downloadLink").download = "EC-AI-Instrumental." + (blob.type.includes("wav") ? "wav" : "mp3");
    $("downloadLink").classList.add("show");
    $("resultTitle").textContent = "¡Tu instrumental está lista!";
    $("resultText").textContent = "Escúchala y descarga el archivo para mezclarlo con tu voz.";
    setProgress(100, "Generación completada");
  } catch (e) {
    $("resultTitle").textContent = "No se pudo completar la generación";
    $("resultText").textContent = "Revisa el mensaje de error e inténtalo nuevamente.";
    error(e.message || "Ocurrió un error inesperado.");
  } finally {
    busy = false;
    updateButton();
    setTimeout(() => $("status").classList.remove("show"), 1600);
  }
});

onAuthStateChanged(auth, user => {
  signedIn = Boolean(user);
  $("generateButton").textContent = user ? "✦ CREAR MI INSTRUMENTAL" : "INICIA SESIÓN PARA GENERAR";
  updateButton();
});
