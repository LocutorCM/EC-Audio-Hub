# EC Audio Hub Cloud

The cloud service now contains two separate authentication domains:

- **Administrator API:** the existing private file-upload service used by the macOS Admin app.
- **Customer API:** customer registration, sign-in, account lookup, and a server-authoritative free 60-second demo subscription.

Customer accounts are stored separately from administrator users. Customer tokens use a distinct JWT audience and cannot authenticate to administrator routes.

## Customer accounts and demo subscriptions

See [CUSTOMER-ACCOUNTS.md](server/CUSTOMER-ACCOUNTS.md) for environment variables, endpoints, examples, and client entitlement rules.

The demo activation is free and does not process a payment. It is intentionally 60 seconds for testing. A production paid subscription requires a payment provider and verified server-side webhooks.

## Hosting requirement

GitHub Pages only hosts static files. The Express API must run on a separate Node.js 20+ host with HTTPS and a persistent writable volume for SQLite. Set `DATA_DIR` to that persistent volume and set `CORS_ORIGINS` to the exact website origin. Do not expose server secrets in the website or native client.

**Important:** this repository branch prepares the backend source; it does not create a live backend deployment. The macOS Client Hub still needs to be connected to the deployed API and its entitlement response before automatic plugin suspension/restoration is active.
