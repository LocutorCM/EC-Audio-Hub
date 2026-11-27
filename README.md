# EC Guitar Tuner

Afinador cromático para guitarra eléctrica, desarrollado en Kotlin + Jetpack Compose.

## Funciones
- Afinador de seis cuerdas (E2, A2, D3, G3, B3, E4).
- Modo cromático.
- Detección de frecuencia en tiempo real desde el micrófono.
- Medidor visual de afinación y desviación en cents.
- Calibración A4 de 430 a 450 Hz.
- Procesamiento local: no requiere Internet.

## Compilar
Requisitos: JDK 17 y Gradle 8.9 (o Android Studio reciente).

```bash
gradle assembleDebug
```

APK: `app/build/outputs/apk/debug/app-debug.apk`

## GitHub Actions
Al subir el proyecto a la rama `main`, el workflow **Android APK** compila el APK y lo publica como artifact de la ejecución.

## Permisos
La app solicita permiso de micrófono para analizar el sonido. El audio se procesa localmente y no se transmite.

## Nota
La precisión depende del micrófono, ruido ambiental y armónicos de la guitarra. Para mejor resultado, toca una cuerda a la vez y silencia las demás.
