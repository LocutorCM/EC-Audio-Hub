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
  if (API_BASE_URL) {
    try {
      const response = await fetch(API_BASE_URL + "/api/customer/subscription", {
        headers: { Authorization: "Bearer " + await user.getIdToken() }
      });
      if (response.ok) {
        const payload = await response.json();
        const subscription = payload.subscription || {};
        if (subscription.active || (subscription.plan && subscription.plan !== "trial" && subscription.status !== "inactive")) {
          return {
            ...subscription,
            expiresAt: subscription.expiresAt ? new Date(subscription.expiresAt) : null,
            remainingSeconds: subscription.active && subscription.expiresAt
              ? Math.max(0, Math.ceil((new Date(subscription.expiresAt).getTime() - Date.now()) / 1000)) : 0,
            trialUsed: false
          };
        }
      }
    } catch {}
  }
  const reference = doc(firestore, "ecAudioSubscriptions", user.uid);
  const snapshot = await getDoc(reference);
  if (!snapshot.exists()) {
    return { status: "inactive", active: false, plan: null, expiresAt: null, remainingSeconds: 0, trialUsed: false };
  }
  const data = snapshot.data();
  const startedAt = data.startedAt?.toDate?.() || null;
  const expiresAt = startedAt ? new Date(startedAt.getTime() + 60 * 1000) : null;
  const active = data.status === "active" && expiresAt instanceof Date && expiresAt.getTime() > Date.now();
  return {
    status: data.status === "active" && !active ? "expired" : (data.status || "inactive"),
    active,
    plan: data.plan || null,
    expiresAt,
    remainingSeconds: active ? Math.max(0, Math.ceil((expiresAt.getTime() - Date.now()) / 1000)) : 0,
    trialUsed: data.trialUsed === true
  };
}

function renderSubscription(subscription) {
  const status = $("subscriptionStatus");
  const details = $("subscriptionDetails");
  const trialButton = $("trialBtn");
  const billingActions = $("billingActions");
  const portalButton = $("portalBtn");
  if (subscription.active && subscription.plan && subscription.plan !== "trial") {
    const planName = subscription.plan === "annual" ? "Anual" : subscription.plan === "monthly" ? "Mensual" : "Comercial";
    status.textContent = "Suscripción " + planName + " activa";
    details.textContent = subscription.cancelAtPeriodEnd
      ? "Tu suscripción está programada para cancelarse al terminar el periodo actual."
      : "Tu licencia comercial está activa y sincronizada con EC Audio Client.";
    trialButton.hidden = true;
    billingActions.hidden = false;
    portalButton.hidden = false;
  } else if (subscription.active) {
    status.textContent = "Prueba activa · " + subscription.remainingSeconds + " segundos restantes";
    details.textContent = "Tu acceso de prueba está guardado y se comparte con EC Audio Client.";
    trialButton.hidden = false;
    billingActions.hidden = false;
    portalButton.hidden = true;
  } else if (subscription.trialUsed) {
    status.textContent = "Prueba gratuita utilizada";
    details.textContent = "Esta cuenta ya utilizó su prueba de 60 segundos. Puedes elegir un plan comercial.";
    trialButton.disabled = true;
    trialButton.textContent = "Prueba gratuita utilizada";
    trialButton.hidden = false;
    billingActions.hidden = false;
    portalButton.hidden = true;
  } else {
    status.textContent = "Cuenta Firebase conectada · sin licencia activa";
    details.textContent = "Puedes activar la prueba técnica o elegir una suscripción comercial.";
    trialButton.disabled = false;
    trialButton.textContent = "Activar prueba gratuita · $0 MXN";
    trialButton.hidden = false;
    billingActions.hidden = false;
    portalButton.hidden = true;
  }
  trialButton.disabled = subscription.trialUsed || subscription.active;
}

async function syncCustomerSession(user) {
  try {
    const subscription = await readSubscription(user);
    renderSubscription(subscription);
    await loadBillingPlans(user);
    await loadCustomerDevices(user);
  } catch (error) {
    $("subscriptionStatus").textContent = "No se pudo consultar la licencia";
    $("subscriptionDetails").textContent = error.message || "No se pudo consultar el estado de tu cuenta.";
    $("trialBtn").disabled = true;
  }
}

function money(amount, currency) {
  return new Intl.NumberFormat("es-MX", { style: "currency", currency: currency || "MXN" }).format((amount || 0) / 100);
}

