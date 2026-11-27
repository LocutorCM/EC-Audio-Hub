import Foundation

enum PluginFormat: String, CaseIterable, Codable, Identifiable {
    case vst3 = "VST3", au = "Audio Unit", aax = "AAX", standalone = "Standalone", other = "Otro"
    var id: String { rawValue }
}

struct Plugin: Identifiable, Codable, Hashable {
    var id: UUID = UUID()
    var name: String
    var maker: String
    var version: String
    var format: PluginFormat
    var category: String
    var downloadURL: URL
    var notes: String = ""
}
