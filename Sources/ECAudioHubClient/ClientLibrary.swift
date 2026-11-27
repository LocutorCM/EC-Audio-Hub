import Foundation
import Combine
import CryptoKit
import AppKit
import Security

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
    @Published var apiBaseURL: String { didSet { UserDefaults.standard.set(apiBaseURL, forKey: "ECAudioHubClient.apiBaseURL") } }
    @Published var accountEmail = ""
    @Published var subscriptionStatus = "Sin verificar"
    @Published var subscriptionActive = false
    @Published var isAccountBusy = false
    @Published var accountMessage = ""

    private let owner = "LocutorCM"
    private let repository = "EC-Audio-Hub"
    private let installedKey = "ECAudioHubClient.installedVersions"
    private let installedPathsKey = "ECAudioHubClient.installedPaths"
    private let catalogETagKey = "ECAudioHubClient.catalogETag"
    private let suspendedPluginsKey = "ECAudioHubClient.suspendedPlugins"
    private let customerTokenKey = "com.locutorcm.ECAudioHub.customerToken"

    init() {
        installedVersions = UserDefaults.standard.dictionary(forKey: installedKey) as? [String: String] ?? [:]
        installedPaths = UserDefaults.standard.dictionary(forKey: installedPathsKey) as? [String: [String]] ?? [:]
        apiBaseURL = UserDefaults.standard.string(forKey: "ECAudioHubClient.apiBaseURL") ?? ""
        accountEmail = UserDefaults.standard.string(forKey: "ECAudioHubClient.accountEmail") ?? ""
        subscriptionStatus = UserDefaults.standard.string(forKey: "ECAudioHubClient.subscriptionStatus") ?? "Sin verificar"
    }

    var isLicenseEnforcementEnabled: Bool { !apiBaseURL.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }

    var filteredPlugins: [HubPlugin] {
        guard !searchText.isEmpty else { return plugins }
        return plugins.filter {
            $0.name.localizedCaseInsensitiveContains(searchText) ||
            $0.version.localizedCaseInsensitiveContains(searchText) ||
            $0.formatLabel.localizedCaseInsensitiveContains(searchText)
        }
    }

    var updateCount: Int {
        plugins.filter { (installedVersions[$0.id] ?? installedVersions[$0.name]) != nil && (installedVersions[$0.id] ?? installedVersions[$0.name]) != $0.version }.count
    }

    var installedCount: Int { installedVersions.count }

    func installedVersion(for plugin: HubPlugin) -> String? {
        installedVersions[plugin.id] ?? installedVersions[plugin.name]
    }

    func refresh() async {
        guard !isRefreshing else { return }
        isRefreshing = true
        defer { isRefreshing = false }

        do {
            var releases: [GitHubRelease] = []
            var page = 1
            while true {
                var request = URLRequest(url: URL(string: "https://api.github.com/repos/\(owner)/\(repository)/releases?per_page=100&page=\(page)")!)
                request.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
                request.setValue("EC-Audio-Hub-Client", forHTTPHeaderField: "User-Agent")
                request.timeoutInterval = 30
                let pageCacheKey = "\(catalogETagKey).page.\(page)"
                if let etag = UserDefaults.standard.string(forKey: pageCacheKey + ".etag") {
                    request.setValue(etag, forHTTPHeaderField: "If-None-Match")
                }
                let (networkData, response) = try await URLSession.shared.data(for: request)
                guard let http = response as? HTTPURLResponse else { throw URLError(.badServerResponse) }
                let data: Data
                if http.statusCode == 304 {
                    guard let cached = UserDefaults.standard.data(forKey: pageCacheKey + ".data") else {
                        throw URLError(.cannotParseResponse)
                    }
                    data = cached
                } else {
                    guard (200...299).contains(http.statusCode) else { throw URLError(.badServerResponse) }
                    data = networkData
                    UserDefaults.standard.set(data, forKey: pageCacheKey + ".data")
                    if let etag = http.value(forHTTPHeaderField: "ETag") {
                        UserDefaults.standard.set(etag, forKey: pageCacheKey + ".etag")
                    } else {
                        UserDefaults.standard.removeObject(forKey: pageCacheKey + ".etag")
                    }
                }
                let batch = try JSONDecoder().decode([GitHubRelease].self, from: data)
                releases.append(contentsOf: batch)
                if batch.count < 100 { break }
                page += 1
            }
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
        if isLicenseEnforcementEnabled && (!subscriptionActive || customerToken == nil) {
            accountMessage = "Inicia sesión y activa tu licencia antes de instalar plugins."
            return
        }
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


    // MARK: - Customer account and subscription

    private var customerToken: String? {
        get { KeychainStore.read(key: customerTokenKey) }
        set {
            if let newValue { KeychainStore.save(newValue, key: customerTokenKey) }
            else { KeychainStore.delete(key: customerTokenKey) }
        }
    }

    private struct CustomerUserDTO: Decodable {
        let id: String
        let email: String
        let displayName: String?
    }
    private struct CustomerSubscriptionDTO: Decodable {
        let status: String
        let plan: String?
        let active: Bool
        let expiresAt: String?
        let remainingSeconds: Int?
    }
    private struct CustomerSessionDTO: Decodable {
        let token: String
        let user: CustomerUserDTO
        let subscription: CustomerSubscriptionDTO
    }
    private struct CustomerSubscriptionEnvelope: Decodable {
        let subscription: CustomerSubscriptionDTO
    }
    private struct CustomerActivationDTO: Decodable {
        let message: String
        let subscription: CustomerSubscriptionDTO
    }

    private func customerRequest<T: Decodable>(
        _ path: String,
        method: String = "GET",
        body: Data? = nil,
        responseType: T.Type
    ) async throws -> T {
        guard let base = URL(string: apiBaseURL.trimmingCharacters(in: .whitespacesAndNewlines)),
              base.scheme?.lowercased() == "https",
              let url = URL(string: path, relativeTo: base)?.absoluteURL else {
            throw ClientAccountError.apiNotConfigured
        }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.timeoutInterval = 20
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let body {
            request.httpBody = body
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        if let token = customerToken {
            request.setValue("Bearer " + token, forHTTPHeaderField: "Authorization")
        }
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw URLError(.badServerResponse) }
        guard (200...299).contains(http.statusCode) else {
            let payload = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
            let message = payload?["error"] as? String ?? "El servidor rechazó la solicitud (HTTP \(http.statusCode))."
            throw ClientAccountError.server(message)
        }
        return try JSONDecoder().decode(T.self, from: data)
    }

    func authenticateCustomer(email: String, password: String, displayName: String, register: Bool) async {
        guard !isAccountBusy else { return }
        isAccountBusy = true
        defer { isAccountBusy = false }
        do {
            let payload: [String: String] = [
                "email": email.trimmingCharacters(in: .whitespacesAndNewlines),
                "password": password,
                "displayName": displayName.trimmingCharacters(in: .whitespacesAndNewlines)
            ]
            let body = try JSONSerialization.data(withJSONObject: payload)
            let session: CustomerSessionDTO = try await customerRequest(
                register ? "/api/customer/auth/register" : "/api/customer/auth/login",
                method: "POST", body: body, responseType: CustomerSessionDTO.self
            )
            customerToken = session.token
            accountEmail = session.user.email
            UserDefaults.standard.set(accountEmail, forKey: "ECAudioHubClient.accountEmail")
            applySubscription(session.subscription)
            accountMessage = "Sesión iniciada correctamente."
        } catch {
            accountMessage = error.localizedDescription
        }
    }

    func activateTrial() async {
        guard !isAccountBusy else { return }
        isAccountBusy = true
        defer { isAccountBusy = false }
        do {
            let body = "{}".data(using: .utf8)
            let result: CustomerActivationDTO = try await customerRequest(
                "/api/customer/subscription/activate",
                method: "POST", body: body, responseType: CustomerActivationDTO.self
            )
            applySubscription(result.subscription)
            accountMessage = result.message
        } catch {
            accountMessage = error.localizedDescription
        }
    }

    func checkCustomerEntitlement() async {
        guard customerToken != nil else { return }
        do {
            let result: CustomerSubscriptionEnvelope = try await customerRequest(
                "/api/customer/subscription", responseType: CustomerSubscriptionEnvelope.self
            )
            applySubscription(result.subscription)
        } catch {
            // Un fallo de red o servidor no demuestra que la licencia haya vencido.
            accountMessage = "No se pudo verificar la licencia. Se conserva el estado actual hasta recibir confirmación del servidor."
        }
    }

    private func applySubscription(_ subscription: CustomerSubscriptionDTO) {
        subscriptionActive = subscription.active
        let expiry = subscription.remainingSeconds.map { " · \($0) s restantes" } ?? ""
        subscriptionStatus = subscription.active ? "Acceso activo" + expiry :
            (subscription.status == "expired" ? "Prueba vencida" : "Sin acceso activo")
        UserDefaults.standard.set(subscriptionStatus, forKey: "ECAudioHubClient.subscriptionStatus")
        if subscription.active {
            do { try restoreManagedPlugins() }
            catch { accountMessage = "Acceso restaurado, pero algunos plugins requieren restauración manual: \(error.localizedDescription)" }
        } else {
            do { try suspendManagedPlugins() }
            catch { accountMessage = "La licencia venció, pero no se pudieron suspender todos los plugins: \(error.localizedDescription)" }
        }
    }

    func signOutCustomer() {
        customerToken = nil
        accountEmail = ""
        UserDefaults.standard.removeObject(forKey: "ECAudioHubClient.accountEmail")
        accountMessage = "Sesión cerrada. Los plugins administrados permanecen en su estado actual hasta una verificación válida."
    }

    private func pluginInstallRoot() -> URL {
        FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Audio/Plug-Ins", isDirectory: true).standardizedFileURL
    }

    private func isManagedPluginPath(_ url: URL) -> Bool {
        let root = pluginInstallRoot()
        let parent = url.deletingLastPathComponent()
        let allowed = parent == root.appendingPathComponent("VST3", isDirectory: true) ||
            parent == root.appendingPathComponent("Components", isDirectory: true)
        let ext = url.pathExtension.lowercased()
        return allowed && (ext == "vst3" || ext == "component") && installedPaths.values.contains(where: { $0.contains(url.path) })
    }

    private func suspendManagedPlugins() throws {
        let manager = FileManager.default
        var suspended = UserDefaults.standard.dictionary(forKey: suspendedPluginsKey) as? [String: String] ?? [:]
        let managed = Set(installedPaths.values.flatMap { $0 })
        for rawPath in managed {
            let original = URL(fileURLWithPath: rawPath).standardizedFileURL
            guard isManagedPluginPath(original), manager.fileExists(atPath: original.path) else { continue }
            let folder = manager.homeDirectoryForCurrentUser
                .appendingPathComponent("Library/Application Support/EC Audio Hub/Suspended Plugins", isDirectory: true)
                .appendingPathComponent(UUID().uuidString, isDirectory: true)
            try manager.createDirectory(at: folder, withIntermediateDirectories: true)
            let destination = folder.appendingPathComponent(original.lastPathComponent, isDirectory: true)
            try manager.moveItem(at: original, to: destination)
            suspended[original.path] = destination.path
            UserDefaults.standard.set(suspended, forKey: suspendedPluginsKey)
        }
        UserDefaults.standard.set(suspended, forKey: suspendedPluginsKey)
        status = "Licencia vencida: plugins EC Audio suspendidos sin eliminarlos."
    }

    private func restoreManagedPlugins() throws {
        let manager = FileManager.default
        var suspended = UserDefaults.standard.dictionary(forKey: suspendedPluginsKey) as? [String: String] ?? [:]
        for (originalPath, suspendedPath) in Array(suspended) {
            let original = URL(fileURLWithPath: originalPath).standardizedFileURL
            let source = URL(fileURLWithPath: suspendedPath).standardizedFileURL
            guard manager.fileExists(atPath: source.path) else {
                suspended.removeValue(forKey: originalPath)
                continue
            }
            guard isManagedPluginOriginalPath(original) else { continue }
            if manager.fileExists(atPath: original.path) {
                // Never overwrite a file the user or another installer placed there.
                continue
            }
            try manager.createDirectory(at: original.deletingLastPathComponent(), withIntermediateDirectories: true)
            try manager.moveItem(at: source, to: original)
            try? manager.removeItem(at: source.deletingLastPathComponent())
            suspended.removeValue(forKey: originalPath)
            UserDefaults.standard.set(suspended, forKey: suspendedPluginsKey)
        }
        UserDefaults.standard.set(suspended, forKey: suspendedPluginsKey)
        status = "Licencia activa: plugins EC Audio restaurados."
    }

    private func isManagedPluginOriginalPath(_ url: URL) -> Bool {
        let root = pluginInstallRoot()
        let parent = url.deletingLastPathComponent()
        let allowed = parent == root.appendingPathComponent("VST3", isDirectory: true) ||
            parent == root.appendingPathComponent("Components", isDirectory: true)
        return allowed && (url.pathExtension.lowercased() == "vst3" || url.pathExtension.lowercased() == "component")
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

enum ClientAccountError: LocalizedError {
    case apiNotConfigured
    case server(String)
    var errorDescription: String? {
        switch self {
        case .apiNotConfigured:
            return "Falta configurar la dirección HTTPS del servidor EC Audio."
        case .server(let message):
            return message
        }
    }
}

private enum KeychainStore {
    static func read(key: String) -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: "EC Audio Hub Client",
            kSecAttrAccount as String: key,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]
        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
              let data = item as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }
    static func save(_ value: String, key: String) {
        let data = Data(value.utf8)
        delete(key: key)
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: "EC Audio Hub Client",
            kSecAttrAccount as String: key,
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlock
        ]
        SecItemAdd(query as CFDictionary, nil)
    }
    static func delete(key: String) {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: "EC Audio Hub Client",
            kSecAttrAccount as String: key
        ]
        SecItemDelete(query as CFDictionary)
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
