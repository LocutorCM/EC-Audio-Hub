import SwiftUI
import AppKit

struct HubView: View {
    @EnvironmentObject private var cloud: CloudSyncManager
    @State private var showingSettings = false
    @State private var downloading: String?
    @State private var message: String?
    @State private var showError = false

    private let ink = Color(red: 0.07, green: 0.09, blue: 0.12)
    private let panel = Color(red: 0.11, green: 0.14, blue: 0.18)
    private let accent = Color(red: 0.95, green: 0.42, blue: 0.19)

    var body: some View {
        HStack(spacing: 0) {
            sidebar
            VStack(spacing: 0) {
                topbar
                if cloud.filtered.isEmpty { emptyState } else { pluginGrid }
                footer
            }.background(ink)
        }
        .background(ink).preferredColorScheme(.dark)
        .sheet(isPresented: $showingSettings) { CloudConnectionView().environmentObject(cloud) }
        .alert("EC Audio Hub", isPresented: $showError) {
            Button("Aceptar", role: .cancel) { }
        } message: { Text(message ?? "") }
    }

    private var sidebar: some View {
        VStack(alignment: .leading, spacing: 26) {
            HStack(spacing: 10) {
                ZStack {
                    RoundedRectangle(cornerRadius: 11).fill(accent).frame(width: 38, height: 38)
                    Image(systemName: "waveform").font(.system(size: 18, weight: .bold)).foregroundColor(.white)
                }
                VStack(alignment: .leading, spacing: 1) {
                    Text("EC AUDIO").font(.system(size: 14, weight: .black, design: .rounded)).tracking(1.4)
                    Text("HUB").font(.system(size: 10, weight: .bold)).tracking(3).foregroundColor(accent)
                }
            }
            VStack(alignment: .leading, spacing: 8) {
                Text("LIBRERÍA").font(.system(size: 10, weight: .bold)).tracking(2).foregroundColor(.secondary)
                ForEach(cloud.categories, id: \.self) { category in
                    Button { cloud.selectedCategory = category } label: {
                        HStack {
                            Image(systemName: category == "Todos" ? "square.grid.2x2" : "slider.horizontal.3")
                            Text(category); Spacer()
                            if category == "Todos" { Text("\(cloud.plugins.count)").foregroundColor(.secondary) }
                        }
                        .font(.system(size: 13, weight: .medium)).padding(.horizontal, 11).padding(.vertical, 9)
                        .background(cloud.selectedCategory == category ? Color.white.opacity(0.09) : .clear)
                        .foregroundColor(cloud.selectedCategory == category ? .white : .secondary).cornerRadius(8)
                    }.buttonStyle(.plain)
                }
            }
            Spacer()
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 7) {
                    Circle().fill(cloud.isOnline ? Color.green : Color.orange).frame(width: 7, height: 7)
                    Text(cloud.isOnline ? "CLOUD ONLINE" : "MODO OFFLINE").font(.system(size: 9, weight: .bold, design: .monospaced))
                }
                Text("Los instaladores guardados funcionan sin internet.").font(.system(size: 10)).foregroundColor(.secondary).fixedSize(horizontal: false, vertical: true)
                Text("v2.0 • macOS 12+").font(.system(size: 10, design: .monospaced)).foregroundColor(.gray)
            }
        }.padding(22).frame(width: 225).background(panel)
    }

    private var topbar: some View {
        HStack {
            VStack(alignment: .leading, spacing: 4) {
                Text("Plugin library").font(.system(size: 25, weight: .bold, design: .rounded))
                Text(cloud.status).font(.system(size: 12)).foregroundColor(.secondary)
            }
            Spacer()
            HStack(spacing: 8) {
                Image(systemName: "magnifyingglass").foregroundColor(.secondary)
                TextField("Buscar plugin...", text: $cloud.searchText).textFieldStyle(.plain).frame(width: 170)
            }.padding(10).background(panel).cornerRadius(9)
            Button { Task { do { try await cloud.syncCatalog() } catch { message = error.localizedDescription; showError = true } } } label: {
                Label("Sync", systemImage: cloud.isSyncing ? "arrow.triangle.2.circlepath" : "arrow.clockwise")
                    .font(.system(size: 11, weight: .semibold)).padding(10).background(panel).cornerRadius(8)
            }.buttonStyle(.plain).disabled(cloud.isSyncing || !cloud.isAuthenticated)
            Button { showingSettings = true } label: {
                Label(cloud.isAuthenticated ? "Cuenta" : "Conectar", systemImage: "cloud")
                    .font(.system(size: 12, weight: .semibold)).padding(.horizontal, 14).padding(.vertical, 11)
                    .background(accent).foregroundColor(.white).cornerRadius(9)
            }.buttonStyle(.plain)
        }.padding(.horizontal, 28).padding(.vertical, 24)
    }

    private var pluginGrid: some View {
        ScrollView {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 245), spacing: 15)], spacing: 15) {
                ForEach(cloud.filtered) { plugin in
                    VStack(alignment: .leading, spacing: 13) {
                        HStack {
                            ZStack {
                                RoundedRectangle(cornerRadius: 10).fill(accent.opacity(0.16)).frame(width: 43, height: 43)
                                Image(systemName: "puzzlepiece.extension").font(.system(size: 19)).foregroundColor(accent)
                            }
                            Spacer()
                            Text(plugin.category.uppercased()).font(.system(size: 9, weight: .bold, design: .monospaced))
                                .padding(.horizontal, 8).padding(.vertical, 5).background(.white.opacity(0.07)).cornerRadius(5)
                        }
                        VStack(alignment: .leading, spacing: 4) {
                            Text(plugin.name).font(.system(size: 16, weight: .bold))
                            Text(plugin.manufacturer).font(.system(size: 12)).foregroundColor(.secondary)
                        }
                        Text(plugin.description.isEmpty ? "Official EC Audio release" : plugin.description)
                            .font(.system(size: 11)).foregroundColor(.secondary).lineLimit(2).frame(height: 30, alignment: .topLeading)
                        HStack {
                            Text("v\(plugin.version)").font(.system(size: 10, design: .monospaced)).foregroundColor(.secondary)
                            Spacer()
                            Text(plugin.formattedSize).font(.system(size: 10, design: .monospaced)).foregroundColor(.secondary)
                            if plugin.isCached {
                                Label("OFFLINE", systemImage: "checkmark.circle.fill").font(.system(size: 9, weight: .bold)).foregroundColor(.green)
                            }
                        }
                        Button {
                            Task {
                                downloading = plugin.id
                                defer { downloading = nil }
                                do {
                                    let file = try await cloud.download(plugin)
                                    NSWorkspace.shared.activateFileViewerSelecting([file])
                                    message = plugin.isCached ? "Instalador disponible en este Mac." : "Descarga guardada para uso sin conexión."
                                } catch { message = error.localizedDescription; showError = true }
                            }
                        } label: {
                            HStack {
                                Spacer()
                                if downloading == plugin.id { ProgressView().scaleEffect(0.7) }
                                else { Image(systemName: plugin.isCached ? "folder" : "arrow.down.circle") }
                                Text(downloading == plugin.id ? "Descargando..." : plugin.isCached ? "Abrir instalador guardado" : "Descargar instalador")
                                Spacer()
                            }.font(.system(size: 11, weight: .semibold)).padding(10)
                                .background(accent.opacity(0.17)).foregroundColor(.white).cornerRadius(7)
                        }.buttonStyle(.plain).disabled(downloading != nil || (!cloud.isOnline && !plugin.isCached))
                    }
                    .padding(16).background(panel)
                    .overlay(RoundedRectangle(cornerRadius: 12).stroke(.white.opacity(0.06), lineWidth: 1)).cornerRadius(12)
                }
            }.padding(.horizontal, 28).padding(.bottom, 24)
        }
    }

    private var emptyState: some View {
        VStack(spacing: 14) {
            Image(systemName: "cloud.slash").font(.system(size: 42, weight: .light)).foregroundColor(accent)
            Text(cloud.isAuthenticated ? "Tu catálogo está vacío" : "Conecta con EC Audio Cloud")
                .font(.system(size: 21, weight: .bold, design: .rounded))
            Text(cloud.isAuthenticated ? "Cuando publiques plugins desde tu consola de administrador, aparecerán aquí." : "Inicia sesión para descargar el catálogo. Después podrás utilizar los instaladores guardados incluso sin internet.")
                .font(.system(size: 13)).foregroundColor(.secondary).multilineTextAlignment(.center).frame(maxWidth: 360)
            Button { showingSettings = true } label: {
                Label("Configurar conexión", systemImage: "link").font(.system(size: 12, weight: .semibold))
                    .padding(.horizontal, 14).padding(.vertical, 10).background(accent).foregroundColor(.white).cornerRadius(8)
            }.buttonStyle(.plain)
        }.frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var footer: some View {
        HStack {
            Text("© EC AUDIO · OFFICIAL PLUGIN DISTRIBUTION")
            Spacer()
            Text(cloud.isOnline ? "● ONLINE · LIVE CATALOG" : "● OFFLINE · LOCAL CACHE")
        }.font(.system(size: 9, design: .monospaced)).foregroundColor(.secondary)
            .padding(.horizontal, 28).padding(.vertical, 15)
    }
}

