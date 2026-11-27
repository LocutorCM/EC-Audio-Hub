# EC Audio Cloud — self-hosted

This is the independent backend for EC Audio Hub. It does not use AppDeploy, Supabase, Firebase, or a hosted vendor database. It runs on a VPS or a computer/server you control.

## Features
- Private owner console at `/` (login with the admin account configured in environment).
- Customers sign in through the native macOS app; there is no customer upload API.
- Admin-only plugin upload, metadata changes, publish/hide controls.
- Installer binaries stored on private server disk, not in the public web directory.
- SQLite metadata database with WAL and persistent Docker volume.
- Authenticated downloads and SHA-256 checksums.
- WebSocket notifications for connected clients; clients refresh the catalog immediately after a change.
- The macOS app is designed to retain catalog metadata and downloaded installers locally for offline use.

## Run on a VPS
1. Install Docker Engine and Docker Compose.
2. Copy this directory to your server.
3. Run `cp .env.example .env`.
4. Set a unique random `JWT_SECRET` (at least 40 characters), `ADMIN_EMAIL`, and a strong `ADMIN_PASSWORD` (at least 14 characters).
5. Run `docker compose up -d --build`.
6. Put a TLS reverse proxy (Caddy or Nginx) in front of port 8080. Do not expose the admin console or login over plain public HTTP.
7. Open your HTTPS domain in a browser and sign in.

Example Caddy site:
```
hub.example.com {
  reverse_proxy 127.0.0.1:8080
}
```

## API
- `POST /api/auth/login`
- `GET /api/auth/me`
- `GET /api/catalog` (authenticated customer or admin; published only)
- `GET /api/plugins/:id/download` (authenticated; published only)
- `GET /api/admin/plugins` (admin only)
- `POST /api/admin/plugins` (admin only, multipart field `installer`)
- `PATCH /api/admin/plugins/:id` (admin only)
- `DELETE /api/admin/plugins/:id` (admin only; hides, never destroys the binary)
- `WS /api/live?token=JWT` (authenticated live catalog event stream)

## Hybrid/offline behavior
The server is required for login, first catalog sync, and new downloads. Once the app has synchronized and an installer has been downloaded, its cached copy is stored on the Mac and can be opened/installed without internet. When online again, the app fetches the catalog and refreshes on WebSocket events. A customer cannot upload or modify catalog records.

## Security notes
- Change the initial admin password before sharing the server.
- Use HTTPS/WSS only for production.
- Never put `.env`, JWT secrets, or admin credentials in GitHub or inside the customer app.
- Keep server backups of both `/data/ec-audio.sqlite` and `/data/installers`.
- Deleting from the admin console only unpublishes. This protects existing customer caches and avoids accidental data loss.
