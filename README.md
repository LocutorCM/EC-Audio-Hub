# EC Audio Hub

**EC Audio Hub** is a hybrid macOS plugin library for Intel and Apple Silicon, with an owner-controlled cloud catalog and offline installer cache.

## Two separate experiences

### Owner / administrator
The owner uses the private web console hosted on their own server:
- Upload installers and add release metadata.
- Publish, hide, or update plugins.
- Create customer accounts and suspend access.
- Changes are broadcast to connected clients in real time.

### Customer application
The native macOS app is read-only:
- Sign in to the EC Audio Cloud server.
- See only published plugins.
- Download official installers.
- Keep catalog metadata and downloaded installers on the Mac.
- Open previously downloaded installers while offline.
- Automatically refresh the catalog on live server events and periodic sync.

Customers have no upload, publish, edit, or delete API permissions. Authorization is enforced by the server, not just by hiding interface buttons.

## Hybrid / offline behavior

| Feature | Online | Offline |
|---|---:|---:|
| Open the app | Yes | Yes |
| View previously synced catalog | Yes | Yes |
| Open an installer already cached on the Mac | Yes | Yes |
| Download a new installer | Yes | No |
| Receive new releases and changes | Live | When connection returns |
| Upload or publish plugins as a customer | Never | Never |

The first sign-in, initial catalog sync, and new downloads require internet. Downloaded installers remain in the local EC Audio Hub Application Support folder.

## Self-hosted cloud — no AppDeploy

The backend is in [cloud/server](cloud/server/README.md). It uses Node.js, Express, SQLite, private disk storage, JWT sessions, and WebSockets. It does not require AppDeploy, Supabase, Firebase, or another backend-as-a-service.

Deploy it on a VPS or server you control. Put HTTPS in front of it before using customer accounts. The owner console is served by the same server.

Quick start:
1. Install Docker and Docker Compose on your server.
2. Copy cloud/server/.env.example to .env.
3. Set a long random JWT_SECRET, your owner email, and a strong admin password (14+ characters).
4. Run docker compose up -d --build from cloud/server.
5. Configure a TLS reverse proxy. Full instructions and a Caddy example are in cloud/server/README.md.
6. Open the HTTPS domain to manage plugins and create customer accounts.
7. Give customers the server HTTPS address and their login credentials.

## Build the macOS app

Requires Xcode 14+ and Swift 5.7:

```sh
swift build -c release
```

GitHub Actions builds the universal Intel + Apple Silicon app for macOS 12 Monterey and later.

## Security
- The server stores installer binaries outside the public web directory.
- Every customer API request requires a valid account.
- Upload, publish, customer account management, and release changes require the admin role on the server.
- Downloads are authenticated and include a SHA-256 checksum header; the macOS client verifies the downloaded file.
- Session tokens are stored in macOS Keychain.
- The client only accepts HTTPS cloud URLs; production WebSockets use WSS.
- The server never exposes a public installer URL.
- Configure backups for both the SQLite database and installer volume.
- Do not commit your real .env file or secrets.

## Current deployment status

Source code is versioned in GitHub. The cloud is self-hosted software and is not live until you deploy it to a server with a domain and TLS certificate. No AppDeploy service is used.