struct CloudConnectionView: View {
    @EnvironmentObject private var cloud: CloudSyncManager
    @Environment(\.dismiss) private var dismiss
    @State private var url: String
    @State private var email = ""
    @State private var password = ""
    @State private var busy = false
    @State private var errorText: String?

    init() { _url = State(initialValue: UserDefaults.standard.string(forKey: "ECAudioCloudURL") ?? "") }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text("EC AUDIO CLOUD").font(.system(size: 10, weight: .bold, design: .monospaced)).tracking(2).foregroundColor(.orange)
                    Text("Conexión y cuenta").font(.system(size: 22, weight: .bold, design: .rounded))
                }
                Spacer()
                Button("Cerrar") { dismiss() }.buttonStyle(.plain)
            }
            Text("Servidor HTTPS").font(.system(size: 11, weight: .semibold))
            TextField("https://hub.tudominio.com", text: $url).textFieldStyle(.roundedBorder)
            if cloud.isAuthenticated {
                Label("Sesión iniciada", systemImage: "checkmark.seal.fill").foregroundColor(.green)
                Text("Tu catálogo y los instaladores descargados permanecen guardados localmente.").font(.system(size: 11)).foregroundColor(.secondary)
                Button("Cerrar sesión", role: .destructive) { cloud.logout(); dismiss() }
            } else {
                Text("Correo electrónico").font(.system(size: 11, weight: .semibold))
                TextField("cliente@correo.com", text: $email).textFieldStyle(.roundedBorder)
                Text("Contraseña").font(.system(size: 11, weight: .semibold))
                SecureField("Contraseña de tu cuenta", text: $password).textFieldStyle(.roundedBorder)
                Button {
                    Task {
                        busy = true; errorText = nil
                        do { try await cloud.login(email: email, password: password, baseURL: url); dismiss() }
                        catch { errorText = error.localizedDescription }
                        busy = false
                    }
                } label: {
                    HStack { if busy { ProgressView().scaleEffect(0.7) }; Text(busy ? "Conectando..." : "Iniciar sesión") }
                        .frame(maxWidth: .infinity).padding(10).background(Color.orange).foregroundColor(.white).cornerRadius(8)
                }.buttonStyle(.plain).disabled(busy || email.isEmpty || password.isEmpty || url.isEmpty)
            }
            if let errorText { Text(errorText).font(.system(size: 11)).foregroundColor(.red) }
            Text("Se requiere conexión para iniciar sesión por primera vez y descargar plugins nuevos. Los archivos guardados se pueden abrir sin internet.")
                .font(.system(size: 10)).foregroundColor(.secondary).fixedSize(horizontal: false, vertical: true)
        }.padding(24).frame(width: 440).background(Color(red: 0.09, green: 0.11, blue: 0.14))
    }
}
