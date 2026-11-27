import SwiftUI

struct HubView: View {
    @EnvironmentObject private var library: PluginLibrary
    @State private var searchText = ""
    @State private var selectedSection = "Todos"
    @State private var showingAddPlugin = false
    private let accent = Color(red: 0.28, green: 0.91, blue: 0.69)
    private let sections = ["Todos", "Ecualizadores", "Compresores", "Reverb", "Delay", "Otros"]

    private var filteredPlugins: [AudioPlugin] {
        let selected = selectedSection == "Todos" ? library.plugins :
            library.plugins.filter { $0.category.localizedCaseInsensitiveCompare(selectedSection) == .orderedSame }
        guard !searchText.isEmpty else { return selected }
        return selected.filter {
            $0.name.localizedCaseInsensitiveContains(searchText) ||
            $0.manufacturer.localizedCaseInsensitiveContains(searchText) ||
            $0.format.localizedCaseInsensitiveContains(searchText)
        }
    }

    var body: some View {
        HStack(spacing: 0) {
            sidebar
            Rectangle().fill(Color.white.opacity(0.08)).frame(width: 1)
            mainPanel
        }
        .background(Color(red: 0.055, green: 0.065, blue: 0.075))
        .sheet(isPresented: $showingAddPlugin) {
            AddPluginView { plugin in library.add(plugin) }
        }
    }

    private var sidebar: some View {
        VStack(alignment: .leading, spacing: 24) {
            HStack(spacing: 11) {
                ZStack {
                    RoundedRectangle(cornerRadius: 10).fill(accent).frame(width: 38, height: 38)
                    Image(systemName: "waveform").font(.system(size: 19, weight: .bold)).foregroundColor(.black)
                }
                VStack(alignment: .leading, spacing: 2) {
                    Text("EC AUDIO").font(.system(size: 13, weight: .black, design: .rounded)).tracking(1.3)
                    Text("HUB").font(.system(size: 10, weight: .bold)).tracking(2.8).foregroundColor(accent)
                }
            }.padding(.top, 28)

            VStack(alignment: .leading, spacing: 8) {
                Text("BIBLIOTECA").font(.system(size: 10, weight: .bold)).tracking(1.8)
                    .foregroundColor(.secondary).padding(.horizontal, 10)
                ForEach(sections, id: \.self) { section in
                    Button { selectedSection = section } label: {
                        HStack(spacing: 10) {
                            Image(systemName: icon(for: section)).frame(width: 17)
                            Text(section)
                            Spacer()
                            if section == "Todos" {
                                Text("\(library.plugins.count)")
                                    .font(.system(size: 10, weight: .semibold, design: .monospaced))
                                    .foregroundColor(.secondary)
                            }
                        }
                        .font(.system(size: 13, weight: selectedSection == section ? .semibold : .regular))
                        .foregroundColor(selectedSection == section ? accent : Color.white.opacity(0.72))
                        .padding(.horizontal, 10).padding(.vertical, 9)
                        .background(selectedSection == section ? accent.opacity(0.12) : Color.clear)
                        .clipShape(RoundedRectangle(cornerRadius: 8))
                    }.buttonStyle(.plain)
                }
            }
            Spacer()
            VStack(alignment: .leading, spacing: 7) {
                Text("MACOS 12+").font(.system(size: 10, weight: .bold)).tracking(1.4).foregroundColor(accent)
                Text("Intel • Apple Silicon").font(.system(size: 11)).foregroundColor(.secondary)
            }.padding(.bottom, 24)
        }
        .padding(.horizontal, 18).frame(width: 218)
        .background(Color.black.opacity(0.16))
    }

    private var mainPanel: some View {
        VStack(spacing: 0) {
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Mis plugins").font(.system(size: 27, weight: .bold))
                    Text("Tu colección de herramientas de audio, en un solo lugar.")
                        .font(.system(size: 12)).foregroundColor(.secondary)
                }
                Spacer()
                Button { showingAddPlugin = true } label: {
                    Label("Agregar plugin", systemImage: "plus")
                        .font(.system(size: 12, weight: .bold)).foregroundColor(.black)
                        .padding(.horizontal, 15).padding(.vertical, 10)
                        .background(accent).clipShape(RoundedRectangle(cornerRadius: 8))
                }.buttonStyle(.plain)
            }.padding(.horizontal, 30).padding(.top, 30).padding(.bottom, 22)

