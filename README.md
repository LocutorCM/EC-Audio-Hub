# EC Blackmagic Camera

Aplicación Android de cámara y video con controles manuales, desarrollada en Kotlin, Jetpack Compose y CameraX.

## Funciones incluidas
- Vista previa de cámara trasera y frontal.
- Grabación de video con audio y guardado en la galería.
- Captura de fotografías.
- Selección de calidad HD, Full HD y UHD/4K cuando el dispositivo la admita.
- Selección de 24, 30 y 60 FPS cuando el hardware/encoder lo permita.
- Control manual de ISO y tiempo de obturación mediante Camera2 cuando el dispositivo admita exposición manual.
- Balance de blancos automático, luz día, nublado, fluorescente e incandescente cuando estén disponibles.
- Compensación de exposición, zoom y enfoque automático tocando la imagen.
- Cuadrícula de composición y controles de grabación.
- Interfaz oscura de estilo cinematográfico con identidad EC.

## Compatibilidad
Las capacidades reales dependen del teléfono, sus cámaras, el fabricante y las extensiones de Camera2/CameraX. La aplicación consulta y utiliza los modos que el hardware expone. UHD/4K, 60 FPS, controles manuales, cambio de lente y estabilización no están garantizados en todos los modelos.

## Compilar
Requisitos: JDK 17 y Android SDK 35.

```bash
gradle assembleDebug
```

APK: `app/build/outputs/apk/debug/app-debug.apk`

## Privacidad
El video y las fotografías se guardan localmente en el dispositivo. La aplicación necesita permiso de cámara y permiso de micrófono para grabar audio en los videos.