async function loadBillingPlans(user) {
  const container = $("billingActions");
  if (!API_BASE_URL) {
    container.hidden = false;
    $("billingNotice").textContent = "Las suscripciones comerciales estarán disponibles cuando se publique el servidor seguro de EC Audio.";
    $("monthlyBtn").disabled = true;
    $("annualBtn").disabled = true;
    return;
  }
  try {
    const response = await fetch(API_BASE_URL + "/api/customer/billing/plans");
    if (!response.ok) throw new Error("No se pudieron cargar los planes.");
    const payload = await response.json();
    const monthly = payload.plans.find(plan => plan.plan === "monthly");
    const annual = payload.plans.find(plan => plan.plan === "annual");
    if (monthly) $("monthlyBtn").textContent = "Plan mensual · " + money(monthly.amount, monthly.currency) + " / mes";
    if (annual) $("annualBtn").textContent = "Plan anual · " + money(annual.amount, annual.currency) + " / año";
    $("monthlyBtn").disabled = !monthly;
    $("annualBtn").disabled = !annual;
    $("billingNotice").textContent = "Pago seguro mediante Stripe. Puedes administrar o cancelar tu suscripción desde tu cuenta.";
  } catch (error) {
    $("billingNotice").textContent = error.message || "La facturación todavía no está disponible.";
    $("monthlyBtn").disabled = true;
    $("annualBtn").disabled = true;
  }
}

async function startCheckout(plan) {
  const user = auth.currentUser;
  if (!user || !API_BASE_URL) return;
  const button = $(plan === "monthly" ? "monthlyBtn" : "annualBtn");
  button.disabled = true;
  try {
    const response = await fetch(API_BASE_URL + "/api/customer/billing/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + await user.getIdToken() },
      body: JSON.stringify({ plan })
    });
    const payload = await response.json();
    if (!response.ok || !payload.url) throw new Error(payload.error || "No se pudo iniciar el pago.");
    window.location.assign(payload.url);
  } catch (error) {
    say(error.message || "No se pudo abrir el pago.", "error");
    button.disabled = false;
  }
}

async function openBillingPortal() {
  const user = auth.currentUser;
  if (!user || !API_BASE_URL) return;
  try {
    const response = await fetch(API_BASE_URL + "/api/customer/billing/portal", {
      method: "POST",
      headers: { Authorization: "Bearer " + await user.getIdToken() }
    });
    const payload = await response.json();
    if (!response.ok || !payload.url) throw new Error(payload.error || "No se pudo abrir la administración de pagos.");
    window.location.assign(payload.url);
  } catch (error) {
    say(error.message || "No se pudo abrir la administración de pagos.", "error");
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

$("monthlyBtn")?.addEventListener("click", () => startCheckout("monthly"));
$("annualBtn")?.addEventListener("click", () => startCheckout("annual"));
$("portalBtn")?.addEventListener("click", openBillingPortal);

const checkoutResult = new URLSearchParams(window.location.search).get("checkout");
if (checkoutResult === "success") say("Pago recibido. Estamos confirmando tu suscripción; actualiza el estado en unos segundos.", "ok");
if (checkoutResult === "cancelled") say("El proceso de pago se canceló. No se realizó ningún cobro.");

async function refreshSubscription() {
  const user = auth.currentUser;
  if (!user) return;
  const subscription = await readSubscription(user);
  renderSubscription(subscription);
}

$("trialBtn").addEventListener("click", async () => {
  const user = auth.currentUser;
  if (!user || busy) return;
  const button = $("trialBtn");
  button.disabled = true;
  button.textContent = "Activando…";
  try {
    const reference = doc(firestore, "ecAudioSubscriptions", user.uid);
    await runTransaction(firestore, async (transaction) => {
      const existing = await transaction.get(reference);
      if (existing.exists()) {
        throw new Error("La prueba gratuita de esta cuenta ya fue utilizada.");
      }
      transaction.set(reference, {
        uid: user.uid,
        email: user.email || "",
        status: "active",
        plan: "trial",
        startedAt: serverTimestamp(),
        trialUsed: true
      });
    });
    await refreshSubscription();
    say("Prueba gratuita activada durante 60 segundos. No se realizó ningún cobro.", "ok");
  } catch (error) {
    say(error.message || "No se pudo activar la prueba gratuita. Revisa la configuración de Cloud Firestore.", "error");
    try { await refreshSubscription(); } catch {}
  } finally {
    const current = auth.currentUser;
    if (current) {
      try { renderSubscription(await readSubscription(current)); } catch { button.disabled = true; }
    }
  }
});

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
