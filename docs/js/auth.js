import { initializeApp } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  GoogleAuthProvider,
  signInWithPopup,
  sendPasswordResetEmail,
  signOut,
  onAuthStateChanged,
  updateProfile
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";
import { firebaseConfig } from "./firebase-config.js";
import { API_BASE_URL } from "./api-config.js";
import { getFirestore, doc, getDoc, runTransaction, serverTimestamp } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const firestore = getFirestore(app);
const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: "select_account" });

const $ = (id) => document.getElementById(id);
const authPanel = $("authPanel");
const accountPanel = $("accountPanel");
const message = $("message");
let mode = "login";
let busy = false;
// En modo de cambio de cuenta, no enviar automáticamente la sesión anterior al Client Hub.
let waitingForExplicitSignIn = new URLSearchParams(window.location.search).get("switch") === "1";

function say(text, kind = "") {
  if (!message) return;
  message.textContent = text;
  message.className = "note " + kind;
}
function setBusy(value) {
  busy = value;
  ["submitBtn", "googleBtn", "forgotBtn", "loginTab", "signupTab"].forEach(id => {
    const element = $(id);
    if (element) element.disabled = value;
  });
}
function setMode(next) {
  mode = next;
  $("loginTab").classList.toggle("active", mode === "login");
  $("signupTab").classList.toggle("active", mode === "signup");
  $("nameWrap").classList.toggle("hidden", mode !== "signup");
  $("submitBtn").textContent = mode === "signup" ? "Crear mi cuenta" : "Iniciar sesión";
  $("password").autocomplete = mode === "signup" ? "new-password" : "current-password";
  say("");
}
function showUser(user) {
  authPanel.classList.add("hidden");
  accountPanel.classList.remove("hidden");
  $("userEmail").textContent = user.email || "Correo no disponible";
  $("userName").textContent = user.displayName || "";
  $("avatar").textContent = (user.displayName || user.email || "EC").trim().charAt(0).toUpperCase();
}
function showSignedOut() {
  sessionStorage.removeItem("ecAudioCustomerToken");
  accountPanel.classList.add("hidden");
  authPanel.classList.remove("hidden");
}
async function readSubscription(user) {
  if (!API_BASE_URL) return { status: "inactive", active: false, plan: null, expiresAt: null, remainingSeconds: 0 };
  try {
    const response = await fetch(API_BASE_URL + "/api/customer/subscription", {
      headers: { Authorization: "Bearer " + await user.getIdToken() }
    });
    if (response.ok) {
      const payload = await response.json();
      const subscription = payload.subscription || {};
      if (subscription.active && subscription.plan && subscription.plan !== "trial") {
        return { ...subscription, expiresAt: subscription.expiresAt ? new Date(subscription.expiresAt) : null };
      }
    }
  } catch {}
  return { status: "inactive", active: false, plan: null, expiresAt: null, remainingSeconds: 0 };
}

function renderSubscription(subscription) {
  const status = $("subscriptionStatus");
  const details = $("subscriptionDetails");
  if (subscription.active && subscription.plan && subscription.plan !== "trial") {
    const planName = subscription.plan === "annual" ? "Anual" : subscription.plan === "monthly" ? "Mensual" : "Comercial";
    status.textContent = "Licencia " + planName + " activa";
    details.textContent = subscription.cancelAtPeriodEnd
      ? "Tu licencia está programada para finalizar al terminar el periodo actual."
      : "Tu licencia comercial está activa y sincronizada con EC Audio Client.";
  } else {
    status.textContent = "Cuenta conectada";
    details.textContent = "Por ahora, las pruebas gratuitas y los planes de pago están desactivados. Anunciaremos aquí cuando vuelvan a estar disponibles.";
  }
}

async function syncCustomerSession(user) {
  try {
    renderSubscription(await readSubscription(user));
    await loadCustomerDevices(user);
  } catch (error) {
    $("subscriptionStatus").textContent = "Cuenta conectada";
    $("subscriptionDetails").textContent = "No se pudo consultar el estado de la licencia en este momento.";
  }
}

async function loadCustomerDevices(user) {
  const list = $("devicesList");
  list.replaceChildren();
  if (!API_BASE_URL) {
    $("devicesSection").hidden = true;
    return;
  }
  try {
    const response = await fetch(API_BASE_URL + "/api/customer/devices", {
      headers: { Authorization: "Bearer " + await user.getIdToken() }
    });
    if (!response.ok) return;
    const payload = await response.json();
    $("devicesSection").hidden = false;
    $("devicesSummary").textContent = (payload.devices || []).length + " de " + payload.maxDevices + " dispositivos vinculados";
    for (const device of payload.devices || []) {
      const item = document.createElement("div");
      item.className = "device-item";
      const label = document.createElement("span");
      label.textContent = device.deviceName + " · " + device.platform;
      const release = document.createElement("button");
      release.type = "button";
      release.textContent = "Liberar";
      release.addEventListener("click", async () => {
        const result = await fetch(API_BASE_URL + "/api/customer/devices/" + encodeURIComponent(device.deviceId), {
          method: "DELETE", headers: { Authorization: "Bearer " + await user.getIdToken() }
        });
        if (result.ok) await loadCustomerDevices(user);
      });
      item.append(label, release);
      list.append(item);
    }
  } catch {}
}


