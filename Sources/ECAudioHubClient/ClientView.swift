import SwiftUI

struct ClientView: View {
    @EnvironmentObject private var library: ClientLibrary
    @Environment(\.scenePhase) private var scenePhase
    @State private var selectedSection = "Biblioteca"
    @State private var pluginToUninstall: String?

    private let navy = Color(hex: 0x0B1424)
    private let panel = Color(hex: 0x14243A)
    private let blue = Color(hex: 0x398BFF)
    private let cyan = Color(hex: 0x70C9F2)

    var body: some View {
        HStack(spacing: 0) {
            sidebar
            VStack(spacing: 0) {
                topBar
                ScrollView {
                    VStack(alignment: .leading, spacing: 22) {
                        hero
                        if selectedSection == "Biblioteca" {
                            catalog
                        } else {
                            installedSection
                        }
                    }
                    .padding(28)
                    .frame(maxWidth: 1050)
                    .frame(maxWidth: .infinity, alignment: .topLeading)
                }
                bottomBar
            }
            .background(navy)
        }
        .background(navy)
        .preferredColorScheme(.dark)
        .alert("EC Audio Hub Client", isPresented: Binding(
            get: { library.errorMessage != nil },
            set: { if !$0 { library.errorMessage = nil } }
        )) {
            Button("Aceptar", role: .cancel) { library.errorMessage = nil }
        } message: {
            Text(library.errorMessage ?? "")
        }
        .confirmationDialog("Desinstalar plugin", isPresented: Binding(
            get: { pluginToUninstall != nil },
            set: { if !$0 { pluginToUninstall = nil } }
        ), titleVisibility: .visible) {
            Button("Desinstalar", role: .destructive) {
                if let name = pluginToUninstall {
                    do { try library.uninstallBundle(at: name) }
                    catch { library.errorMessage = error.localizedDescription }
                }
                pluginToUninstall = nil
            }
            Button("Cancelar", role: .cancel) { pluginToUninstall = nil }
        } message: {
            Text("Se eliminará este bundle AU/VST3 de la carpeta de plugins de tu usuario, aunque no proceda de EC Audio Hub.")
        }
        .task {
            await library.refresh()
            while !Task.isCancelled {
                // Actualiza el catálogo automáticamente cada 10 segundos.
                try? await Task.sleep(nanoseconds: 10_000_000_000)
                if !Task.isCancelled { await library.refresh() }
            }
        }
        .onChange(of: scenePhase) { phase in
            // Al volver a abrir/activar la ventana, consulta inmediatamente el catálogo.
            if phase == .active {
                Task { await library.refresh() }
            }
        }
    }

