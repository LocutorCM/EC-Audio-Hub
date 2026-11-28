import Foundation
import AppKit

struct ClientAppUpdate: Identifiable {
    let id: String
    let version: String
    let downloadURL: URL
    let releaseURL: URL
    let notes: String
}

@MainActor
final class ClientUpdater: ObservableObject {
    @Published private(set) var availableUpdate: ClientAppUpdate?
    @Published var isChecking = false
    @Published var isInstalling = false
    @Published var errorMessage: String?

    private let releaseAPI = URL(string: "https://api.github.com/repos/LocutorCM/EC-Audio-Hub/releases/latest")!
    private let assetName = "EC-Audio-Hub-Client-macOS-Universal.zip"

    func checkForUpdates() async {
        guard !isChecking, !isInstalling else { return }
        isChecking = true
        defer { isChecking = false }
        do {
            var request = URLRequest(url: releaseAPI)
            request.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
            request.setValue("EC-Audio-Hub-Client", forHTTPHeaderField: "User-Agent")
            request.timeoutInterval = 25
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
                throw URLError(.badServerResponse)
            }
            let release = try JSONDecoder().decode(UpdateRelease.self, from: data)
            guard !release.draft, !release.prerelease,
                  release.tagName.hasPrefix("client-hub-"),
                  let asset = release.assets.first(where: { $0.name == assetName }),
                  let releaseURL = URL(string: release.htmlURL) else {
                availableUpdate = nil
                return
            }
            let current = Int(Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "0") ?? 0
            let latest = Int(release.tagName.replacingOccurrences(of: "client-hub-", with: "")) ?? 0
            guard latest > current else {
                availableUpdate = nil
                return
            }
            availableUpdate = ClientAppUpdate(
                id: release.tagName,
                version: String(latest),
                downloadURL: asset.downloadURL,
                releaseURL: releaseURL,
                notes: release.body ?? "Mejoras y correcciones de EC Audio Hub Client."
            )
        } catch {
            // Los fallos de consulta no interrumpen el uso normal del Client.
        }
    }

    func installUpdate() async {
        guard let update = availableUpdate, !isInstalling else { return }
        isInstalling = true
        defer { isInstalling = false }
        do {
            let targetApp = Bundle.main.bundleURL.standardizedFileURL
            guard targetApp.pathExtension == "app",
                  targetApp.path.contains("/Applications/") ||
                    targetApp.path.hasPrefix(FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Applications").path) else {
                throw UpdateError.unsupportedInstallLocation
            }

            var request = URLRequest(url: update.downloadURL)
            request.setValue("application/octet-stream,*/*", forHTTPHeaderField: "Accept")
            request.setValue("EC-Audio-Hub-Client", forHTTPHeaderField: "User-Agent")
            request.timeoutInterval = 600
            let (archive, response) = try await URLSession.shared.download(for: request)
            guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
                throw URLError(.badServerResponse)
            }

            let staging = FileManager.default.temporaryDirectory.appendingPathComponent("ECAudioHubUpdate-\(UUID().uuidString)", isDirectory: true)
            try FileManager.default.createDirectory(at: staging, withIntermediateDirectories: true)
            defer { try? FileManager.default.removeItem(at: staging) }

            let extracted = staging.appendingPathComponent("Extracted", isDirectory: true)
            try FileManager.default.createDirectory(at: extracted, withIntermediateDirectories: true)
            let unzip = Process()
            unzip.executableURL = URL(fileURLWithPath: "/usr/bin/ditto")
            unzip.arguments = ["-x", "-k", archive.path, extracted.path]
            try unzip.run()
            unzip.waitUntilExit()
            guard unzip.terminationStatus == 0 else { throw UpdateError.archiveExtractionFailed }

            let candidate = extracted.appendingPathComponent("EC Audio Hub Client.app", isDirectory: true)
            guard FileManager.default.fileExists(atPath: candidate.path),
                  Bundle(url: candidate)?.bundleIdentifier == "com.ecaudio.hub.client" else {
                throw UpdateError.invalidApplication
            }

            let command = "/usr/bin/killall -TERM EC-Audio-Hub-Client >/dev/null 2>&1 || true; /bin/sleep 2; /bin/rm -rf -- \(shellQuote(targetApp.path)); /usr/bin/ditto \(shellQuote(candidate.path)) \(shellQuote(targetApp.path)); /usr/bin/xattr -dr com.apple.quarantine \(shellQuote(targetApp.path)) >/dev/null 2>&1 || true; /usr/bin/open \(shellQuote(targetApp.path))"
            let escaped = command.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "\"", with: "\\\"")
            let script = "do shell script \"\(escaped)\" with administrator privileges"
            let installer = Process()
            installer.executableURL = URL(fileURLWithPath: "/usr/bin/osascript")
            installer.arguments = ["-e", script]
            try installer.run()
            installer.waitUntilExit()
            guard installer.terminationStatus == 0 else { throw UpdateError.installationCancelled }
            availableUpdate = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func shellQuote(_ value: String) -> String {
        "'" + value.replacingOccurrences(of: "'", with: "'\\''") + "'"
    }
}

private struct UpdateRelease: Decodable {
    let tagName: String
    let htmlURL: String
    let body: String?
    let draft: Bool
    let prerelease: Bool
    let assets: [UpdateAsset]

    enum CodingKeys: String, CodingKey {
        case tagName = "tag_name"
        case htmlURL = "html_url"
        case body, draft, prerelease, assets
    }
}

private struct UpdateAsset: Decodable {
    let name: String
    let downloadURL: URL
    enum CodingKeys: String, CodingKey {
        case name
        case downloadURL = "browser_download_url"
    }
}

private enum UpdateError: LocalizedError {
    case unsupportedInstallLocation
    case archiveExtractionFailed
    case invalidApplication
    case installationCancelled

    var errorDescription: String? {
        switch self {
        case .unsupportedInstallLocation:
            return "Mueve EC Audio Hub Client a la carpeta Aplicaciones antes de actualizarlo."
        case .archiveExtractionFailed:
            return "No se pudo extraer el paquete de actualización."
        case .invalidApplication:
            return "El paquete descargado no es una versión válida de EC Audio Hub Client."
        case .installationCancelled:
            return "La actualización fue cancelada o macOS no autorizó el reemplazo."
        }
    }
}
