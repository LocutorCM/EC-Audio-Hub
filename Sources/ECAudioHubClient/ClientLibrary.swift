import Foundation
import Combine
import CryptoKit
import AppKit

@MainActor
final class ClientLibrary: ObservableObject {
    @Published private(set) var plugins: [HubPlugin] = []
    @Published private(set) var installedVersions: [String: String] = [:]
    @Published private(set) var installedPaths: [String: [String]] = [:]
    @Published var searchText = ""
    @Published var isRefreshing = false
    @Published var downloadingIDs: Set<String> = []
    @Published var status = "Conecta con EC Audio Hub para consultar los plugins."
    @Published var errorMessage: String?

    private let owner = "LocutorCM"
    private let repository = "EC-Audio-Hub"
    private let installedKey = "ECAudioHubClient.installedVersions"
    private let installedPathsKey = "ECAudioHubClient.installedPaths"
    private let catalogETagKey = "ECAudioHubClient.catalogETag"

    init() {
        installedVersions = UserDefaults.standard.dictionary(forKey: installedKey) as? [String: String] ?? [:]
        installedPaths = UserDefaults.standard.dictionary(forKey: installedPathsKey) as? [String: [String]] ?? [:]
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
        plugins.filter { installedVersions[$0.id] != nil && installedVersions[$0.id] != $0.version }.count
    }

    var installedCount: Int { installedVersions.count }

    func installedVersion(for plugin: HubPlugin) -> String? {
        installedVersions[plugin.id]
    }

