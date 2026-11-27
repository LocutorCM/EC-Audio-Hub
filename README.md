# EC Audio Hub

**Tu centro personal para organizar y descargar plugins de audio en macOS.**

EC Audio Hub es una aplicación nativa SwiftUI diseñada para macOS Monterey 12 o posterior, con compilación universal para Intel (x86_64) y Apple Silicon (arm64).

## Funciones incluidas
- Biblioteca local persistente en Application Support.
- Agregar plugins manualmente con nombre, fabricante, versión, formato, categoría, notas y URL.
- Formatos etiquetados: VST3, Audio Unit, AAX y Standalone.
- Búsqueda instantánea y filtros por categoría.
- Descargas HTTPS a `~/Downloads/EC Audio Hub`.
- Conserva archivos existentes y crea nombres alternativos para descargas repetidas.
- Permite abrir el archivo descargado con la aplicación predeterminada de macOS, para que el usuario continúe la instalación.
- Interfaz oscura, adaptable y con marca EC Audio.

## Compilar desde código fuente
Requiere Xcode 14 o posterior:

```sh
swift build -c release
```

## Descargar
Los builds universales se publican como artefactos de GitHub Actions en la pestaña **Actions** del repositorio.

## Seguridad y alcance
- Solo se aceptan enlaces HTTPS al registrar una fuente.
- Los instaladores se descargan y se abren por acción explícita del usuario.
- EC Audio Hub no instala software silenciosamente ni omite Gatekeeper, firmas, permisos o licencias.
- La primera versión no tiene cuentas, servidor remoto de catálogo, verificación de actualizaciones de plugins ni integración de licencias con fabricantes.
- El usuario debe utilizar enlaces oficiales y comprobar que el instalador corresponde al fabricante.

## Requisitos
- macOS 12 Monterey o posterior.
- Intel x86_64 o Apple Silicon arm64.
