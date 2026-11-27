# GitHub Releases distribution

EC Audio Hub Admin publishes each plugin version as a GitHub Release in this repository. The release contains one installer asset and a machine-readable metadata block in its description:

- `plugin_name`
- `version`
- `file_name`
- `sha256`

Release tags use `<plugin-slug>-v<version>`, for example `ec-air-v1.0.0`. Publish each new version with a new version number; GitHub release tags are immutable in this workflow.

## Admin setup

1. Open EC Audio Hub Admin.
2. Enter the repository owner and repository name.
3. Create a GitHub fine-grained personal access token limited to this repository with **Contents: Read and write**.
4. Paste the token into the app and connect. The token is stored in macOS Keychain.
5. Enter plugin name and version, select a plugin file/installer (or a VST3/AU bundle folder), and publish.

The app verifies the token using GitHub's authenticated user endpoint, creates a release, calculates SHA-256 locally, and uploads the binary as a release asset. The token is never included in release metadata or the future customer app.

## Customer app integration

The customer client can read the public release feed without a GitHub login:

`GET https://api.github.com/repos/LocutorCM/EC-Audio-Hub/releases`

It should parse the metadata block in each release body, display the newest version per plugin, and download the corresponding asset from `assets[].browser_download_url`. Verify the downloaded file against the SHA-256 value before installing. Cache installers and the last catalog locally for offline access.

## Visibility and security

The current repository is public. Therefore, GitHub Releases and their installer assets are publicly downloadable by anyone who has the asset URL or can access the release page. The admin token is private, but the plugin binaries are not private. Do not publish commercial/customer-restricted binaries here unless public distribution is intended.

For private paid distribution, use a private repository plus a separate authenticated download service that issues short-lived download URLs. Never put a GitHub token with repository access in the customer app.

## Limits

GitHub Releases is file storage/distribution, not a dedicated CDN or entitlement/licensing service. Large assets, API rate limits, bandwidth, and GitHub terms should be considered before scaling. Uploading/publishing requires internet; clients can use previously downloaded installers offline.
