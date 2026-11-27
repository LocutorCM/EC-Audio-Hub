import Foundation
import Combine
import Security
import UniformTypeIdentifiers

private enum AdminTokenStore {
    private static let service = "com.ecaudio.hub.admin"
    static func save(_ token: String) {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: "admin-session",
            kSecValueData as String: Data(token.utf8)
        ]
        SecItemDelete(query as CFDictionary)
        SecItemAdd(query as CFDictionary, nil)
    }
    static func read() -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: "admin-session",
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]
        var result: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
              let data = result as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }
    static func clear() {
        SecItemDelete([
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: "admin-session"
        ] as CFDictionary)
    }
}

@MainActor
final class UploadManager: ObservableObject {
    @Published var serverURL: String {
        didSet { UserDefaults.standard.set(serverURL, forKey: "ECAudioAdminServerURL") }
    }
    @Published var email = ""
    @Published var password = ""
    @Published private(set) var isAuthenticated = false
    @Published private(set) var isConnecting = false
    @Published private(set) var isUploading = false
    @Published private(set) var selectedFile: URL?
    @Published private(set) var status = "Conecta con tu servidor EC Audio."
    @Published private(set) var lastUploaded = ""
    @Published var errorMessage: String?

    private var token: String? = AdminTokenStore.read()
    private let session = URLSession.shared

    init() {
        serverURL = UserDefaults.standard.string(forKey: "ECAudioAdminServerURL") ?? ""
        isAuthenticated = token != nil
        if isAuthenticated { status = "Sesión guardada. Selecciona un archivo para subir." }
    }

    func selectFile(_ url: URL) {
        selectedFile = url
        status = "Archivo seleccionado y listo para subir."
        errorMessage = nil
    }

    func clearFile() {
        selectedFile = nil
    }

