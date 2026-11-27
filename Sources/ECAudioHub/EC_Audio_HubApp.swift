import SwiftUI

@main
struct ECAudioHubApp: App {
    @StateObject private var uploader = UploadManager()

    var body: some Scene {
        WindowGroup {
            HubView()
                .environmentObject(uploader)
                .frame(minWidth: 760, minHeight: 570)
        }
        .windowStyle(.hiddenTitleBar)
    }
}