            HStack(spacing: 10) {
                Image(systemName: "magnifyingglass").foregroundColor(.secondary)
                TextField("Buscar por plugin, fabricante o formato…", text: $searchText)
                    .textFieldStyle(.plain).font(.system(size: 12))
            }
            .padding(12).background(Color.white.opacity(0.055))
            .clipShape(RoundedRectangle(cornerRadius: 9))
            .padding(.horizontal, 30).padding(.bottom, 20)

            if filteredPlugins.isEmpty {
                emptyState
            } else {
                ScrollView {
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 245), spacing: 14)], spacing: 14) {
                        ForEach(filteredPlugins) { plugin in PluginCard(plugin: plugin) }
                    }.padding(.horizontal, 30).padding(.bottom, 25)
                }
            }

            HStack(spacing: 8) {
                Circle().fill(accent).frame(width: 6, height: 6)
                Text(library.statusMessage).font(.system(size: 10))
                    .foregroundColor(.secondary).lineLimit(1)
                Spacer()
                Text("EC AUDIO HUB  •  1.0").font(.system(size: 9, weight: .bold, design: .monospaced))
                    .tracking(1).foregroundColor(.white.opacity(0.25))
            }
            .padding(.horizontal, 30).padding(.vertical, 13)
            .background(Color.black.opacity(0.18))
        }
    }

    private var emptyState: some View {
        VStack(spacing: 12) {
            Image(systemName: searchText.isEmpty ? "square.stack.3d.up" : "magnifyingglass")
                .font(.system(size: 34, weight: .light)).foregroundColor(accent.opacity(0.85))
            Text(searchText.isEmpty ? "Tu biblioteca está vacía" : "No encontramos resultados")
                .font(.system(size: 17, weight: .semibold))
            Text(searchText.isEmpty
                 ? "Agrega tus plugins para tenerlos organizados y descargarlos desde aquí."
                 : "Prueba con otro nombre o fabricante.")
                .font(.system(size: 12)).foregroundColor(.secondary)
                .multilineTextAlignment(.center).frame(maxWidth: 340)
            if searchText.isEmpty {
                Button("Agregar mi primer plugin") { showingAddPlugin = true }
                    .buttonStyle(.plain).font(.system(size: 12, weight: .bold))
                    .foregroundColor(accent).padding(.top, 4)
            }
        }.frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func icon(for section: String) -> String {
        switch section {
        case "Todos": return "square.grid.2x2"
        case "Ecualizadores": return "slider.horizontal.3"
        case "Compresores": return "waveform.path"
        case "Reverb": return "water.waves"
        case "Delay": return "clock.arrow.circlepath"
        default: return "puzzlepiece"
        }
    }
}

private struct PluginCard: View {
    @EnvironmentObject private var library: PluginLibrary
    let plugin: AudioPlugin
    private let accent = Color(red: 0.28, green: 0.91, blue: 0.69)
    var body: some View {
        VStack(alignment: .leading, spacing: 13) {
            HStack {
                ZStack {
                    RoundedRectangle(cornerRadius: 9).fill(accent.opacity(0.12)).frame(width: 40, height: 40)
                    Image(systemName: "puzzlepiece.extension.fill").font(.system(size: 18)).foregroundColor(accent)
                }
                Spacer()
                Text(plugin.format.uppercased()).font(.system(size: 9, weight: .bold, design: .monospaced))
                    .tracking(1).foregroundColor(accent).padding(.horizontal, 8).padding(.vertical, 5)
                    .background(accent.opacity(0.09)).clipShape(Capsule())
            }
            VStack(alignment: .leading, spacing: 4) {
                Text(plugin.name).font(.system(size: 15, weight: .bold)).lineLimit(1)
                Text(plugin.subtitle.isEmpty ? plugin.category : plugin.subtitle)
                    .font(.system(size: 10)).foregroundColor(.secondary).lineLimit(1)
            }
            if !plugin.notes.isEmpty {
                Text(plugin.notes).font(.system(size: 10)).foregroundColor(.secondary).lineLimit(2)
            }
            HStack {
                Button {
                    Task { await library.download(plugin) }
                } label: {
                    HStack(spacing: 6) {
                        if library.downloadingIDs.contains(plugin.id) {
                            ProgressView().controlSize(.small).scaleEffect(0.75)
                        } else {
                            Image(systemName: "arrow.down.to.line")
                        }
                        Text(library.downloadingIDs.contains(plugin.id) ? "Descargando" : "Descargar")
                    }
                    .font(.system(size: 11, weight: .bold)).foregroundColor(.black)
                    .frame(maxWidth: .infinity).padding(.vertical, 9)
                    .background(accent).clipShape(RoundedRectangle(cornerRadius: 7))
                }.buttonStyle(.plain).disabled(library.downloadingIDs.contains(plugin.id))
                Button { library.remove(plugin) } label: {
                    Image(systemName: "trash").font(.system(size: 11)).foregroundColor(.secondary)
                        .frame(width: 34, height: 32).background(Color.white.opacity(0.06))
                        .clipShape(RoundedRectangle(cornerRadius: 7))
                }.buttonStyle(.plain).help("Eliminar de la biblioteca")
            }
        }
        .padding(15).background(Color.white.opacity(0.045))
        .overlay(RoundedRectangle(cornerRadius: 11).stroke(Color.white.opacity(0.07), lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: 11))
    }
}

