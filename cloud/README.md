# EC Audio Hub Cloud

At this stage, this repository contains only the private file-upload service used by the native macOS administrator app.

- macOS app: administrator login, file selection, and upload.
- Server: HTTPS API, administrator authentication, private file storage, SQLite metadata, and SHA-256 checksums.
- No customer application, catalog, download system, licensing, or AppDeploy integration yet.

Deployment instructions: see server/README.md.