import Foundation

struct ReleaseAsset: Decodable {
    let name: String
    let browserDownloadURL: URL
    let size: Int

    enum CodingKeys: String, CodingKey {
        case name
        case browserDownloadURL = "browser_download_url"
        case size
    }
}

struct GitHubRelease: Decodable {
    let id: Int
    let tagName: String
    let name: String?
    let body: String?
    let assets: [ReleaseAsset]
    let draft: Bool
    let prerelease: Bool

    enum CodingKeys: String, CodingKey {
        case id
        case tagName = "tag_name"
        case name, body, assets, draft, prerelease
    }
}

struct HubPlugin: Identifiable {
    let id: String
    let name: String
    let version: String
    let fileName: String
    let sha256: String
    let downloadURL: URL
    let size: Int
    let releaseNotes: String
    let imageURL: URL?

    var fileExtension: String {
        URL(fileURLWithPath: fileName).pathExtension.lowercased()
    }

    var formatLabel: String {
        switch fileExtension {
        case "zip": return "AU / VST3 · ZIP"
        case "pkg": return "INSTALADOR PKG"
        case "dmg": return "IMAGEN DMG"
        case "vst3": return "VST3"
        case "component": return "AUDIO UNIT"
        default: return fileExtension.uppercased()
        }
    }

    var sizeLabel: String {
        ByteCountFormatter.string(fromByteCount: Int64(size), countStyle: .file)
    }
}
