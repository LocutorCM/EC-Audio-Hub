import { initializeApp } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";
import { firebaseConfig } from "./firebase-config.js";
import { API_BASE_URL } from "./api-config.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const $ = id => document.getElementById(id);
let currentUser = null, onlineAvailable = false, busy = false, outputUrl = null;

function message(text) { $("cloudAuthMessage").textContent = text; }
function showError(text) { $("cloudError").textContent = text; $("cloudError").classList.add("show"); }
function clearError() { $("cloudError").textContent = ""; $("cloudError").classList.remove("show"); }
function setProgress(value, text) {
  $("cloudProgress").classList.add("show");
  $("cloudProgressPct").textContent = value + "%";
  $("cloudProgressBar").style.width = value + "%";
  $("cloudProgressText").textContent = text;
}
function updateButton() {
  $("generateCloud").disabled = !currentUser || !onlineAvailable || busy;
  $("generateCloud").textContent = busy ? "GENERANDO EN LA NUBE…" : "✦ GENERAR DESDE EC AUDIO";
}
async function authHeaders() {
  if (!currentUser) throw new Error("Inicia sesión en Mi cuenta para generar desde la página.");
  return { Authorization: "Bearer " + await currentUser.getIdToken() };
}
async function checkOnline() {
  if (!currentUser) { onlineAvailable = false; message("Inicia sesión en Mi cuenta. La generación online está reservada a cuentas autorizadas."); updateButton(); return; }
  message("Verificando autorización y conexión con ACE-Step ZeroGPU…");
  try {
    const response = await fetch(API_BASE_URL + "/api/instrumental/status", { headers: await authHeaders(), cache: "no-store" });
    const data = await response.json().catch(() => ({}));
    if (response.status === 403) throw new Error(data.error || "Tu cuenta no está autorizada.");
    if (!response.ok) throw new Error(data.error || "No se pudo verificar el motor online.");
    onlineAvailable = data.available === true;
    message(onlineAvailable ? "Acceso autorizado · ACE-Step online disponible · máximo 3 generaciones por hora." : (data.message || "El motor online no está disponible en este momento."));
  } catch (err) { onlineAvailable = false; message(err.message || "No se pudo conectar con EC Audio Cloud."); }
  updateButton();
}
async function pollJob(jobId) {
  const started = Date.now();
  while (Date.now() - started < 12 * 60 * 1000) {
    await new Promise(resolve => setTimeout(resolve, 2500));
    const response = await fetch(API_BASE_URL + "/api/instrumental/jobs/" + encodeURIComponent(jobId), { headers: await authHeaders(), cache: "no-store" });
    const job = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(job.error || "No se pudo consultar el progreso.");
    setProgress(job.progress || 10, job.stageLabel || "Generando instrumental online…");
    if (job.status === "failed") throw new Error(job.error || "ACE-Step no pudo completar la generación.");
    if (job.status === "completed") {
      const audioResponse = await fetch(API_BASE_URL + "/api/instrumental/jobs/" + encodeURIComponent(jobId) + "/audio", { headers: await authHeaders() });
      if (!audioResponse.ok) { const detail = await audioResponse.json().catch(() => ({})); throw new Error(detail.error || "No se pudo descargar el resultado."); }
      const blob = await audioResponse.blob();
      if (!blob.type.startsWith("audio/")) throw new Error("El servidor no devolvió un archivo de audio válido.");
      if (outputUrl) URL.revokeObjectURL(outputUrl);
      outputUrl = URL.createObjectURL(blob);
      $("resultAudio").src = outputUrl; $("resultAudio").hidden = false;
      $("download").href = outputUrl; $("download").download = "EC-Audio-Instrumental.mp3"; $("download").classList.add("show");
      $("result").classList.add("ready");
      $("resultTitle").textContent = "¡Tu instrumental online está lista!";
      $("resultText").textContent = "Generada por ACE-Step en la nube y entregada directamente en EC Audio.";
      setProgress(100, "Generación completada");
      return;
    }
  }
  throw new Error("La generación sigue en cola o procesándose. Espera un poco y vuelve a consultar el estado.");
}
$("generateCloud").addEventListener("click", async () => {
  if (!currentUser || !onlineAvailable || busy) return;
  clearError();
  const description = $("prompt").value.trim();
  if (description.length < 4) { showError("Escribe una descripción musical antes de generar."); $("prompt").focus(); return; }
  busy = true; updateButton();
  $("resultTitle").textContent = "Preparando generación online…";
  $("resultText").textContent = "La solicitud se enviará a ACE-Step sin instalar el modelo.";
  $("resultAudio").hidden = true; $("download").classList.remove("show");
  setProgress(4, "Enviando descripción al motor online…");
  try {
    const data = new FormData();
    const genre = $("genre").value === "custom" ? "" : $("genre").value;
    const prompt = [description, genre, $("mood").value, "instrumental music, no vocals, professional studio production"].filter(Boolean).join(", ");
    data.append("prompt", prompt); data.append("bpm", $("bpm").value || "90"); data.append("duration", String(Math.min(60, Number($("duration").value || 30))));
    const voice = $("voiceFile").files?.[0]; if (voice) data.append("voice", voice, voice.name);
    const response = await fetch(API_BASE_URL + "/api/instrumental/generate", { method: "POST", headers: await authHeaders(), body: data });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "No se pudo iniciar la generación online.");
    if (!payload.jobId) throw new Error("El servidor no devolvió el identificador de generación.");
    setProgress(8, "Solicitud aceptada · esperando turno de GPU…");
    await pollJob(payload.jobId);
  } catch (err) {
    showError(err.message || "Error al generar desde la página.");
    $("resultTitle").textContent = "No se pudo generar online";
    $("resultText").textContent = "Revisa el mensaje de error y vuelve a intentarlo.";
  } finally { busy = false; updateButton(); checkOnline(); }
});
onAuthStateChanged(auth, user => { currentUser = user; onlineAvailable = false; updateButton(); checkOnline(); });
