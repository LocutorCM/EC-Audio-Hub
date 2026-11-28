import { initializeApp } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";
import { firebaseConfig } from "./firebase-config.js";
import { API_BASE_URL } from "./api-config.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const $ = id => document.getElementById(id);
let selectedFile = null;
let inputUrl = null;
let outputUrl = null;
let signedInUser = null;
let busy = false;
let activeJobId = null;
let apiAvailable = false;

function bytes(size) {
  return size < 1048576 ? (size / 1024).toFixed(0) + " KB" : (size / 1048576).toFixed(1) + " MB";
}
function showError(message) {
  $("errorBox").textContent = message;
  $("errorBox").classList.add("show");
}
function clearError() {
  $("errorBox").textContent = "";
  $("errorBox").classList.remove("show");
}
function updateButton() {
  $("generateButton").disabled = !selectedFile || !signedInUser || !apiAvailable || ! $("consent").checked || busy;
  if (!signedInUser) $("generateButton").textContent = "INICIA SESIÓN PARA CREAR";
  else if (!apiAvailable) $("generateButton").textContent = "MOTOR DE IA NO DISPONIBLE";
  else $("generateButton").textContent = busy ? "GENERANDO CON IA…" : "✦ CREAR CON INTELIGENCIA ARTIFICIAL";
}
function setFile(file) {
  clearError();
  if (!file) {
    selectedFile = null;
    $("fileLine").hidden = true;
    $("voicePlayer").hidden = true;
    if (inputUrl) URL.revokeObjectURL(inputUrl);
    inputUrl = null;
    updateButton();
    return;
  }
  const ext = (file.name.split(".").pop() || "").toLowerCase();
  if (!["wav", "mp3", "m4a", "aac", "ogg"].includes(ext)) {
    showError("Formato no compatible. Usa WAV, MP3, M4A, AAC u OGG.");
    return;
  }
  if (file.size > 50 * 1024 * 1024) {
    showError("El archivo supera el límite de 50 MB.");
    return;
  }
  selectedFile = file;
  $("fileName").textContent = file.name;
  $("fileSize").textContent = bytes(file.size);
  $("fileLine").hidden = false;
  if (inputUrl) URL.revokeObjectURL(inputUrl);
  inputUrl = URL.createObjectURL(file);
  $("voicePlayer").src = inputUrl;
  $("voicePlayer").hidden = false;
  $("result").classList.remove("ready");
  $("resultTitle").textContent = "Tu instrumental aparecerá aquí";
  $("resultText").textContent = "La nueva generación reemplazará el resultado anterior.";
  $("resultPlayer").hidden = true;
  $("downloadMix").classList.remove("show");
  $("downloadStems").classList.remove("show");
  if (outputUrl) URL.revokeObjectURL(outputUrl);
  outputUrl = null;
  updateButton();
}
$("voiceFile").addEventListener("change", event => setFile(event.target.files?.[0]));
$("removeFile").addEventListener("click", () => {
  $("voiceFile").value = "";
  setFile(null);
});
$("consent").addEventListener("change", updateButton);
const drop = $("dropzone");
drop.addEventListener("dragover", event => {
  event.preventDefault();
  drop.classList.add("drag");
});
drop.addEventListener("dragleave", () => drop.classList.remove("drag"));
drop.addEventListener("drop", event => {
  event.preventDefault();
  drop.classList.remove("drag");
  if (event.dataTransfer.files?.[0]) setFile(event.dataTransfer.files[0]);
});

