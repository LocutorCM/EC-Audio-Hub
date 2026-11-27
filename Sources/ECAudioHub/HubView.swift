import SwiftUI
import AppKit

struct HubView: View {
    @EnvironmentObject private var library: PluginLibrary
    @State private var showingAdd = false
    @State private var downloading: UUID?
    @State private var downloadedURL: URL?
    @State private var status = "Tu biblioteca está lista"
    @State private var showingError = false

    private let ink = Color(red: 0.07, green: 0.09, blue: 0.12)
    private let panel = Color(red: 0.11, green: 0.14, blue: 0.18)
    private let accent = Color(red: 0.95, green: 0.42, blue: 0.19)

    var body: some View {
        HStack(spacing: 0) {
            sidebar
            VStack(spacing: 0) {
                topbar
                if library.filtered.isEmpty { emptyState }
                else { pluginGrid }
                footer
            }
            .background(ink)
        }
        .background(ink)
        .preferredColorScheme(.dark)
        .sheet(isPresented: $showingAdd) { AddPluginView { library.add($0) } }
        .alert("EC Audio Hub", isPresented: $showingError) {
            Button("Aceptar", role: .cancel) { }
        } message: { Text(status) }
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
                ForEach(library.categories, id: \.self) { category in
                    Button { library.selectedCategory = category } label: {
                        HStack {
                            Image(systemName: category == "Todos" ? "square.grid.2x2" : "slider.horizontal.3")
                            Text(category)
                            Spacer()
                            if category == "Todos" { Text("\(library.plugins.count)").foregroundColor(.secondary) }
                        }
                        .font(.system(size: 13, weight: .medium))
                        .padding(.horizontal, 11).padding(.vertical, 9)
                        .background(library.selectedCategory == category ? Color.white.opacity(0.09) : .clear)
                        .foregroundColor(library.selectedCategory == category ? .white : .secondary)
                        .cornerRadius(8)
                    }.buttonStyle(.plain)
                }
            }
            Spacer()
            VStack(alignment: .leading, spacing: 6) {
                Text("EC AUDIO HUB").font(.system(size: 10, weight: .bold)).tracking(1.5)
                Text("Gestor personal de plugins").font(.system(size: 11)).foregroundColor(.secondary)
                Text("v1.0 • macOS 12+").font(.system(size: 10, design: .monospaced)).foregroundColor(.gray)
            }
        }
        .padding(22).frame(width: 225).background(panel)
    }

    private var topbar: some View {
        HStack {
            VStack(alignment: .leading, spacing: 4) {
                Text("Mis plugins").font(.system(size: 25, weight: .bold, design: .rounded))
                Text("Organiza y descarga tus herramientas de audio").font(.system(size: 12)).foregroundColor(.secondary)
            }
            Spacer()
            HStack(spacing: 8) {
                Image(systemName: "magnifyingglass").foregroundColor(.secondary)
                TextField("Buscar plugin...", text: $library.searchText).textFieldStyle(.plain).frame(width: 170)
            }
            .padding(10).background(panel).cornerRadius(9)
            Button { showingAdd = true } label: {
                Label("Agregar plugin", systemImage: "plus")
                    .font(.system(size: 12, weight: .semibold))
                    .padding(.horizontal, 14).padding(.vertical, 11)
                    .background(accent).foregroundColor(.white).cornerRadius(9)
            }.buttonStyle(.plain)
        }
        .padding(.horizontal, 28).padding(.vertical, 24)
    }

    private var pluginGrid: some View {
        ScrollView {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 245), spacing: 15)], spacing: 15) {
                ForEach(library.filtered) { plugin in
                    VStack(alignment: .leading, spacing: 13) {
                        HStack {
                            ZStack {
                                RoundedRectangle(cornerRadius: 10).fill(accent.opacity(0.16)).frame(width: 43, height: 43)
                                Image(systemName: "puzzlepiece.extension").font(.system(size: 19)).foregroundColor(accent)
                            }
                            Spacer()
                            Text(plugin.format.rawValue.uppercased()).font(.system(size: 9, weight: .bold, design: .monospaced))
                                .padding(.horizontal, 8).padding(.vertical, 5).background(.white.opacity(0.07)).cornerRadius(5)
                        }
                        VStack(alignment: .leading, spacing: 4) {
                            Text(plugin.name).font(.system(size: 16, weight: .bold))
                            Text(plugin.maker).font(.system(size: 12)).foregroundColor(.secondary)
                        }
                        HStack {
                            Text(plugin.category).font(.system(size: 10, weight: .medium)).foregroundColor(accent)
                            Spacer()
                            Text("v\(plugin.version)").font(.system(size: 10, design: .monospaced)).foregroundColor(.secondary)
                        }
                        Button {
                            Task {
                                downloading = plugin.id
                                defer { downloading = nil }
                                do {
                                    let url = try await library.download(plugin)
                                    downloadedURL = url
                                    status = "Descarga completada: \(url.lastPathComponent)"
                                } catch {
                                    status = "No se pudo descargar \(plugin.name): \(error.localizedDescription)"
                                    showingError = true
                                }
                            }
                        } label: {
                            HStack {
                                Spacer()
                                if downloading == plugin.id { ProgressView().scaleEffect(0.7) }
                                else { Image(systemName: "arrow.down.circle") }
                                Text(downloading == plugin.id ? "Descargando..." : "Descargar")
                                Spacer()
                            }
                            .font(.system(size: 12, weight: .semibold)).padding(10)
                            .background(accent.opacity(0.17)).foregroundColor(.white).cornerRadius(7)
                        }.buttonStyle(.plain).disabled(downloading != nil)
                    }
                    .padding(16).background(panel).overlay(RoundedRectangle(cornerRadius: 12).stroke(.white.opacity(0.06), lineWidth: 1)).cornerRadius(12)
                    .contextMenu {
                        Button("Mostrar en Finder") {
                            if let downloadedURL, downloadedURL.lastPathComponent == plugin.downloadURL.lastPathComponent {
                                NSWorkspace.shared.activateFileViewerSelecting([downloadedURL])
                            }
                        }
                        Button("Eliminar de mi biblioteca", role: .destructive) { library.remove(plugin) }
                    }
                }
            }.padding(.horizontal, 28).padding(.bottom, 24)
        }
    }

    private var emptyState: some View {
        VStack(spacing: 14) {
            Image(systemName: "square.stack.3d.up").font(.system(size: 42, weight: .light)).foregroundColor(accent)
            Text(library.plugins.isEmpty ? "Tu biblioteca comienza aquí" : "No se encontraron plugins")
                .font(.system(size: 21, weight: .bold, design: .rounded))
            Text(library.plugins.isEmpty ? "Agrega tus instaladores y enlaces oficiales para tenerlos organizados en un solo lugar." : "Prueba otra búsqueda o categoría.")
                .font(.system(size: 13)).foregroundColor(.secondary).multilineTextAlignment(.center).frame(maxWidth: 360)
            if library.plugins.isEmpty {
                Button("Agregar mi primer plugin") { showingAdd = true }
                    .padding(.horizontal, 16).padding(.vertical, 10).background(accent).cornerRadius(8)
            }
        }.frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var footer: some View {
        HStack {
            Circle().fill(Color.green).frame(width: 6, height: 6)
            Text(status).font(.system(size: 10)).foregroundColor(.secondary).lineLimit(1)
            Spacer()
            if let downloadedURL {
                Button("Abrir instalador") {
                    NSWorkspace.shared.open(downloadedURL)
                }
                .font(.system(size: 10, weight: .semibold))
                .buttonStyle(.plain).foregroundColor(accent)
            }
            Text("\(library.filtered.count) ELEMENTOS").font(.system(size: 9, weight: .bold, design: .monospaced)).tracking(1).foregroundColor(.secondary)
        }.padding(.horizontal, 28).padding(.vertical, 12).background(panel)
    }
}

