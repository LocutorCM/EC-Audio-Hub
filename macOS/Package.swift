// swift-tools-version: 5.7
import PackageDescription
let package = Package(
    name: "ECAudioHub",
    platforms: [.macOS(.v12)],
    products: [.executable(name: "ECAudioHub", targets: ["ECAudioHub"])],
    targets: [.executableTarget(name: "ECAudioHub", path: "Sources/ECAudioHub")]
)
