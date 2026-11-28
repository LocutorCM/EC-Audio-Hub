# Publicar EC Audio Cloud API

El backend de cuentas y licencias necesita ejecutarse como servicio Node/Docker independiente. GitHub Pages no puede ejecutar Express ni guardar la base SQLite.

## Opción preparada: Render Blueprint

El archivo `render.yaml` define el servicio Docker, comprobación de salud, variables privadas y un disco persistente de 1 GB montado en `/data`.

1. Conecta la cuenta de Render con el repositorio `LocutorCM/EC-Audio-Hub`.
2. En Render, crea un **Blueprint** desde ese repositorio y selecciona la rama `main`.
3. Render detectará `render.yaml`. Confirma la creación del servicio `ec-audio-cloud`.
4. Introduce `ADMIN_EMAIL`, `ADMIN_PASSWORD` y `FIREBASE_API_KEY` cuando Render los solicite. `FIREBASE_PROJECT_ID` ya está configurado como `ec-audio-accounts`. Render genera `JWT_SECRET`. `HF_MUSIC_SPACE` apunta al Space oficial de ACE-Step ZeroGPU. `INSTRUMENTAL_ALLOWLIST` puede permanecer vacío al inicio (solo se autoriza `ADMIN_EMAIL`); después puedes agregar correos de cuentas Firebase separados por comas. `HF_TOKEN` es opcional y solo se necesita si Hugging Face exige autenticación para el Space.
5. Espera a que el despliegue termine y abre `https://<servicio>.onrender.com/health`. Debe responder JSON con `ok: true`, `customerAccounts: true`, `firebaseConfigured: true` y `demoTrialSeconds: 60`. También quedarán disponibles `GET /api/instrumental/status`, `POST /api/instrumental/generate`, `GET /api/instrumental/jobs/:jobId` y `GET /api/instrumental/jobs/:jobId/audio` (todos requieren sesión Firebase).
6. Copia el dominio HTTPS generado por Render. En `docs/js/api-config.js`, asigna ese origen a `API_BASE_URL` (sin barra final), guarda el cambio y publica GitHub Pages.
7. En EC Audio Client Hub, abre **Cuenta**, pega el mismo origen HTTPS en **Dirección del servidor** e inicia sesión con el mismo correo y contraseña de Firebase que usas en la web. El Client intercambia el ID token de Firebase por una sesión de EC Audio.

## Costos y persistencia

El Blueprint usa el plan Render Starter y un disco persistente porque SQLite no debe residir en el disco efímero de una instancia gratuita. Render puede cobrar por el servicio y el disco; revisa el precio mostrado antes de confirmar. No hay cargo por la activación de prueba de EC Audio: es $0 MXN y dura 60 segundos.

## Verificación

- Sitio web: `https://locutorcm.github.io/EC-Audio-Hub/account.html`
- API health: `https://<servicio>.onrender.com/health`
- Vinculación/inicio de sesión Firebase: `POST /api/customer/auth/firebase` (valida el ID token con Identity Toolkit)
- Los endpoints antiguos de correo/contraseña permanecen por compatibilidad.
- Activación de prueba: `POST /api/customer/subscription/activate`

La web y el Client Hub usan el mismo proyecto Firebase (`ec-audio-accounts`) como identidad y el mismo API/base de datos para licencias. El servidor valida los ID tokens de Firebase mediante `accounts:lookup`; no confía en datos de usuario enviados por el cliente. El Client Hub guarda su token de sesión de EC Audio en macOS Keychain. El Client Hub guarda su token en macOS Keychain. Si el servidor confirma que la suscripción venció, mueve únicamente los bundles AU/VST3 instalados y registrados por EC Audio a una carpeta de suspensión; no los elimina. Al recibir una respuesta activa, los restaura. Los fallos de red no se interpretan como vencimiento.

## Importante antes de producción comercial

La activación actual es solo una demostración gratuita que puede renovarse para probar. No procesa dinero. Antes de vender suscripciones, integra un proveedor de pagos y activa licencias únicamente mediante webhooks verificados en el servidor. También debe añadirse un sistema de dispositivos/licencias para controlar el número de Macs por cuenta.