    private var sidebar: some View {
        VStack(alignment: .leading, spacing: 24) {
            HStack(spacing: 11) {
                ZStack {
                    RoundedRectangle(cornerRadius: 12).fill(LinearGradient(colors: [blue, Color(hex: 0x2458B8)], startPoint: .topLeading, endPoint: .bottomTrailing))
                    Image(systemName: "waveform").font(.system(size: 21, weight: .bold)).foregroundColor(.white)
                }
                .frame(width: 42, height: 42)
                VStack(alignment: .leading, spacing: 2) {
                    Text("EC AUDIO").font(.system(size: 14, weight: .black, design: .rounded)).foregroundColor(.white)
                    Text("HUB CLIENT").font(.system(size: 9, weight: .bold, design: .monospaced)).tracking(1.2).foregroundColor(cyan)
                }
            }
            Rectangle().fill(Color.white.opacity(0.08)).frame(height: 1)
            VStack(alignment: .leading, spacing: 8) {
                sideButton("Biblioteca", icon: "square.grid.2x2.fill")
                sideButton("Instalados", icon: "checkmark.seal")
            }
            Spacer()
            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 7) {
                    Circle().fill(Color.green).frame(width: 7, height: 7)
                    Text("CENTRO DE DISTRIBUCIÓN").font(.system(size: 8, weight: .bold, design: .monospaced)).foregroundColor(.secondary)
                }
                Text("Tus herramientas de audio, siempre al día.")
                    .font(.system(size: 11)).foregroundColor(Color(hex: 0xA9BBD2)).fixedSize(horizontal: false, vertical: true)
            }
            .padding(13).background(panel.opacity(0.8)).cornerRadius(12)
            Text("EC AUDIO © 2026").font(.system(size: 8, weight: .medium, design: .monospaced)).foregroundColor(.gray)
        }
        .padding(18)
        .frame(width: 218)
        .background(Color(hex: 0x0E1B2D))
    }

    private var topBar: some View {
        HStack {
            VStack(alignment: .leading, spacing: 3) {
                Text(selectedSection.uppercased()).font(.system(size: 10, weight: .bold, design: .monospaced)).tracking(1.4).foregroundColor(cyan)
                Text(selectedSection == "Biblioteca" ? "Explora tus plugins" : "Tu colección instalada")
                    .font(.system(size: 21, weight: .bold, design: .rounded)).foregroundColor(.white)
            }
            Spacer()
            Button {
                Task { await library.refresh() }
            } label: {
                HStack(spacing: 8) {
                    if library.isRefreshing { ProgressView().scaleEffect(0.7) }
                    else { Image(systemName: "arrow.clockwise") }
                    Text(library.isRefreshing ? "Actualizando" : "Actualizar")
                }
                .font(.system(size: 11, weight: .semibold))
                .foregroundColor(.white)
                .padding(.horizontal, 14).padding(.vertical, 9)
                .background(panel).cornerRadius(9)
            }
            .buttonStyle(.plain)
            .disabled(library.isRefreshing)
        }
        .padding(.horizontal, 28).padding(.vertical, 18)
        .background(navy.opacity(0.96))
        .overlay(alignment: .bottom) { Rectangle().fill(Color.white.opacity(0.07)).frame(height: 1) }
    }

    private var hero: some View {
        ZStack(alignment: .leading) {
            RoundedRectangle(cornerRadius: 18)
                .fill(LinearGradient(colors: [Color(hex: 0x1A4C88), Color(hex: 0x17365D), Color(hex: 0x14243A)], startPoint: .topLeading, endPoint: .bottomTrailing))
            Circle().fill(cyan.opacity(0.12)).frame(width: 230, height: 230).blur(radius: 2).offset(x: 520, y: -55)
            Circle().stroke(Color.white.opacity(0.10), lineWidth: 1).frame(width: 190, height: 190).offset(x: 570, y: 22)
            HStack {
                VStack(alignment: .leading, spacing: 10) {
                    Text("EL SONIDO DE TU ESTUDIO, EN UN SOLO LUGAR")
                        .font(.system(size: 9, weight: .bold, design: .monospaced)).tracking(1.2).foregroundColor(Color(hex: 0xA9DDF7))
                    Text("Bienvenido a\nEC Audio Hub.")
                        .font(.system(size: 28, weight: .bold, design: .rounded)).foregroundColor(.white)
                    Text("Descarga, instala y mantén tus plugins actualizados.")
                        .font(.system(size: 12)).foregroundColor(Color(hex: 0xC5D8ED))
                }
                Spacer(minLength: 0)
                Image(systemName: "slider.horizontal.3")
                    .font(.system(size: 54, weight: .ultraLight))
                    .foregroundColor(Color.white.opacity(0.72))
                    .padding(.trailing, 28)
            }
            .padding(25)
        }
        .frame(height: 172)
        .clipShape(RoundedRectangle(cornerRadius: 18))
    }

    private var catalog: some View {
        VStack(alignment: .leading, spacing: 15) {
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Catálogo de plugins").font(.system(size: 18, weight: .bold, design: .rounded)).foregroundColor(.white)
                    Text("\(library.plugins.count) productos disponibles").font(.system(size: 11)).foregroundColor(.secondary)
                }
                Spacer()
                HStack(spacing: 8) {
                    Image(systemName: "magnifyingglass").foregroundColor(cyan)
                    TextField("Buscar plugin…", text: $library.searchText).textFieldStyle(.plain).font(.system(size: 11))
                        .frame(width: 170)
                }
                .padding(10).background(panel).cornerRadius(9)
            }

            if library.filteredPlugins.isEmpty {
                emptyState
            } else {
                LazyVStack(spacing: 10) {
                    ForEach(library.filteredPlugins) { plugin in
                        pluginCard(plugin)
                    }
                }
            }
        }
    }

    private var emptyState: some View {
        VStack(spacing: 12) {
            Image(systemName: "shippingbox").font(.system(size: 35, weight: .light)).foregroundColor(cyan)
            Text(library.isRefreshing ? "Consultando el catálogo…" : "Aún no hay plugins disponibles")
                .font(.system(size: 15, weight: .semibold)).foregroundColor(.white)
            Text(library.status).font(.system(size: 11)).foregroundColor(.secondary).multilineTextAlignment(.center)
            if !library.isRefreshing {
                Button("Volver a intentar") { Task { await library.refresh() } }
                    .buttonStyle(BlueButtonStyle())
            }
        }
        .frame(maxWidth: .infinity).padding(.vertical, 38)
        .background(panel.opacity(0.55)).cornerRadius(15)
    }

    private func pluginCard(_ plugin: HubPlugin) -> some View {
        let installed = library.installedVersion(for: plugin)
        let isUpdate = installed != nil && installed != plugin.version
        let isCurrent = installed == plugin.version
        let isBusy = library.downloadingIDs.contains(plugin.id)

        return HStack(spacing: 15) {
            ZStack {
                RoundedRectangle(cornerRadius: 12).fill(LinearGradient(colors: [Color(hex: 0x285E9C), Color(hex: 0x193453)], startPoint: .topLeading, endPoint: .bottomTrailing))
                if let imageURL = plugin.imageURL {
                    AsyncImage(url: imageURL) { phase in
                        if let image = phase.image {
                            image.resizable().scaledToFill()
                        } else {
                            Image(systemName: "waveform.path").font(.system(size: 22, weight: .medium)).foregroundColor(Color(hex: 0xB7E5FF))
                        }
                    }
                } else {
                    Image(systemName: "waveform.path").font(.system(size: 22, weight: .medium)).foregroundColor(Color(hex: 0xB7E5FF))
                }
            }
            .frame(width: 54, height: 54)
            .clipShape(RoundedRectangle(cornerRadius: 12))
            VStack(alignment: .leading, spacing: 5) {
                HStack(spacing: 8) {
                    Text(plugin.name).font(.system(size: 14, weight: .bold)).foregroundColor(.white)
                    if isUpdate { Text("ACTUALIZACIÓN").font(.system(size: 8, weight: .bold, design: .monospaced)).foregroundColor(Color(hex: 0x8CCFFF)).padding(.horizontal, 7).padding(.vertical, 4).background(blue.opacity(0.18)).cornerRadius(5) }
                }
                Text("Versión \(plugin.version)  ·  \(plugin.formatLabel)  ·  \(plugin.sizeLabel)")
                    .font(.system(size: 10, weight: .medium)).foregroundColor(Color(hex: 0x9EB1C8))
                if let installed {
                    Text("Instalado: \(installed)").font(.system(size: 9)).foregroundColor(isCurrent ? Color.green : cyan)
                }
            }
            Spacer()
            if isBusy {
                ProgressView().controlSize(.small).padding(.horizontal, 12)
            } else if isCurrent {
                Label("Instalado", systemImage: "checkmark.circle.fill")
                    .font(.system(size: 10, weight: .semibold)).foregroundColor(.green)
                    .padding(.horizontal, 12).padding(.vertical, 9)
                    .background(Color.green.opacity(0.10)).cornerRadius(8)
            } else {
                Button(isUpdate ? "Actualizar" : "Descargar") {
                    Task { await library.downloadAndInstall(plugin) }
                }
                .buttonStyle(BlueButtonStyle())
            }
        }
        .padding(14)
        .background(panel.opacity(0.82))
        .overlay(RoundedRectangle(cornerRadius: 13).stroke(Color.white.opacity(0.055), lineWidth: 1))
        .cornerRadius(13)
    }

    private var installedSection: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Plugins instalados").font(.system(size: 18, weight: .bold, design: .rounded)).foregroundColor(.white)
            if library.detectedInstalledPlugins.isEmpty {
                emptyState
            } else {
                ForEach(library.detectedInstalledPlugins) { plugin in
                    HStack {
                        Image(systemName: "checkmark.seal.fill").foregroundColor(.green)
                        VStack(alignment: .leading, spacing: 3) {
                            Text(plugin.name).font(.system(size: 13, weight: .semibold)).foregroundColor(.white)
                            Text(plugin.format + (plugin.version.map { " · Versión " + $0 } ?? " · Instalado en este Mac"))
                                .font(.system(size: 10)).foregroundColor(.secondary)
                            Text(plugin.path).font(.system(size: 9)).foregroundColor(Color(hex: 0x7188A4)).lineLimit(1)
                        }
                        Spacer()
                        Button("Desinstalar") { pluginToUninstall = plugin.path }
                            .font(.system(size: 10, weight: .semibold))
                            .foregroundColor(Color(hex: 0xFF9B9B))
                            .padding(.horizontal, 11).padding(.vertical, 7)
                            .background(Color.red.opacity(0.12)).cornerRadius(7)
                            .buttonStyle(.plain)
                    }
                    .padding(15).background(panel).cornerRadius(10)
                }
            }
            if library.updateCount > 0 {
                Text("\(library.updateCount) actualización(es) disponible(s).")
                    .font(.system(size: 11, weight: .semibold)).foregroundColor(cyan)
            }
        }
    }

    private var bottomBar: some View {
        HStack {
            HStack(spacing: 7) {
                Circle().fill(library.isRefreshing ? cyan : Color.green).frame(width: 6, height: 6)
                Text(library.status).lineLimit(1)
            }
            Spacer()
            Text("MACOS 12+  ·  INTEL & APPLE SILICON")
        }
        .font(.system(size: 9, weight: .medium, design: .monospaced))
        .foregroundColor(Color(hex: 0x8399B4))
        .padding(.horizontal, 22).padding(.vertical, 13)
        .background(Color(hex: 0x0E1B2D))
    }

    private func sideButton(_ title: String, icon: String) -> some View {
        Button { selectedSection = title } label: {
            HStack(spacing: 11) {
                Image(systemName: icon).frame(width: 18)
                Text(title)
                Spacer()
                if title == "Instalados", library.updateCount > 0 {
                    Text("\(library.updateCount)").font(.system(size: 9, weight: .bold)).foregroundColor(.white)
                        .padding(.horizontal, 6).padding(.vertical, 3).background(blue).cornerRadius(8)
                }
            }
            .font(.system(size: 12, weight: .semibold))
            .foregroundColor(selectedSection == title ? .white : Color(hex: 0x9EB1C8))
            .padding(.horizontal, 12).padding(.vertical, 11)
            .background(selectedSection == title ? blue.opacity(0.22) : Color.clear)
            .overlay(alignment: .leading) {
                if selectedSection == title { RoundedRectangle(cornerRadius: 2).fill(cyan).frame(width: 3) }
            }
            .cornerRadius(8)
        }
        .buttonStyle(.plain)
    }
}

struct BlueButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 10, weight: .bold))
            .foregroundColor(.white)
            .padding(.horizontal, 15).padding(.vertical, 9)
            .background(LinearGradient(colors: [Color(hex: 0x398BFF), Color(hex: 0x2869C9)], startPoint: .topLeading, endPoint: .bottomTrailing))
            .cornerRadius(8)
            .opacity(configuration.isPressed ? 0.78 : 1)
    }
}

extension Color {
    init(hex: UInt) {
        self.init(
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255
        )
    }
}
