// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "YojinTray",
    platforms: [.macOS(.v13)],
    targets: [
        .executableTarget(
            name: "YojinTray",
            path: "Sources/YojinTray",
            resources: [
                .copy("../../Resources/Info.plist"),
            ]
        ),
    ]
)
