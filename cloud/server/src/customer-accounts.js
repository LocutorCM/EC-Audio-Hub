'use strict';

const crypto = require('node:crypto');

function installCustomerAccountApi(app, { db, jwt, bcrypt, jwtSecret, loginLimiter, firebaseApiKey, firebaseProjectId, firebaseTokenVerifier, stripe, stripeWebhookSecret, stripeMonthlyPriceId, stripeAnnualPriceId, customerWebURL, maxActiveDevices = 2 }) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS customer_accounts (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      display_name TEXT NOT NULL DEFAULT '',
      password_hash TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS customer_subscriptions (
      id TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'inactive',
      plan TEXT NOT NULL DEFAULT 'trial',
      started_at TEXT,
      expires_at TEXT,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(customer_id) REFERENCES customer_accounts(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_customer_subscriptions_expiry
      ON customer_subscriptions(status, expires_at);
  `);

  const customerColumns = db.prepare('PRAGMA table_info(customer_accounts)').all().map(column => column.name);
  if (!customerColumns.includes('stripe_customer_id')) db.exec('ALTER TABLE customer_accounts ADD COLUMN stripe_customer_id TEXT');
  const subscriptionColumns = db.prepare('PRAGMA table_info(customer_subscriptions)').all().map(column => column.name);
  if (!subscriptionColumns.includes('stripe_subscription_id')) db.exec('ALTER TABLE customer_subscriptions ADD COLUMN stripe_subscription_id TEXT');
  if (!subscriptionColumns.includes('stripe_price_id')) db.exec('ALTER TABLE customer_subscriptions ADD COLUMN stripe_price_id TEXT');
  if (!subscriptionColumns.includes('cancel_at_period_end')) db.exec('ALTER TABLE customer_subscriptions ADD COLUMN cancel_at_period_end INTEGER NOT NULL DEFAULT 0');
  if (!subscriptionColumns.includes('billing_interval')) db.exec('ALTER TABLE customer_subscriptions ADD COLUMN billing_interval TEXT');
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_subscriptions_stripe_id
      ON customer_subscriptions(stripe_subscription_id) WHERE stripe_subscription_id IS NOT NULL;
    CREATE TABLE IF NOT EXISTS stripe_webhook_events (
      id TEXT PRIMARY KEY,
      event_type TEXT NOT NULL,
      processed_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS customer_devices (
      device_id TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL,
      device_name TEXT NOT NULL DEFAULT 'Mac',
      platform TEXT NOT NULL DEFAULT 'macOS',
      active INTEGER NOT NULL DEFAULT 1,
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      FOREIGN KEY(customer_id) REFERENCES customer_accounts(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_customer_devices_customer
      ON customer_devices(customer_id, active, last_seen_at DESC);
  `);
  if (!customerColumns.includes('firebase_uid')) db.exec('ALTER TABLE customer_accounts ADD COLUMN firebase_uid TEXT');
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_accounts_firebase_uid ON customer_accounts(firebase_uid) WHERE firebase_uid IS NOT NULL');

  async function verifyFirebaseIdToken(idToken) {
    if (firebaseTokenVerifier) return firebaseTokenVerifier(idToken);
    if (!firebaseApiKey || !firebaseProjectId) { const error = new Error('La conexión con Firebase no está configurada en el servidor.'); error.status = 503; throw error; }
    const response = await fetch('https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=' + encodeURIComponent(firebaseApiKey), {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken }), signal: AbortSignal.timeout(10000)
    });
    if (!response.ok) { const error = new Error('Firebase rechazó la sesión. Inicia sesión nuevamente.'); error.status = 401; throw error; }
    const payload = await response.json(); const user = payload.users?.[0];
    if (!user?.localId || !user.email) { const error = new Error('La cuenta de Firebase no contiene un correo válido.'); error.status = 401; throw error; }
    if (user.tenantId) { const error = new Error('Las cuentas de Firebase con tenant no están habilitadas.'); error.status = 403; throw error; }
    return { uid: user.localId, email: String(user.email).trim().toLowerCase(), displayName: String(user.displayName || '').trim().slice(0, 80), emailVerified: user.emailVerified === true };
  }
  const issueCustomerToken = (customer) => jwt.sign(
    { sub: customer.id, role: 'customer' },
    jwtSecret,
    { expiresIn: '30d', issuer: 'ec-audio-cloud', audience: 'ec-audio-customer' }
  );

  async function customerAuth(req, res, next) {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token) return res.status(401).json({ error: 'Inicia sesión para continuar.' });
    try {
      let customer = null;
      try {
        const payload = jwt.verify(token, jwtSecret, {
          issuer: 'ec-audio-cloud',
          audience: 'ec-audio-customer'
        });
        customer = db.prepare(
          'SELECT id,email,display_name,active,created_at,stripe_customer_id FROM customer_accounts WHERE id=?'
        ).get(payload.sub);
      } catch {
        const identity = await verifyFirebaseIdToken(token);
        customer = db.prepare(
          'SELECT id,email,display_name,active,created_at,stripe_customer_id FROM customer_accounts WHERE firebase_uid=?'
        ).get(identity.uid);
        if (!customer) {
          const existing = db.prepare(
            'SELECT id,email,display_name,active,firebase_uid,stripe_customer_id FROM customer_accounts WHERE email=? COLLATE NOCASE'
          ).get(identity.email);
          if (existing) {
            if (existing.firebase_uid && existing.firebase_uid !== identity.uid) {
              return res.status(409).json({ error: 'Este correo ya está vinculado a otra identidad de Firebase.' });
            }
            if (!identity.emailVerified && !existing.firebase_uid) {
              return res.status(403).json({ error: 'Verifica tu correo de Firebase antes de continuar.' });
            }
            db.prepare('UPDATE customer_accounts SET firebase_uid=? WHERE id=?').run(identity.uid, existing.id);
            customer = db.prepare(
              'SELECT id,email,display_name,active,created_at,stripe_customer_id FROM customer_accounts WHERE id=?'
            ).get(existing.id);
          } else {
            const now = new Date().toISOString();
            const id = crypto.randomUUID();
            db.prepare('INSERT INTO customer_accounts(id,email,display_name,password_hash,active,created_at,firebase_uid) VALUES(?,?,?,?,1,?,?)')
              .run(id, identity.email, identity.displayName, bcrypt.hashSync(crypto.randomBytes(32).toString('hex'), 12), now, identity.uid);
            customer = db.prepare(
              'SELECT id,email,display_name,active,created_at,stripe_customer_id FROM customer_accounts WHERE id=?'
            ).get(id);
          }
        }
      }
      if (!customer || !customer.active) {
        return res.status(403).json({ error: 'La cuenta no está disponible.' });
      }
      req.customer = customer;
      return next();
    } catch (error) {
      return res.status(error.status || 401).json({ error: error.message || 'La sesión venció. Inicia sesión nuevamente.' });
    }
  }

  function subscriptionFor(customerId) {
    const row = db.prepare(
      'SELECT status,plan,started_at,expires_at,updated_at,stripe_subscription_id,stripe_price_id,cancel_at_period_end,billing_interval FROM customer_subscriptions WHERE customer_id=?'
    ).get(customerId);
    if (!row) return { status: 'inactive', plan: null, active: false, expiresAt: null, remainingSeconds: 0 };
    const expires = row.expires_at ? Date.parse(row.expires_at) : 0;
    const active = row.status === 'active' && Number.isFinite(expires) && expires > Date.now();
    const status = row.status === 'active' && !active ? 'expired' : row.status;
    return {
      status,
      plan: row.plan,
      active,
      startedAt: row.started_at,
      expiresAt: row.expires_at,
      remainingSeconds: active ? Math.max(0, Math.ceil((expires - Date.now()) / 1000)) : 0,
      updatedAt: row.updated_at,
      cancelAtPeriodEnd: row.cancel_at_period_end === 1,
      billingInterval: row.billing_interval || null,
      stripeSubscriptionId: row.stripe_subscription_id || null
    };
  }

  app.post('/api/customer/auth/register', loginLimiter, (req, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    const displayName = String(req.body?.displayName || '').trim().slice(0, 80);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Escribe un correo electrónico válido.' });
    }
    if (password.length < 10 || password.length > 128) {
      return res.status(400).json({ error: 'La contraseña debe tener entre 10 y 128 caracteres.' });
    }
    try {
      const customer = {
        id: crypto.randomUUID(),
        email,
        display_name: displayName,
        active: 1,
        created_at: new Date().toISOString()
      };
      const hash = bcrypt.hashSync(password, 12);
      db.prepare(
        'INSERT INTO customer_accounts(id,email,display_name,password_hash,active,created_at) VALUES(?,?,?,?,?,?)'
      ).run(customer.id, customer.email, customer.display_name, hash, 1, customer.created_at);
      return res.status(201).json({
        token: issueCustomerToken(customer),
        user: { id: customer.id, email: customer.email, displayName: customer.display_name },
        subscription: subscriptionFor(customer.id)
      });
    } catch (error) {
      if (String(error.code || '').includes('SQLITE_CONSTRAINT')) {
        return res.status(409).json({ error: 'Ya existe una cuenta con ese correo.' });
      }
      return res.status(500).json({ error: 'No se pudo crear la cuenta.' });
    }
  });

  app.post('/api/customer/auth/login', loginLimiter, (req, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    const customer = db.prepare(
      'SELECT id,email,display_name,password_hash,active,created_at FROM customer_accounts WHERE email=? COLLATE NOCASE'
    ).get(email);
    if (!customer || !customer.active || !bcrypt.compareSync(password, customer.password_hash)) {
      return res.status(401).json({ error: 'Correo o contraseña incorrectos.' });
    }
    return res.json({
      token: issueCustomerToken(customer),
      user: { id: customer.id, email: customer.email, displayName: customer.display_name },
      subscription: subscriptionFor(customer.id)
    });
  });

  // Exchange a Firebase ID token for the shared EC Audio customer session.
  app.post('/api/customer/auth/firebase', loginLimiter, async (req, res) => {
    const idToken = String(req.body?.idToken || '');
    if (!idToken || idToken.length > 10000) return res.status(400).json({ error: 'Falta el token de acceso de Firebase.' });
    try {
      const identity = await verifyFirebaseIdToken(idToken);
      let customer = db.prepare('SELECT id,email,display_name,active,firebase_uid FROM customer_accounts WHERE firebase_uid=?').get(identity.uid);
      if (!customer) {
        const existing = db.prepare('SELECT id,email,display_name,active,firebase_uid FROM customer_accounts WHERE email=? COLLATE NOCASE').get(identity.email);
        if (existing) {
          if (!identity.emailVerified) return res.status(409).json({ error: 'Verifica tu correo en Firebase antes de vincular esta cuenta existente.' });
          if (existing.firebase_uid && existing.firebase_uid !== identity.uid) return res.status(409).json({ error: 'Este correo ya está vinculado a otra identidad de Firebase.' });
          db.prepare("UPDATE customer_accounts SET firebase_uid=?,display_name=CASE WHEN display_name='' THEN ? ELSE display_name END WHERE id=?").run(identity.uid, identity.displayName, existing.id);
          customer = db.prepare('SELECT id,email,display_name,active,firebase_uid FROM customer_accounts WHERE id=?').get(existing.id);
        } else {
          const now = new Date().toISOString(); const id = crypto.randomUUID();
          db.prepare('INSERT INTO customer_accounts(id,email,display_name,password_hash,active,created_at,firebase_uid) VALUES(?,?,?,?,1,?,?)').run(id, identity.email, identity.displayName, bcrypt.hashSync(crypto.randomBytes(32).toString('hex'), 12), now, identity.uid);
          customer = db.prepare('SELECT id,email,display_name,active,firebase_uid FROM customer_accounts WHERE id=?').get(id);
        }
      }
      if (!customer || !customer.active) return res.status(403).json({ error: 'La cuenta EC Audio está deshabilitada.' });
      return res.json({ token: issueCustomerToken(customer), user: { id: customer.id, email: customer.email, displayName: customer.display_name }, subscription: subscriptionFor(customer.id) });
    } catch (error) { return res.status(error.status || 503).json({ error: error.message || 'No se pudo validar la cuenta de Firebase.' }); }
  });
  app.get('/api/customer/auth/me', customerAuth, (req, res) => {
    return res.json({
      user: {
        id: req.customer.id,
        email: req.customer.email,
        displayName: req.customer.display_name
      },
      subscription: subscriptionFor(req.customer.id)
    });
  });

  app.get('/api/customer/subscription', customerAuth, (req, res) => {
    return res.json({ subscription: subscriptionFor(req.customer.id) });
  });

  // Free demo activation: no payment is collected. Duration is controlled only by the server.
  app.post('/api/customer/subscription/activate', customerAuth, (req, res) => {
    const now = new Date();
    const startedAt = now.toISOString();
    const expiresAt = new Date(now.getTime() + 60 * 1000).toISOString();
    const existing = db.prepare(
      'SELECT id FROM customer_subscriptions WHERE customer_id=?'
    ).get(req.customer.id);
    if (existing) {
      db.prepare(`
        UPDATE customer_subscriptions
        SET status='active',plan='trial',started_at=?,expires_at=?,updated_at=?
        WHERE customer_id=?
      `).run(startedAt, expiresAt, startedAt, req.customer.id);
    } else {
      db.prepare(`
        INSERT INTO customer_subscriptions(id,customer_id,status,plan,started_at,expires_at,updated_at)
        VALUES(?,?,'active','trial',?,?,?)
      `).run(crypto.randomUUID(), req.customer.id, startedAt, expiresAt, startedAt);
    }
    return res.status(200).json({
      message: 'Acceso de prueba activado por 60 segundos. No se realizó ningún cobro.',
      subscription: subscriptionFor(req.customer.id)
    });
  });

  // Stripe catalog is read-only; secret keys and price IDs stay on the server.
  app.get('/api/customer/billing/plans', async (_req, res) => {
    if (!stripe || !stripeMonthlyPriceId || !stripeAnnualPriceId) {
      return res.status(503).json({ error: 'La facturación todavía no está configurada.' });
    }
    try {
      const [monthly, annual] = await Promise.all([
        stripe.prices.retrieve(stripeMonthlyPriceId),
        stripe.prices.retrieve(stripeAnnualPriceId)
      ]);
      const format = (price, plan) => ({
        plan,
        priceId: price.id,
        amount: price.unit_amount,
        currency: String(price.currency || 'mxn').toUpperCase(),
        interval: price.recurring?.interval || (plan === 'annual' ? 'year' : 'month'),
        intervalCount: price.recurring?.interval_count || 1
      });
      return res.json({ plans: [format(monthly, 'monthly'), format(annual, 'annual')] });
    } catch (error) {
      return res.status(502).json({ error: 'No se pudieron consultar los planes de Stripe.' });
    }
  });

  app.post('/api/customer/billing/checkout', customerAuth, async (req, res) => {
    if (!stripe || !stripeMonthlyPriceId || !stripeAnnualPriceId) {
      return res.status(503).json({ error: 'La facturación todavía no está configurada.' });
    }
    const plan = String(req.body?.plan || '');
    const price = plan === 'monthly' ? stripeMonthlyPriceId : plan === 'annual' ? stripeAnnualPriceId : null;
    if (!price) return res.status(400).json({ error: 'Selecciona un plan mensual o anual válido.' });
    try {
      let stripeCustomerId = req.customer.stripe_customer_id;
      if (!stripeCustomerId) {
        const customer = await stripe.customers.create({
          email: req.customer.email,
          name: req.customer.display_name || undefined,
          metadata: { ecAudioCustomerId: req.customer.id }
        });
        stripeCustomerId = customer.id;
        db.prepare('UPDATE customer_accounts SET stripe_customer_id=? WHERE id=?').run(stripeCustomerId, req.customer.id);
      }
      const session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        customer: stripeCustomerId,
        client_reference_id: req.customer.id,
        line_items: [{ price, quantity: 1 }],
        allow_promotion_codes: true,
        billing_address_collection: 'required',
        locale: 'es',
        metadata: { ecAudioCustomerId: req.customer.id, ecAudioPlan: plan },
        subscription_data: { metadata: { ecAudioCustomerId: req.customer.id, ecAudioPlan: plan } },
        success_url: `${customerWebURL}/account.html?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${customerWebURL}/account.html?checkout=cancelled`
      });
      return res.json({ url: session.url });
    } catch (error) {
      return res.status(502).json({ error: 'No se pudo iniciar el pago. Inténtalo nuevamente.' });
    }
  });

  app.post('/api/customer/billing/portal', customerAuth, async (req, res) => {
    if (!stripe || !req.customer.stripe_customer_id) {
      return res.status(400).json({ error: 'Esta cuenta todavía no tiene una suscripción de Stripe.' });
    }
    try {
      const session = await stripe.billingPortal.sessions.create({
        customer: req.customer.stripe_customer_id,
        return_url: `${customerWebURL}/account.html`
      });
      return res.json({ url: session.url });
    } catch {
      return res.status(502).json({ error: 'No se pudo abrir el portal de facturación.' });
    }
  });

  function applyStripeSubscription(subscription) {
    const stripeCustomerId = typeof subscription.customer === 'string' ? subscription.customer : subscription.customer?.id;
    const customerId = subscription.metadata?.ecAudioCustomerId ||
      db.prepare('SELECT id FROM customer_accounts WHERE stripe_customer_id=?').get(stripeCustomerId)?.id;
    if (!customerId) return;
    const priceId = subscription.items?.data?.[0]?.price?.id || null;
    const plan = priceId === stripeAnnualPriceId ? 'annual' : priceId === stripeMonthlyPriceId ? 'monthly' : 'paid';
    const status = subscription.status === 'active' || subscription.status === 'trialing'
      ? 'active' : String(subscription.status || 'inactive');
    const startedAt = subscription.current_period_start
      ? new Date(subscription.current_period_start * 1000).toISOString() : new Date().toISOString();
    const expiresAt = subscription.current_period_end
      ? new Date(subscription.current_period_end * 1000).toISOString() : null;
    const now = new Date().toISOString();
    db.prepare('UPDATE customer_accounts SET stripe_customer_id=COALESCE(stripe_customer_id,?) WHERE id=?')
      .run(stripeCustomerId || null, customerId);
    const existing = db.prepare('SELECT id FROM customer_subscriptions WHERE customer_id=?').get(customerId);
    if (existing) {
      db.prepare(`
        UPDATE customer_subscriptions SET status=?,plan=?,started_at=?,expires_at=?,updated_at=?,
          stripe_subscription_id=?,stripe_price_id=?,cancel_at_period_end=?,billing_interval=?
        WHERE customer_id=?
      `).run(status, plan, startedAt, expiresAt, now, subscription.id, priceId,
        subscription.cancel_at_period_end ? 1 : 0,
        subscription.items?.data?.[0]?.price?.recurring?.interval || null, customerId);
    } else {
      db.prepare(`
        INSERT INTO customer_subscriptions(id,customer_id,status,plan,started_at,expires_at,updated_at,
          stripe_subscription_id,stripe_price_id,cancel_at_period_end,billing_interval)
        VALUES(?,?,?,?,?,?,?,?,?,?,?)
      `).run(crypto.randomUUID(), customerId, status, plan, startedAt, expiresAt, now,
        subscription.id, priceId, subscription.cancel_at_period_end ? 1 : 0,
        subscription.items?.data?.[0]?.price?.recurring?.interval || null);
    }
  }

  app.post('/api/customer/billing/webhook', async (req, res) => {
    if (!stripe || !stripeWebhookSecret || !req.rawBody) {
      return res.status(503).json({ error: 'El webhook de Stripe no está configurado.' });
    }
    let event;
    try {
      event = stripe.webhooks.constructEvent(req.rawBody, req.headers['stripe-signature'], stripeWebhookSecret);
    } catch {
      return res.status(400).json({ error: 'Firma de webhook inválida.' });
    }
    if (db.prepare('SELECT id FROM stripe_webhook_events WHERE id=?').get(event.id)) {
      return res.json({ received: true, duplicate: true });
    }
    try {
      if (event.type === 'checkout.session.completed') {
        const session = event.data.object;
        const customerId = session.metadata?.ecAudioCustomerId || session.client_reference_id;
        const stripeCustomerId = typeof session.customer === 'string' ? session.customer : session.customer?.id;
        if (customerId && stripeCustomerId) {
          db.prepare('UPDATE customer_accounts SET stripe_customer_id=? WHERE id=?').run(stripeCustomerId, customerId);
        }
        if (session.subscription) {
          const subscription = await stripe.subscriptions.retrieve(
            typeof session.subscription === 'string' ? session.subscription : session.subscription.id
          );
          applyStripeSubscription(subscription);
        }
      } else if (event.type === 'customer.subscription.created' ||
                 event.type === 'customer.subscription.updated' ||
                 event.type === 'customer.subscription.deleted') {
        applyStripeSubscription(event.data.object);
      } else if (event.type === 'invoice.payment_failed') {
        const invoice = event.data.object;
        const subscriptionId = typeof invoice.subscription === 'string' ? invoice.subscription : invoice.subscription?.id;
        if (subscriptionId) {
          db.prepare("UPDATE customer_subscriptions SET status='past_due',updated_at=? WHERE stripe_subscription_id=?")
            .run(new Date().toISOString(), subscriptionId);
        }
      }
      db.prepare('INSERT INTO stripe_webhook_events(id,event_type,processed_at) VALUES(?,?,?)')
        .run(event.id, event.type, new Date().toISOString());
      return res.json({ received: true });
    } catch {
      return res.status(500).json({ error: 'No se pudo procesar el evento de Stripe.' });
    }
  });

  // Each paid seat is bound to a stable Client Hub installation identifier.
  app.get('/api/customer/devices', customerAuth, (req, res) => {
    const devices = db.prepare(
      'SELECT device_id AS deviceId,device_name AS deviceName,platform,first_seen_at AS firstSeenAt,last_seen_at AS lastSeenAt FROM customer_devices WHERE customer_id=? AND active=1 ORDER BY last_seen_at DESC'
    ).all(req.customer.id);
    return res.json({ devices, maxDevices: maxActiveDevices });
  });

  app.post('/api/customer/devices/activate', customerAuth, (req, res) => {
    const deviceId = String(req.body?.deviceId || '').trim().slice(0, 120);
    const deviceName = String(req.body?.deviceName || 'Mac').trim().slice(0, 100) || 'Mac';
    const platform = String(req.body?.platform || 'macOS').trim().slice(0, 40) || 'macOS';
    if (!/^[A-Za-z0-9._:-]{12,120}$/.test(deviceId)) {
      return res.status(400).json({ error: 'El identificador del dispositivo no es válido.' });
    }
    const subscription = subscriptionFor(req.customer.id);
    if (!subscription.active) return res.status(403).json({ error: 'Necesitas una licencia activa para registrar este dispositivo.' });
    const now = new Date().toISOString();
    const existing = db.prepare('SELECT device_id FROM customer_devices WHERE device_id=? AND customer_id=?').get(deviceId, req.customer.id);
    if (!existing) {
      const count = db.prepare('SELECT COUNT(*) AS count FROM customer_devices WHERE customer_id=? AND active=1').get(req.customer.id).count;
      if (count >= maxActiveDevices) {
        return res.status(409).json({ error: `Has alcanzado el límite de ${maxActiveDevices} dispositivos. Libera uno desde tu cuenta EC Audio.` });
      }
      db.prepare('INSERT INTO customer_devices(device_id,customer_id,device_name,platform,active,first_seen_at,last_seen_at) VALUES(?,?,?,?,1,?,?)')
        .run(deviceId, req.customer.id, deviceName, platform, now, now);
    } else {
      db.prepare('UPDATE customer_devices SET device_name=?,platform=?,active=1,last_seen_at=? WHERE device_id=? AND customer_id=?')
        .run(deviceName, platform, now, deviceId, req.customer.id);
    }
    return res.json({ active: true, deviceId, maxDevices: maxActiveDevices });
  });

  app.delete('/api/customer/devices/:deviceId', customerAuth, (req, res) => {
    db.prepare('UPDATE customer_devices SET active=0,last_seen_at=? WHERE device_id=? AND customer_id=?')
      .run(new Date().toISOString(), req.params.deviceId, req.customer.id);
    return res.json({ released: true });
  });
}

module.exports = { installCustomerAccountApi };
