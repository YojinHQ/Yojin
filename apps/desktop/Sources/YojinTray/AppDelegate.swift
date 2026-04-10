import AppKit

final class AppDelegate: NSObject, NSApplicationDelegate {
    private var statusItem: NSStatusItem!
    private var serverManager: ServerManager!

    // Menu items we need to toggle enabled/disabled state
    private var startItem: NSMenuItem!
    private var stopItem: NSMenuItem!
    private var statusMenuItem: NSMenuItem!

    func applicationDidFinishLaunching(_ notification: Notification) {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)

        buildMenu()
        updateIcon(status: .stopped)

        serverManager = ServerManager { [weak self] status in
            self?.updateIcon(status: status)
            self?.updateMenuState(status: status)
        }

        // Auto-start the server on launch
        serverManager.start()
    }

    func applicationWillTerminate(_ notification: Notification) {
        serverManager.stop(completion: nil)
    }

    // MARK: - Menu

    private func buildMenu() {
        let menu = NSMenu()

        statusMenuItem = NSMenuItem(title: "Yojin: Stopped", action: nil, keyEquivalent: "")
        statusMenuItem.isEnabled = false
        menu.addItem(statusMenuItem)

        menu.addItem(NSMenuItem.separator())

        let dashboardItem = NSMenuItem(title: "Open Dashboard", action: #selector(openDashboard), keyEquivalent: "d")
        dashboardItem.target = self
        menu.addItem(dashboardItem)

        menu.addItem(NSMenuItem.separator())

        startItem = NSMenuItem(title: "Start Server", action: #selector(startServer), keyEquivalent: "s")
        startItem.target = self
        menu.addItem(startItem)

        stopItem = NSMenuItem(title: "Stop Server", action: #selector(stopServer), keyEquivalent: "")
        stopItem.target = self
        stopItem.isEnabled = false
        menu.addItem(stopItem)

        menu.addItem(NSMenuItem.separator())

        let quitItem = NSMenuItem(title: "Quit Yojin", action: #selector(quit), keyEquivalent: "q")
        quitItem.target = self
        menu.addItem(quitItem)

        statusItem.menu = menu
    }

    // MARK: - Actions

    @objc private func openDashboard() {
        let url = URL(string: "http://localhost:\(serverManager.port)")!
        NSWorkspace.shared.open(url)
    }

    @objc private func startServer() {
        serverManager.start()
    }

    @objc private func stopServer() {
        serverManager.stop()
    }

    @objc private func quit() {
        serverManager.stop {
            NSApplication.shared.terminate(nil)
        }
    }

    // MARK: - UI Updates

    private func updateIcon(status: ServerManager.Status) {
        guard let button = statusItem.button else { return }
        switch status {
        case .running:
            button.image = Icons.trayIconWithStatus(running: true)
        case .starting:
            button.image = Icons.trayIcon() // plain icon while starting
        case .stopped:
            button.image = Icons.trayIconWithStatus(running: false)
        }
    }

    private func updateMenuState(status: ServerManager.Status) {
        switch status {
        case .stopped:
            statusMenuItem.title = "Yojin: Stopped"
            startItem.isEnabled = true
            stopItem.isEnabled = false
        case .starting:
            statusMenuItem.title = "Yojin: Starting..."
            startItem.isEnabled = false
            stopItem.isEnabled = true
        case .running:
            statusMenuItem.title = "Yojin: Running"
            startItem.isEnabled = false
            stopItem.isEnabled = true
        }
    }
}
