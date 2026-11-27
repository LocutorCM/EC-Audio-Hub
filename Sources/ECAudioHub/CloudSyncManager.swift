import Foundation
import Combine
import CryptoKit
import Security
import AppKit

struct CloudPlugin: Identifiable, Codable, Hashable {
    let id: String
    var name: String
    var manufacturer: String
    var version: String
    var category: String
    var description: String
    var changelog: String
    var fileName: String
    var contentType: String
    var sizeBytes: Int64
    var sha256: String
    var published: Bool
    var createdAt: String
    var updatedAt: String
    var cachedPath: String?
    var cachedVersion: String?

    var isCached: Bool {
        guard let cachedPath, cachedVersion == version else { return false }
        return FileManager.default.fileExists(atPath: cachedPath)
    }

    var formattedSize: String {
        let mb = Double(sizeBytes) / 1_048_576
        return mb < 1 ? "\(max(1, Int(Double(sizeBytes) / 1024))) KB" : String(format: "%.1f MB", mb)
    }
}

private enum SecureToken {
    private static let service = "com.ecaudio.hub.cloud"
    static func save(_ token: String) {
        let data = Data(token.utf8)
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
                                    kSecAttrService as String: service,
                                    kSecAttrAccount as String: "session",
                                    kSecValueData as String: data]
        SecItemDelete(query as CFDictionary)
        SecItemAdd(query as CFDictionary, nil)
    }
    static func read() -> String? {
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
                                    kSecAttrService as String: service,
                                    kSecAttrAccount as String: "session",
                                    kSecReturnData as String: true,
                                    kSecMatchLimit as String: kSecMatchLimitOne]
        var result: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
              let data = result as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }
    static func clear() {
        SecItemDelete([kSecClass as String: kSecClassGenericPassword,
                       kSecAttrService as String: service,
                       kSecAttrAccount as String: "session"] as CFDictionary)
    }
}

@MainActor
final class CloudSyncManager: ObservableObject {
    @Published private(set) var plugins: [CloudPlugin] = []
    @Published private(set) var isOnline = false
    @Published private(set) var isAuthenticated = false
    @Published private(set) var isSyncing = false
    @Published private(set) var status = "Conecta con EC Audio Cloud"
    @Published var searchText = ""
    @Published var selectedCategory = "Todos"
    @Published var serverURL: String {
        didSet { UserDefaults.standard.set(serverURL, forKey: "ECAudioCloudURL") }
    }

    private var token: String? = SecureToken.read()
    private var socket: URLSessionWebSocketTask?
    private var syncTask: Task<Void, Never>?
    private let session = URLSession.shared
    private let encoder = JSONEncoder()
    private let decoder = JSONDecoder()
    private let catalogFile: URL
    private let cacheFolder: URL

    init() {
        serverURL = UserDefaults.standard.string(forKey: "ECAudioCloudURL") ?? ""
        let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("EC Audio Hub", isDirectory: true)
        cacheFolder = support.appendingPathComponent("Offline Installers", isDirectory: true)
        catalogFile = support.appendingPathComponent("cloud-catalog.json")
        try? FileManager.default.createDirectory(at: cacheFolder, withIntermediateDirectories: true)
        loadOfflineCatalog()
        isAuthenticated = token != nil
        if token != nil { startSync() }
    }

    var categories: [String] {
        ["Todos"] + Array(Set(plugins.map(\.category))).sorted()
    }

    var filtered: [CloudPlugin] {
        plugins.filter {
            (selectedCategory == "Todos" || $0.category == selectedCategory) &&
            (searchText.isEmpty || [$0.name, $0.manufacturer, $0.category, $0.description]
                .joined(separator: " ").localizedCaseInsensitiveContains(searchText))
        }
    }

