'use strict';

const crypto = require('node:crypto');

function installCustomerAccountApi(app, { db, jwt, bcrypt, jwtSecret, loginLimiter }) {
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

  const issueCustomerToken = (customer) => jwt.sign(
    { sub: customer.id, role: 'customer' },
    jwtSecret,
    { expiresIn: '30d', issuer: 'ec-audio-cloud', audience: 'ec-audio-customer' }
  );

  function customerAuth(req, res, next) {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token) return res.status(401).json({ error: 'Inicia sesión para continuar.' });
    try {
      const payload = jwt.verify(token, jwtSecret, {
        issuer: 'ec-audio-cloud',
        audience: 'ec-audio-customer'
      });
      const customer = db.prepare(
        'SELECT id,email,display_name,active,created_at FROM customer_accounts WHERE id=?'
      ).get(payload.sub);
      if (!customer || !customer.active) {
        return res.status(403).json({ error: 'La cuenta no está disponible.' });
      }
      req.customer = customer;
      return next();
    } catch {
      return res.status(401).json({ error: 'La sesión venció. Inicia sesión nuevamente.' });
    }
  }

  function subscriptionFor(customerId) {
    const row = db.prepare(
      'SELECT status,plan,started_at,expires_at,updated_at FROM customer_subscriptions WHERE customer_id=?'
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
      updatedAt: row.updated_at
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
}

module.exports = { installCustomerAccountApi };
