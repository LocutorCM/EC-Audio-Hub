# EC Audio Accounts — configuración Firebase

La página de cuenta está en `docs/account.html` y usa Firebase Authentication.

## Activación (una sola vez)
1. Crea un proyecto en https://console.firebase.google.com/ con el plan Spark.
2. En **Authentication > Sign-in method**, activa **Email/Password** y **Google**.
3. En **Authentication > Settings > Authorized domains**, agrega `locutorcm.github.io`.
4. En **Project settings > General > Your apps**, registra una aplicación web y copia la configuración del SDK.
5. Sustituye los valores de `docs/js/firebase-config.js` por los valores reales de tu aplicación web.
6. Publica el sitio y prueba registro, inicio de sesión, Google y recuperación de contraseña.

La configuración web de Firebase está diseñada para estar en el frontend; no subas service-account JSON, claves privadas ni secretos OAuth al repositorio.

## Importante
- El Client Hub de escritorio todavía no se modifica.
- La futura integración de escritorio debe autenticar contra el mismo proyecto Firebase para compartir identidad con la web.
- Apple y X requieren configuración adicional de proveedor y credenciales de desarrollador; no están habilitados en esta primera etapa.
- Para producción, configura restricciones de API y políticas de seguridad adecuadas.
