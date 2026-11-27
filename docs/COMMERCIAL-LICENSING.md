# Sistema comercial de licencias EC Audio

## Arquitectura

- Firebase Authentication conserva la identidad de cada cliente.
- EC Audio Cloud API valida el ID token de Firebase y mantiene las suscripciones comerciales en SQLite sobre un disco persistente.
- Stripe Checkout procesa el pago y las renovaciones.
- Stripe Webhooks firmados son la única fuente autorizada para activar, renovar, marcar como impaga o cancelar una suscripción.
- Client Hub consulta el estado al servidor y registra cada Mac autorizado.
- Firestore conserva el registro de la prueba técnica actual de 60 segundos. El API lee licencias comerciales primero y el cliente recurre a Firestore para la prueba existente.

## 1. Crear los precios en Stripe

En Stripe Dashboard, inicialmente en modo de prueba:

1. Crea un producto llamado EC Audio Monthly.
2. Agrega un precio recurrente mensual en MXN.
3. Crea otro producto o precio para EC Audio Annual, recurrente anual en MXN.
4. Copia los dos identificadores que comienzan con price_.
5. Activa y configura el Customer Portal en Billing para que el cliente pueda actualizar su método de pago y cancelar su suscripción.

Los importes no están fijados en el código: utiliza los precios que decidas para EC Audio.

## 2. Publicar EC Audio Cloud API

1. Entra a Render y conecta el repositorio LocutorCM/EC-Audio-Hub.
2. Crea un Blueprint desde el archivo render.yaml de la rama feature/commercial-licensing-stripe.
3. El servicio se llama ec-audio-cloud. El Blueprint usa el plan Starter y un disco persistente de 1 GB; Render puede cobrar por ambos.
4. Configura las variables privadas que Render solicite:
   - ADMIN_EMAIL: correo de administración.
   - ADMIN_PASSWORD: contraseña larga y única (mínimo 14 caracteres).
   - FIREBASE_API_KEY: apiKey del archivo docs/js/firebase-config.js.
   - STRIPE_SECRET_KEY: clave secreta de Stripe (sk_test_... al probar).
   - STRIPE_MONTHLY_PRICE_ID: ID del precio mensual.
   - STRIPE_ANNUAL_PRICE_ID: ID del precio anual.
   - STRIPE_WEBHOOK_SECRET: se configura después de crear el webhook.
5. Mantén FIREBASE_PROJECT_ID=ec-audio-accounts, CUSTOMER_WEB_URL y MAX_ACTIVE_DEVICES=2.
6. Cuando termine, abre https://TU-SERVICIO.onrender.com/health. Debe responder ok: true, firebaseConfigured: true y, una vez agregadas las claves y precios, stripeConfigured: true.

## 3. Configurar el webhook de Stripe

En Stripe Dashboard > Developers > Webhooks:

1. Agrega un endpoint con la dirección https://TU-SERVICIO.onrender.com/api/customer/billing/webhook.
2. Selecciona estos eventos:
   - checkout.session.completed
   - customer.subscription.created
   - customer.subscription.updated
   - customer.subscription.deleted
   - invoice.payment_failed
3. Guarda el endpoint y copia su Signing secret (whsec_...).
4. En Render, agrega ese valor como STRIPE_WEBHOOK_SECRET y vuelve a desplegar.

## 4. Conectar el sitio web

Después de obtener el dominio HTTPS de Render:

1. Edita docs/js/api-config.js.
2. Asigna el dominio sin barra final a API_BASE_URL, por ejemplo https://ec-audio-cloud.onrender.com.
3. Publica los cambios en GitHub Pages.

La página de cuenta cargará los precios de Stripe, abrirá Checkout y ofrecerá el portal de facturación. El panel administrativo estará en https://locutorcm.github.io/EC-Audio-Hub/admin-licenses.html.

## 5. Conectar Client Hub

Antes de publicar la siguiente versión macOS:

1. En Sources/ECAudioHubClient/ClientLibrary.swift, asigna el mismo dominio HTTPS a apiBaseURL.
2. Compila y publica Client Hub.
3. Inicia sesión con Firebase. Si hay una suscripción comercial activa, el cliente consulta el servidor y registra el Mac.
4. El límite inicial es de dos dispositivos por cuenta. El usuario puede liberar dispositivos desde la página de cuenta.

## 6. Pruebas obligatorias antes de cobrar en producción

- Ejecutar Checkout con claves y precios de prueba de Stripe.
- Confirmar que el webhook llega y el endpoint responde 200.
- Confirmar que la cuenta web muestra el plan activo.
- Confirmar que Client Hub registra el dispositivo y reconoce el mismo plan.
- Probar un segundo Mac y verificar el límite de dispositivos.
- Probar cancelación al final del periodo y pago fallido.
- Probar el portal de facturación.
- Solo después cambiar a claves y precios Live de Stripe y crear un webhook Live independiente.

## Seguridad y límites

- Las claves secretas permanecen en Render; nunca en GitHub Pages ni en la app macOS.
- La base SQLite debe estar en el disco persistente configurado en render.yaml.
- Los webhooks se verifican con la firma de Stripe y se deduplican por ID de evento.
- La cuenta de administrador usa credenciales separadas de las cuentas de clientes.
- La administración temporal de licencias no sustituye la confirmación de pago de Stripe.
- El modo de prueba de Stripe no cobra dinero. No uses claves Live hasta completar todas las pruebas.
