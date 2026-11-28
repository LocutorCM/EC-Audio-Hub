#!/bin/bash
set -euo pipefail
APP_DIR="$HOME/EC-Audio-AI-Engine"
REPO="https://github.com/ace-step/ACE-Step-1.5.git"
echo "EC AUDIO · Instalador del motor local ACE-Step"
if ! command -v git >/dev/null 2>&1; then echo "Necesitas instalar Xcode Command Line Tools: xcode-select --install"; read -r; exit 1; fi
if ! command -v uv >/dev/null 2>&1; then
  echo "Instalando uv…"
  curl -LsSf https://astral.sh/uv/install.sh | sh
  export PATH="$HOME/.local/bin:$HOME/.cargo/bin:$PATH"
fi
if [ ! -d "$APP_DIR/.git" ]; then git clone "$REPO" "$APP_DIR"; else git -C "$APP_DIR" pull --ff-only; fi
cd "$APP_DIR"
echo "Configurando dependencias (puede tardar)…"
uv sync
python3 - <<'PY'
from pathlib import Path
p=Path("acestep/api/route_setup.py")
s=p.read_text()
old='allow_origins=["null", "http://localhost", "http://127.0.0.1"],'
new='allow_origins=["null", "http://localhost", "http://127.0.0.1", "https://locutorcm.github.io"],'
if old not in s:
    if '"https://locutorcm.github.io"' not in s:
        raise SystemExit("No se encontró la configuración CORS esperada; no se modificó el archivo.")
else:
    p.write_text(s.replace(old,new,1))
print("Permiso CORS limitado al sitio oficial EC Audio.")
PY
echo
echo "Instalación lista. Iniciando motor local en http://127.0.0.1:8001"
echo "La primera ejecución puede descargar varios GB de modelos."
echo "Deja esta ventana abierta mientras uses EC Audio."
uv run python -m acestep.api_server --host 127.0.0.1 --port 8001