private struct AddPluginView: View {
    @Environment(\.dismiss) private var dismiss
    let onSave: (Plugin) -> Void
    @State private var name = ""
    @State private var maker = ""
    @State private var version = "1.0"
    @State private var category = "Efectos"
    @State private var format: PluginFormat = .vst3
    @State private var url = ""
    @State private var notes = ""
    @State private var error = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Agregar plugin").font(.system(size: 22, weight: .bold, design: .rounded))
            Group {
                field("Nombre", text: $name)
                field("Fabricante", text: $maker)
                HStack { field("Versión", text: $version); field("Categoría", text: $category) }
                VStack(alignment: .leading, spacing: 6) {
                    Text("FORMATO").font(.system(size: 10, weight: .bold)).foregroundColor(.secondary)
                    Picker("Formato", selection: $format) { ForEach(PluginFormat.allCases) { Text($0.rawValue).tag($0) } }.labelsHidden()
                }
                field("URL de descarga HTTPS", text: $url)
                VStack(alignment: .leading, spacing: 6) {
                    Text("NOTAS").font(.system(size: 10, weight: .bold)).foregroundColor(.secondary)
                    TextEditor(text: $notes).frame(height: 65).padding(5).background(Color.black.opacity(0.2)).cornerRadius(7)
                }
            }
            if !error.isEmpty { Text(error).font(.system(size: 11)).foregroundColor(.red) }
            HStack {
                Spacer()
                Button("Cancelar") { dismiss() }.keyboardShortcut(.cancelAction)
                Button("Guardar plugin") { save() }.keyboardShortcut(.defaultAction).disabled(name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || maker.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || url.isEmpty)
            }
        }
        .padding(24).frame(width: 440).background(Color(red: 0.11, green: 0.14, blue: 0.18)).preferredColorScheme(.dark)
    }

    private func field(_ title: String, text: Binding<String>) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title.uppercased()).font(.system(size: 10, weight: .bold)).foregroundColor(.secondary)
            TextField(title, text: text).textFieldStyle(.roundedBorder)
        }
    }

    private func save() {
        guard let parsed = URL(string: url.trimmingCharacters(in: .whitespacesAndNewlines)),
              parsed.scheme?.lowercased() == "https", parsed.host != nil else {
            error = "Ingresa una URL HTTPS válida y segura."
            return
        }
        onSave(Plugin(name: name.trimmingCharacters(in: .whitespacesAndNewlines),
                      maker: maker.trimmingCharacters(in: .whitespacesAndNewlines),
                      version: version, format: format,
                      category: category.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "Otros" : category,
                      downloadURL: parsed, notes: notes))
        dismiss()
    }
}
