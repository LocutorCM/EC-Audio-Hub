import SwiftUI

@main
struct ECAudioHubClientApp: App {
    @StateObject private var library = ClientLibrary()

    var body: some Scene {
        WindowGroup {
            ClientView()
                .environmentObject(library)
                .frame(minWidth: 900, minHeight: 640)
                .onOpenURL { url in
                    Task { await library.handleAuthenticationCallback(url) }
                }
        }
        .windowStyle(.hiddenTitleBar)
    }
}