    func login() async {
        let normalized = serverURL.trimmingCharacters(in: .whitespacesAndNewlines).trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        guard let base = URL(string: normalized), base.scheme == "https", base.host != nil else {
            errorMessage = "Introduce la dirección HTTPS de tu servidor EC Audio."
            return
        }
        guard !email.isEmpty, !password.isEmpty else {
            errorMessage = "Escribe tu correo y contraseña de administrador."
            return
        }
        isConnecting = true
        errorMessage = nil
        defer { isConnecting = false }
        do {
            guard let url = endpoint("api/auth/login", base: normalized) else {
                throw UploadError.message("La dirección del servidor no es válida.")
            }
            var request = URLRequest(url: url)
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONSerialization.data(withJSONObject: ["email": email, "password": password])
            let (data, response) = try await session.data(for: request)
            guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
                let apiError = try? JSONDecoder().decode(APIError.self, from: data)
                throw UploadError.message(apiError?.error ?? "No se pudo iniciar sesión.")
            }
            let result = try JSONDecoder().decode(LoginResponse.self, from: data)
            guard result.user.role == "admin" else {
                throw UploadError.message("Esta aplicación solo permite acceso a la cuenta administradora.")
            }
            serverURL = normalized
            token = result.token
            AdminTokenStore.save(result.token)
            password = ""
            isAuthenticated = true
            status = "Conectado como administrador. Ya puedes subir archivos."
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func logout() {
        token = nil
        AdminTokenStore.clear()
        isAuthenticated = false
        selectedFile = nil
        status = "Sesión cerrada."
    }

    func uploadSelectedFile() async {
        guard let file = selectedFile else {
            errorMessage = "Primero selecciona un archivo."
            return
        }
        guard let token else {
            errorMessage = "Inicia sesión como administrador para subir archivos."
            return
        }
        let didStartAccess = file.startAccessingSecurityScopedResource()
        defer { if didStartAccess { file.stopAccessingSecurityScopedResource() } }

        isUploading = true
        errorMessage = nil
        status = "Preparando archivo para subir…"
        defer { isUploading = false }

        let temporaryBody = FileManager.default.temporaryDirectory
            .appendingPathComponent("ec-audio-upload-\(UUID().uuidString).multipart")
        do {
            guard FileManager.default.fileExists(atPath: file.path) else {
                throw UploadError.message("No se puede acceder al archivo seleccionado.")
            }
            let boundary = "EC-Audio-\(UUID().uuidString)"
            let sourceIsDirectory = (try FileManager.default.attributesOfItem(atPath: file.path)[.type] as? FileAttributeType) == .typeDirectory
            let uploadSource: URL
            let uploadFileName: String
            if sourceIsDirectory {
                let archive = FileManager.default.temporaryDirectory
                    .appendingPathComponent(file.lastPathComponent + "-\(UUID().uuidString).zip")
                let process = Process()
                process.executableURL = URL(fileURLWithPath: "/usr/bin/ditto")
                process.arguments = ["-c", "-k", "--sequesterRsrc", "--keepParent", file.path, archive.path]
                try process.run()
                process.waitUntilExit()
                guard process.terminationStatus == 0 else {
                    throw UploadError.message("No se pudo comprimir el plugin. Intenta crear un ZIP manualmente.")
                }
                uploadSource = archive
                uploadFileName = file.lastPathComponent + ".zip"
            } else {
                uploadSource = file
                uploadFileName = file.lastPathComponent
            }
            defer {
                try? FileManager.default.removeItem(at: temporaryBody)
                if sourceIsDirectory { try? FileManager.default.removeItem(at: uploadSource) }
            }
            try createMultipartFile(source: uploadSource, fileName: uploadFileName, destination: temporaryBody, boundary: boundary)

            guard let url = endpoint("api/admin/files") else {
                throw UploadError.message("Configura una dirección HTTPS válida.")
            }
            var request = URLRequest(url: url)
            request.httpMethod = "POST"
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
            request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
            request.setValue(String((try FileManager.default.attributesOfItem(atPath: temporaryBody.path)[.size] as? NSNumber)?.intValue ?? 0), forHTTPHeaderField: "Content-Length")
            request.timeoutInterval = 3600

            status = "Subiendo \(file.lastPathComponent)…"
            let (data, response) = try await session.upload(for: request, fromFile: temporaryBody)
            guard let http = response as? HTTPURLResponse else {
                throw UploadError.message("El servidor no devolvió una respuesta válida.")
            }
            if http.statusCode == 401 {
                logout()
                throw UploadError.message("La sesión expiró. Inicia sesión otra vez.")
            }
            guard (200...299).contains(http.statusCode) else {
                let apiError = try? JSONDecoder().decode(APIError.self, from: data)
                throw UploadError.message(apiError?.error ?? "El servidor respondió \(http.statusCode).")
            }
            let result = try JSONDecoder().decode(UploadResponse.self, from: data)
            lastUploaded = result.fileName
            status = "Archivo subido correctamente."
            selectedFile = nil
        } catch {
            errorMessage = error.localizedDescription
            status = "No se pudo completar la subida."
        }
    }

    private func endpoint(_ path: String, base: String? = nil) -> URL? {
        let value = base ?? serverURL
        guard let root = URL(string: value), root.scheme == "https" else { return nil }
        var components = URLComponents(url: root, resolvingAgainstBaseURL: false)
        components?.path = "/" + path
        return components?.url
    }

    private func createMultipartFile(source: URL, fileName originalName: String, destination: URL, boundary: String) throws {
        let fileName = originalName.replacingOccurrences(of: "\"", with: "")
        let mime = UTType(filenameExtension: source.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
        let prefix = "--\(boundary)\r\nContent-Disposition: form-data; name=\"installer\"; filename=\"\(fileName)\"\r\nContent-Type: \(mime)\r\n\r\n"
        let suffix = "\r\n--\(boundary)--\r\n"
        FileManager.default.createFile(atPath: destination.path, contents: nil)
        let output = try FileHandle(forWritingTo: destination)
        let input = try FileHandle(forReadingFrom: source)
        defer {
            try? input.close()
            try? output.close()
        }
        try output.write(contentsOf: Data(prefix.utf8))
        while true {
            let chunk = try input.read(upToCount: 1024 * 1024) ?? Data()
            if chunk.isEmpty { break }
            try output.write(contentsOf: chunk)
        }
        try output.write(contentsOf: Data(suffix.utf8))
    }
}

private struct LoginResponse: Decodable {
    struct User: Decodable { let role: String }
    let token: String
    let user: User
}
private struct UploadResponse: Decodable {
    let id: String
    let fileName: String
    let sizeBytes: Int64
    let sha256: String
}
private struct APIError: Decodable { let error: String? }
private enum UploadError: LocalizedError {
    case message(String)
    var errorDescription: String? {
        if case .message(let value) = self { return value }
        return nil
    }
}
