import Foundation
import Combine
import CryptoKit
import AppKit

@MainActor
final class ClientLibrary: ObservableObject {
    @Published private(set) var plugins: [HubPlugin] = []
    @Published private(set) var installedVersions: [String: String] = [:]
    @Published var searchText = ""
    @Published var isRefreshing = false
    @Published var downloadingIDs: Set<String> = []
    @Published var status = "Conecta con EC Audio Hub para consultar los plugins."
    @Published var errorMessage: String?

    private let owner = "LocutorCM"
    private let repository = "EC-Audio-Hub"
    private let installedKey = "ECAudioHubClient.installedVersions"

    init() {
        installedVersions = UserDefaults.standard.dictionary(forKey: installedKey) as? [String: String] ?? [:]
    }

    var filteredPlugins: [HubPlugin] {
        guard !searchText.isEmpty else { return plugins }
        return plugins.filter {
            $0.name.localizedCaseInsensitiveContains(searchText) ||
            $0.version.localizedCaseInsensitiveContains(searchText) ||
            $0.formatLabel.localizedCaseInsensitiveContains(searchText)
        }
    }

    var updateCount: Int {
        plugins.filter { installedVersions[$0.name] != nil && installedVersions[$0.name] != $0.version }.count
    }

    var installedCount: Int { installedVersions.count }

    func installedVersion(for plugin: HubPlugin) -> String? {
        installedVersions[plugin.name]
    }

    func refresh() async {
        guard !isRefreshing else { return }
        isRefreshing = true
        defer { isRefreshing = false }

        do {
            var request = URLRequest(url: URL(string: "https://api.github.com/repos/\(owner)/\(repository)/releases?per_page=100")!)
            request.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
            request.setValue("EC-Audio-Hub-Client", forHTTPHeaderField: "User-Agent")
            request.timeoutInterval = 30

            let (data, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
                throw URLError(.badServerResponse)
            }

            let releases = try JSONDecoder().decode([GitHubRelease].self, from: data)
            var found: [HubPlugin] = []

            for release in releases where !release.draft && !release.prerelease {
                let metadata = parseMetadata(release.body ?? "")
                guard metadata["plugin_name"] != nil,
                      let fileName = metadata["file_name"],
                      let checksum = metadata["sha256"] else { continue }

                guard let asset = release.assets.first(where: { $0.name == fileName }) else { continue }
                guard checksum.count == 64, checksum.allSatisfy({ $0.isHexDigit }) else { continue }

                let pluginName = metadata["plugin_name"] ?? release.name ?? release.tagName
                let version = metadata["version"] ?? release.tagName
                found.append(HubPlugin(
                    id: release.tagName + ":" + asset.name,
                    name: pluginName,
                    version: version,
                    fileName: asset.name,
                    sha256: checksum.lowercased(),
                    downloadURL: asset.browserDownloadURL,
                    size: asset.size,
                    releaseNotes: release.body ?? ""
                ))
            }

            // Keep the newest release for each plugin name.
            var newest: [String: HubPlugin] = [:]
            for plugin in found {
                if let current = newest[plugin.name] {
                    if compareVersions(plugin.version, current.version) == .orderedDescending {
                        newest[plugin.name] = plugin
                    }
                } else {
                    newest[plugin.name] = plugin
                }
            }
            plugins = newest.values.sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
            status = plugins.isEmpty
                ? "No hay plugins publicados todavía. Publica uno desde EC Audio Hub Admin."
                : "\(plugins.count) plugin(s) disponibles · Catálogo actualizado."
        } catch {
            errorMessage = "No se pudo actualizar el catálogo. Comprueba tu conexión e inténtalo de nuevo. \(error.localizedDescription)"
            status = "No se pudo conectar con el catálogo."
        }
    }

