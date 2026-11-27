# EC Audio Cloud

Cloud source for the EC Audio Hub owner console and customer catalog.

## Architecture
- **Owner console:** authenticated AppDeploy account with the platform's automatic `owner` role. All write endpoints require `requireAuth()` and `requireRole('admin')`; the owner inherits admin access.
- **Customer library:** signed-in customers can read only published releases and request signed download URLs.
- **Private installer storage:** installer bytes are uploaded in 450 KiB chunks to private AppDeploy storage. Metadata is kept in the app database; installers are not exposed as public static files.
- **Live catalog:** clients subscribe to the `catalog/main` entity over WebSockets. Admin changes send `entity.update` events.
- **Large downloads:** the client retrieves short-lived signed URLs for each chunk and assembles the original file locally.

## Source layout
- `backend/index.ts`: API, role checks, uploads, release CRUD, signed downloads, realtime subscriptions.
- `backend/realtime.ts`: removes dead subscriptions when sockets disconnect.
- `src/App.tsx`: owner and customer web experience.
- `src/index.css`: EC Audio visual system.

## Publishing workflow
1. Owner signs in with the same verified email as the AppDeploy app owner.
2. Owner adds plugin details and selects the installer.
3. Browser sends 450 KiB chunks; server stores them privately.
4. Publish creates or updates a release record and broadcasts a catalog event.
5. Customers see published changes live and download via signed URLs.

## Security boundaries
- Never trust client-side role flags. Backend write routes use server-side role middleware.
- Customer catalog and download endpoints require authentication.
- Draft/unpublished releases are omitted from customer catalog and cannot be downloaded.
- Download URLs are signed and short-lived.
- Delete hides a release; it does not erase historical installer bytes.
- AppDeploy platform authentication, database, storage and realtime services are required.

## Deployment
Deploy this source as an AppDeploy **frontend + backend** React/Vite app with realtime enabled. The AppDeploy account used for deployment must have an active deployment window. This repository contains source only; no live endpoint is configured until deployment succeeds.
