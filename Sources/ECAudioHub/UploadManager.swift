import Foundation
import Combine
import CryptoKit
import Security
import UniformTypeIdentifiers

private enum GitHubTokenStore {
    private static let service = "com.ecaudio.hub.github"
    static func save(_ token: String) {
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service, kSecAttrAccount as String: "release-token",
            kSecValueData as String: Data(token.utf8)]
        SecItemDelete(query as CFDictionary)
        SecItemAdd(query as CFDictionary, nil)
    }
    static func read() -> String? {
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service, kSecAttrAccount as String: "release-token",
            kSecReturnData as String: true, kSecMatchLimit as String: kSecMatchLimitOne]
        var result: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
              let data = result as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }
    static func clear() {
        SecItemDelete([kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service, kSecAttrAccount as String: "release-token"] as CFDictionary)
    }
}

@MainActor
final class UploadManager: ObservableObject {
    @Published var repositoryOwner = UserDefaults.standard.string(forKey: "ECGHOwner") ?? "LocutorCM" {
        didSet { UserDefaults.standard.set(repositoryOwner, forKey: "ECGHOwner") }
    }
    @Published var repositoryName = UserDefaults.standard.string(forKey: "ECGHRepo") ?? "EC-Audio-Hub" {
        didSet { UserDefaults.standard.set(repositoryName, forKey: "ECGHRepo") }
    }
    @Published var githubToken = ""
    @Published var pluginName = ""
    @Published var version = "1.0.0"
    @Published private(set) var isAuthenticated = GitHubTokenStore.read() != nil
    @Published private(set) var isConnecting = false
    @Published private(set) var isUploading = false
    @Published private(set) var selectedFile: URL?
    @Published private(set) var status = "Conecta tu cuenta de GitHub para publicar releases."
    @Published private(set) var lastUploaded = ""
    @Published var errorMessage: String?

    private var token: String? = GitHubTokenStore.read()
    private let session = URLSession.shared
    private let api = "https://api.github.com"

    func selectFile(_ url: URL) {
        selectedFile = url
        if pluginName.trimmingCharacters(in: .whitespaces).isEmpty {
            pluginName = url.deletingPathExtension().lastPathComponent
        }
        status = "Archivo seleccionado y listo para publicar."
        errorMessage = nil
    }
    func clearFile() { selectedFile = nil }

