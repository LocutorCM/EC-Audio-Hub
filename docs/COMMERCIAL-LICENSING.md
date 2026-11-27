# Sistema comercial de licencias EC Audio con Ko-fi

## Arquitectura

- Firebase Authentication conserva la identidad de cada cliente.
- EC Audio Cloud API valida el ID token de Firebase y mantiene las licencias en SQLite sobre un disco persistente.
- Ko-fi procesa las membresías mensuales y envía cada pago al webhook de EC Audio.
- El webhook valida el `verification_token`, el nombre exacto del nivel, la moneda y opcionalmente el importe.
- La primera compra se vincula a una cuenta mediante un código de un solo uso generado desde Mi cuenta.
- Cada pago confirmado extiende la licencia por 32 días. Si no llega el siguiente pago, la licencia vence automáticamente.
- Client Hub consulta el estado al servidor y registra cada Mac autorizado.
- Firestore conserva la prueba técnica de 60 segundos, separada de la licencia comercial.

## 1. Configurar la membresía de Ko-fi

1. Abre [Ko-fi EC Audio](https://ko-fi.com/ecaudio).
2. Crea un nivel de membresía mensual llamado exactamente **`EC Audio $1`**.
3. Establece el precio mínimo en **1 USD al mes**. Ko-fi permite que un miembro aporte más que el mínimo del nivel, pero el plan base es de 1 USD.
4. La moneda debe ser USD. Ko-fi admite USD, EUR, GBP, AUD, BRL, CAD, JPY, SGD, THB y NZD; no ofrece MXN.
5. En Ko-fi abre Settings > Payments > Webhooks y configura la URL del webhook cuando Render esté publicado.

Ko-fi no proporciona al webhook eventos de cancelación o fin de membresía. Por eso EC Audio no intenta consultar una cancelación: cada pago renueva 32 días y la licencia caduca si no llega el siguiente pago. Ko-fi documenta el webhook y sus limitaciones en [su centro de ayuda](https://help.ko-fi.com/hc/en-us/articles/360004162298-Does-Ko-fi-have-an-API-or-webhook).

## 2. Publicar EC Audio Cloud API

1. Entra a Render y conecta el repositorio `LocutorCM/EC-Audio-Hub`.
2. Crea el Blueprint desde `render.yaml` en la rama `main` después de integrar esta actualización.
3. El servicio usa el plan Starter y un disco persistente de 1 GB; Render puede cobrar por ambos.
4. Configura las variables privadas:
   - `ADMIN_EMAIL`: correo de administración.
   - `ADMIN_PASSWORD`: contraseña larga y única (mínimo 14 caracteres).
   - `FIREBASE_API_KEY`: apiKey de `docs/js/firebase-config.js`.
   - `KOFI_VERIFICATION_TOKEN`: token secreto que Ko-fi muestra en la configuración del webhook. Guárdalo solo en Render, nunca en GitHub ni en este chat.
   - `KOFI_MONTHLY_TIER_NAME`: nombre exacto del nivel mensual de Ko-fi.
   - `KOFI_MONTHLY_AMOUNT`: importe exacto opcional; usa el valor decimal que Ko-fi envía.
   - `KOFI_CURRENCY=USD`.
   - Mantén `FIREBASE_PROJECT_ID=ec-audio-accounts`, `CUSTOMER_WEB_URL` y `MAX_ACTIVE_DEVICES=2`.
5. Comprueba `https://TU-SERVICIO.onrender.com/health`. Debe responder `ok: true`, `firebaseConfigured: true` y `kofiConfigured: true`.

## 3. Configurar el webhook Ko-fi

En Ko-fi configura la URL:

`https://TU-SERVICIO.onrender.com/api/webhooks/kofi`

El endpoint recibe el POST form-encoded de Ko-fi, lee el campo `data` y valida `verification_token`. Ko-fi debe recibir HTTP 200. Los eventos duplicados no renuevan la licencia dos veces.

## 4. Flujo de compra y vinculación

1. El cliente inicia sesión en [Mi cuenta EC Audio](https://locutorcm.github.io/EC-Audio-Hub/account.html).
2. Pulsa “Unirme a EC Audio en Ko-fi”. El servidor genera un código de vinculación de un solo uso (cuando usa un correo distinto) con 24 horas de vigencia.
3. Si paga con el mismo correo de su cuenta EC Audio, la vinculación se realiza por coincidencia de correo. Si usa otro correo, copia el código en el mensaje público de su primera membresía en Ko-fi; un mensaje privado puede no llegar en el webhook.
4. Ko-fi envía el webhook. Si el token, el nivel, la moneda y el pago son válidos, el servidor vincula el correo de Ko-fi a la cuenta Firebase y activa la licencia.
5. Los pagos posteriores se relacionan con el correo Ko-fi previamente vinculado y renuevan 32 días.
6. Client Hub consulta el mismo entitlement y aplica el límite de dos Macs.

No se activa ninguna licencia por visitar el enlace, por enviar un mensaje o por un webhook sin pago de membresía válido.

## 5. Pruebas antes de vender

- Configurar primero el webhook de prueba de Ko-fi y confirmar respuesta HTTP 200.
- Confirmar que un nivel distinto, una donación simple o una moneda incorrecta no activan licencias.
- Confirmar que un primer pago sin código no activa una cuenta.
- Confirmar que el código de vinculación solo se utiliza una vez y caduca a las 24 horas.
- Confirmar que un pago repetido con el mismo identificador no duplica la renovación.
- Confirmar que cada renovación extiende el vencimiento 32 días y que una cuenta sin pagos vence.
- Probar el límite de dos Macs y la revocación administrativa.
- No anunciar que una suscripción está cancelada desde EC Audio: Ko-fi no envía ese evento al webhook.

## Seguridad y límites

- El token de verificación de Ko-fi permanece exclusivamente en Render.
- El webhook no confía en el correo para vincular una cuenta por primera vez: exige el código de un solo uso.
- El webhook verifica el nivel exacto y la moneda configurada.
- La base SQLite debe permanecer en el disco persistente de Render.
- La prueba técnica de 60 segundos sigue separada de los pagos.
- Esta integración controla el acceso desde Client Hub. Para bloquear un AU/VST3 copiado fuera del Client Hub, cada plugin debe integrar el SDK de validación runtime.
- No vendas licencias hasta publicar el servidor, configurar el webhook y completar las pruebas descritas.
