# EC AI Mastering

EC AI Mastering is integrated into the EC Audio GitHub Pages website at:

- https://locutorcm.github.io/EC-Audio-Hub/mastering.html

## Included in this first release

- Responsive upload page for phones, tablets and desktop.
- Firebase Authentication: customers must sign in with their existing EC Audio account.
- Authenticated upload endpoint with a 150 MB default limit and five master jobs per hour per account/IP.
- WAV, MP3, FLAC, AIFF, M4A, AAC, OGG and OPUS input (FFmpeg-supported decode).
- Genre-oriented processing profiles: pop, urban/reggaeton, rap/hip-hop, rock, worship/Christian music, ballad, electronic and acoustic.
- Adaptive profile, conservative EQ, dynamics control, peak limiting and two-pass EBU R128 loudness normalization.
- WAV PCM 24-bit / 48 kHz or MP3 320 kbps export.
- Temporary source and output files are removed after the response completes or fails.

## Important processing note

This first release is an automated DSP mastering engine, not a trained neural-network genre classifier. The user chooses a genre profile; “Auto / equilibrado” uses a conservative general-purpose profile. It analyzes audio level and peak and applies the selected mastering chain. It cannot reconstruct clipped recordings, remove every mix defect, or replace a mastering engineer's listening decisions. A dedicated ML genre classifier and more advanced restoration models can be added later when a model/provider and its operating budget are selected.

## Deploy the processing server

The website is hosted on GitHub Pages and cannot process long audio jobs itself. Processing runs in the existing EC Audio Cloud API service defined in the repository's root `render.yaml`.

1. Open the Render Dashboard and select the existing `ec-audio-cloud` service. If it does not exist, create a Blueprint from this repository and let Render read `render.yaml`.
2. Confirm the service is built from the latest `main` branch. The Dockerfile now installs FFmpeg (including ffprobe).
3. Ensure the required existing private environment variables are set: `JWT_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, and `FIREBASE_API_KEY`. Keep secrets private; never commit them to GitHub.
4. Confirm `FIREBASE_PROJECT_ID=ec-audio-accounts`, `CORS_ORIGINS=https://locutorcm.github.io`, and `MASTERING_MAX_UPLOAD_MB=150`.
5. Deploy/redeploy and wait for the service health check to pass at `/health`.
6. The frontend API configuration currently points to `https://ec-audio-cloud.onrender.com`. If Render assigns a different hostname, update `docs/js/api-config.js` to the exact Render URL and commit the change.

## Verify

- Open `https://ec-audio-cloud.onrender.com/health`; it should return JSON with `ok: true`.
- Sign in at the EC Audio website with a Firebase account.
- Open the Mastering page, upload a short test file, select a genre, and export WAV first.
- Check that the downloaded file plays and that the temporary files are removed from the server.

## API

- `GET /api/mastering/status` — authenticated service capabilities.
- `POST /api/mastering/process` — authenticated multipart upload; fields: `audio`, `genre`, `format`.

The API uses the existing Firebase customer-auth middleware. It does not grant or modify subscriptions, Ko-fi payments, customer licenses, or plugin access.
