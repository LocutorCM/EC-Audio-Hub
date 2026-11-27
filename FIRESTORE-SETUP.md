# Activar la sincronización de licencias EC Audio

EC Audio usa el mismo proyecto Firebase para iniciar sesión y guardar la prueba gratuita compartida entre la página web y EC Audio Client. Ya no requiere un servidor Express independiente ni una URL de API externa.

## 1. Crear Cloud Firestore

1. Abre https://console.firebase.google.com/project/ec-audio-accounts/firestore
2. Si todavía no existe una base de datos, selecciona **Crear base de datos**.
3. Elige **Modo de producción**.
4. Selecciona una ubicación y termina la creación.

Cloud Firestore tiene una cuota gratuita, sujeta a los límites vigentes de Firebase.

## 2. Publicar las reglas de seguridad

En Firebase Console, abre **Firestore Database → Reglas** y reemplaza el contenido por el archivo `firestore.rules` de este repositorio. Pulsa **Publicar**.

Las reglas permiten que cada usuario lea únicamente su propio documento, permiten crear una sola prueba de 60 segundos con hora del servidor y bloquean las modificaciones o eliminaciones posteriores. No publiques reglas abiertas como `allow read, write: if true`.

También puedes publicar las reglas desde la carpeta del repositorio con Firebase CLI:

```bash
firebase deploy --only firestore:rules --project ec-audio-accounts
```

## 3. Cómo funciona la licencia compartida

- La página y la app nativa autentican con el mismo proyecto Firebase `ec-audio-accounts`.
- La prueba se guarda en `ecAudioSubscriptions/{Firebase UID}`.
- El inicio se fija con la hora confiable del servidor Firestore.
- La prueba dura 60 segundos y solo se puede crear una vez por cuenta.
- EC Audio Client lee el mismo documento para habilitar o bloquear la instalación de plugins administrados.

La página web se publica automáticamente desde GitHub Pages al fusionar los cambios. La app macOS requiere la nueva compilación para incluir la conexión Firestore y el refresco seguro del token Firebase.

## Alcance

Esto activa la identidad compartida y la prueba gratuita de demostración. No procesa pagos ni crea suscripciones comerciales. Para vender planes de pago se necesitará posteriormente un flujo de pagos y una validación de suscripciones controlada por servidor.
