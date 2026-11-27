// swift-tools-version: 5.7
import PackageDescription

let package = Package(
    name: "ECAudioHub",
    platforms: [.macOS(.v12)],
    products: [.executable(name: "EC-Audio-Hub", targets: ["ECAudioHub"])],
    targets: [.executableTarget(name: "ECAudioHub", path: "Sources/ECAudioHub")]
)
