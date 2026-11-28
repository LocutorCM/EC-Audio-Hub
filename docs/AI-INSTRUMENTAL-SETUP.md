# EC AI Instrumental Studio — ACE-Step + Demucs

EC Audio Pages remains the user interface. The authenticated Render API sends voice references to the EC Audio Hugging Face Space. GitHub Actions deploys the Space source from this repository.

## One-time configuration
1. Create a Hugging Face Space named `ec-audio-music-engine`, SDK Gradio. Select ZeroGPU hardware if your account is eligible.
2. Create a Hugging Face write token for that Space.
3. In GitHub repository Settings → Secrets and variables → Actions, add:
   - `HF_TOKEN`: Hugging Face token with permission to push to the Space.
   - `HF_SPACE_ID`: `username/ec-audio-music-engine`.
4. In Render service `ec-audio-cloud`, add private environment variables:
   - `HF_TOKEN`: token with permission to access the Space.
   - `HF_MUSIC_SPACE`: `username/ec-audio-music-engine`.
5. Redeploy Render. Run the GitHub Actions workflow `Deploy EC Audio Music Engine`.

The GitHub workflow deploys the Space code; Render calls the Space. Neither secret is placed in the public website.

## Models and capabilities
ACE-Step 1.5 is MIT-licensed. The Space uses its documented `complete` task with the uploaded voice as source audio and asks the model to add drums, bass, guitar, keyboard, strings and percussion. It uses the Base model because ACE-Step documents `complete`, `lego` and `extract` as Base-only tasks. Demucs `htdemucs_6s` then attempts to separate the resulting mix into vocals, drums, bass, guitar, piano and other. Stem quality varies and piano separation may contain artifacts.

This does not guarantee exact note-for-note or beat-perfect following of the singer. The UI should describe it as AI-assisted arrangement from a vocal reference.

## Free-tier limitations
Hugging Face ZeroGPU is shared GPU compute with queueing, eligibility requirements and a daily free allowance. It is not an unlimited, dedicated free GPU. Model initialization and a complete + separation run may exceed the available free runtime. If the free Space cannot complete jobs reliably, use a locally hosted ACE-Step instance or a paid GPU host; do not fall back to fal.ai automatically.

## Security and retention
Voice recordings are sent to the Hugging Face Space after the user explicitly consents. Temporary job files are stored by the Render API and deleted after approximately one hour. Never add HF tokens to GitHub source, frontend JavaScript or HTML.
