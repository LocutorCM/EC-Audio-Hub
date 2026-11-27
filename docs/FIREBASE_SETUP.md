# EC Audio Accounts — configuración Firebase compartida

El proyecto Firebase EC Audio Accounts (`ec-audio-accounts`) es la identidad central del sitio y del Client Hub de macOS. Ambos inician sesión con Firebase Authentication; el API EC Audio valida el ID token y entrega una sesión propia para consultar licencias.

## Configuración

1. Configura `FIREBASE_API_KEY` en el servidor con el valor `apiKey` de `docs/js/firebase-config.js`.
2. Configura `FIREBASE_PROJECT_ID=ec-audio-accounts`.
3. Publica el backend siguiendo `cloud/DEPLOY_RENDER.md`.
4. Copia el origen HTTPS del backend en `docs/js/api-config.js`, en `API_BASE_URL`, sin barra final.
5. Publica GitHub Pages.
6. En EC Audio Client Hub, abre Cuenta y pega el mismo origen HTTPS en Dirección del servidor.

## Proveedores de Firebase

En Firebase Console > Authentication > Sign-in method, habilita Email/Password y Google. En Authentication > Settings > Authorized domains, agrega `locutorcm.github.io`.

Si aparece `auth/operation-not-allowed`, el proveedor usado en ese intento todavía no está habilitado en Firebase. No es un error del código de la página.

## Cómo se comparte la cuenta

- La web y el Client Hub autentican con el mismo proyecto Firebase.
- El Client Hub usa Firebase Authentication REST para correo y contraseña; no guarda la contraseña.
- Ambos intercambian el Firebase ID token con `POST /api/customer/auth/firebase`.
- El backend valida el token con Firebase Identity Toolkit, vincula el UID a una sola cuenta EC Audio y emite un token EC Audio independiente.
- El Client Hub guarda únicamente el token EC Audio en el Llavero de macOS.

## Licencias

La prueba actual es $0 MXN, dura 60 segundos y no cobra ni requiere tarjeta. Es solo para pruebas. El servidor controla el vencimiento; al confirmarse, Client Hub resguarda los plugins administrados por EC Audio sin borrarlos.

## Límites actuales

El inicio de sesión nativo del Client Hub está conectado primero con correo y contraseña Firebase. Google nativo requiere añadir el OAuth Client ID de macOS del proyecto; el botón Google del sitio web utiliza Firebase popup. Los pagos comerciales todavía no están implementados.

El API debe publicarse con HTTPS antes de que la sincronización de licencias y la activación de prueba funcionen de extremo a extremo.