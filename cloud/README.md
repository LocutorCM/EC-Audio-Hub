# EC Audio Cloud — self-hosted

This project uses its own server. It does **not** depend on AppDeploy.

The backend and owner console are in [server/](server/README.md).

## Components
- **Owner console:** upload installers, edit release details, publish/hide plugins, create and suspend customer accounts.
- **Customer macOS app:** read-only catalog, authenticated downloads, local installer cache.
- **Server:** Node.js API, SQLite metadata database, private installer storage, JWT sessions, WebSocket notifications.

## Hybrid behavior
- The client saves the catalog metadata locally.
- Downloaded installers are stored in Application Support and can be opened offline.
- New installers and first-time login require internet.
- The client refreshes periodically and reacts to live catalog change events.
- When offline, the app continues to show its last synced catalog and identifies installers already cached on that Mac.

## Deployment
Follow [server/README.md](server/README.md). Deploy on a VPS/server you control, configure the environment variables, and place a TLS reverse proxy in front of the app. The server is not live until you deploy it and set a public HTTPS domain.
