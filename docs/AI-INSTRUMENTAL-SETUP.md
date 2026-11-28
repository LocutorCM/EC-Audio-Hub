# EC AI Instrumental Studio — Cloud AI and separated tracks

The instrumental creator is served by GitHub Pages and sends generation requests to the existing EC Audio Cloud API on Render. The API keeps the fal.ai API key on the server; it is never exposed to the browser.

## Pipeline

1. The customer signs in with the existing EC Audio Firebase account.
2. The customer uploads a solo vocal recording and explicitly consents to sending it to the external AI provider.
3. The server uploads the reference audio to fal.ai and calls ACE-Step Audio-to-Audio (fal-ai/ace-step/audio-to-audio) to create an instrumental backing track.
4. The server converts the generated instrumental to stereo MP3 at 192 kbps and sends it to Mureka Stem Separation (mureka/api/song/stem).
5. The API returns the complete instrumental as an authenticated download and the separated tracks as the provider's ZIP archive.

The frontend polls the authenticated job endpoint. Its percentage represents completed pipeline milestones (upload, composition, stem separation and completion), not the neural network's internal sampling percentage.

## Required server configuration

The root render.yaml already defines the existing ec-audio-cloud service and the private FAL_KEY environment variable.

1. Open the Render Dashboard and select ec-audio-cloud.
2. Set FAL_KEY to an API key from https://fal.ai/dashboard/keys. Keep it in Render only; never put it in GitHub, HTML or browser JavaScript.
3. Keep FIREBASE_API_KEY, FIREBASE_PROJECT_ID=ec-audio-accounts, JWT_SECRET, ADMIN_EMAIL, ADMIN_PASSWORD, and the existing CORS origin configured.
4. Deploy the latest main branch and wait for /health to return ok: true.
5. Open /api/instrumental/status after signing in through the EC Audio page. The endpoint requires a customer session.

Optional environment variable:

- FAL_STEM_MODEL=audio-separation-3 (default). The other provider models are audio-separation-1 and audio-separation-2; their available separation outputs and current prices are set by fal.ai.

## Provider costs and limits

- ACE-Step Audio-to-Audio currently lists a price of US$0.0002 per second of generated audio. See https://fal.ai/models/fal-ai/ace-step/audio-to-audio/api.
- Mureka Stem Separation currently lists US$0.20 per song for audio-separation-3, US$0.06 for audio-separation-1, and US$0.70 for audio-separation-2. See https://fal.ai/models/mureka/api/song/stem/api.
- Provider prices can change. fal.ai bills the connected account directly; EC Audio does not set or collect these model charges.
- Mureka accepts MP3/M4A input up to 10 MB. The server converts the generated instrumental to MP3 and checks the limit before submitting stem separation.
- The current EC Audio endpoint accepts up to 50 MB of voice input and limits each account/IP to three generations per hour.

## Progress and track delivery

The UI reports actual pipeline stages: voice upload, ACE-Step composition, stem separation, and finished downloads. The provider does not expose a reliable per-instrument progress percentage for piano, drums, bass or guitar. It returns a ZIP containing the stems it can separate; the exact track list depends on the provider's separation model and the audio. EC Audio therefore does not display fabricated instrument-by-instrument progress or promise that every instrument will always be isolated.

If stem separation fails after the instrumental has been generated, the job is marked partial and the complete instrumental remains downloadable.

## Privacy

The voice file is sent to fal.ai storage for generation. The generated mix is downloaded to temporary storage on the EC Audio Cloud server; the temporary working directory is removed after one hour. The ZIP is delivered from the provider's result URL. Review the provider's current privacy and retention terms before using recordings containing confidential or third-party material.