    func downloadAndInstall(_ plugin: HubPlugin) async {
        guard !downloadingIDs.contains(plugin.id) else { return }
        downloadingIDs.insert(plugin.id)
        defer { downloadingIDs.remove(plugin.id) }
        status = "Descargando \(plugin.name)…"

        do {
            var request = URLRequest(url: plugin.downloadURL)
            request.setValue("application/octet-stream,*/*", forHTTPHeaderField: "Accept")
            request.setValue("EC-Audio-Hub-Client", forHTTPHeaderField: "User-Agent")
            request.timeoutInterval = 600

            let (temporaryURL, response) = try await URLSession.shared.download(for: request)
            guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
                throw URLError(.badServerResponse)
            }

            let actualHash = try sha256(of: temporaryURL)
            guard actualHash == plugin.sha256 else {
                throw ClientInstallError.checksumMismatch
            }

            let installed = try installPluginFile(temporaryURL, plugin: plugin)
            if installed {
                installedVersions[plugin.name] = plugin.version
                UserDefaults.standard.set(installedVersions, forKey: installedKey)
                status = "\(plugin.name) \(plugin.version) se instaló correctamente."
            } else {
                let destination = try saveForManualInstall(temporaryURL, fileName: plugin.fileName)
                status = "Descarga verificada. Este formato requiere instalación manual: \(destination.path)"
                NSWorkspace.shared.activateFileViewerSelecting([destination])
            }
        } catch {
            errorMessage = "No se pudo instalar \(plugin.name): \(error.localizedDescription)"
            status = "La instalación no se completó."
        }
    }

    private func parseMetadata(_ body: String) -> [String: String] {
        var result: [String: String] = [:]
        for line in body.components(separatedBy: .newlines) {
            let pieces = line.split(separator: ":", maxSplits: 1, omittingEmptySubsequences: false)
            guard pieces.count == 2 else { continue }
            result[String(pieces[0]).trimmingCharacters(in: .whitespaces)] =
                String(pieces[1]).trimmingCharacters(in: .whitespaces)
        }
        return result
    }

    private func compareVersions(_ lhs: String, _ rhs: String) -> ComparisonResult {
        let left = lhs.split(separator: ".").map { Int($0) ?? 0 }
        let right = rhs.split(separator: ".").map { Int($0) ?? 0 }
        for index in 0..<max(left.count, right.count) {
            let a = index < left.count ? left[index] : 0
            let b = index < right.count ? right[index] : 0
            if a < b { return .orderedAscending }
            if a > b { return .orderedDescending }
        }
        return .orderedSame
    }

    private func sha256(of url: URL) throws -> String {
        let handle = try FileHandle(forReadingFrom: url)
        defer { try? handle.close() }
        var hasher = SHA256()
        while let chunk = try handle.read(upToCount: 1024 * 1024), !chunk.isEmpty {
            hasher.update(data: chunk)
        }
        return hasher.finalize().map { String(format: "%02x", $0) }.joined()
    }

    private func installPluginFile(_ downloadedURL: URL, plugin: HubPlugin) throws -> Bool {
        let fileManager = FileManager.default
        let ext = plugin.fileExtension
        let installRoot = fileManager.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Audio/Plug-Ins", isDirectory: true)

        if ext == "vst3" || ext == "component" {
            let folder = installRoot.appendingPathComponent(ext == "vst3" ? "VST3" : "Components", isDirectory: true)
            try fileManager.createDirectory(at: folder, withIntermediateDirectories: true)
            let destination = folder.appendingPathComponent(plugin.fileName, isDirectory: true)
            if fileManager.fileExists(atPath: destination.path) { try fileManager.removeItem(at: destination) }
            try fileManager.copyItem(at: downloadedURL, to: destination)
            return true
        }

        guard ext == "zip" else { return false }
        let extraction = fileManager.temporaryDirectory.appendingPathComponent("ECAudioInstall-\(UUID().uuidString)", isDirectory: true)
        try fileManager.createDirectory(at: extraction, withIntermediateDirectories: true)
        defer { try? fileManager.removeItem(at: extraction) }

        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/ditto")
        process.arguments = ["-x", "-k", downloadedURL.path, extraction.path]
        try process.run()
        process.waitUntilExit()
        guard process.terminationStatus == 0 else { throw ClientInstallError.archiveExtractionFailed }

        guard let enumerator = fileManager.enumerator(at: extraction, includingPropertiesForKeys: [.isDirectoryKey], options: [.skipsHiddenFiles]) else {
            throw ClientInstallError.noPluginBundle
        }

        var bundles: [URL] = []
        for case let url as URL in enumerator {
            let suffix = url.pathExtension.lowercased()
            if suffix == "vst3" || suffix == "component" {
                bundles.append(url)
                enumerator.skipDescendants()
            }
        }
        guard !bundles.isEmpty else { return false }

        for bundle in bundles {
            let suffix = bundle.pathExtension.lowercased()
            let folder = installRoot.appendingPathComponent(suffix == "vst3" ? "VST3" : "Components", isDirectory: true)
            try fileManager.createDirectory(at: folder, withIntermediateDirectories: true)
            let destination = folder.appendingPathComponent(bundle.lastPathComponent, isDirectory: true)
            if fileManager.fileExists(atPath: destination.path) { try fileManager.removeItem(at: destination) }
            try fileManager.copyItem(at: bundle, to: destination)
        }
        return true
    }

    private func saveForManualInstall(_ source: URL, fileName: String) throws -> URL {
        let folder = FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("EC Audio Hub", isDirectory: true)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let safeName = URL(fileURLWithPath: fileName).lastPathComponent
        let destination = folder.appendingPathComponent(safeName)
        if FileManager.default.fileExists(atPath: destination.path) { try FileManager.default.removeItem(at: destination) }
        try FileManager.default.copyItem(at: source, to: destination)
        return destination
    }
}

enum ClientInstallError: LocalizedError {
    case checksumMismatch
    case archiveExtractionFailed
    case noPluginBundle

    var errorDescription: String? {
        switch self {
        case .checksumMismatch: return "La verificación SHA-256 no coincide. El archivo se rechazó por seguridad."
        case .archiveExtractionFailed: return "No se pudo extraer el ZIP."
        case .noPluginBundle: return "El ZIP no contiene un paquete AU (.component) o VST3 (.vst3)."
        }
    }
}
