import Foundation
import Combine

@MainActor
final class PluginLibrary: ObservableObject {
    @Published private(set) var plugins: [Plugin] = []
    @Published var searchText = ""
    @Published var selectedCategory = "Todos"

    private let fileURL: URL

    init() {
        let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("EC Audio Hub", isDirectory: true)
        try? FileManager.default.createDirectory(at: support, withIntermediateDirectories: true)
        fileURL = support.appendingPathComponent("plugins.json")
        load()
    }

    var categories: [String] {
        ["Todos"] + Array(Set(plugins.map(\.category))).sorted()
    }

    var filtered: [Plugin] {
        plugins.filter { plugin in
            (selectedCategory == "Todos" || plugin.category == selectedCategory) &&
            (searchText.isEmpty || [plugin.name, plugin.maker, plugin.category, plugin.format.rawValue]
                .joined(separator: " ").localizedCaseInsensitiveContains(searchText))
        }
    }

    func add(_ plugin: Plugin) {
        plugins.append(plugin)
        save()
    }

    func remove(_ plugin: Plugin) {
        plugins.removeAll { $0.id == plugin.id }
        save()
    }

    func download(_ plugin: Plugin) async throws -> URL {
        guard plugin.downloadURL.scheme?.lowercased() == "https",
              plugin.downloadURL.host != nil else { throw URLError(.badURL) }

        var request = URLRequest(url: plugin.downloadURL)
        request.timeoutInterval = 300
        request.setValue("application/octet-stream,*/*", forHTTPHeaderField: "Accept")
        let (temporary, response) = try await URLSession.shared.download(for: request)
        guard let http = response as? HTTPURLResponse,
              (200...299).contains(http.statusCode) else {
            throw URLError(.badServerResponse)
        }

        let folder = FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("EC Audio Hub", isDirectory: true)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)

        let proposedName = plugin.downloadURL.lastPathComponent.removingPercentEncoding ?? plugin.downloadURL.lastPathComponent
        let safeName = proposedName.isEmpty || proposedName == "/" ? plugin.name + ".download" : URL(fileURLWithPath: proposedName).lastPathComponent
        let destination = uniqueDestination(in: folder, name: safeName)
        try FileManager.default.moveItem(at: temporary, to: destination)
        return destination
    }

    private func uniqueDestination(in folder: URL, name: String) -> URL {
        let base = URL(fileURLWithPath: name)
        var candidate = folder.appendingPathComponent(name)
        var index = 2
        while FileManager.default.fileExists(atPath: candidate.path) {
            let nextName = base.deletingPathExtension().lastPathComponent + " (\(index))." + base.pathExtension
            candidate = folder.appendingPathComponent(nextName)
            index += 1
        }
        return candidate
    }

    private func load() {
        guard let data = try? Data(contentsOf: fileURL),
              let decoded = try? JSONDecoder().decode([Plugin].self, from: data) else { return }
        plugins = decoded
    }

    private func save() {
        guard let data = try? JSONEncoder().encode(plugins) else { return }
        try? data.write(to: fileURL, options: .atomic)
    }
}
