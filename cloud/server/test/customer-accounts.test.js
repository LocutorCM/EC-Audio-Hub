'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Database = require('better-sqlite3');
const { installCustomerAccountApi } = require('../src/customer-accounts');

test('customer registration, login, one-time trial activation and expiry', async (t) => {
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
  assert.equal(activate.status, 200);
  const trial = await activate.json();
  assert.equal(trial.subscription.active, true);
  assert.ok(trial.subscription.remainingSeconds > 0 && trial.subscription.remainingSeconds <= 60);
  assert.equal(trial.subscription.plan, 'trial');

  db.prepare("UPDATE customer_subscriptions SET expires_at=? WHERE customer_id=?")
    .run(new Date(Date.now() - 1000).toISOString(), created.user.id);
  const expiredResponse = await fetch(base + '/api/customer/subscription', { headers });
  const expired = await expiredResponse.json();
  assert.equal(expired.subscription.active, false);
  assert.equal(expired.subscription.status, 'expired');

  const secondActivation = await fetch(base + '/api/customer/subscription/activate', {
    method: 'POST',
    headers
  });
  assert.equal(secondActivation.status, 409);
  assert.equal((await secondActivation.json()).error, 'Esta cuenta ya tiene una prueba o licencia registrada.');
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
