# EC Audio Accounts — configuración actual

La página de cuenta `docs/account.html` y la aplicación macOS Client Hub utilizan el mismo API Express del repositorio.

## Configuración

1. Publica el servidor siguiendo [cloud/DEPLOY_RENDER.md](../cloud/DEPLOY_RENDER.md) o la guía de [cloud/server/CUSTOMER-ACCOUNTS.md](../cloud/server/CUSTOMER-ACCOUNTS.md).
2. Copia el origen HTTPS del servidor.
3. Sustituye el valor vacío de `API_BASE_URL` en `docs/js/api-config.js` por el origen HTTPS, sin barra final.
4. Publica GitHub Pages.
5. En macOS Client Hub, abre **Cuenta** y pega el mismo origen HTTPS.
6. Registra una cuenta con correo y contraseña en la web o en el Client Hub. Las credenciales son las mismas en ambos.

## Funciones actuales

- Registro e inicio de sesión con correo y contraseña.
- Contraseñas almacenadas mediante bcrypt en el servidor.
- Token de cliente independiente del token de administrador.
- Prueba gratuita de $0 MXN durante 60 segundos, sin tarjeta ni cobro.
- El token de escritorio se guarda en macOS Keychain.
- El Client Hub consulta el estado de licencia cada 30 segundos. Solo una respuesta válida del servidor que confirme el vencimiento suspende los plugins EC Audio administrados. Los errores de red no los desactivan.
- Los plugins suspendidos se mueven a una carpeta local de resguardo y se restauran cuando el servidor confirma una suscripción activa.

## Proveedores sociales y pagos

Google, Apple y otros proveedores sociales no están habilitados en esta versión del API. Para activarlos hay que configurar credenciales OAuth del proyecto y añadir la verificación de identidad del lado del servidor. La activación actual es una demostración gratuita; no procesa pagos. Antes de vender suscripciones, integrar un proveedor de pagos y aceptar solo notificaciones verificadas del servidor.
