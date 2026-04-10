import Foundation

/// Manages the Yojin Node.js server process and monitors its health.
final class ServerManager {
    enum Status: Equatable { case stopped, starting, running }

    private(set) var status: Status = .stopped
    private var process: Process?
    private var healthTimer: Timer?
    let port: Int
    private let onStatusChange: (Status) -> Void

    init(
        port: Int = Int(ProcessInfo.processInfo.environment["YOJIN_PORT"] ?? "") ?? 3000,
        onStatusChange: @escaping (Status) -> Void
    ) {
        self.port = port
        self.onStatusChange = onStatusChange
    }

    // MARK: - Start / Stop

    func start() {
        guard status == .stopped else { return }

        // Check if a server is already running on the port (started externally)
        setStatus(.starting)
        startHealthPolling()
        checkHealth { [weak self] alreadyRunning in
            guard let self else { return }
            if alreadyRunning {
                NSLog("[YojinTray] Server already running on port %d (external)", self.port)
                self.setStatus(.running)
                return
            }
            self.launchProcess()
        }
    }

    private func launchProcess() {
        guard let binaryPath = findYojinBinary() else {
            NSLog("[YojinTray] Could not find 'yojin' binary in PATH")
            setStatus(.stopped)
            return
        }

        NSLog("[YojinTray] Starting server: %@", binaryPath)

        let proc = Process()
        proc.executableURL = URL(fileURLWithPath: "/bin/zsh")
        proc.arguments = ["-l", "-c", "\"\(binaryPath)\" start --port \(port)"]
        let logHandle = logFileHandle()
        logHandle.seekToEndOfFile()
        proc.standardOutput = logHandle
        proc.standardError = logHandle
        proc.terminationHandler = { [weak self] _ in
            DispatchQueue.main.async { self?.handleTermination() }
        }

        do {
            try proc.run()
            process = proc
            startHealthPolling()
        } catch {
            NSLog("[YojinTray] Failed to start: %@", error.localizedDescription)
            setStatus(.stopped)
        }
    }

    func stop(completion: (() -> Void)? = nil) {
        NSLog("[YojinTray] Stopping server")
        stopHealthPolling()

        if let proc = process, proc.isRunning {
            // We started this process — terminate it directly
            NSLog("[YojinTray] Sending SIGTERM to child process")
            if let completion {
                let originalHandler = proc.terminationHandler
                proc.terminationHandler = { [weak self] p in
                    DispatchQueue.main.async {
                        self?.handleTermination()
                        completion()
                    }
                    originalHandler?(p)
                }
            }
            proc.terminate()

            // Force kill after 5 seconds if still running
            DispatchQueue.global().asyncAfter(deadline: .now() + 5.0) { [weak self] in
                guard let self, let proc = self.process, proc.isRunning else { return }
                NSLog("[YojinTray] Server did not exit in 5s, sending SIGKILL")
                proc.interrupt()
                DispatchQueue.main.async {
                    self.handleTermination()
                    completion?()
                }
            }
        } else {
            // Server was started externally (npx, terminal, etc.) — kill by port
            killProcessOnPort()
            setStatus(.stopped)
            process = nil
            completion?()
        }
    }

    /// Finds and kills whatever process is listening on our port.
    private func killProcessOnPort() {
        let proc = Process()
        let pipe = Pipe()
        proc.executableURL = URL(fileURLWithPath: "/usr/sbin/lsof")
        proc.arguments = ["-ti", "tcp:\(port)"]
        proc.standardOutput = pipe
        proc.standardError = FileHandle.nullDevice

        do {
            try proc.run()
            proc.waitUntilExit()
            let data = pipe.fileHandleForReading.readDataToEndOfFile()
            let output = String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            let pids = output.split(separator: "\n").compactMap { Int32($0.trimmingCharacters(in: .whitespaces)) }
            for pid in pids {
                NSLog("[YojinTray] Killing PID %d on port %d", pid, port)
                kill(pid, SIGTERM)
            }
        } catch {
            NSLog("[YojinTray] Failed to find process on port: %@", error.localizedDescription)
        }
    }

    var isRunning: Bool { status == .running }

    // MARK: - Binary Discovery

    /// Finds the `yojin` binary by invoking a login shell so NVM/fnm paths are available.
    private func findYojinBinary() -> String? {
        let proc = Process()
        let pipe = Pipe()
        proc.executableURL = URL(fileURLWithPath: "/bin/zsh")
        proc.arguments = ["-l", "-c", "which yojin"]
        proc.standardOutput = pipe
        proc.standardError = FileHandle.nullDevice

        do {
            try proc.run()
            proc.waitUntilExit()
            let data = pipe.fileHandleForReading.readDataToEndOfFile()
            let path = String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines)
            if let path, !path.isEmpty, FileManager.default.fileExists(atPath: path) {
                return path
            }
        } catch {}

        // Fallback: check common locations
        let candidates = [
            "\(NSHomeDirectory())/.nvm/versions/node/v22.22.1/bin/yojin",
            "/usr/local/bin/yojin",
            "/opt/homebrew/bin/yojin",
        ]
        return candidates.first { FileManager.default.fileExists(atPath: $0) }
    }

    // MARK: - Health Polling

    private func startHealthPolling() {
        stopHealthPolling()
        healthTimer = Timer.scheduledTimer(withTimeInterval: 3.0, repeats: true) { [weak self] _ in
            self?.checkHealth()
        }
    }

    private func stopHealthPolling() {
        healthTimer?.invalidate()
        healthTimer = nil
    }

    private func checkHealth(completion: ((Bool) -> Void)? = nil) {
        guard let url = URL(string: "http://127.0.0.1:\(port)/api/health") else {
            completion?(false)
            return
        }

        let task = URLSession.shared.dataTask(with: url) { [weak self] _, response, error in
            DispatchQueue.main.async {
                guard let self else { return }
                let healthy = (response as? HTTPURLResponse)?.statusCode == 200
                if healthy {
                    if self.status != .running { self.setStatus(.running) }
                } else if self.status == .running {
                    // Server was running but health check failed — might be shutting down
                    self.setStatus(.starting)
                }
                completion?(healthy)
            }
        }
        task.resume()
    }

    // MARK: - Logging

    private func logFileHandle() -> FileHandle {
        let logDir = "\(NSHomeDirectory())/.yojin/logs"
        try? FileManager.default.createDirectory(atPath: logDir, withIntermediateDirectories: true)
        let logPath = "\(logDir)/tray.log"
        if !FileManager.default.fileExists(atPath: logPath) {
            FileManager.default.createFile(atPath: logPath, contents: nil)
        }
        return FileHandle(forWritingAtPath: logPath) ?? .nullDevice
    }

    // MARK: - Internal

    private func handleTermination() {
        NSLog("[YojinTray] Server process terminated")
        process = nil
        stopHealthPolling()
        setStatus(.stopped)
    }

    private func setStatus(_ newStatus: Status) {
        guard status != newStatus else { return }
        status = newStatus
        onStatusChange(newStatus)
    }
}
