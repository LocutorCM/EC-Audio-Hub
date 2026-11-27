import SwiftUI

@main
struct ECAudioHubApp: App {
    @StateObject private var library = PluginLibrary()
    var body: some Scene {
        WindowGroup {
            HubView()
                .environmentObject(library)
                .frame(minWidth: 980, minHeight: 640)
        }
        .windowStyle(.hiddenTitleBar)
    }
}
