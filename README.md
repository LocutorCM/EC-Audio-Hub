# EC Audio Hub

EC Audio Hub es la plataforma de distribución, cuentas y licencias para los plugins EC Audio, con aplicaciones nativas de administración y Client Hub para macOS.

## Componentes

- Sitio web: https://locutorcm.github.io/EC-Audio-Hub/
- macOS Admin: publica plugins AU/VST3 y portadas en GitHub Releases.
- macOS Client Hub: explora releases, verifica SHA-256 e instala plugins administrados.
- Firebase: identidad central para la web y Client Hub (`ec-audio-accounts`).
- Cloud API: valida ID tokens Firebase, administra perfiles EC Audio y controla licencias.

## Cuentas y licencias

La web y el Client Hub utilizan el mismo proyecto Firebase para iniciar sesión. El backend valida los ID tokens con Firebase Identity Toolkit y entrega una sesión EC Audio independiente para consultar licencias. El Client Hub guarda el token EC Audio en el Llavero de macOS; no guarda contraseñas Firebase.

La prueba actual es $0 MXN durante 60 segundos, sin tarjeta ni cobro. Es una activación de demostración. Cuando el servidor confirma el vencimiento, Client Hub mueve únicamente los plugins administrados por EC Audio a una carpeta de resguardo sin eliminarlos. Al confirmar acceso activo, los restaura. Un fallo temporal de red no provoca suspensión.

- API: [cloud/server/CUSTOMER-ACCOUNTS.md](cloud/server/CUSTOMER-ACCOUNTS.md)
- Despliegue: [cloud/DEPLOY_RENDER.md](cloud/DEPLOY_RENDER.md)
- Firebase: [docs/FIREBASE_SETUP.md](docs/FIREBASE_SETUP.md)

## Compilar apps macOS

Requiere Xcode 14+ y Swift 5.7+:

```sh
swift build -c release
```

GitHub Actions compila Intel + Apple Silicon y publica artefactos descargables cuando los cambios se integran en `main`.

## Estado de publicación

El código de integración Firebase está en desarrollo. El API Express necesita publicarse con HTTPS y almacenamiento persistente antes de que la sincronización de licencias funcione en vivo. El Blueprint de Render usa Starter y un disco persistente; revisa el costo antes de confirmar el despliegue. No se han creado servicios ni cargos.

El Client Hub usa correo/contraseña Firebase en esta fase. Google nativo requiere el OAuth Client ID de macOS. Los pagos comerciales no están implementados. Nunca subas tokens, contraseñas de administrador ni claves privadas al repositorio.