    func login(email: String, password: String, baseURL: String) async throws {
        let normalized = baseURL.trimmingCharacters(in: .whitespacesAndNewlines).trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        guard let base = URL(string: normalized), base.scheme == "https", base.host != nil else {
            throw CloudError.message("Usa la dirección HTTPS de tu servidor EC Audio Cloud.")
        }
        serverURL = normalized
        guard let loginURL = endpoint("api/auth/login") else { throw CloudError.message("Dirección del servidor inválida.") }\n        var request = URLRequest(url: loginURL)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: ["email": email, "password": password])
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
            let message = (try? JSONDecoder().decode(APIError.self, from: data).error) ?? "No se pudo iniciar sesión."
            throw CloudError.message(message)
        }
        let result = try decoder.decode(LoginResponse.self, from: data)
        token = result.token
        SecureToken.save(result.token)
        isAuthenticated = true
        startSync()
        try await syncCatalog()
    }

    func logout() {
        syncTask?.cancel()
        socket?.cancel(with: .goingAway, reason: nil)
        socket = nil
        token = nil
        SecureToken.clear()
        isAuthenticated = false
        isOnline = false
        status = "Sesión cerrada. Los instaladores guardados permanecen disponibles."
    }

    func syncCatalog() async throws {
        guard let requestURL = endpoint("api/catalog"), let token else {
            throw CloudError.message("Configura el servidor e inicia sesión.")
        }
        isSyncing = true
        defer { isSyncing = false }
        var request = URLRequest(url: requestURL)
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.timeoutInterval = 20
        do {
            let (data, response) = try await session.data(for: request)
            guard let http = response as? HTTPURLResponse else { throw CloudError.message("Respuesta del servidor inválida.") }
            if http.statusCode == 401 { logout(); throw CloudError.message("Tu sesión expiró. Inicia sesión otra vez.") }
            guard (200...299).contains(http.statusCode) else { throw CloudError.message("El servidor respondió \(http.statusCode).") }
            let decoded = try decoder.decode(CatalogResponse.self, from: data)
            let oldCache = Dictionary(uniqueKeysWithValues: plugins.compactMap { plugin in
                plugin.cachedPath.map { (plugin.id, ($0, plugin.cachedVersion)) }
            })
            plugins = decoded.plugins.map { item in
                var copy = item
                if let cached = oldCache[item.id], cached.1 == item.version {
                    copy.cachedPath = cached.0
                    copy.cachedVersion = cached.1
                }
                return copy
            }
            isOnline = true
            status = "Catálogo sincronizado · \(plugins.count) plugins"
            saveOfflineCatalog()
        } catch {
            isOnline = false
            if plugins.isEmpty { status = "Sin conexión. Conecta para descargar el catálogo por primera vez." }
            else { status = "Modo sin conexión · mostrando catálogo guardado" }
            throw error
        }
    }

    func download(_ plugin: CloudPlugin) async throws -> URL {
        if plugin.isCached, let path = plugin.cachedPath { return URL(fileURLWithPath: path) }
        guard let url = endpoint("api/plugins/\(plugin.id)/download"), let token else {
            throw CloudError.message("Inicia sesión y sincroniza para descargar este plugin.")
        }
        var request = URLRequest(url: url)
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.timeoutInterval = 600
        let (temporary, response) = try await session.download(for: request)
        guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
            throw CloudError.message("No se pudo descargar el instalador.")
        }
        let expected = http.value(forHTTPHeaderField: "X-Checksum-SHA256")?.lowercased()
        let data = try Data(contentsOf: temporary, options: .mappedIfSafe)
        let actual = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
        if let expected, expected != actual { throw CloudError.message("El instalador no pasó la verificación SHA-256.") }
        let safeName = URL(fileURLWithPath: plugin.fileName).lastPathComponent
        let destination = cacheFolder.appendingPathComponent("\(plugin.id)-\(safeName)")
        try? FileManager.default.removeItem(at: destination)
        try FileManager.default.moveItem(at: temporary, to: destination)
        if let index = plugins.firstIndex(where: { $0.id == plugin.id }) {
            plugins[index].cachedPath = destination.path
            plugins[index].cachedVersion = plugin.version
            saveOfflineCatalog()
        }
        return destination
    }

    func openCached(_ plugin: CloudPlugin) throws {
        guard plugin.isCached, let path = plugin.cachedPath else {
            throw CloudError.message("Este instalador todavía no está guardado en este Mac.")
        }
        NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: path)])
    }

    func startSync() {
        syncTask?.cancel()
        syncTask = Task { [weak self] in
            guard let self else { return }
            while !Task.isCancelled {
                do { try await self.syncCatalog() } catch { }
                self.connectLive()
                try? await Task.sleep(nanoseconds: 60_000_000_000)
            }
        }
    }

    private func connectLive() {
        guard let token, let base = URL(string: serverURL) else { return }
        var components = URLComponents(url: base, resolvingAgainstBaseURL: false)
        components?.scheme = base.scheme == "https" ? "wss" : "ws"
        components?.path = "/api/live"
        components?.queryItems = [URLQueryItem(name: "token", value: token)]
        guard let url = components?.url else { return }
        socket?.cancel(with: .goingAway, reason: nil)
        let task = session.webSocketTask(with: url)
        socket = task
        task.resume()
        Task { [weak self, weak task] in
            guard let self, let task else { return }
            while !Task.isCancelled {
                do {
                    let message = try await task.receive()
                    if case .string(let text) = message, text.contains("catalog.changed") {
                        try? await self.syncCatalog()
                    }
                } catch { break }
            }
        }
    }

    private func endpoint(_ path: String) -> URL? {
        guard let base = URL(string: serverURL), base.scheme == "https" else { return nil }
        return base.appendingPathComponent(path)
    }

    private func loadOfflineCatalog() {
        guard let data = try? Data(contentsOf: catalogFile),
              let saved = try? decoder.decode(CatalogResponse.self, from: data) else { return }
        plugins = saved.plugins
        status = "Modo sin conexión · catálogo guardado"
    }

    private func saveOfflineCatalog() {
        guard let data = try? encoder.encode(CatalogResponse(plugins: plugins)) else { return }
        try? data.write(to: catalogFile, options: .atomic)
    }
}

private struct CatalogResponse: Codable { var plugins: [CloudPlugin] }
private struct LoginResponse: Codable { let token: String }
private struct APIError: Codable { let error: String? }
enum CloudError: LocalizedError {
    case message(String)
    var errorDescription: String? { if case .message(let value) = self { return value }; return nil }
}
