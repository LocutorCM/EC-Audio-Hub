# EC Audio Hub

EC Audio Hub es la plataforma de distribución, cuentas y licencias para los plugins EC Audio, con aplicaciones nativas de administración y Client Hub para macOS.

## Componentes

- Sitio web: https://locutorcm.github.io/EC-Audio-Hub/
- Cuenta de clientes: https://locutorcm.github.io/EC-Audio-Hub/account.html
- Panel de licencias: https://locutorcm.github.io/EC-Audio-Hub/admin-licenses.html
- macOS Admin: publica plugins AU/VST3 y portadas en GitHub Releases.
- macOS Client Hub: explora releases, verifica SHA-256 e instala plugins administrados.
- Firebase: identidad central para la web y Client Hub (ec-audio-accounts).
- EC Audio Cloud API: valida identidades Firebase, gestiona suscripciones y dispositivos y procesa pagos de membresía notificados por Ko-fi.

## Licencias y pagos

El sistema comercial integra membresías mensuales de Ko-fi. El servidor confirma las licencias únicamente a partir de webhooks validados de Ko-fi y de un código de vinculación de un solo uso; los clientes nunca pueden escribir una licencia comercial directamente.

Incluye:
- Checkout de suscripción y portal de facturación del cliente.
- Sincronización de estados activos, pagos fallidos y cancelaciones.
- Límite configurable de dispositivos (por defecto, 2 Macs por cuenta).
- Panel administrativo para consultar clientes, revocar licencias, conceder accesos temporales y liberar dispositivos.
- Control de acceso a la instalación y distribución de plugins AU/VST3 mediante Client Hub.

La prueba gratuita existente continúa siendo una demostración técnica de 60 segundos y no procesa pagos. El nivel y el importe de la membresía se configuran en Ko-fi y en las variables privadas del servidor; no se han inventado precios ni se han creado cargos.

## Configuración y despliegue comercial

Sigue docs/COMMERCIAL-LICENSING.md. El backend necesita un servicio HTTPS persistente (el Blueprint de Render utiliza el plan Starter y un disco persistente), una cuenta Ko-fi y el token secreto del webhook configurado como variable privada del servidor.

**Estado:** el código está integrado en main. Todavía no hay un servidor de pagos publicado ni se ha conectado el webhook de Ko-fi. La validación de licencia dentro de cada plugin cuando se carga en Logic Pro todavía requiere integrar el SDK de licencia en el código fuente de cada plugin. No vendas licencias hasta completar la configuración, esa integración y las pruebas de webhooks.

## Compilar apps macOS

Requiere Xcode 14+ y Swift 5.7+. GitHub Actions compila Intel + Apple Silicon y publica artefactos descargables cuando los cambios se integran en main.

## Seguridad

Nunca subas KOFI_VERIFICATION_TOKEN, JWT_SECRET, contraseñas de administrador ni tokens privados al repositorio. Usa variables privadas del proveedor de hosting.
