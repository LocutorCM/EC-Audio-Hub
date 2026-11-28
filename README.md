# EC Audio Hub

EC Audio Hub es la plataforma de distribución, cuentas y licencias para los plugins EC Audio, con aplicaciones nativas de administración y Client Hub para macOS.

## Componentes

- Sitio web: https://locutorcm.github.io/EC-Audio-Hub/
- EC AI Mastering: https://locutorcm.github.io/EC-Audio-Hub/mastering.html
- EC AI Instrumental Creator: https://locutorcm.github.io/EC-Audio-Hub/instrumental.html
- Cuenta de clientes: https://locutorcm.github.io/EC-Audio-Hub/account.html
- Panel de licencias: https://locutorcm.github.io/EC-Audio-Hub/admin-licenses.html
- macOS Admin: publica plugins AU/VST3 y portadas en GitHub Releases.
- macOS Client Hub: explora releases, verifica SHA-256 e instala plugins administrados.
- Firebase: identidad central para la web y Client Hub (ec-audio-accounts).
- EC Audio Cloud API: valida identidades Firebase, gestiona suscripciones y dispositivos y procesa pagos de membresía notificados por Ko-fi.

## Licencias y pagos

El sistema comercial integra membresías mensuales de Ko-fi. El servidor confirma las licencias únicamente a partir de webhooks validados de Ko-fi y vinculación segura por correo o código de un solo uso; los clientes nunca pueden escribir una licencia comercial directamente.

Incluye:
- Membresía mensual de Ko-fi y renovación automática de licencias al recibir cada pago.
- Vinculación segura entre la cuenta Firebase y el correo de Ko-fi.
- Límite configurable de dispositivos (por defecto, 2 Macs por cuenta).
- Panel administrativo para consultar clientes, revocar licencias, conceder accesos temporales y liberar dispositivos.
- Control de acceso a la instalación y distribución de plugins AU/VST3 mediante Client Hub.

La prueba gratuita existente continúa siendo una demostración técnica de 60 segundos y no procesa pagos. El nivel y el importe de la membresía se configuran en Ko-fi y en las variables privadas del servidor; no se han inventado precios ni se han creado cargos.

## Configuración y despliegue comercial

Sigue docs/COMMERCIAL-LICENSING.md. El backend necesita un servicio HTTPS persistente (el Blueprint de Render utiliza el plan Starter y un disco persistente), una cuenta Ko-fi y el token secreto del webhook configurado como variable privada del servidor.

**Estado:** la integración Ko-fi ya está en main. Todavía no hay un servidor de pagos publicado ni se ha conectado el webhook de Ko-fi. La validación de licencia dentro de cada plugin cuando se carga en Logic Pro todavía requiere integrar el SDK de licencia en el código fuente de cada plugin. No vendas licencias hasta completar la configuración, esa integración y las pruebas de webhooks.

## EC AI Mastering

La web incluye un área de masterización local en el navegador con perfiles DSP adaptativos y exportación WAV 24-bit/48 kHz. No necesita enviar la canción al servidor para masterizar; consulta `docs/AI-MASTERING-SETUP.md`.

## EC AI Instrumental Creator

La web incluye un generador de acompañamientos a partir de una voz a capela, con estilos musicales, tempo y ambiente configurables. Usa el modelo ACE-Step Audio-to-Audio mediante fal.ai, con autenticación del cliente Firebase y la clave privada `FAL_KEY` en Render. Para activarlo, crea una API key en fal.ai y guárdala en Render como variable de entorno `FAL_KEY` (nunca en el repositorio ni en el navegador). El audio de referencia se envía al almacenamiento del proveedor para generar la pista; la página solicita consentimiento antes de enviar. El proveedor puede cobrar por generación según su tarifa vigente. El modelo usa la voz como referencia musical, pero el resultado puede no coincidir exactamente con cada nota o compás.

## Compilar apps macOS

Requiere Xcode 14+ y Swift 5.7+. GitHub Actions compila Intel + Apple Silicon y publica artefactos descargables cuando los cambios se integran en main.

## Seguridad

Nunca subas KOFI_VERIFICATION_TOKEN, JWT_SECRET, contraseñas de administrador ni tokens privados al repositorio. Usa variables privadas del proveedor de hosting.
