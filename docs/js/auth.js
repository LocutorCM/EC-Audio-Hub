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

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: "select_account" });

const $ = (id) => document.getElementById(id);
const authPanel = $("authPanel");
const accountPanel = $("accountPanel");
const message = $("message");
let mode = "login";
let busy = false;

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
  accountPanel.classList.add("hidden");
  authPanel.classList.remove("hidden");
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

onAuthStateChanged(auth, (user) => {
  if (user) showUser(user);
  else showSignedOut();
});
