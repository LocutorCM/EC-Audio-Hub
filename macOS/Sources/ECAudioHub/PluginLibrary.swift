import Foundation
import Combine
import AppKit

struct AudioPlugin: Identifiable, Codable, Equatable {
    var id: UUID = UUID()
    var name: String
    var manufacturer: String
    var version: String
    var format: String
    var category: String
    var downloadURL: String
    var notes: String

    var subtitle: String {
        [manufacturer, version.isEmpty ? nil : "v\(version)", format]
            .compactMap { $0 }.joined(separator: " • ")
    }
}

@MainActor
final class PluginLibrary: ObservableObject {
    @Published private(set) var plugins: [AudioPlugin] = []
    @Published var downloadingIDs: Set<UUID> = []
    @Published var statusMessage = "Tu biblioteca está lista"

    private let fileManager = FileManager.default
    private var catalogURL: URL {
        let base = fileManager.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
        let folder = base.appendingPathComponent("ECAudioHub", isDirectory: true)
        try? fileManager.createDirectory(at: folder, withIntermediateDirectories: true)
        return folder.appendingPathComponent("plugins.json")
    }

    init() { load() }

    func add(_ plugin: AudioPlugin) {
        guard URL(string: plugin.downloadURL)?.scheme?.lowercased() == "https" else {
            statusMessage = "Usa un enlace HTTPS válido."
            return
        }
        plugins.append(plugin)
        save()
        statusMessage = "\(plugin.name) agregado a tu biblioteca."
    }

    func remove(_ plugin: AudioPlugin) {
        plugins.removeAll { $0.id == plugin.id }
        save()
        statusMessage = "\(plugin.name) eliminado de la biblioteca."
    }

    func download(_ plugin: AudioPlugin) async {
        guard !downloadingIDs.contains(plugin.id),
              let remoteURL = URL(string: plugin.downloadURL),
              remoteURL.scheme?.lowercased() == "https" else {
            statusMessage = "No se pudo validar el enlace."
            return
        }
        downloadingIDs.insert(plugin.id)
        defer { downloadingIDs.remove(plugin.id) }
        do {
            let (temporaryURL, response) = try await URLSession.shared.download(from: remoteURL)
            if let http = response as? HTTPURLResponse, !(200...299).contains(http.statusCode) {
                throw DownloadError.badResponse(http.statusCode)
            }
            let downloads = fileManager.urls(for: .downloadsDirectory, in: .userDomainMask).first!
                .appendingPathComponent("EC Audio Hub", isDirectory: true)
            try fileManager.createDirectory(at: downloads, withIntermediateDirectories: true)
            var filename = remoteURL.lastPathComponent
            if filename.isEmpty || filename == "/" {
                filename = plugin.name.replacingOccurrences(of: "/", with: "-") + ".download"
            }
            filename = filename.replacingOccurrences(of: ":", with: "-")
            var destination = downloads.appendingPathComponent(filename)
            if fileManager.fileExists(atPath: destination.path) {
                let stem = destination.deletingPathExtension().lastPathComponent
                let ext = destination.pathExtension
                destination = downloads.appendingPathComponent("\(stem)-\(Int(Date().timeIntervalSince1970)).\(ext)")
            }
            try fileManager.moveItem(at: temporaryURL, to: destination)
            statusMessage = "Descarga completa: \(destination.lastPathComponent)"
            let ext = destination.pathExtension.lowercased()
            if ["pkg", "mpkg", "dmg"].contains(ext) {
                // La instalación queda bajo confirmación explícita del usuario.
                NSWorkspace.shared.open(destination)
            } else {
                NSWorkspace.shared.activateFileViewerSelecting([destination])
            }
        } catch {
            statusMessage = "Error al descargar \(plugin.name): \(error.localizedDescription)"
        }
    }

    private func load() {
        guard let data = try? Data(contentsOf: catalogURL),
              let decoded = try? JSONDecoder().decode([AudioPlugin].self, from: data) else {
            plugins = []
            return
        }
        plugins = decoded
    }

    private func save() {
        do {
            try JSONEncoder().encode(plugins).write(to: catalogURL, options: .atomic)
        } catch {
            statusMessage = "No se pudo guardar la biblioteca: \(error.localizedDescription)"
        }
    }

    enum DownloadError: LocalizedError {
        case badResponse(Int)
        var errorDescription: String? {
            if case .badResponse(let code) = self { return "Respuesta HTTP \(code)." }
            return "Error de descarga."
        }
    }
}
