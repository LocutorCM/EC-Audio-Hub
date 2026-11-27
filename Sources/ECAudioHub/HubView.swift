import SwiftUI
import AppKit

struct HubView: View {
    @EnvironmentObject private var uploader: UploadManager
    @State private var isFileHovering = false

    private let background = Color(red: 0.055, green: 0.067, blue: 0.09)
    private let panel = Color(red: 0.105, green: 0.125, blue: 0.16)
    private let orange = Color(red: 0.96, green: 0.39, blue: 0.18)

    var body: some View {
        VStack(spacing: 0) {
            header
            Rectangle().fill(Color.white.opacity(0.07)).frame(height: 1)
            if uploader.isAuthenticated {
                uploadWorkspace
            } else {
                loginWorkspace
            }
            footer
        }
        .background(background)
        .preferredColorScheme(.dark)
        .alert("EC Audio Hub", isPresented: Binding(
            get: { uploader.errorMessage != nil },
            set: { if !$0 { uploader.errorMessage = nil } }
        )) {
            Button("Aceptar", role: .cancel) { uploader.errorMessage = nil }
        } message: {
            Text(uploader.errorMessage ?? "")
        }
    }

    private var header: some View {
        HStack(spacing: 13) {
            ZStack {
                RoundedRectangle(cornerRadius: 12).fill(orange).frame(width: 44, height: 44)
                Image(systemName: "waveform").font(.system(size: 21, weight: .bold)).foregroundColor(.white)
            }
            VStack(alignment: .leading, spacing: 2) {
                Text("EC AUDIO").font(.system(size: 15, weight: .black, design: .rounded)).tracking(1.8)
                Text("HUB  /  ADMIN UPLOADER").font(.system(size: 9, weight: .bold, design: .monospaced)).tracking(1.5).foregroundColor(orange)
            }
            Spacer()
            if uploader.isAuthenticated {
                HStack(spacing: 7) {
                    Circle().fill(Color.green).frame(width: 7, height: 7)
                    Text("ADMIN CONECTADO").font(.system(size: 9, weight: .bold, design: .monospaced)).foregroundColor(.secondary)
                }
                Button("Cerrar sesión") { uploader.logout() }
                    .font(.system(size: 11, weight: .medium)).buttonStyle(.plain).foregroundColor(.secondary)
                    .padding(.leading, 10)
            }
        }
        .padding(.horizontal, 28).padding(.vertical, 21)
    }

    private var loginWorkspace: some View {
        VStack(alignment: .leading, spacing: 18) {
            Spacer()
            VStack(alignment: .leading, spacing: 7) {
                Text("PANEL PRIVADO").font(.system(size: 10, weight: .bold, design: .monospaced)).tracking(2).foregroundColor(orange)
                Text("Iniciar sesión").font(.system(size: 27, weight: .bold, design: .rounded))
                Text("Acceso exclusivo para administrar y subir archivos a EC Audio Cloud.")
                    .font(.system(size: 13)).foregroundColor(.secondary)
            }
            VStack(alignment: .leading, spacing: 13) {
                fieldLabel("SERVIDOR HTTPS")
                TextField("https://tu-servidor.com", text: $uploader.serverURL)
                    .textFieldStyle(.plain).padding(13).background(background).cornerRadius(8)
                fieldLabel("CORREO DEL ADMINISTRADOR")
                TextField("admin@tudominio.com", text: $uploader.email)
                    .textFieldStyle(.plain).padding(13).background(background).cornerRadius(8)
                fieldLabel("CONTRASEÑA")
                SecureField("Contraseña de administrador", text: $uploader.password)
                    .textFieldStyle(.plain).padding(13).background(background).cornerRadius(8)
                Button {
                    Task { await uploader.login() }
                } label: {
                    HStack {
                        Spacer()
                        if uploader.isConnecting { ProgressView().scaleEffect(0.75) }
                        Text(uploader.isConnecting ? "Conectando…" : "Conectar como administrador")
                        Image(systemName: "arrow.right")
                        Spacer()
                    }
                    .font(.system(size: 12, weight: .bold)).padding(13)
                    .background(orange).foregroundColor(.white).cornerRadius(9)
                }.buttonStyle(.plain).disabled(uploader.isConnecting)
            }
            .padding(20).background(panel).cornerRadius(14)
            Spacer()
        }
        .frame(maxWidth: 430)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(28)
    }

