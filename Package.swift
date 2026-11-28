// swift-tools-version: 5.7
import PackageDescription

let package = Package(
    name: "ECAudioHub",
    platforms: [.macOS(.v12)],
    products: [
        .executable(name: "EC-Audio-Hub", targets: ["ECAudioHub"]),
        .executable(name: "EC-Audio-Hub-Client", targets: ["ECAudioHubClient"])
    ],
    targets: [
        .executableTarget(name: "ECAudioHub", path: "Sources/ECAudioHub", resources: [.process("Resources")]),
        .executableTarget(name: "ECAudioHubClient", path: "Sources/ECAudioHubClient", resources: [.process("Resources")])
    ]
)
