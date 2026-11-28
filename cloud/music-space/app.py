import os
import tempfile
import zipfile
from pathlib import Path

import gradio as gr
import librosa
import numpy as np
import soundfile as sf
import spaces
import torch
from acestep.handler import AceStepHandler
from acestep.inference import GenerationParams, GenerationConfig, generate_music

# Base checkpoint supports ACE-Step's complete/lego/extract tasks.
MODEL_CONFIG = os.environ.get("ACESTEP_CONFIG_PATH", "acestep-v15-base")
HANDLER = None

def get_handler():
    global HANDLER
    if HANDLER is None:
        handler = AceStepHandler()
        handler.initialize_service(
            project_root=os.environ.get("ACESTEP_PROJECT_ROOT", "/home/user/app"),
            config_path=MODEL_CONFIG,
            device="cuda"
        )
        HANDLER = handler
    return HANDLER

@spaces.GPU(duration=300)
def generate(voice, prompt, bpm, duration, separate_stems):
    if not voice:
        raise gr.Error("Sube una grabación de voz.")
    work = Path(tempfile.mkdtemp(prefix="ec-audio-"))
    try:
        audio, sample_rate = librosa.load(voice, sr=48000, mono=True)
        voice_path = work / "voice-reference.wav"
        sf.write(str(voice_path), audio, 48000)
        handler = get_handler()
        bpm_value = int(bpm) if bpm and int(bpm) >= 60 else None
        params = GenerationParams(
            task_type="complete",
            src_audio=str(voice_path),
            instruction="Complete the input vocal track with drums, bass, guitar, keyboard, strings and percussion. Keep the original lead vocal present and clearly audible:",
            caption=prompt,
            lyrics="",
            instrumental=False,
            bpm=bpm_value,
            duration=min(max(float(duration), 10), 120),
            inference_steps=8,
            thinking=False
        )
        config = GenerationConfig(batch_size=1, audio_format="wav")
        result = generate_music(handler, None, params, config, save_dir=str(work))
        if not result.success or not result.audios:
            raise gr.Error(result.error or "ACE-Step no pudo completar la voz.")
        source = Path(result.audios[0]["path"])
        mix = work / "EC-AI-Instrumental.wav"
        if source.resolve() != mix.resolve():
            mix.write_bytes(source.read_bytes())
        if not separate_stems:
            return str(mix), None
        import subprocess
        output_dir = work / "demucs"
        subprocess.run(
            ["python", "-m", "demucs.separate", "-n", "htdemucs_6s", "-o", str(output_dir), str(mix)],
            check=True, timeout=240, capture_output=True, text=True
        )
        stems = list(output_dir.rglob("*.wav"))
        if not stems:
            raise gr.Error("Demucs no devolvió pistas separadas.")
        archive_path = work / "EC-AI-Stems.zip"
        with zipfile.ZipFile(archive_path, "w", zipfile.ZIP_DEFLATED) as archive:
            for stem in stems:
                archive.write(stem, stem.name)
        return str(mix), str(archive_path)
    except gr.Error:
        raise
    except Exception as exc:
        raise gr.Error("Error del motor EC Audio: " + str(exc)[:450])

with gr.Blocks(title="EC Audio Music Engine") as demo:
    gr.Markdown("# EC Audio Music Engine\nACE-Step 1.5 + Demucs · Procesamiento de voz y generación instrumental")
    voice = gr.Audio(label="Voz de referencia", type="filepath")
    prompt = gr.Textbox(label="Estilo y dirección musical", lines=4, value="Modern worship production, warm piano, ambient electric guitars, deep bass, live drums, emotional build, professional studio mix")
    bpm = gr.Number(label="BPM (opcional)", value=0, precision=0)
    duration = gr.Slider(20, 120, value=60, step=10, label="Duración (segundos)")
    separate = gr.Checkbox(value=True, label="Separar pistas con Demucs")
    submit = gr.Button("Generar instrumental", variant="primary")
    mix = gr.File(label="Mezcla completa WAV")
    stems = gr.File(label="Pistas separadas ZIP")
    submit.click(generate, [voice, prompt, bpm, duration, separate], [mix, stems], api_name="generate")

demo.queue(max_size=4).launch()
