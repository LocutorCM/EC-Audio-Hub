import SwiftUI
import AppKit
import UniformTypeIdentifiers

struct HubView: View {
    @State private var releaseToDelete: AdminRelease?
    @EnvironmentObject private var uploader: UploadManager
    private let bg = Color(red: 0.035, green: 0.039, blue: 0.070)
    private let panel = Color(red: 0.075, green: 0.085, blue: 0.135)
    private let lime = Color(red: 0.78, green: 1.0, blue: 0.37)
    private let violet = Color(red: 0.65, green: 0.55, blue: 1.0)

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 12) {
                Image(systemName: "waveform").font(.system(size: 24, weight: .bold)).foregroundColor(bg)
                    .frame(width: 46, height: 46).background(LinearGradient(colors: [lime, violet], startPoint: .topLeading, endPoint: .bottomTrailing)).cornerRadius(14)
                VStack(alignment: .leading, spacing: 3) {
                    Text("EC AUDIO").font(.system(size: 15, weight: .black, design: .rounded))
                    Text("PRIVATE PLUGIN DISTRIBUTION").font(.system(size: 9, weight: .bold, design: .monospaced)).foregroundColor(lime)
                }
                Spacer()
                if uploader.isAuthenticated {
                    Label("GITHUB CONECTADO", systemImage: "checkmark.circle.fill").font(.system(size: 9, weight: .bold, design: .monospaced)).foregroundColor(.green)
                    Button("Desconectar") { uploader.logout() }.buttonStyle(.plain).foregroundColor(.secondary)
                }
            }.padding(24)
            Rectangle().fill(Color.white.opacity(0.08)).frame(height: 1)
            if uploader.isAuthenticated { publisher } else { connection }
            HStack {
                Text("EC AUDIO • ADMINISTRADOR PRIVADO")
                Spacer()
                Text("macOS 12+ • INTEL & APPLE SILICON")
            }.font(.system(size: 9, weight: .medium, design: .monospaced)).foregroundColor(.gray)
                .padding(18).background(panel.opacity(0.6))
        }
        .background(bg).preferredColorScheme(.dark)
        .frame(minWidth: 760, minHeight: 600)
        .task { if uploader.isAuthenticated { await uploader.refreshReleases() } }
        .confirmationDialog("Eliminar publicación", isPresented: Binding(get: { releaseToDelete != nil }, set: { if !$0 { releaseToDelete = nil } }), titleVisibility: .visible) {
            Button("Eliminar definitivamente", role: .destructive) {
                if let item = releaseToDelete { Task { await uploader.deleteRelease(item) } }
                releaseToDelete = nil
            }
            Button("Cancelar", role: .cancel) { releaseToDelete = nil }
        } message: { Text("Se eliminará únicamente esta publicación y sus archivos de GitHub. Las demás publicaciones, aunque tengan el mismo nombre, permanecerán disponibles.") }
        .alert("EC Audio Hub", isPresented: Binding(get: { uploader.errorMessage != nil }, set: { if !$0 { uploader.errorMessage = nil } })) {
            Button("Aceptar", role: .cancel) { uploader.errorMessage = nil }
        } message: { Text(uploader.errorMessage ?? "") }
    }

    private var connection: some View {
        VStack(alignment: .leading, spacing: 16) {
            Spacer()
            Text("PANEL PRIVADO").font(.system(size: 10, weight: .bold, design: .monospaced)).foregroundColor(lime)
            Text("Conectar con GitHub").font(.system(size: 28, weight: .bold, design: .rounded))
            Text("El programa publicará cada plugin como un GitHub Release. El token se guarda en el Llavero de macOS y nunca se incluye en EC Audio Hub Client.")
                .font(.system(size: 13)).foregroundColor(.secondary)
            VStack(alignment: .leading, spacing: 11) {
                label("PROPIETARIO")
                TextField("LocutorCM", text: $uploader.repositoryOwner).textFieldStyle(.plain).padding(12).background(bg).cornerRadius(8)
                label("REPOSITORIO")
                TextField("EC-Audio-Hub", text: $uploader.repositoryName).textFieldStyle(.plain).padding(12).background(bg).cornerRadius(8)
                label("PERSONAL ACCESS TOKEN")
                SecureField("github_pat_…", text: $uploader.githubToken).textFieldStyle(.plain).padding(12).background(bg).cornerRadius(8)
                Text("Permiso requerido: Contents → Read and write. Limita el token a este repositorio y no lo compartas.")
                    .font(.system(size: 10)).foregroundColor(.secondary)
                Button { Task { await uploader.connectGitHub() } } label: {
                    HStack { Spacer(); if uploader.isConnecting { ProgressView().scaleEffect(0.75) }; Text(uploader.isConnecting ? "Verificando…" : "CONECTAR GITHUB"); Image(systemName: "arrow.right"); Spacer() }
                        .font(.system(size: 12, weight: .bold)).padding(14).background(LinearGradient(colors: [lime, violet], startPoint: .leading, endPoint: .trailing)).foregroundColor(bg).cornerRadius(11)
                }.buttonStyle(.plain).disabled(uploader.isConnecting)
            }.padding(20).background(panel).cornerRadius(14)
            Spacer()
        }.frame(maxWidth: 470).frame(maxWidth: .infinity, maxHeight: .infinity).padding(30)
    }

    private var publisher: some View {
        VStack(alignment: .leading, spacing: 14) {
            VStack(alignment: .leading, spacing: 5) {
                Text("PUBLICAR NUEVA VERSIÓN").font(.system(size: 10, weight: .bold, design: .monospaced)).foregroundColor(lime)
                Text("Distribución de plugins").font(.system(size: 27, weight: .bold, design: .rounded))
                Text("Solo aparecerán aquí los plugins publicados desde este Admin Hub. Los cambios y archivos subidos directamente al repositorio no se mostrarán en esta lista.")
                    .font(.system(size: 12)).foregroundColor(.secondary)
            }
            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 7) {
                    label("NOMBRE DEL PLUGIN")
                    TextField("EC Air", text: $uploader.pluginName).textFieldStyle(.plain).padding(11).background(panel).cornerRadius(8)
                }
                VStack(alignment: .leading, spacing: 7) {
                    label("VERSIÓN")
                    TextField("1.0.0", text: $uploader.version).textFieldStyle(.plain).padding(11).background(panel).cornerRadius(8)
                }.frame(width: 130)
            }
            Button { chooseFile() } label: {
                VStack(spacing: 10) {
                    Image(systemName: "icloud.and.arrow.up").font(.system(size: 34)).foregroundColor(lime)
                    Text(uploader.selectedFile?.lastPathComponent ?? "Seleccionar plugin o instalador").font(.system(size: 15, weight: .bold))
                    Text("VST3 • AU • AAX • PKG • DMG • ZIP • APP").font(.system(size: 10, design: .monospaced)).foregroundColor(.secondary)
                    Text("Puedes seleccionar una carpeta VST3/AU; se comprimirá en ZIP.").font(.system(size: 10)).foregroundColor(.secondary)
                }.frame(maxWidth: .infinity).frame(height: 155).background(panel)
                    .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color.white.opacity(0.13), style: StrokeStyle(lineWidth: 1, dash: [6, 5]))).cornerRadius(12)
            }
            .buttonStyle(.plain)
            .disabled(uploader.isUploading)
            .onDrop(of: [UTType.fileURL], isTargeted: nil) { providers in
                handleFileDrop(providers)
            }
            HStack(spacing: 10) {
                Button { chooseArtwork() } label: {
                    Label(uploader.selectedArtwork?.lastPathComponent ?? "Añadir imagen ilustrativa", systemImage: "photo")
                        .font(.system(size: 11, weight: .semibold)).foregroundColor(violet)
                }.buttonStyle(.plain)
                if uploader.selectedArtwork != nil {
                    Button("Quitar imagen") { uploader.clearArtwork() }.buttonStyle(.plain).foregroundColor(.secondary)
                }
            }
            if let file = uploader.selectedFile {
                HStack {
                    Label(file.lastPathComponent, systemImage: "doc.zipper").lineLimit(1)
                    Spacer()
                    Button("Quitar") { uploader.clearFile() }.buttonStyle(.plain).foregroundColor(.secondary)
                }.font(.system(size: 11)).padding(10).background(panel).cornerRadius(8)
            }
            Button { Task { await uploader.uploadSelectedFile() } } label: {
                HStack { Spacer(); if uploader.isUploading { ProgressView().scaleEffect(0.75) } else { Image(systemName: "shippingbox.fill") }; Text(uploader.isUploading ? "PUBLICANDO…" : "PUBLICAR EN GITHUB RELEASES"); Spacer() }
                    .font(.system(size: 12, weight: .bold)).padding(14)
                    .background(uploader.selectedFile == nil || uploader.isUploading ? Color.gray.opacity(0.25) : lime).foregroundColor(bg).cornerRadius(11)
            }.buttonStyle(.plain).disabled(uploader.selectedFile == nil || uploader.isUploading)
            HStack(spacing: 8) {
                Circle().fill(uploader.isUploading ? lime : Color.green).frame(width: 7, height: 7)
                Text(uploader.status).font(.system(size: 11)).foregroundColor(.secondary)
            }
            if !uploader.lastUploaded.isEmpty {
                Label("Último publicado: \(uploader.lastUploaded)", systemImage: "checkmark.circle.fill").font(.system(size: 10)).foregroundColor(.green)
            }
            Divider().overlay(Color.white.opacity(0.08))
            HStack {
                Text("PUBLICACIONES DEL ADMIN HUB").font(.system(size: 10, weight: .bold, design: .monospaced)).foregroundColor(lime)
                Spacer()
                Button { Task { await uploader.refreshReleases() } } label: { Image(systemName: "arrow.clockwise") }.buttonStyle(.plain)
            }
            ForEach(uploader.releases) { release in
                HStack {
                    VStack(alignment: .leading, spacing: 3) {
                        Text(release.name ?? release.tagName).font(.system(size: 11, weight: .semibold)).foregroundColor(.white)
                        Text(release.tagName + " · " + String(release.assets.count) + " archivo(s)").font(.system(size: 9, design: .monospaced)).foregroundColor(.secondary)
                    }
                    Spacer()
                    Button(role: .destructive) { releaseToDelete = release } label: {
                        Image(systemName: "trash").foregroundColor(.red).padding(8).background(Color.red.opacity(0.1)).cornerRadius(7)
                    }.buttonStyle(.plain)
                }.padding(9).background(panel).cornerRadius(8)
            }
            Spacer(minLength: 0)
        }.padding(32).frame(maxWidth: 680).frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func handleFileDrop(_ providers: [NSItemProvider]) -> Bool {
        guard !uploader.isUploading,
              let provider = providers.first(where: { $0.hasItemConformingToTypeIdentifier(UTType.fileURL.identifier) }) else {
            return false
        }
        provider.loadItem(forTypeIdentifier: UTType.fileURL.identifier, options: nil) { item, _ in
            let url: URL?
            if let value = item as? URL {
                url = value
            } else if let data = item as? Data {
                url = URL(dataRepresentation: data, relativeTo: nil)
            } else {
                url = nil
            }
            guard let url else { return }
            Task { @MainActor in uploader.selectFile(url) }
        }
        return true
    }

    private func label(_ text: String) -> some View {
        Text(text).font(.system(size: 9, weight: .bold, design: .monospaced)).foregroundColor(.secondary)
    }
    private func chooseArtwork() {
        let panel = NSOpenPanel()
        panel.title = "Seleccionar imagen del plugin"
        panel.allowedContentTypes = [.png, .jpeg, .webP]
        panel.canChooseFiles = true
        panel.canChooseDirectories = false
        panel.allowsMultipleSelection = false
        if panel.runModal() == .OK, let url = panel.url { uploader.selectArtwork(url) }
    }
    private func chooseFile() {
        let panel = NSOpenPanel()
        panel.title = "Seleccionar plugin para publicar"
        panel.canChooseFiles = true
        panel.canChooseDirectories = true
        panel.allowsMultipleSelection = false
        panel.prompt = "Seleccionar"
        if panel.runModal() == .OK, let url = panel.url { uploader.selectFile(url) }
    }
}