    private var uploadWorkspace: some View {
        VStack(alignment: .leading, spacing: 20) {
            VStack(alignment: .leading, spacing: 5) {
                Text("DISTRIBUCIÓN PRIVADA").font(.system(size: 10, weight: .bold, design: .monospaced)).tracking(2).foregroundColor(orange)
                Text("Subir archivos").font(.system(size: 27, weight: .bold, design: .rounded))
                Text("Selecciona un archivo de plugin o instalador y súbelo al almacenamiento privado.")
                    .font(.system(size: 13)).foregroundColor(.secondary)
            }
            Button {
                chooseFile()
            } label: {
                VStack(spacing: 14) {
                    ZStack {
                        RoundedRectangle(cornerRadius: 15).fill(orange.opacity(0.13)).frame(width: 68, height: 68)
                        Image(systemName: "arrow.up.doc.fill").font(.system(size: 27)).foregroundColor(orange)
                    }
                    Text(uploader.selectedFile == nil ? "Seleccionar archivo" : "Cambiar archivo")
                        .font(.system(size: 16, weight: .bold))
                    Text("VST3 · AU · AAX · PKG · DMG · ZIP · APP y más")
                        .font(.system(size: 10, weight: .medium, design: .monospaced)).foregroundColor(.secondary)
                    Text("Los bundles VST3 y AU se comprimen automáticamente en ZIP.")
                        .font(.system(size: 11)).foregroundColor(.secondary)
                }
                .frame(maxWidth: .infinity).frame(height: 205)
                .background(panel)
                .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(
                    uploader.selectedFile == nil ? Color.white.opacity(0.12) : orange.opacity(0.75),
                    style: StrokeStyle(lineWidth: 1, dash: [6, 5])
                ))
                .cornerRadius(14)
            }.buttonStyle(.plain).disabled(uploader.isUploading)

            if let file = uploader.selectedFile {
                HStack(spacing: 12) {
                    Image(systemName: "doc.zipper").font(.system(size: 23)).foregroundColor(orange)
                    VStack(alignment: .leading, spacing: 4) {
                        Text(file.lastPathComponent).font(.system(size: 12, weight: .semibold)).lineLimit(1)
                        Text(fileSize(file)).font(.system(size: 10, design: .monospaced)).foregroundColor(.secondary)
                    }
                    Spacer()
                    Button { uploader.clearFile() } label: {
                        Image(systemName: "xmark.circle.fill").foregroundColor(.secondary)
                    }.buttonStyle(.plain)
                }
                .padding(13).background(panel).cornerRadius(9)
            }

            Button {
                Task { await uploader.uploadSelectedFile() }
            } label: {
                HStack(spacing: 9) {
                    if uploader.isUploading { ProgressView().scaleEffect(0.75) }
                    else { Image(systemName: "icloud.and.arrow.up.fill") }
                    Text(uploader.isUploading ? "Subiendo archivo…" : "SUBIR ARCHIVO AL SERVIDOR")
                }
                .font(.system(size: 12, weight: .bold)).tracking(0.5)
                .frame(maxWidth: .infinity).padding(14)
                .background(uploader.selectedFile == nil || uploader.isUploading ? Color.gray.opacity(0.25) : orange)
                .foregroundColor(.white).cornerRadius(9)
            }
            .buttonStyle(.plain)
            .disabled(uploader.selectedFile == nil || uploader.isUploading)

            HStack(spacing: 8) {
                Circle().fill(uploader.isUploading ? orange : Color.green).frame(width: 7, height: 7)
                Text(uploader.status).font(.system(size: 11)).foregroundColor(.secondary)
            }
            if !uploader.lastUploaded.isEmpty {
                Label("Último archivo subido: \(uploader.lastUploaded)", systemImage: "checkmark.circle.fill")
                    .font(.system(size: 10)).foregroundColor(.green).lineLimit(1)
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 42).padding(.top, 30).padding(.bottom, 24)
        .frame(maxWidth: 650).frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var footer: some View {
        HStack {
            Text("EC AUDIO  •  PRIVATE ADMIN TOOL")
            Spacer()
            Text("macOS 12+  •  INTEL & APPLE SILICON")
        }
        .font(.system(size: 9, weight: .medium, design: .monospaced))
        .foregroundColor(.gray)
        .padding(.horizontal, 28).padding(.vertical, 13)
        .background(panel.opacity(0.65))
    }

    private func fieldLabel(_ value: String) -> some View {
        Text(value).font(.system(size: 9, weight: .bold, design: .monospaced)).tracking(1.2).foregroundColor(.secondary)
    }

    private func chooseFile() {
        let panel = NSOpenPanel()
        panel.title = "Seleccionar archivo para EC Audio Cloud"
        panel.message = "Elige el archivo del plugin o instalador que deseas subir."
        panel.canChooseFiles = true
        panel.canChooseDirectories = true
        panel.allowsMultipleSelection = false
        panel.prompt = "Seleccionar"
        if panel.runModal() == .OK, let url = panel.url {
            uploader.selectFile(url)
        }
    }

    private func fileSize(_ url: URL) -> String {
        let values = try? FileManager.default.attributesOfItem(atPath: url.path)
        if let type = values?[.type] as? FileAttributeType, type == .typeDirectory {
            let enumerator = FileManager.default.enumerator(at: url, includingPropertiesForKeys: [.fileSizeKey], options: [.skipsHiddenFiles])
            var total: Int64 = 0
            while let item = enumerator?.nextObject() as? URL {
                if let size = try? item.resourceValues(forKeys: [.fileSizeKey]).fileSize { total += Int64(size) }
            }
            return ByteCountFormatter.string(fromByteCount: total, countStyle: .file)
        }
        guard let size = values?[.size] as? NSNumber else { return "Tamaño desconocido" }
        let bytes = size.int64Value
        if bytes >= 1_073_741_824 { return String(format: "%.2f GB", Double(bytes) / 1_073_741_824) }
        if bytes >= 1_048_576 { return String(format: "%.1f MB", Double(bytes) / 1_048_576) }
        return String(format: "%.0f KB", Double(bytes) / 1024)
    }
}
