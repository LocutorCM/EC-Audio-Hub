import { initializeApp } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";
import {
  getAuth, onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  GoogleAuthProvider, signInWithPopup, sendPasswordResetEmail, updateProfile, signOut
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";
import { firebaseConfig } from "./firebase-config.js";

const configured = firebaseConfig.apiKey && !firebaseConfig.apiKey.startsWith("PEGA_AQUI") &&
  firebaseConfig.projectId && !firebaseConfig.projectId.startsWith("PEGA_AQUI") &&
  firebaseConfig.appId && !firebaseConfig.appId.startsWith("PEGA_AQUI");
const $ = (id) => document.getElementById(id);
const authPanel = $("authPanel"), accountPanel = $("accountPanel"), message = $("message");
let mode = "login", auth = null;
function say(text, kind = "") { message.textContent = text; message.className = "note " + kind; }
function setMode(next) {
  mode = next;
  $("loginTab").classList.toggle("active", mode === "login");
  $("signupTab").classList.toggle("active", mode === "signup");
  $("nameWrap").classList.toggle("hidden", mode !== "signup");
  $("submitBtn").textContent = mode === "signup" ? "Crear mi cuenta" : "Iniciar sesión";
  $("password").autocomplete = mode === "signup" ? "new-password" : "current-password";
  say("");
}
$("loginTab").addEventListener("click", () => setMode("login"));
$("signupTab").addEventListener("click", () => setMode("signup"));

function friendlyError(error) {
  const map = {
    "auth/email-already-in-use": "Ese correo ya tiene una cuenta. Inicia sesión.",
    "auth/invalid-email": "El correo electrónico no es válido.",
    "auth/weak-password": "La contraseña debe tener al menos 6 caracteres.",
    "auth/invalid-credential": "Correo o contraseña incorrectos.",
    "auth/popup-closed-by-user": "Se cerró la ventana de Google antes de terminar.",
    "auth/popup-blocked": "El navegador bloqueó la ventana emergente. Permite las ventanas emergentes e inténtalo otra vez.",
    "auth/unauthorized-domain": "Este dominio aún no está autorizado en Firebase Authentication.",
    "auth/network-request-failed": "No se pudo conectar. Revisa tu conexión a internet."
  };
  return map[error.code] || "No se pudo completar la operación. " + (error.message || "");
}
function showUser(user) {
  if (!user) { authPanel.classList.remove("hidden"); accountPanel.classList.add("hidden"); return; }
  authPanel.classList.add("hidden"); accountPanel.classList.remove("hidden");
  $("userEmail").textContent = user.email || "Correo no disponible";
  $("userName").textContent = user.displayName || "";
  $("avatar").textContent = (user.displayName || user.email || "EC").trim().charAt(0).toUpperCase();
}
if (!configured) {
  $("submitBtn").disabled = true; $("googleBtn").disabled = true; $("forgotBtn").classList.add("hidden");
  say("La interfaz está preparada. Falta conectar las credenciales del proyecto Firebase para activar el registro y el inicio de sesión.", "");
} else {
  const app = initializeApp(firebaseConfig); auth = getAuth(app);
  onAuthStateChanged(auth, showUser);
  $("authForm").addEventListener("submit", async (event) => {
    event.preventDefault(); say("");
    const email = $("email").value.trim(), password = $("password").value;
    $("submitBtn").disabled = true;
    try {
      if (mode === "signup") {
        const credential = await createUserWithEmailAndPassword(auth, email, password);
        const name = $("displayName").value.trim();
        if (name) await updateProfile(credential.user, { displayName: name });
        say("Cuenta creada correctamente.", "ok");
      } else {
        await signInWithEmailAndPassword(auth, email, password);
      }
    } catch (error) { say(friendlyError(error), "error"); }
    finally { $("submitBtn").disabled = false; }
  });
  $("googleBtn").addEventListener("click", async () => {
    say("");
    try { await signInWithPopup(auth, new GoogleAuthProvider()); }
    catch (error) { say(friendlyError(error), "error"); }
  });
  $("forgotBtn").addEventListener("click", async (event) => {
    event.preventDefault();
    const email = $("email").value.trim();
    if (!email) { say("Escribe tu correo para enviarte el enlace de recuperación.", "error"); $("email").focus(); return; }
    try { await sendPasswordResetEmail(auth, email); say("Si existe una cuenta con ese correo, recibirás un enlace para restablecer la contraseña.", "ok"); }
    catch (error) { say(friendlyError(error), "error"); }
  });
  $("signoutBtn").addEventListener("click", async () => { try { await signOut(auth); } catch (error) { $("userName").textContent = friendlyError(error); } });
}
