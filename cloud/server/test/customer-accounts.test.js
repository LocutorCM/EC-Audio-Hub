'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Database = require('better-sqlite3');
const { installCustomerAccountApi } = require('../src/customer-accounts');

test('customer registration, login and disabled free trial', async (t) => {
  const db = new Database(':memory:');
  const app = express();
  app.use(express.json());
  installCustomerAccountApi(app, {
    db,
    jwt,
    bcrypt,
    jwtSecret: 'test-secret-with-at-least-forty-eight-characters',
    loginLimiter: rateLimit({ windowMs: 60_000, limit: 50, standardHeaders: false, legacyHeaders: false })
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    db.close();
  });

  const register = await fetch(base + '/api/customer/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'Demo@Example.com',
      password: 'long-test-password',
      displayName: 'Demo'
    })
  });
  assert.equal(register.status, 201);
  const created = await register.json();
  assert.ok(created.token);
  assert.equal(created.subscription.active, false);

  const duplicate = await fetch(base + '/api/customer/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'demo@example.com', password: 'long-test-password' })
  });
  assert.equal(duplicate.status, 409);

  const headers = { Authorization: 'Bearer ' + created.token };
  const me = await fetch(base + '/api/customer/auth/me', { headers });
  assert.equal(me.status, 200);
  assert.equal((await me.json()).user.email, 'demo@example.com');

  const login = await fetch(base + '/api/customer/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'DEMO@example.com', password: 'long-test-password' })
  });
  assert.equal(login.status, 200);

  const activate = await fetch(base + '/api/customer/subscription/activate', {
    method: 'POST',
    headers
  });
  assert.equal(activate.status, 410);
  assert.match((await activate.json()).error, /desactivadas temporalmente/i);
  const subscription = await fetch(base + '/api/customer/subscription', { headers });
  assert.equal((await subscription.json()).subscription.active, false);
});

test('Firebase identity exchange creates one shared EC Audio customer session', async (t) => {
  const db = new Database(':memory:');
  const app = express();
  app.use(express.json());
  installCustomerAccountApi(app, {
    db, jwt, bcrypt, jwtSecret: 'test-secret-with-at-least-forty-eight-characters',
    firebaseTokenVerifier: async (token) => {
      assert.equal(token, 'firebase-id-token');
      return { uid: 'firebase-user-123', email: 'firebase@example.com', displayName: 'Firebase User', emailVerified: true };
    },
    loginLimiter: rateLimit({ windowMs: 60_000, limit: 50, standardHeaders: false, legacyHeaders: false })
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { await new Promise(resolve => server.close(resolve)); db.close(); });
  const exchange = () => fetch(base + '/api/customer/auth/firebase', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken: 'firebase-id-token' })
  });
  const first = await exchange();
  assert.equal(first.status, 200);
  const firstSession = await first.json();
  assert.equal(firstSession.user.email, 'firebase@example.com');
  assert.ok(firstSession.token);
  const second = await exchange();
  assert.equal(second.status, 200);
  const secondSession = await second.json();
  assert.equal(secondSession.user.id, firstSession.user.id);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM customer_accounts').get().count, 1);
});


test('billing and Ko-fi webhook remain disabled while EC Audio is free', async (t) => {
  const previous = {
    token: process.env.KOFI_VERIFICATION_TOKEN,
    tier: process.env.KOFI_MONTHLY_TIER_NAME,
    currency: process.env.KOFI_CURRENCY,
    amount: process.env.KOFI_MONTHLY_AMOUNT
  };
  process.env.KOFI_VERIFICATION_TOKEN = 'kofi-test-secret';
  process.env.KOFI_MONTHLY_TIER_NAME = 'EC Audio Monthly';
  process.env.KOFI_CURRENCY = 'USD';
  process.env.KOFI_MONTHLY_AMOUNT = '9.99';

  const db = new Database(':memory:');
  const app = express();
  app.use(express.json());
  installCustomerAccountApi(app, {
    db, jwt, bcrypt, jwtSecret: 'test-secret-with-at-least-forty-eight-characters',
    loginLimiter: rateLimit({ windowMs: 60_000, limit: 50, standardHeaders: false, legacyHeaders: false })
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    db.close();
    for (const [key, value] of Object.entries({
      KOFI_VERIFICATION_TOKEN: previous.token,
      KOFI_MONTHLY_TIER_NAME: previous.tier,
      KOFI_CURRENCY: previous.currency,
      KOFI_MONTHLY_AMOUNT: previous.amount
    })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });

  const plans = await fetch(base + '/api/customer/billing/plans');
  assert.equal(plans.status, 410);
  const webhook = await fetch(base + '/api/webhooks/kofi', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: JSON.stringify({ verification_token: 'kofi-test-secret' }) })
  });
  assert.equal(webhook.status, 200);
  assert.deepEqual(await webhook.json(), { received: true, disabled: true });
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM customer_subscriptions').get().count, 0);
});
