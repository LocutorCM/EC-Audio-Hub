# EC AI Instrumental Studio — motor local

EC Audio Instrumental usa ACE-Step 1.5 como motor local. La página publicada es solo la interfaz: el modelo se ejecuta en tu computadora y atiende en `http://127.0.0.1:8001`. No se usa Hugging Face Spaces, Render ni una GPU remota. La primera instalación descarga los modelos y puede ocupar varios GB.

## Instalar el motor

1. Descarga o clona el repositorio oficial: https://github.com/ace-step/ACE-Step-1.5
2. Sigue las instrucciones oficiales de instalación y compatibilidad de GPU de ese repositorio.
3. Inicia el servidor API local:
   - macOS Apple Silicon: `./start_api_server_macos.sh`
   - Windows NVIDIA: `start_api_server.bat`
   - Linux NVIDIA: `./start_api_server.sh`
   - AMD/ROCm: utiliza el lanzador ROCm incluido por ACE-Step.
4. Mantén abierta la ventana del motor. Debe responder en `http://127.0.0.1:8001/health`.
5. Abre EC Audio → AI Instrumental y pulsa «Comprobar conexión».

La disponibilidad de aceleración depende del hardware y de las instrucciones oficiales. En macOS, el proyecto ofrece un lanzador MLX para Apple Silicon. En equipos sin GPU compatible puede usarse el modo CPU/offload, con tiempos de generación mucho mayores. No se garantiza que cualquier teléfono o computadora pueda ejecutar el modelo.

## Qué hace la página

- Envía prompts, BPM, duración y opciones de generación a `POST /release_task`.
- Consulta el progreso mediante `POST /query_result`.
- Reproduce y descarga el audio devuelto por `GET /v1/audio`.
- El archivo de referencia opcional se envía al motor local como audio de referencia para una tarea de cover. Eso no equivale a una función garantizada de Vocal2BGM; esa función requiere el flujo/modelo específico compatible que ofrezca la versión instalada.

## Privacidad y red local

La solicitud de generación y el archivo de referencia se envían a `127.0.0.1`, es decir, al servicio que corre en el mismo equipo. No se envían a EC Audio Cloud. No expongas el servidor local a internet ni abras el puerto 8001 al público.

Si el navegador bloquea la conexión por CORS o por políticas de red local, debe configurarse el servidor ACE-Step para permitir el origen de EC Audio o servirse la interfaz desde el mismo equipo. No desactives las protecciones generales del navegador.

## Referencias oficiales

- Repositorio e instalación: https://github.com/ace-step/ACE-Step-1.5
- API REST: https://github.com/ace-step/ACE-Step-1.5/blob/main/docs/en/API.md
- Inferencia y modelos: https://github.com/ace-step/ACE-Step-1.5/blob/main/docs/en/INFERENCE.md

ACE-Step y sus modelos tienen sus propias licencias, requisitos y dependencias; revísalos antes de uso comercial.
