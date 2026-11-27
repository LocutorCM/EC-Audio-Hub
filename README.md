# EC Audio Hub — Admin Uploader

EC Audio Hub is currently a small native macOS application whose only purpose is to upload plugin and installer files to your private server.

## What the program does
- Connects to your server using HTTPS.
- Signs in with the administrator account.
- Lets you choose one plugin or installer file.
- Uploads it to private server storage.
- Calculates and stores a SHA-256 checksum.
- Supports large files (server default limit: 2 GB).
- Automatically packages VST3 and AU bundle folders into ZIP archives before uploading.
- Works on Intel and Apple Silicon Macs running macOS 12 Monterey or later.

There is no customer catalog, customer login, download manager, licensing, plugin publishing workflow, or AppDeploy integration in this version. Those can be added later.

## Build the macOS application
Requires Xcode 14 or newer and Swift 5.7:

```sh
swift build -c release
```

GitHub Actions builds a universal Intel + Apple Silicon app artifact for macOS 12+.

## Private upload server
The backend is in cloud/server. It uses Node.js, Express, SQLite, private disk storage, and JWT authentication.

1. Install Docker Engine and Docker Compose on your VPS.
2. Copy cloud/server to the server.
3. Run cp .env.example .env.
4. Set JWT_SECRET to a random secret of at least 40 characters.
5. Set ADMIN_EMAIL and a unique ADMIN_PASSWORD of at least 14 characters.
6. Run docker compose up -d --build.
7. Configure HTTPS with a reverse proxy such as Caddy.
8. Enter the HTTPS server address and administrator credentials in EC Audio Hub.

Example Caddy configuration:

```text
hub.example.com {
  reverse_proxy 127.0.0.1:8080
}
```

The server stores uploaded files in /data/uploads and metadata in /data/ec-audio.sqlite. Back up the Docker volume regularly.

## Security
- Only the administrator account can upload.
- Files are stored outside any public web directory.
- The app stores the session token in macOS Keychain.
- Uploads use HTTPS.
- SHA-256 checksums are recorded by the server.
- Never commit the real .env file or credentials to GitHub.

## Deployment status
The source code is in GitHub. The server is not online until you deploy it on a VPS or other server and configure its HTTPS domain. No AppDeploy service is used.