    func refresh() async {
        guard !isRefreshing else { return }
        isRefreshing = true
        defer { isRefreshing = false }

        do {
            var request = URLRequest(url: URL(string: "https://api.github.com/repos/\(owner)/\(repository)/releases?per_page=100")!)
            request.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
            request.setValue("EC-Audio-Hub-Client", forHTTPHeaderField: "User-Agent")
            if let etag = UserDefaults.standard.string(forKey: catalogETagKey) {
                request.setValue(etag, forHTTPHeaderField: "If-None-Match")
            }
            request.timeoutInterval = 30

            let (data, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse else {
                throw URLError(.badServerResponse)
            }
            // GitHub responde 304 cuando el catálogo no ha cambiado. Las peticiones
            // condicionales evitan consumir el límite normal de consultas repetidas.
            if http.statusCode == 304 {
                status = "\(plugins.count) plugin(s) disponibles · Sin cambios."
                return
            }
            guard (200...299).contains(http.statusCode) else {
                throw URLError(.badServerResponse)
            }
            if let etag = http.value(forHTTPHeaderField: "ETag") {
                UserDefaults.standard.set(etag, forKey: catalogETagKey)
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
                // Busca la portada por nombre indicado en los metadatos y, como
                // respaldo, detecta automáticamente cualquier imagen adjunta al release.
                let imageExtensions: Set<String> = ["png", "jpg", "jpeg", "webp", "gif", "bmp", "heic", "tif", "tiff"]
                let imageAsset = metadata["image_file"].flatMap { imageName in
                    release.assets.first(where: { $0.name.caseInsensitiveCompare(imageName) == .orderedSame })
                } ?? release.assets.first(where: {
                    imageExtensions.contains(URL(fileURLWithPath: $0.name).pathExtension.lowercased())
                })
                let metadataImageURL = metadata["image_url"].flatMap { rawValue -> URL? in
                    guard let url = URL(string: rawValue.trimmingCharacters(in: .whitespacesAndNewlines)),
                          let scheme = url.scheme?.lowercased(), scheme == "https" else { return nil }
                    return url
                }
                // Prioriza el enlace del asset adjunto al release: GitHub lo genera
                // directamente y evita que una URL antigua guardada en los metadatos
                // impida mostrar la portada actual.
                let artworkURL = imageAsset?.browserDownloadURL ?? metadataImageURL

                found.append(HubPlugin(
                    id: String(release.id) + ":" + asset.name,
                    name: pluginName,
                    version: version,
                    fileName: asset.name,
                    sha256: checksum.lowercased(),
                    downloadURL: asset.browserDownloadURL,
                    size: asset.size,
                    releaseNotes: release.body ?? "",
                    imageURL: artworkURL
                ))
            }

            // Cada release es una publicación independiente. No agrupar por nombre:
            // se permiten nombres y versiones repetidos.
            plugins = found.sorted {
                let order = $0.name.localizedCaseInsensitiveCompare($1.name)
                return order == .orderedSame ? $0.id < $1.id : order == .orderedAscending
            }
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
            if let installed, !installed.isEmpty {
                installedVersions[plugin.id] = plugin.version
                installedPaths[plugin.id] = installed.map(\.path)
                UserDefaults.standard.set(installedVersions, forKey: installedKey)
                UserDefaults.standard.set(installedPaths, forKey: installedPathsKey)
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

    private func installPluginFile(_ downloadedURL: URL, plugin: HubPlugin) throws -> [URL]? {
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
            return [destination]
        }

        guard ext == "zip" else { return nil }
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
        guard !bundles.isEmpty else { return nil }

        var installedBundles: [URL] = []
        for bundle in bundles {
            let suffix = bundle.pathExtension.lowercased()
            let folder = installRoot.appendingPathComponent(suffix == "vst3" ? "VST3" : "Components", isDirectory: true)
            try fileManager.createDirectory(at: folder, withIntermediateDirectories: true)
            let destination = folder.appendingPathComponent(bundle.lastPathComponent, isDirectory: true)
            if fileManager.fileExists(atPath: destination.path) { try fileManager.removeItem(at: destination) }
            try fileManager.copyItem(at: bundle, to: destination)
            installedBundles.append(destination)
        }
        return installedBundles
    }

    var detectedInstalledPlugins: [InstalledPlugin] {
        let root = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Audio/Plug-Ins", isDirectory: true)
            .standardizedFileURL
        var result: [InstalledPlugin] = []
        for folderName in ["VST3", "Components"] {
            let folder = root.appendingPathComponent(folderName, isDirectory: true)
            let urls = (try? FileManager.default.contentsOfDirectory(
                at: folder, includingPropertiesForKeys: [.isDirectoryKey], options: [.skipsHiddenFiles]
            )) ?? []
            for url in urls {
                let ext = url.pathExtension.lowercased()
                guard ext == "vst3" || ext == "component" else { continue }
                let path = url.standardizedFileURL.path
                let owner = installedPaths.first(where: { $0.value.contains(path) })?.key
                let version = owner.flatMap { installedVersions[$0] }
                result.append(InstalledPlugin(
                    id: path,
                    name: url.deletingPathExtension().lastPathComponent,
                    format: ext == "vst3" ? "VST3" : "Audio Unit",
                    version: version,
                    path: path
                ))
            }
        }
        return result.sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
    }

    func uninstallBundle(at rawPath: String) throws {
        let fileManager = FileManager.default
        let root = fileManager.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Audio/Plug-Ins", isDirectory: true).standardizedFileURL
        let url = URL(fileURLWithPath: rawPath).standardizedFileURL
        let parent = url.deletingLastPathComponent()
        let allowedParents = [
            root.appendingPathComponent("VST3", isDirectory: true),
            root.appendingPathComponent("Components", isDirectory: true)
        ]
        let ext = url.pathExtension.lowercased()
        guard allowedParents.contains(parent), ext == "vst3" || ext == "component" else {
            throw ClientInstallError.invalidUninstallPath
        }
        guard fileManager.fileExists(atPath: url.path) else {
            throw ClientInstallError.installedBundleNotFound(url.lastPathComponent)
        }
        try fileManager.removeItem(at: url)
        for (name, paths) in Array(installedPaths) {
            let remaining = paths.filter { $0 != url.path }
            if remaining.isEmpty {
                installedPaths.removeValue(forKey: name)
                installedVersions.removeValue(forKey: name)
            } else {
                installedPaths[name] = remaining
            }
        }
        UserDefaults.standard.set(installedPaths, forKey: installedPathsKey)
        UserDefaults.standard.set(installedVersions, forKey: installedKey)
        status = "\(url.deletingPathExtension().lastPathComponent) se desinstaló correctamente."
    }

    func uninstallPlugin(named name: String) throws {
        let fileManager = FileManager.default
        let root = fileManager.homeDirectoryForCurrentUser.appendingPathComponent("Library/Audio/Plug-Ins", isDirectory: true).standardizedFileURL
        var paths = installedPaths[name] ?? []
        // Older Client versions did not store exact bundle paths; try matching bundle names.
        if paths.isEmpty {
            for folderName in ["VST3", "Components"] {
                let folder = root.appendingPathComponent(folderName, isDirectory: true)
                let contents = (try? fileManager.contentsOfDirectory(at: folder, includingPropertiesForKeys: [.isDirectoryKey])) ?? []
                paths += contents.filter { url in
                    let candidate = url.deletingPathExtension().lastPathComponent
                    return candidate.localizedCaseInsensitiveContains(name) || name.localizedCaseInsensitiveContains(candidate)
                }.map(\.path)
            }
        }
        guard !paths.isEmpty else { throw ClientInstallError.installedBundleNotFound(name) }
        for rawPath in paths {
            let url = URL(fileURLWithPath: rawPath).standardizedFileURL
            let parent = url.deletingLastPathComponent()
            let allowed = parent == root.appendingPathComponent("VST3") || parent == root.appendingPathComponent("Components")
            let ext = url.pathExtension.lowercased()
            guard allowed, (ext == "vst3" || ext == "component") else { continue }
            if fileManager.fileExists(atPath: url.path) { try fileManager.removeItem(at: url) }
        }
        installedPaths.removeValue(forKey: name)
        installedVersions.removeValue(forKey: name)
        UserDefaults.standard.set(installedPaths, forKey: installedPathsKey)
        UserDefaults.standard.set(installedVersions, forKey: installedKey)
        status = "\(name) se desinstaló correctamente."
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
    case installedBundleNotFound(String)
    case invalidUninstallPath

    var errorDescription: String? {
        switch self {
        case .checksumMismatch: return "La verificación SHA-256 no coincide. El archivo se rechazó por seguridad."
        case .archiveExtractionFailed: return "No se pudo extraer el ZIP."
        case .noPluginBundle: return "El ZIP no contiene un paquete AU (.component) o VST3 (.vst3)."
        case .installedBundleNotFound(let name): return "No encontré los archivos instalados de \(name)."
        case .invalidUninstallPath: return "Por seguridad, solo se pueden eliminar plugins dentro de las carpetas VST3 y Components de tu usuario."
        }
    }
}

struct InstalledPlugin: Identifiable {
    let id: String
    let name: String
    let format: String
    let version: String?
    let path: String
}
