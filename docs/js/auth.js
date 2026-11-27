import { API_BASE_URL } from "./api-config.js";

const $ = (id) => document.getElementById(id);
const authPanel = $("authPanel");
const accountPanel = $("accountPanel");
const message = $("message");
let mode = "login";
let token = sessionStorage.getItem("ecAudioCustomerToken") || "";

function say(text, kind = "") {
  if (!message) return;
  message.textContent = text;
  message.className = "note " + kind;
}
function setMode(next) {
  mode = next;
  $("loginTab").classList.toggle("active", mode === "login");
  $("signupTab").classList.toggle("active", mode === "signup");
  $("nameWrap").classList.toggle("hidden", mode !== "signup");
  $("submitBtn").textContent = mode === "signup" ? "Crear mi cuenta" : "Iniciar sesión";
  $("password").autocomplete = mode === "signup" ? "new-password" : "current-password";
  $("password").minLength = 10;
  say("");
}
$("loginTab").addEventListener("click", () => setMode("login"));
$("signupTab").addEventListener("click", () => setMode("signup"));

async function api(path, options = {}) {
  if (!API_BASE_URL) throw new Error("El servidor de cuentas aún no está publicado. La web está preparada; falta configurar API_BASE_URL en js/api-config.js.");
  const response = await fetch(API_BASE_URL.replace(/\/$/, "") + path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: "Bearer " + token } : {}),
      ...(options.headers || {})
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "No se pudo completar la solicitud.");
  return data;
}
function showUser(user, subscription) {
  authPanel.classList.add("hidden");
  accountPanel.classList.remove("hidden");
  $("userEmail").textContent = user.email || "Correo no disponible";
  $("userName").textContent = user.displayName || "";
  $("avatar").textContent = (user.displayName || user.email || "EC").trim().charAt(0).toUpperCase();
  updateSubscription(subscription);
}
function updateSubscription(subscription) {
  const active = !!subscription?.active;
  $("subscriptionStatus").textContent = active
    ? "Acceso de prueba activo · " + subscription.remainingSeconds + " segundos restantes"
    : subscription?.status === "expired" ? "La prueba terminó" : "Sin suscripción activa";
  $("activateTrialBtn").disabled = false;
  $("activateTrialBtn").textContent = active ? "Activar de nuevo (prueba)" : "Activar prueba gratuita · $0 MXN";
}
async function loadAccount() {
  const data = await api("/api/customer/auth/me");
  showUser(data.user, data.subscription);
}
$("authForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  say("");
  $("submitBtn").disabled = true;
  try {
    const payload = {
      email: $("email").value.trim(),
      password: $("password").value,
      displayName: $("displayName").value.trim()
    };
    const data = await api(mode === "signup" ? "/api/customer/auth/register" : "/api/customer/auth/login", {
      method: "POST", body: JSON.stringify(payload)
    });
    token = data.token;
    sessionStorage.setItem("ecAudioCustomerToken", token);
    showUser(data.user, data.subscription);
    say("Sesión iniciada correctamente.", "ok");
  } catch (error) {
    say(error.message, "error");
  } finally {
    $("submitBtn").disabled = false;
  }
});
$("activateTrialBtn").addEventListener("click", async () => {
  $("activateTrialBtn").disabled = true;
  say("");
  try {
    const data = await api("/api/customer/subscription/activate", { method: "POST", body: "{}" });
    updateSubscription(data.subscription);
    say(data.message || "Prueba activada.", "ok");
  } catch (error) {
    say(error.message, "error");
  } finally {
    $("activateTrialBtn").disabled = false;
  }
});
$("signoutBtn").addEventListener("click", () => {
  token = "";
  sessionStorage.removeItem("ecAudioCustomerToken");
  accountPanel.classList.add("hidden");
  authPanel.classList.remove("hidden");
  say("Sesión cerrada.");
});
$("googleBtn").classList.add("hidden");
$("forgotBtn").classList.add("hidden");
if (!API_BASE_URL) {
  $("submitBtn").disabled = true;
  $("googleBtn").classList.add("hidden");
  say("El sistema de cuentas ya está preparado, pero falta publicar el servidor y configurar su dirección HTTPS en js/api-config.js.");
} else if (token) {
  loadAccount().catch((error) => {
    token = "";
    sessionStorage.removeItem("ecAudioCustomerToken");
    say(error.message, "error");
  });
}
