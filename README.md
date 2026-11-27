# EC Audio Hub

EC Audio Hub is the distribution and account platform for EC Audio plugins, with a native macOS Admin uploader and Client Hub.

## Components

- **Website:** GitHub Pages at https://locutorcm.github.io/EC-Audio-Hub/
- **macOS Admin:** uploads AU/VST3 plugins and artwork to GitHub Releases.
- **macOS Client Hub:** browses GitHub Releases, verifies SHA-256, and installs managed plugins.
- **Cloud API:** administrator uploads plus customer accounts and subscription entitlements.

## Customer accounts and licensing

The website and macOS Client Hub use the same Express API and customer database. Email/password accounts are separate from administrator accounts. The macOS Client Hub stores its customer token in Keychain.

A free $0 MXN demo activation lasts 60 seconds and requires no card. It is a test activation, not a payment. When the server confirms expiry, the Client Hub moves only EC Audio-managed AU/VST3 bundles into a local suspended-plugins folder; it does not delete them. When the server confirms active access, it restores them. Temporary network failures do not trigger suspension.

- API details: [cloud/server/CUSTOMER-ACCOUNTS.md](cloud/server/CUSTOMER-ACCOUNTS.md)
- Deployment guide: [cloud/DEPLOY_RENDER.md](cloud/DEPLOY_RENDER.md)
- Account page setup: [docs/FIREBASE_SETUP.md](docs/FIREBASE_SETUP.md)

## Build macOS apps

Requires Xcode 14+ and Swift 5.7+:

```sh
swift build -c release
```

GitHub Actions builds universal Intel + Apple Silicon macOS applications and publishes downloadable release artifacts when changes are merged to `main`.

## Deployment status

The API source and a Render Blueprint are included, but the API is **not yet deployed**. The website API base URL remains blank until the service has an HTTPS address. The Render Blueprint uses a persistent disk and a paid Starter service; review the provider's price before confirming deployment. The source changes are in the open pull request and are not yet merged into `main`.

Google/Apple social login and real paid billing are not enabled in this test version. Never commit API secrets, administrator credentials, or tokens to GitHub.