async function refreshSubscription() {
  const user = auth.currentUser;
  if (!user) return;
  renderSubscription(await readSubscription(user));
}


function friendlyError(error) {
  const code = error?.code || "";
  const messages = {
    "auth/email-already-in-use": "Este correo ya tiene una cuenta. Inicia sesión.",
    "auth/invalid-email": "El correo electrónico no es válido.",
    "auth/weak-password": "La contraseña es demasiado débil. Usa al menos 10 caracteres.",
    "auth/invalid-credential": "Correo o contraseña incorrectos.",
    "auth/user-disabled": "Esta cuenta está deshabilitada.",
    "auth/popup-closed-by-user": "Se cerró la ventana de Google antes de terminar.",
    "auth/popup-blocked": "El navegador bloqueó la ventana de Google. Permite las ventanas emergentes e inténtalo otra vez.",
    "auth/unauthorized-domain": "Este dominio todavía no está autorizado en Firebase Authentication.",
    "auth/network-request-failed": "No se pudo conectar. Revisa tu conexión e inténtalo otra vez.",
    "auth/too-many-requests": "Hubo demasiados intentos. Espera un momento y vuelve a intentarlo."
  };
  return messages[code] || error?.message || "No se pudo completar la operación. Inténtalo de nuevo.";
}

$("loginTab").addEventListener("click", () => setMode("login"));
$("signupTab").addEventListener("click", () => setMode("signup"));

$("authForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (busy) return;
  say("");
  waitingForExplicitSignIn = false;
  setBusy(true);
  try {
    const email = $("email").value.trim();
    const password = $("password").value;
    if (mode === "signup") {
      const credential = await createUserWithEmailAndPassword(auth, email, password);
      const displayName = $("displayName").value.trim();
      if (displayName) await updateProfile(credential.user, { displayName });
      showUser(auth.currentUser);
      say("¡Tu cuenta EC Audio fue creada correctamente!", "ok");
    } else {
      const credential = await signInWithEmailAndPassword(auth, email, password);
      showUser(credential.user);
      say("Sesión iniciada correctamente.", "ok");
    }
  } catch (error) {
    say(friendlyError(error), "error");
  } finally {
    setBusy(false);
  }
});

$("googleBtn").addEventListener("click", async () => {
  if (busy) return;
  say("");
  waitingForExplicitSignIn = false;
  setBusy(true);
  try {
    const credential = await signInWithPopup(auth, googleProvider);
    showUser(credential.user);
    say("Sesión iniciada con Google correctamente.", "ok");
  } catch (error) {
    say(friendlyError(error), "error");
  } finally {
    setBusy(false);
  }
});

$("forgotBtn").addEventListener("click", async (event) => {
  event.preventDefault();
  const email = $("email").value.trim();
  if (!email) {
    say("Escribe tu correo electrónico y vuelve a pulsar «¿Olvidaste tu contraseña?».");
    $("email").focus();
    return;
  }
  try {
    await sendPasswordResetEmail(auth, email);
    say("Te enviamos un enlace para restablecer tu contraseña. Revisa tu correo.", "ok");
  } catch (error) {
    say(friendlyError(error), "error");
  }
});

$("signoutBtn").addEventListener("click", async () => {
  try {
    await signOut(auth);
    say("Sesión cerrada correctamente.", "ok");
  } catch (error) {
    say(friendlyError(error), "error");
  }
});

function returnToNativeClient(user, force = false) {
  const params = new URLSearchParams(window.location.search);
  if (params.get("client") !== "1" && !force) return false;
  user.getIdToken().then((idToken) => {
    const callback = "ecaudiohub://auth#" + new URLSearchParams({
      idToken,
      email: user.email || "",
      displayName: user.displayName || "",
      uid: user.uid,
      refreshToken: user.refreshToken || ""
    }).toString();
    window.location.href = callback;
  }).catch((error) => say(friendlyError(error), "error"));
  return true;
}

$("openClientBtn")?.addEventListener("click", () => {
  const user = auth.currentUser;
  if (user) returnToNativeClient(user, true);
});

onAuthStateChanged(auth, async (user) => {
  if (user) {
    if (waitingForExplicitSignIn) {
      showSignedOut();
      return;
    }
    showUser(user);
    if (new URLSearchParams(window.location.search).get("billing") !== "1" && returnToNativeClient(user)) return;
    await syncCustomerSession(user);
  } else showSignedOut();
});
