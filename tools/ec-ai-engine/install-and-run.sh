#!/usr/bin/env bash
set -euo pipefail
ROOT="${HOME}/EC-Audio/ACE-Step-1.5"
mkdir -p "${HOME}/EC-Audio"
if [ ! -d "$ROOT/.git" ]; then
  git clone --depth 1 https://github.com/ace-step/ACE-Step-1.5.git "$ROOT"
else
  echo "ACE-Step ya está instalado en $ROOT"
fi
cd "$ROOT"
if [[ "$(uname -s)" == "Darwin" ]]; then
  if [[ "$(uname -m)" == "arm64" ]] && [ -f "./start_api_server_macos.sh" ]; then
    exec bash ./start_api_server_macos.sh
  fi
  echo "Para macOS Intel revisa las instrucciones oficiales de ACE-Step; no se garantiza soporte MLX."
elif [ -f "./start_api_server.sh" ]; then
  exec bash ./start_api_server.sh
else
  echo "No se encontró start_api_server.sh. Consulta la guía oficial: https://github.com/ace-step/ACE-Step-1.5"
  exit 1
fi
