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
        req.firebaseIdentity = identity;
        req.firebaseIdToken = token;
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

  // Free trials are temporarily disabled. Existing paid licenses remain readable.
  app.post('/api/customer/subscription/activate', customerAuth, (req, res) => {
    return res.status(410).json({ error: 'Las pruebas gratuitas están desactivadas temporalmente.' });
  });

  // Ko-fi membership payments are activated only from verified webhook events.
  const kofiPageURL = String(process.env.KOFI_PAGE_URL || 'https://ko-fi.com/ecaudio').trim();
  const kofiVerificationToken = String(process.env.KOFI_VERIFICATION_TOKEN || '');
  const kofiMonthlyTierName = String(process.env.KOFI_MONTHLY_TIER_NAME || '').trim();
  const kofiCurrency = String(process.env.KOFI_CURRENCY || 'USD').toUpperCase();
  const kofiMonthlyAmount = Number(process.env.KOFI_MONTHLY_AMOUNT || 1);
  db.exec(`
    CREATE TABLE IF NOT EXISTS kofi_webhook_events (
      id TEXT PRIMARY KEY,
      processed_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS kofi_link_tokens (
      token_hash TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY(customer_id) REFERENCES customer_accounts(id) ON DELETE CASCADE
    );
  `);
  const accountColumns = db.prepare('PRAGMA table_info(customer_accounts)').all().map(column => column.name);
  if (!accountColumns.includes('kofi_email')) db.exec('ALTER TABLE customer_accounts ADD COLUMN kofi_email TEXT');
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_accounts_kofi_email ON customer_accounts(kofi_email COLLATE NOCASE) WHERE kofi_email IS NOT NULL');

  app.get('/api/customer/billing/plans', (_req, res) => {
    if (!kofiVerificationToken || !kofiMonthlyTierName) {
      return res.status(503).json({ error: 'Los pagos de Ko-fi todavía no están configurados.' });
    }
    return res.json({ provider: 'kofi', plans: [{ plan: 'monthly', tierName: kofiMonthlyTierName, currency: kofiCurrency, interval: 'month' }] });
  });

  app.post('/api/customer/billing/kofi-link', customerAuth, (req, res) => {
    if (!kofiVerificationToken || !kofiMonthlyTierName) {
      return res.status(503).json({ error: 'Los pagos de Ko-fi todavía no están configurados.' });
    }
    const current = subscriptionFor(req.customer.id);
    if (current.active && current.plan !== 'trial') {
      return res.status(409).json({ error: 'Tu licencia comercial ya está activa.' });
    }
    const rawCode = 'EC-' + crypto.randomBytes(5).toString('hex').toUpperCase();
    const tokenHash = crypto.createHash('sha256').update(rawCode).digest('hex');
    const now = new Date();
    db.prepare('DELETE FROM kofi_link_tokens WHERE expires_at < ? OR used_at IS NOT NULL').run(now.toISOString());
    db.prepare('INSERT INTO kofi_link_tokens(token_hash,customer_id,expires_at,created_at) VALUES(?,?,?,?)')
      .run(tokenHash, req.customer.id, new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(), now.toISOString());
    return res.json({ code: rawCode, url: kofiPageURL, instructions: 'Pega este código en el mensaje de tu pago o primera membresía de Ko-fi.' });
  });

  app.post('/api/webhooks/kofi', (req, res) => {
    if (!kofiVerificationToken) return res.status(503).json({ error: 'El webhook de Ko-fi no está configurado.' });
    let payload;
    try {
      const raw = req.body?.data;
      payload = typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch {
      return res.status(400).json({ error: 'El contenido del webhook de Ko-fi no es válido.' });
    }
    const receivedToken = String(payload?.verification_token || '');
    const expected = Buffer.from(kofiVerificationToken);
    const received = Buffer.from(receivedToken);
    if (expected.length !== received.length || !crypto.timingSafeEqual(expected, received)) {
      return res.status(401).json({ error: 'Token de verificación de Ko-fi incorrecto.' });
    }
    const eventId = String(payload?.kofi_transaction_id || payload?.message_id || '').trim();
    if (!eventId) return res.status(400).json({ error: 'El evento de Ko-fi no contiene un identificador.' });
    if (db.prepare('SELECT id FROM kofi_webhook_events WHERE id=?').get(eventId)) {
      return res.status(200).json({ received: true, duplicate: true });
    }
    try {
      const isMembershipPayment = String(payload?.type || '') === 'Subscription' &&
        (payload?.is_subscription_payment === true || payload?.is_subscription_payment === 'true');
      const tierName = String(payload?.tier_name || '').trim();
      const currency = String(payload?.currency || '').toUpperCase();
      const amount = Number(payload?.amount);
      if (!isMembershipPayment || !kofiMonthlyTierName || tierName !== kofiMonthlyTierName ||
          currency !== kofiCurrency || !Number.isFinite(amount) || amount <= 0 ||
          (kofiMonthlyAmount > 0 && amount + 0.001 < kofiMonthlyAmount)) {
        return res.status(200).json({ received: true, ignored: true, reason: 'not_matching_paid_membership_tier' });
      }

      const kofiEmail = String(payload?.email || '').trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(kofiEmail)) {
        return res.status(400).json({ error: 'El pago no contiene un correo válido.' });
      }
      let customer = db.prepare('SELECT id FROM customer_accounts WHERE kofi_email=? COLLATE NOCASE').get(kofiEmail);
      if (!customer) {
        customer = db.prepare('SELECT id FROM customer_accounts WHERE email=? COLLATE NOCASE').get(kofiEmail);
        if (customer) db.prepare('UPDATE customer_accounts SET kofi_email=? WHERE id=?').run(kofiEmail, customer.id);
      }
      if (!customer) {
        const message = String(payload?.message || '');
        const match = message.match(/\bEC-[A-F0-9]{10}\b/i);
        if (match) {
          const tokenHash = crypto.createHash('sha256').update(match[0].toUpperCase()).digest('hex');
          const link = db.prepare('SELECT customer_id FROM kofi_link_tokens WHERE token_hash=? AND used_at IS NULL AND expires_at>?')
            .get(tokenHash, new Date().toISOString());
          if (link) {
            customer = { id: link.customer_id };
            db.prepare('UPDATE kofi_link_tokens SET used_at=? WHERE token_hash=?')
              .run(new Date().toISOString(), tokenHash);
            db.prepare('UPDATE customer_accounts SET kofi_email=? WHERE id=?').run(kofiEmail, customer.id);
          }
        }
      }
      if (!customer) {
        // Never grant a license by matching an unverified email alone. The first payment
        // must carry the one-time EC Audio linking code; later renewals use the linked Ko-fi email.
        db.prepare('INSERT INTO kofi_webhook_events(id,processed_at) VALUES(?,?)').run(eventId, new Date().toISOString());
        return res.status(200).json({ received: true, ignored: true, reason: 'account_link_code_required' });
      }

      const now = new Date();
      const existing = db.prepare('SELECT started_at,expires_at FROM customer_subscriptions WHERE customer_id=?').get(customer.id);
      const previousExpiry = existing?.expires_at ? Date.parse(existing.expires_at) : 0;
      const baseTime = Number.isFinite(previousExpiry) && previousExpiry > now.getTime() ? previousExpiry : now.getTime();
      const expiresAt = new Date(baseTime + 32 * 24 * 60 * 60 * 1000).toISOString();
      const startedAt = existing?.started_at || now.toISOString();
      const updatedAt = now.toISOString();
      if (existing) {
        db.prepare("UPDATE customer_subscriptions SET status='active',plan='monthly',started_at=?,expires_at=?,updated_at=?,stripe_subscription_id=NULL,stripe_price_id=NULL,cancel_at_period_end=0,billing_interval='month' WHERE customer_id=?")
          .run(startedAt, expiresAt, updatedAt, customer.id);
      } else {
        db.prepare("INSERT INTO customer_subscriptions(id,customer_id,status,plan,started_at,expires_at,updated_at,billing_interval) VALUES(?,?,'active','monthly',?,?,?,'month')")
          .run(crypto.randomUUID(), customer.id, startedAt, expiresAt, updatedAt);
      }
      db.prepare('INSERT INTO kofi_webhook_events(id,processed_at) VALUES(?,?)').run(eventId, updatedAt);
      return res.status(200).json({ received: true, activated: true });
    } catch {
      return res.status(500).json({ error: 'No se pudo procesar el pago de Ko-fi.' });
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
    const existing = db.prepare('SELECT device_id,active FROM customer_devices WHERE device_id=? AND customer_id=?').get(deviceId, req.customer.id);
    if (!existing || existing.active !== 1) {
      const count = db.prepare('SELECT COUNT(*) AS count FROM customer_devices WHERE customer_id=? AND active=1').get(req.customer.id).count;
      if (count >= maxActiveDevices) {
        return res.status(409).json({ error: `Has alcanzado el límite de ${maxActiveDevices} dispositivos. Libera uno desde tu cuenta EC Audio.` });
      }
    }
    if (!existing) {
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
