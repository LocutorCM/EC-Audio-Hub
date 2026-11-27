'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Database = require('better-sqlite3');
const { installCustomerAccountApi } = require('../src/customer-accounts');

test('customer registration, login, trial activation, expiry and reactivation', async (t) => {
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

  const reactivate = await fetch(base + '/api/customer/subscription/activate', {
    method: 'POST',
    headers
  });
  assert.equal(reactivate.status, 200);
  assert.equal((await reactivate.json()).subscription.active, true);
});
