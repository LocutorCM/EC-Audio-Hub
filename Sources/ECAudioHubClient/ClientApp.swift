import SwiftUI

@main
struct ECAudioHubClientApp: App {
    @StateObject private var library = ClientLibrary()

    var body: some Scene {
        WindowGroup {
            ClientView()
                .environmentObject(library)
                .frame(minWidth: 900, minHeight: 640)
        }
        .windowStyle(.hiddenTitleBar)
    }
}
