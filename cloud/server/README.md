# EC Audio Upload Server

The EC Audio Hub HTTPS API for administrator uploads and customer accounts/licensing.

## What it does
- Admin email/password sign-in.
- One authenticated file upload endpoint.
- Customer registration and email/password login.
- Server-authoritative free 60-second demo subscriptions.
- Customer entitlement endpoint for the macOS Client Hub.
- Private storage under /data/uploads.
- SQLite metadata records and SHA-256 checksums.
- Default maximum upload size: 2 GB (MAX_UPLOAD_GB can be increased).

The customer API and demo entitlement endpoints are documented in [CUSTOMER-ACCOUNTS.md](CUSTOMER-ACCOUNTS.md). Plugin catalog delivery remains on GitHub Releases.

## Deploy
1. Install Docker Engine and Docker Compose.
2. Copy this folder to your VPS.
3. Run cp .env.example .env.
4. Set a random JWT_SECRET (at least 40 characters), ADMIN_EMAIL, and a unique ADMIN_PASSWORD (at least 14 characters).
5. Run docker compose up -d --build.
6. Put Caddy or Nginx in front of port 8080 and enable HTTPS.
7. Set CORS_ORIGINS to the exact website origin (default: https://locutorcm.github.io).\n8. Use the resulting HTTPS address in the website config and macOS Client Hub account settings.

Example Caddy site:

```text
hub.example.com {
  reverse_proxy 127.0.0.1:8080
}
```

## API
- GET /health
- POST /api/auth/login
- POST /api/admin/files — admin JWT required; multipart field name is installer.

Supported file types include VST3, AU, AAX, PKG, DMG, ZIP, APP, CLAP, and common installer/archive formats. VST3 and AU plugin bundles can be selected as folders in the Mac app; the app packages those folders into ZIP archives.

## Storage and security
- Uploaded binaries are private and are not served from a public URL.
- Admin tokens expire after 12 hours and are stored in macOS Keychain.
- The server records the original filename, byte size, uploader, upload time, and SHA-256.
- Keep backups of /data/uploads and /data/ec-audio.sqlite.
- Never commit .env or real credentials to GitHub.