    func connectGitHub() async {
        let value = githubToken.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty else { errorMessage = "Pega un token de GitHub."; return }
        isConnecting = true
        defer { isConnecting = false }
        do {
            var request = URLRequest(url: URL(string: api + "/user")!)
            request.setValue("Bearer \(value)", forHTTPHeaderField: "Authorization")
            request.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
            request.setValue("2022-11-28", forHTTPHeaderField: "X-GitHub-Api-Version")
            let (data, response) = try await session.data(for: request)
            guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
                throw UploadError.message("GitHub rechazó el token. Verifica que sea válido.")
            }
            let user = try JSONDecoder().decode(GitHubUser.self, from: data)
            token = value
            GitHubTokenStore.save(value)
            githubToken = ""
            isAuthenticated = true
            status = "Conectado a GitHub como @\(user.login)."
        } catch { errorMessage = error.localizedDescription }
    }

    func logout() {
        token = nil
        GitHubTokenStore.clear()
        isAuthenticated = false
        selectedFile = nil
        status = "Token desconectado."
    }

    func uploadSelectedFile() async {
        guard let source = selectedFile, let token else {
            errorMessage = "Conecta GitHub y selecciona un archivo."
            return
        }
        let owner = repositoryOwner.trimmingCharacters(in: .whitespacesAndNewlines)
        let repo = repositoryName.trimmingCharacters(in: .whitespacesAndNewlines)
        let name = pluginName.trimmingCharacters(in: .whitespacesAndNewlines)
        let releaseVersion = version.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !owner.isEmpty, !repo.isEmpty, !name.isEmpty, !releaseVersion.isEmpty else {
            errorMessage = "Completa propietario, repositorio, nombre del plugin y versión."
            return
        }
        let access = source.startAccessingSecurityScopedResource()
        defer { if access { source.stopAccessingSecurityScopedResource() } }
        isUploading = true
        errorMessage = nil
        defer { isUploading = false }

        var uploadFile = source
        var createdArchive: URL?
        do {
            guard FileManager.default.fileExists(atPath: source.path) else {
                throw UploadError.message("No se puede acceder al archivo seleccionado.")
            }
            let isDirectory = (try FileManager.default.attributesOfItem(atPath: source.path)[.type] as? FileAttributeType) == .typeDirectory
            if isDirectory {
                let archive = FileManager.default.temporaryDirectory.appendingPathComponent(source.lastPathComponent + ".zip")
                try? FileManager.default.removeItem(at: archive)
                let process = Process()
                process.executableURL = URL(fileURLWithPath: "/usr/bin/ditto")
                process.arguments = ["-c", "-k", "--sequesterRsrc", "--keepParent", source.path, archive.path]
                try process.run()
                process.waitUntilExit()
                guard process.terminationStatus == 0 else { throw UploadError.message("No se pudo comprimir el plugin.") }
                uploadFile = archive
                createdArchive = archive
            }
            defer { if let createdArchive { try? FileManager.default.removeItem(at: createdArchive) } }

            let fileName = uploadFile.lastPathComponent
            let checksum = try sha256(of: uploadFile)
            let slug = name.lowercased().replacingOccurrences(of: "[^a-z0-9]+", with: "-", options: .regularExpression).trimmingCharacters(in: CharacterSet(charactersIn: "-"))
            let tag = "\(slug)-v\(releaseVersion)"
            status = "Creando release en GitHub…"
            let release = try await createRelease(owner: owner, repo: repo, token: token,
                tag: tag, title: "\(name) · v\(releaseVersion)",
                body: """
                EC_AUDIO_PLUGIN_RELEASE
                plugin_name: \(name)
                version: \(releaseVersion)
                file_name: \(fileName)
                sha256: \(checksum)
                """)
            guard let uploadTemplate = release.uploadURL,
                  let uploadURL = URL(string: uploadTemplate.replacingOccurrences(of: "{?name,label}", with: "")) else {
                throw UploadError.message("GitHub creó el release, pero no devolvió una dirección para subir el archivo.")
            }
            var components = URLComponents(url: uploadURL, resolvingAgainstBaseURL: false)!
            components.queryItems = [URLQueryItem(name: "name", value: fileName)]
            guard let finalURL = components.url else { throw UploadError.message("URL de subida inválida.") }
            var request = URLRequest(url: finalURL)
            request.httpMethod = "POST"
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
            request.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
            request.setValue(UTType(filenameExtension: uploadFile.pathExtension)?.preferredMIMEType ?? "application/octet-stream", forHTTPHeaderField: "Content-Type")
            request.setValue("2022-11-28", forHTTPHeaderField: "X-GitHub-Api-Version")
            request.timeoutInterval = 3600
            status = "Subiendo \(fileName) a GitHub Releases…"
            let (data, response) = try await session.upload(for: request, fromFile: uploadFile)
            guard let http = response as? HTTPURLResponse, (200...201).contains(http.statusCode) else {
                let detail = (try? JSONDecoder().decode(GitHubError.self, from: data).message) ?? "HTTP \((response as? HTTPURLResponse)?.statusCode ?? 0)"
                throw UploadError.message("No se pudo subir el asset: \(detail)")
            }
            lastUploaded = "\(name) v\(releaseVersion)"
            status = "Publicado correctamente en GitHub Releases."
            selectedFile = nil
        } catch {
            errorMessage = error.localizedDescription
            status = "No se pudo completar la publicación."
        }
    }

    private func createRelease(owner: String, repo: String, token: String, tag: String, title: String, body: String) async throws -> GitHubRelease {
        let url = URL(string: "\(api)/repos/\(owner)/\(repo)/releases")!
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
        request.setValue("2022-11-28", forHTTPHeaderField: "X-GitHub-Api-Version")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: [
            "tag_name": tag, "name": title, "body": body, "draft": false, "prerelease": false,
            "target_commitish": "main"
        ])
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse, (200...201).contains(http.statusCode) else {
            let detail = (try? JSONDecoder().decode(GitHubError.self, from: data).message) ?? "HTTP \((response as? HTTPURLResponse)?.statusCode ?? 0)"
            if detail.lowercased().contains("already_exists") || detail.lowercased().contains("already_exists") {
                throw UploadError.message("Ya existe la versión \(tag). Cambia el número de versión para publicar otra actualización.")
            }
            throw UploadError.message("No se pudo crear el release: \(detail). Revisa el permiso Contents: Read and write del token.")
        }
        return try JSONDecoder().decode(GitHubRelease.self, from: data)
    }

    private func sha256(of url: URL) throws -> String {
        let handle = try FileHandle(forReadingFrom: url)
        defer { try? handle.close() }
        var hasher = SHA256()
        while true {
            let data = try handle.read(upToCount: 1024 * 1024) ?? Data()
            if data.isEmpty { break }
            hasher.update(data: data)
        }
        return hasher.finalize().map { String(format: "%02x", $0) }.joined()
    }
}

private struct GitHubUser: Decodable { let login: String }
private struct GitHubRelease: Decodable {
    let uploadURL: String?
    enum CodingKeys: String, CodingKey { case uploadURL = "upload_url" }
}
private struct GitHubError: Decodable { let message: String? }
private enum UploadError: LocalizedError {
    case message(String)
    var errorDescription: String? { if case .message(let value) = self { return value }; return nil }
}
