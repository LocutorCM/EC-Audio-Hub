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
    @Published var accountEmail = ""
    @Published var subscriptionStatus = "Sin verificar"
    @Published var subscriptionActive = false
    @Published var trialUsed = false
    @Published var subscriptionPlan: String?
    @Published var isAccountBusy = false
    @Published var accountMessage = ""

    private let owner = "LocutorCM"
    private let repository = "EC-Audio-Hub"
    private let installedKey = "ECAudioHubClient.installedVersions"
    private let installedPathsKey = "ECAudioHubClient.installedPaths"
    private let catalogETagKey = "ECAudioHubClient.catalogETag"
    private let suspendedPluginsKey = "ECAudioHubClient.suspendedPlugins"
    private let customerTokenKey = "com.locutorcm.ECAudioHub.firebaseIDToken"
    private let customerRefreshTokenKey = "com.locutorcm.ECAudioHub.firebaseRefreshToken"
    private let firebaseUIDKey = "ECAudioHubClient.firebaseUID"
    private let firebaseAPIKey = "AIzaSyCXcjmEv0tdynd0gyKDsZAh4mS998lw5tU"
    private let firebaseProjectID = "ec-audio-accounts"
    // Set to the deployed HTTPS Render origin before the commercial release.
    private let apiBaseURL = ""
    private let deviceIDKey = "ECAudioHubClient.deviceID"

    private struct FirebaseAuthDTO: Decodable {
        let idToken: String
        let email: String?
        let localId: String
        let displayName: String?
        let refreshToken: String
    }

    init() {
        installedVersions = UserDefaults.standard.dictionary(forKey: installedKey) as? [String: String] ?? [:]
        installedPaths = UserDefaults.standard.dictionary(forKey: installedPathsKey) as? [String: [String]] ?? [:]
        accountEmail = UserDefaults.standard.string(forKey: "ECAudioHubClient.accountEmail") ?? ""
        subscriptionStatus = UserDefaults.standard.string(forKey: "ECAudioHubClient.subscriptionStatus") ?? "Sin verificar"
    }

    // El Client Hub distribuye e instala plugins sin exigir activación de licencia.
    var isLicenseEnforcementEnabled: Bool { false }
    var isCustomerSignedIn: Bool { customerToken != nil }

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
                let releaseBody = release.body ?? ""
                // El catálogo del Client utiliza el mismo canal de publicaciones del Admin Hub.
                guard releaseBody.contains("EC_AUDIO_PLUGIN_RELEASE") else { continue }
                let metadata = parseMetadata(releaseBody)
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
        let installRoot = pluginInstallRoot()

        if ext == "vst3" || ext == "component" {
            let folder = installRoot.appendingPathComponent(ext == "vst3" ? "VST3" : "Components", isDirectory: true)
            let destination = folder.appendingPathComponent(URL(fileURLWithPath: plugin.fileName).lastPathComponent, isDirectory: true)
            try installBundleWithAdministratorPrivileges(from: downloadedURL, to: destination)
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
            let destination = folder.appendingPathComponent(bundle.lastPathComponent, isDirectory: true)
            try installBundleWithAdministratorPrivileges(from: bundle, to: destination)
            installedBundles.append(destination)
        }
        return installedBundles
    }

    var detectedInstalledPlugins: [InstalledPlugin] {
        let root = pluginInstallRoot()
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
        let root = pluginInstallRoot()
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
        try runWithAdministratorPrivileges("/bin/rm -rf -- \\(shellQuote(url.path))")
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
        let root = pluginInstallRoot()
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
            if fileManager.fileExists(atPath: url.path) {
                try runWithAdministratorPrivileges("/bin/rm -rf -- \(shellQuote(url.path))")
            }
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

    private var customerRefreshToken: String? {
        get { KeychainStore.read(key: customerRefreshTokenKey) }
        set {
            if let newValue { KeychainStore.save(newValue, key: customerRefreshTokenKey) }
            else { KeychainStore.delete(key: customerRefreshTokenKey) }
        }
    }

    private struct CustomerSubscriptionDTO {
        let status: String
        let plan: String?
        let active: Bool
        let expiresAt: String?
        let remainingSeconds: Int?
        let trialUsed: Bool
    }

    private func validFirebaseIDToken() async throws -> String {
        guard let token = customerToken else {
            throw ClientAccountError.server("Inicia sesión con tu cuenta Firebase.")
        }
        let parts = token.split(separator: ".")
        if parts.count == 3 {
            var payload = String(parts[1]).replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
            while payload.count % 4 != 0 { payload.append("=") }
            if let data = Data(base64Encoded: payload),
               let claims = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
               let expiry = claims["exp"] as? TimeInterval,
               expiry > Date().timeIntervalSince1970 + 300 {
                return token
            }
        }

        guard let refresh = customerRefreshToken else { return token }
        guard let url = URL(string: "https://securetoken.googleapis.com/v1/token?key=\(firebaseAPIKey)") else {
            throw ClientAccountError.server("No se pudo preparar la renovación segura de Firebase.")
        }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = 20
        request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        var form = URLComponents()
        form.queryItems = [
            URLQueryItem(name: "grant_type", value: "refresh_token"),
            URLQueryItem(name: "refresh_token", value: refresh)
        ]
        request.httpBody = form.percentEncodedQuery?.data(using: .utf8)
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode),
              let payload = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let newToken = payload["id_token"] as? String,
              let newRefresh = payload["refresh_token"] as? String else {
            throw ClientAccountError.server("La sesión Firebase venció. Vuelve a iniciar sesión.")
        }
        customerToken = newToken
        customerRefreshToken = newRefresh
        return newToken
    }

    private func firestoreRequest(
        _ path: String,
        method: String = "GET",
        body: Data? = nil
    ) async throws -> (Data, Int) {
        let base = "https://firestore.googleapis.com/v1/projects/\(firebaseProjectID)/databases/(default)/documents"
        guard let url = URL(string: base + path) else { throw ClientAccountError.apiNotConfigured }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.timeoutInterval = 20
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("Bearer " + (try await validFirebaseIDToken()), forHTTPHeaderField: "Authorization")
        if let body {
            request.httpBody = body
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw URLError(.badServerResponse) }
        return (data, http.statusCode)
    }

    private func firestoreError(_ data: Data, fallback: String) -> String {
        let payload = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
        let nested = payload?["error"] as? [String: Any]
        return nested?["message"] as? String ?? payload?["message"] as? String ?? fallback
    }

    private func apiRequest(_ path: String, method: String = "GET", body: Data? = nil) async throws -> (Data, Int) {
        guard !apiBaseURL.isEmpty, let url = URL(string: apiBaseURL + path) else {
            throw ClientAccountError.apiNotConfigured
        }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.timeoutInterval = 25
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("Bearer " + (try await validFirebaseIDToken()), forHTTPHeaderField: "Authorization")
        if let body {
            request.httpBody = body
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw URLError(.badServerResponse) }
        return (data, http.statusCode)
    }

    private func registerCurrentDevice() async throws {
        let deviceID: String
        if let saved = UserDefaults.standard.string(forKey: deviceIDKey), !saved.isEmpty {
            deviceID = saved
        } else {
            deviceID = UUID().uuidString.lowercased()
            UserDefaults.standard.set(deviceID, forKey: deviceIDKey)
        }
        let name = Host.current().localizedName ?? "Mac"
        let body = try JSONSerialization.data(withJSONObject: [
            "deviceId": deviceID,
            "deviceName": name,
            "platform": "macOS"
        ])
        let (data, status) = try await apiRequest("/api/customer/devices/activate", method: "POST", body: body)
        guard (200...299).contains(status) else {
            throw ClientAccountError.server(firestoreError(data, fallback: "No se pudo activar este Mac como dispositivo autorizado (HTTP \(status))."))
        }
    }

    private func fetchCustomerSubscription() async throws -> CustomerSubscriptionDTO {
        if !apiBaseURL.isEmpty {
            let (apiData, apiStatus) = try await apiRequest("/api/customer/subscription")
            if (200...299).contains(apiStatus),
               let payload = try JSONSerialization.jsonObject(with: apiData) as? [String: Any],
               let subscription = payload["subscription"] as? [String: Any] {
                let state = subscription["status"] as? String ?? "inactive"
                let plan = subscription["plan"] as? String
                let active = subscription["active"] as? Bool ?? false
                if active || (plan != nil && plan != "trial" && state != "inactive") {
                    if active && plan != "trial" { try await registerCurrentDevice() }
                    return CustomerSubscriptionDTO(
                        status: state,
                        plan: plan,
                        active: active,
                        expiresAt: subscription["expiresAt"] as? String,
                        remainingSeconds: subscription["remainingSeconds"] as? Int,
                        trialUsed: false
                    )
                }
            } else if apiStatus != 404 && apiStatus != 503 && !(200...299).contains(apiStatus) {
                throw ClientAccountError.server(firestoreError(apiData, fallback: "No se pudo consultar la licencia comercial (HTTP \(apiStatus))."))
            }
        }
        guard let uid = UserDefaults.standard.string(forKey: firebaseUIDKey), !uid.isEmpty else {
            throw ClientAccountError.server("No se encontró el identificador de tu cuenta Firebase. Inicia sesión nuevamente.")
        }
        let (data, status) = try await firestoreRequest("/ecAudioSubscriptions/\(uid)")
        if status == 404 {
            return CustomerSubscriptionDTO(
                status: "inactive", plan: nil, active: false, expiresAt: nil,
                remainingSeconds: 0, trialUsed: false
            )
        }
        guard (200...299).contains(status) else {
            throw ClientAccountError.server(firestoreError(data, fallback: "No se pudo consultar la licencia Firebase (HTTP \(status))."))
        }
        guard let document = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let fields = document["fields"] as? [String: Any] else {
            throw ClientAccountError.server("La respuesta de Firestore no tiene el formato esperado.")
        }
        let state = (fields["status"] as? [String: Any])?["stringValue"] as? String ?? "inactive"
        let plan = (fields["plan"] as? [String: Any])?["stringValue"] as? String
        let startedAtText = (fields["startedAt"] as? [String: Any])?["timestampValue"] as? String
        let trialUsed = (fields["trialUsed"] as? [String: Any])?["booleanValue"] as? Bool ?? false
        let startedAt = startedAtText.flatMap { value -> Date? in
            let formatter = ISO8601DateFormatter()
            if let date = formatter.date(from: value) { return date }
            formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            return formatter.date(from: value)
        }
        let expiry = startedAt?.addingTimeInterval(60)
        let active = state == "active" && (expiry.map { $0 > Date() } ?? false)
        let expiryText = expiry.map { ISO8601DateFormatter().string(from: $0) }
        let remaining = active ? max(0, Int(ceil((expiry?.timeIntervalSinceNow ?? 0)))) : 0
        return CustomerSubscriptionDTO(
            status: state == "active" && !active ? "expired" : state,
            plan: plan,
            active: active,
            expiresAt: expiryText,
            remainingSeconds: remaining,
            trialUsed: trialUsed
        )
    }

    func authenticateCustomer(email: String, password: String, displayName: String, register: Bool) async {
        guard !isAccountBusy else { return }
        isAccountBusy = true
        defer { isAccountBusy = false }
        do {
            let action = register ? "signUp" : "signInWithPassword"
            guard let firebaseURL = URL(string: "https://identitytoolkit.googleapis.com/v1/accounts:\(action)?key=\(firebaseAPIKey)") else {
                throw ClientAccountError.server("No se pudo preparar la conexión con Firebase.")
            }
            var firebaseRequest = URLRequest(url: firebaseURL)
            firebaseRequest.httpMethod = "POST"
            firebaseRequest.timeoutInterval = 20
            firebaseRequest.setValue("application/json", forHTTPHeaderField: "Content-Type")
            firebaseRequest.httpBody = try JSONSerialization.data(withJSONObject: [
                "email": email.trimmingCharacters(in: .whitespacesAndNewlines),
                "password": password,
                "returnSecureToken": true
            ])
            let (firebaseData, firebaseResponse) = try await URLSession.shared.data(for: firebaseRequest)
            guard let firebaseHTTP = firebaseResponse as? HTTPURLResponse else { throw URLError(.badServerResponse) }
            guard (200...299).contains(firebaseHTTP.statusCode) else {
                let payload = (try? JSONSerialization.jsonObject(with: firebaseData)) as? [String: Any]
                let error = (payload?["error"] as? [String: Any])?["message"] as? String ?? "Firebase no pudo iniciar sesión."
                throw ClientAccountError.server(error.replacingOccurrences(of: "_", with: " "))
            }
            let session = try JSONDecoder().decode(FirebaseAuthDTO.self, from: firebaseData)
            customerToken = session.idToken
            customerRefreshToken = session.refreshToken
            UserDefaults.standard.set(session.localId, forKey: firebaseUIDKey)
            accountEmail = session.email ?? email
            UserDefaults.standard.set(accountEmail, forKey: "ECAudioHubClient.accountEmail")
            let subscription = try await fetchCustomerSubscription()
            applySubscription(subscription)
            accountMessage = register ? "Cuenta Firebase creada y sincronizada con EC Audio." : "Sesión iniciada y sincronizada con EC Audio."
        } catch {
            accountMessage = error.localizedDescription
        }
    }

    func handleAuthenticationCallback(_ url: URL) async {
        guard url.scheme == "ecaudiohub", url.host == "auth",
              let fragment = url.fragment,
              let components = URLComponents(string: "https://callback.invalid/?" + fragment),
              let token = components.queryItems?.first(where: { $0.name == "idToken" })?.value,
              !token.isEmpty else {
            accountMessage = "No se pudo validar el regreso del navegador. Intenta iniciar sesión otra vez."
            return
        }
        let email = components.queryItems?.first(where: { $0.name == "email" })?.value ?? ""
        let uid = components.queryItems?.first(where: { $0.name == "uid" })?.value ?? ""
        let refreshToken = components.queryItems?.first(where: { $0.name == "refreshToken" })?.value ?? ""
        await authenticateCustomer(firebaseIDToken: token, email: email, uid: uid, refreshToken: refreshToken)
    }

    func authenticateCustomer(firebaseIDToken: String, email: String, uid: String, refreshToken: String) async {
        guard !isAccountBusy else { return }
        isAccountBusy = true
        defer { isAccountBusy = false }
        do {
            customerToken = firebaseIDToken
            if !refreshToken.isEmpty { customerRefreshToken = refreshToken }
            if !uid.isEmpty { UserDefaults.standard.set(uid, forKey: firebaseUIDKey) }
            accountEmail = email
            UserDefaults.standard.set(accountEmail, forKey: "ECAudioHubClient.accountEmail")
            let subscription = try await fetchCustomerSubscription()
            applySubscription(subscription)
            accountMessage = "Sesión Firebase sincronizada con la licencia compartida de EC Audio."
        } catch {
            accountMessage = error.localizedDescription
        }
    }

    func activateTrial() async {
        guard !isAccountBusy else { return }
        guard let uid = UserDefaults.standard.string(forKey: firebaseUIDKey), !uid.isEmpty else {
            accountMessage = "Inicia sesión antes de activar la prueba gratuita."
            return
        }
        isAccountBusy = true
        defer { isAccountBusy = false }
        do {
            let documentName = "projects/\(firebaseProjectID)/databases/(default)/documents/ecAudioSubscriptions/\(uid)"
            let bodyObject: [String: Any] = [
                "writes": [[
                    "update": [
                        "name": documentName,
                        "fields": [
                            "uid": ["stringValue": uid],
                            "email": ["stringValue": accountEmail],
                            "status": ["stringValue": "active"],
                            "plan": ["stringValue": "trial"],
                            "trialUsed": ["booleanValue": true]
                        ]
                    ],
                    "updateMask": ["fieldPaths": ["uid", "email", "status", "plan", "trialUsed"]],
                    "updateTransforms": [[
                        "fieldPath": "startedAt",
                        "setToServerValue": "REQUEST_TIME"
                    ]],
                    "currentDocument": ["exists": false]
                ]]
            ]
            let body = try JSONSerialization.data(withJSONObject: bodyObject)
            let (data, status) = try await firestoreRequest("/documents:commit", method: "POST", body: body)
            guard (200...299).contains(status) else {
                let message = firestoreError(data, fallback: "No se pudo activar la prueba gratuita (HTTP \(status)).")
                if status == 409 || message.localizedCaseInsensitiveContains("already exists") {
                    throw ClientAccountError.server("La prueba gratuita de esta cuenta ya fue utilizada.")
                }
                throw ClientAccountError.server(message)
            }
            let subscription = try await fetchCustomerSubscription()
            applySubscription(subscription)
            accountMessage = "Prueba gratuita activada durante 60 segundos. No se realizó ningún cobro."
        } catch {
            accountMessage = error.localizedDescription
        }
    }

    func checkCustomerEntitlement() async {
        guard customerToken != nil else { return }
        do {
            let subscription = try await fetchCustomerSubscription()
            applySubscription(subscription)
        } catch {
            // Un fallo de red o servidor no demuestra que la licencia haya vencido.
            accountMessage = "No se pudo verificar la licencia Firebase. Se conserva el estado actual: \(error.localizedDescription)"
        }
    }

    private func applySubscription(_ subscription: CustomerSubscriptionDTO) {
        subscriptionActive = subscription.active
        trialUsed = subscription.trialUsed
        subscriptionPlan = subscription.plan
        let expiry = subscription.remainingSeconds.map { " · \($0) s restantes" } ?? ""
        let planLabel = subscription.plan == "annual" ? "anual" : subscription.plan == "monthly" ? "mensual" : subscription.plan == "trial" ? "de prueba" : ""
        subscriptionStatus = subscription.active ? (planLabel.isEmpty ? "Acceso activo" : "Suscripción " + planLabel + " activa") + expiry :
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
        customerRefreshToken = nil
        UserDefaults.standard.removeObject(forKey: firebaseUIDKey)
        accountEmail = ""
        subscriptionActive = false
        trialUsed = false
        subscriptionStatus = "Sesión cerrada"
        UserDefaults.standard.removeObject(forKey: "ECAudioHubClient.accountEmail")
        UserDefaults.standard.set(subscriptionStatus, forKey: "ECAudioHubClient.subscriptionStatus")
        accountMessage = "Sesión cerrada. Los plugins instalados permanecen en su estado actual."
    }

    private func shellQuote(_ value: String) -> String {
        "'" + value.replacingOccurrences(of: "'", with: "'\\''") + "'"
    }

    private func runWithAdministratorPrivileges(_ command: String) throws {
        let escapedCommand = command
            .replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "\"", with: "\\\"")
        let appleScript = "do shell script \"\(escapedCommand)\" with administrator privileges"
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/osascript")
        process.arguments = ["-e", appleScript]
        let output = Pipe()
        process.standardOutput = output
        process.standardError = output
        try process.run()
        process.waitUntilExit()
        guard process.terminationStatus == 0 else {
            let data = output.fileHandleForReading.readDataToEndOfFile()
            let detail = String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines)
            throw ClientInstallError.privilegedOperationFailed(detail?.isEmpty == false ? detail! : "macOS canceló o rechazó la autorización de administrador.")
        }
    }

    private func installBundleWithAdministratorPrivileges(from source: URL, to destination: URL) throws {
        let folder = destination.deletingLastPathComponent()
        let command = "/bin/mkdir -p -- \(shellQuote(folder.path)) && /bin/rm -rf -- \(shellQuote(destination.path)) && /usr/bin/ditto \(shellQuote(source.path)) \(shellQuote(destination.path))"
        try runWithAdministratorPrivileges(command)
    }

    private func pluginInstallRoot() -> URL {
        URL(fileURLWithPath: "/Library/Audio/Plug-Ins", isDirectory: true).standardizedFileURL
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
            let destination = folder.appendingPathComponent(original.lastPathComponent, isDirectory: true)
            try runWithAdministratorPrivileges("/bin/mkdir -p -- \(shellQuote(folder.path)) && /bin/mv -- \(shellQuote(original.path)) \(shellQuote(destination.path))")
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
            try runWithAdministratorPrivileges("/bin/mkdir -p -- \(shellQuote(original.deletingLastPathComponent().path)) && /bin/mv -- \(shellQuote(source.path)) \(shellQuote(original.path))")
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
    case privilegedOperationFailed(String)

    var errorDescription: String? {
        switch self {
        case .checksumMismatch: return "La verificación SHA-256 no coincide. El archivo se rechazó por seguridad."
        case .archiveExtractionFailed: return "No se pudo extraer el ZIP."
        case .noPluginBundle: return "El ZIP no contiene un paquete AU (.component) o VST3 (.vst3)."
        case .installedBundleNotFound(let name): return "No encontré los archivos instalados de \(name)."
        case .invalidUninstallPath: return "Por seguridad, solo se pueden eliminar plugins dentro de /Library/Audio/Plug-Ins/VST3 y /Library/Audio/Plug-Ins/Components."
        case .privilegedOperationFailed(let message): return "No se pudo completar la operación con permisos de administrador: \(message)"
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
