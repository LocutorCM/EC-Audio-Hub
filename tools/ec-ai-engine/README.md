# EC Audio Local AI Engine

## Motor neuronal de instrumentales

Este paquete instala el motor abierto ACE-Step 1.5 en el equipo del usuario. Los pesos del modelo se descargan desde el proyecto oficial durante la primera instalación; no se almacenan dentro de GitHub Pages ni en el servidor EC Audio. La generación se ejecuta localmente mediante la API de ACE-Step en http://127.0.0.1:8001.

### Inicio rápido
- macOS Apple Silicon / Linux: ejecutar `install-and-run.sh`.
- Windows con NVIDIA: abrir PowerShell y ejecutar `install-and-run.ps1`.

Se requiere Git, Python y los requisitos de hardware indicados por ACE-Step. La primera ejecución descarga varios GB. El rendimiento depende de RAM/VRAM y del backend disponible. La instalación no promete que CPU/GPU no compatibles puedan ejecutar el modelo.

### Integración EC Audio
La página `docs/instrumental.html` envía la solicitud a la API local:
- `POST /release_task`
- `POST /query_result`
- `GET /v1/audio`

El navegador debe permitir la comunicación con localhost. Si CORS o la política de acceso a red local bloquea la petición, hay que configurar el origen permitido en el motor local; nunca desactivar la protección del navegador.

### Licencias
ACE-Step y sus pesos mantienen licencias y condiciones propias. Revísalas antes de redistribuir modelos o vender contenido generado.
