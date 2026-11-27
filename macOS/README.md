# EC Audio Hub for macOS

Native SwiftUI plugin library and downloader for macOS 12 Monterey and later.

## Supported Macs
- Intel (x86_64)
- Apple Silicon (arm64)
- Universal binary target

## Current features
- Add plugins to a local library with name, manufacturer, version, category, format, notes and HTTPS download URL.
- Search and filter the library.
- Download installers to ~/Downloads/EC Audio Hub.
- Open PKG/MPKG/DMG files for the user to review and complete installation.
- Reveal other downloaded archives in Finder.
- Save the catalog in Application Support.

## Build locally
Requires Xcode Command Line Tools and Swift 5.7 or later.

```sh
cd macOS
swift build -c release
```

GitHub Actions builds Intel and Apple Silicon executables, combines them into a universal app bundle and publishes a ZIP artifact.

## Security and next steps
The Hub does not bypass installer permissions or silently install third-party code. PKG installers open in Apple's Installer so the user can inspect and approve installation. Only add download links from sources you trust.

The catalog is local to the Mac in this first version. Accounts, a shared online catalog, license activation, update checks, automatic plugin scanning and one-click managed installation are future features.