function stageState(stage, status) {
  const compose = $("stageCompose");
  const stems = $("stageStems");
  const done = $("stageDone");
  [compose, stems, done].forEach(el => el.classList.remove("active", "done"));
  if (["queued", "upload", "composition"].includes(stage)) compose.classList.add("active");
  if (["mix", "separation"].includes(stage)) {
    compose.classList.add("done");
    stems.classList.add("active");
  }
  if (stage === "done" || status === "completed") {
    compose.classList.add("done");
    stems.classList.add("done");
    done.classList.add("done");
  }
  if (status === "partial") {
    compose.classList.add("done");
    stems.classList.add("active");
    $("stageStems").querySelector("span").innerHTML = "<b>Separación de pistas incompleta</b><br>La mezcla se creó, pero el ZIP no pudo prepararse";
  }
  if (status === "failed") compose.classList.add("active");
}
function updateProgress(job) {
  $("status").classList.add("show");
  const value = Math.max(0, Math.min(100, Number(job.progress) || 0));
  $("statusPercent").textContent = Math.round(value) + "%";
  $("progressBar").style.width = value + "%";
  $("statusText").textContent = job.stageLabel || job.message || "Procesando…";
  stageState(job.stage, job.status);
}
async function authHeaders() {
  if (!signedInUser) throw new Error("Inicia sesión con tu cuenta EC Audio para continuar.");
  const token = await signedInUser.getIdToken();
  return { Authorization: "Bearer " + token };
}
async function fetchAudio(jobId) {
  const headers = await authHeaders();
  const response = await fetch(API_BASE_URL + "/api/instrumental/jobs/" + encodeURIComponent(jobId) + "/audio", { headers });
  if (!response.ok) {
    let message = "No se pudo descargar la instrumental.";
    try { message = (await response.json()).error || message; } catch {}
    throw new Error(message);
  }
  const blob = await response.blob();
  if (!blob.type.startsWith("audio/")) throw new Error("El servidor devolvió un archivo que no es audio.");
  return URL.createObjectURL(blob);
}
async function pollJob(jobId) {
  const headers = await authHeaders();
  const startedAt = Date.now();
  while (Date.now() - startedAt < 15 * 60 * 1000) {
    await new Promise(resolve => setTimeout(resolve, 2500));
    const response = await fetch(API_BASE_URL + "/api/instrumental/jobs/" + encodeURIComponent(jobId), { headers, cache: "no-store" });
    const job = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(job.error || "No se pudo consultar el progreso de la generación.");
    updateProgress(job);
    if (job.status === "completed" || job.status === "partial") {
      outputUrl = await fetchAudio(jobId);
      $("resultPlayer").src = outputUrl;
      $("resultPlayer").hidden = false;
      $("downloadMix").href = outputUrl;
      $("downloadMix").download = (selectedFile?.name.replace(/\.[^.]+$/, "") || "EC-Audio") + "-EC-AI-Instrumental" + (job.audioExtension || ".mp3");
      $("downloadMix").classList.add("show");
      if (job.stemsDownloadUrl) {
        $("downloadStems").href = API_BASE_URL + job.stemsDownloadUrl;
        $("downloadStems").classList.add("show");
      }
      $("result").classList.add("ready");
      $("resultTitle").textContent = job.status === "completed" ? "¡Tu producción está lista!" : "Tu instrumental está lista";
      $("resultText").textContent = job.status === "completed"
        ? "La mezcla completa y el archivo ZIP de pistas separadas están disponibles."
        : "La mezcla completa se creó, pero no se pudo completar la separación de pistas.";
      if (job.warning) showError("La instrumental está lista. Aviso de separación: " + job.warning);
      return;
    }
    if (job.status === "failed") throw new Error(job.error || "La IA no pudo completar la generación.");
  }
  throw new Error("La generación sigue tardando más de lo esperado. Vuelve a consultar en unos minutos; no vuelvas a enviar la misma solicitud.");
}

$("downloadStems").addEventListener("click", async event => {
  event.preventDefault();
  if (!activeJobId || !signedInUser) return;
  try {
    const headers = await authHeaders();
    const response = await fetch(API_BASE_URL + "/api/instrumental/jobs/" + encodeURIComponent(activeJobId) + "/stems", { headers });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error || "No se pudo descargar el ZIP de pistas.");
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "EC-AI-Stems.zip";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  } catch (error) {
    showError(error.message || "No se pudo descargar el ZIP de pistas.");
  }
});

$("generateButton").addEventListener("click", async () => {
  if (!selectedFile || !signedInUser || !apiAvailable || !$("consent").checked || busy) return;
  clearError();
  busy = true;
  activeJobId = null;
  updateButton();
  $("result").classList.add("ready");
  $("resultTitle").textContent = "Preparando tu producción…";
  $("resultText").textContent = "La solicitud se enviará al motor de IA en la nube.";
  $("downloadMix").classList.remove("show");
  $("downloadStems").classList.remove("show");
  $("resultPlayer").hidden = true;
  $("stageStems").querySelector("span").innerHTML = "<b>Separación de pistas</b><br>Analizando batería, bajo, piano/teclados y otras capas que el modelo pueda aislar";
  $("status").classList.add("show");
  $("statusPercent").textContent = "4%";
  $("progressBar").style.width = "4%";
  $("statusText").textContent = "Subiendo referencia de voz…";
  try {
    const data = new FormData();
    data.append("voice", selectedFile, selectedFile.name);
    data.append("style", $("style").value);
    data.append("bpm", $("tempo").value);
    data.append("mood", $("mood").value);
    data.append("notes", $("notes").value);
    const headers = await authHeaders();
    const response = await fetch(API_BASE_URL + "/api/instrumental/generate", { method: "POST", headers, body: data });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "No se pudo iniciar la generación.");
    activeJobId = payload.jobId;
    if (!activeJobId) throw new Error("El servidor no devolvió el identificador de generación.");
    await pollJob(activeJobId);
  } catch (error) {
    console.error("EC Audio AI Instrumental:", error);
    $("resultTitle").textContent = "No se pudo completar la generación";
    $("resultText").textContent = "Consulta el detalle del error antes de volver a intentarlo.";
    showError(error.message || "Ocurrió un error al conectar con el motor de IA.");
  } finally {
    busy = false;
    updateButton();
  }
});

onAuthStateChanged(auth, async user => {
  signedInUser = user;
  if (!user) {
    apiAvailable = false;
    $("authMessage").textContent = "Inicia sesión en Mi cuenta para usar el motor de IA.";
    updateButton();
    return;
  }
  $("authMessage").textContent = "Verificando conexión con EC Audio Cloud…";
  try {
    const headers = await authHeaders();
    const response = await fetch(API_BASE_URL + "/api/instrumental/status", { headers, cache: "no-store" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "No se pudo verificar el servicio.");
    apiAvailable = payload.available === true;
    $("authMessage").textContent = apiAvailable
      ? "Sesión activa · Motor de IA conectado · Límite de 3 generaciones por hora."
      : "Sesión activa, pero falta configurar HF_TOKEN y HF_MUSIC_SPACE en el servidor EC Audio.";
  } catch (error) {
    apiAvailable = false;
    $("authMessage").textContent = error.message || "No se pudo conectar con EC Audio Cloud.";
  }
  updateButton();
});
