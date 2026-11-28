$ErrorActionPreference = "Stop"
$AppDir = Join-Path $HOME "EC-Audio-AI-Engine"
$Repo = "https://github.com/ace-step/ACE-Step-1.5.git"
Write-Host "EC AUDIO - Instalador del motor local ACE-Step" -ForegroundColor Green
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { throw "Instala Git for Windows y vuelve a ejecutar este archivo." }
if (-not (Get-Command uv -ErrorAction SilentlyContinue)) {
  powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"
  $env:Path = "$HOME\.local\bin;$HOME\.cargo\bin;$env:Path"
}
if (-not (Test-Path (Join-Path $AppDir ".git"))) { git clone $Repo $AppDir } else { git -C $AppDir pull --ff-only }
Set-Location $AppDir
uv sync
@'
from pathlib import Path
p=Path("acestep/api/route_setup.py")
s=p.read_text()
old='allow_origins=["null", "http://localhost", "http://127.0.0.1"],'
new='allow_origins=["null", "http://localhost", "http://127.0.0.1", "https://locutorcm.github.io"],'
if old not in s and '"https://locutorcm.github.io"' not in s:
    raise SystemExit("No se encontró la configuración CORS esperada.")
if old in s:
    p.write_text(s.replace(old,new,1))
print("CORS de EC Audio configurado.")
'@ | uv run python -
Write-Host "Motor listo. Iniciando en http://127.0.0.1:8001. Deja esta ventana abierta." -ForegroundColor Green
uv run python -m acestep.api_server --host 127.0.0.1 --port 8001
