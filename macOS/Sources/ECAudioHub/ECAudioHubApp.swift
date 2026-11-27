import SwiftUI
@main
struct ECAudioHubApp: App {
    @StateObject private var library = PluginLibrary()
    var body: some Scene {
        WindowGroup {
            HubView().environmentObject(library)
                .frame(minWidth: 900, minHeight: 620)
                .preferredColorScheme(.dark)
        }
        .windowStyle(.hiddenTitleBar)
    }
}
