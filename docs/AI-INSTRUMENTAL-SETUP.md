# EC AI Instrumental Studio — acceso público sin configuración

La página de EC Audio muestra el generador oficial público ACE-Step 1.5 de Hugging Face. No requiere crear un Space propio, añadir tokens a GitHub ni configurar variables en Render.

## Cómo usarlo
1. Abre EC Audio → Instrumental.
2. En el generador ACE-Step, selecciona la función Vocal2BGM o la opción de completar audio con voz de referencia.
3. Sube la grabación, indica el estilo, BPM y duración.
4. Genera y descarga el resultado desde la interfaz de ACE-Step.
5. Si la interfaz pública ofrece separación de pistas, úsala para obtener stems.

## Disponibilidad y límites
El motor público funciona en infraestructura de Hugging Face. Puede estar en cola, limitar solicitudes gratuitas o no estar disponible temporalmente. EC Audio no controla el servicio ni garantiza generación ilimitada. El audio se envía directamente al proveedor público, no al servidor privado de EC Audio.

ACE-Step documenta generación de música, referencia de audio, conversión de voz a acompañamiento y separación de pistas. La interfaz y las funciones disponibles pueden cambiar según la versión del Space.

## Alternativa
Si el Space público deja de funcionar, la integración propia con GPU requiere un host que ejecute ACE-Step; GitHub Pages y GitHub Actions no proporcionan GPU para inferencia musical.
