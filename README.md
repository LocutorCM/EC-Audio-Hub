# EC Audio Hub

Gestor personal de plugins para macOS 12 Monterey o posterior.

## Características iniciales
- Biblioteca local de plugins con persistencia JSON.
- Registro manual de nombre, fabricante, versión, formato, categoría y URL HTTPS.
- Búsqueda y filtros por categoría.
- Descarga de instaladores a `~/Downloads/EC Audio Hub`.
- Arquitectura universal Intel x86_64 y Apple Silicon arm64.

## Compilar
Requiere Xcode 14 o posterior y Swift 5.7:

```sh
swift build -c release
```

La primera versión descarga archivos desde los enlaces HTTPS agregados por el usuario. No instala plugins silenciosamente, no valida licencias ni verifica la firma del fabricante. La instalación queda bajo control del usuario.
