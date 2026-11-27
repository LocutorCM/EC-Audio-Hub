import SwiftUI

@main
struct ECAudioHubApp: App {
    @StateObject private var cloud = CloudSyncManager()
    var body: some Scene {
        WindowGroup {
            HubView()
                .environmentObject(cloud)
                .frame(minWidth: 980, minHeight: 640)
        }
        .windowStyle(.hiddenTitleBar)
    }
}