private struct AddPluginView: View {
    @Environment(\.dismiss) private var dismiss
    var onSave: (AudioPlugin) -> Void
    @State private var name = ""
    @State private var manufacturer = ""
    @State private var version = ""
    @State private var format = "VST3"
    @State private var category = "Otros"
    @State private var downloadURL = ""
    @State private var notes = ""
    private let formats = ["VST3", "AU", "AAX", "Standalone", "Bundle", "Otro"]
    private let categories = ["Ecualizadores", "Compresores", "Reverb", "Delay", "Otros"]
    private let accent = Color(red: 0.28, green: 0.91, blue: 0.69)

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Agregar plugin").font(.system(size: 21, weight: .bold))
                    Text("Registra un plugin y su enlace oficial de descarga.")
                        .font(.system(size: 11)).foregroundColor(.secondary)
                }
                Spacer()
                Button { dismiss() } label: { Image(systemName: "xmark").foregroundColor(.secondary) }
                    .buttonStyle(.plain)
            }
            field("Nombre del plugin", text: $name, placeholder: "Ej. EC Equalizer")
            HStack(spacing: 12) {
                field("Fabricante", text: $manufacturer, placeholder: "EC Audio")
                field("Versión", text: $version, placeholder: "1.0.0")
            }
            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 6) {
                    label("FORMATO")
                    Picker("Formato", selection: $format) {
                        ForEach(formats, id: \.self) { Text($0).tag($0) }
                    }.labelsHidden()
                }
                VStack(alignment: .leading, spacing: 6) {
                    label("CATEGORÍA")
                    Picker("Categoría", selection: $category) {
                        ForEach(categories, id: \.self) { Text($0).tag($0) }
                    }.labelsHidden()
                }
            }
            field("URL HTTPS de descarga", text: $downloadURL, placeholder: "https://tuservidor.com/plugin.pkg")
            VStack(alignment: .leading, spacing: 6) {
                label("NOTAS (OPCIONAL)")
                TextField("Descripción breve o requisitos…", text: $notes).textFieldStyle(.roundedBorder)
            }
            HStack {
                Spacer()
                Button("Cancelar") { dismiss() }.keyboardShortcut(.cancelAction)
                Button("Guardar plugin") {
                    let plugin = AudioPlugin(
                        name: name.trimmingCharacters(in: .whitespacesAndNewlines),
                        manufacturer: manufacturer.trimmingCharacters(in: .whitespacesAndNewlines),
                        version: version.trimmingCharacters(in: .whitespacesAndNewlines),
                        format: format, category: category,
                        downloadURL: downloadURL.trimmingCharacters(in: .whitespacesAndNewlines),
                        notes: notes.trimmingCharacters(in: .whitespacesAndNewlines)
                    )
                    onSave(plugin)
                    dismiss()
                }
                .keyboardShortcut(.defaultAction)
                .disabled(name.trimmingCharacters(in: .whitespaces).isEmpty ||
                          URL(string: downloadURL)?.scheme?.lowercased() != "https")
                .foregroundColor(.black).padding(.horizontal, 13).padding(.vertical, 7)
                .background(accent).clipShape(RoundedRectangle(cornerRadius: 7))
            }
        }
        .padding(24).frame(width: 520)
        .background(Color(red: 0.075, green: 0.085, blue: 0.095))
        .preferredColorScheme(.dark)
    }

    private func field(_ title: String, text: Binding<String>, placeholder: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            label(title.uppercased())
            TextField(placeholder, text: text).textFieldStyle(.roundedBorder)
        }
    }
    private func label(_ value: String) -> some View {
        Text(value).font(.system(size: 9, weight: .bold)).tracking(1.2).foregroundColor(.secondary)
    }
}
