# EC Audio customer accounts and trial subscriptions

This API adds customer accounts independently from the existing administrator account. Customer JWTs use the `ec-audio-customer` audience and cannot be used with administrator endpoints.

## Configuration

Keep the existing required server variables:

- `PORT` (defaults to `8080`)
- `DATA_DIR` (defaults to `cloud/server/data`; **must be a persistent writable volume**)
- `JWT_SECRET` (at least 40 characters, private)
- `ADMIN_EMAIL` and `ADMIN_PASSWORD` (private administrator credentials)

Optional:

- `CORS_ORIGINS`: comma-separated exact browser origins. Defaults to `https://locutorcm.github.io`. Add the production account-site origin if it changes.

Node.js 20 or newer is required. Install with `npm ci` when a lockfile is available, otherwise `npm install`, then run `npm start` from this directory.

Do not put JWT_SECRET, administrator credentials, or a GitHub token in the website or native client. Use HTTPS in production. Back up the persistent SQLite data directory.

## Customer API

All request and response bodies are JSON.

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/customer/auth/register` | No | Create customer account |
| POST | `/api/customer/auth/login` | No | Sign in |
| GET | `/api/customer/auth/me` | Bearer customer token | Current account and subscription |
| GET | `/api/customer/subscription` | Bearer customer token | Read current entitlement |
| POST | `/api/customer/subscription/activate` | Bearer customer token | Activate free 60-second demo |

### Register

```json
{ "email": "cliente@example.com", "password": "una-clave-de-10-o-mas", "displayName": "Cliente" }
```

Registration returns `token`, `user`, and an initially inactive `subscription`. Passwords are stored as bcrypt hashes.

### Sign in

```json
{ "email": "cliente@example.com", "password": "una-clave-de-10-o-mas" }
```

Use the returned token as `Authorization: Bearer <token>` for protected customer endpoints. Store it in the macOS Keychain in the native app, not in source code or UserDefaults.

### Activate demo

Send an authenticated POST to `/api/customer/subscription/activate`. This is a no-charge demo activation; it does not process a payment. The server sets the expiry to exactly 60 seconds after activation. The client must trust the server's `active` and `expiresAt` values, not a local clock-only entitlement.

The activation endpoint can be called again for repeat testing. Before a paid launch, replace this demo endpoint with verified payment-provider webhooks and server-side subscription state. Do not label this endpoint as a real paid subscription.

## Client behavior requirements

- Network timeout, offline mode, or server errors are **unknown status**, not proof of expiry. Do not disable plugins on transient network failure.
- Only a successful entitlement response with `active: false` or an expired `expiresAt` may trigger suspension.
- Suspend only plugin bundles recorded as installed/managed by EC Audio. Move them to a dedicated managed holding directory and persist original paths; never delete them.
- When a later successful entitlement response is active, restore those bundles to their original locations.
- Do not attempt to disable third-party plugins or plugins not installed/managed by EC Audio.
- Recheck entitlement at sign-in, app launch, and periodically while online. Use a short grace policy for network outages, but never extend a confirmed server-side expiry.

## Smoke test

After deploying the API over HTTPS, replace `API_BASE_URL` with its origin and run:

```sh
curl -i https://YOUR_API_HOST/health
curl -i -X POST https://YOUR_API_HOST/api/customer/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"email":"demo@example.com","password":"a-long-demo-password","displayName":"Demo"}'
```

Take the token from the register response, then:

```sh
curl -i -X POST https://YOUR_API_HOST/api/customer/subscription/activate \
  -H 'Authorization: Bearer YOUR_CUSTOMER_TOKEN'
curl -i https://YOUR_API_HOST/api/customer/subscription \
  -H 'Authorization: Bearer YOUR_CUSTOMER_TOKEN'
```

This repository change prepares the API source. It does not deploy or expose a live API host by itself. GitHub Pages is static hosting and cannot run this Express process or persist its SQLite database.
