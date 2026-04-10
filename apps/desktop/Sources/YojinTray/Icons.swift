import AppKit

enum Icons {
    /// Loads the Yojin favicon from the app bundle in its original brand color.
    static func trayIcon() -> NSImage {
        if let loaded = loadBundledIcon() { return loaded }
        return fallbackIcon()
    }

    /// Small colored circle used as a status indicator.
    static func statusDot(running: Bool) -> NSImage {
        let size = NSSize(width: 6, height: 6)
        return NSImage(size: size, flipped: false) { rect in
            let color: NSColor = running ? .systemGreen : .systemGray
            color.setFill()
            NSBezierPath(ovalIn: rect.insetBy(dx: 0.5, dy: 0.5)).fill()
            return true
        }
    }

    /// Composites the tray icon with a status dot in the bottom-right corner.
    static func trayIconWithStatus(running: Bool) -> NSImage {
        let base = trayIcon()
        let dot = statusDot(running: running)
        let size = base.size

        let composite = NSImage(size: size, flipped: false) { rect in
            base.draw(in: rect)
            let dotSize = dot.size
            let dotOrigin = NSPoint(x: size.width - dotSize.width, y: 0)
            dot.draw(in: NSRect(origin: dotOrigin, size: dotSize))
            return true
        }
        composite.isTemplate = false
        return composite
    }

    // MARK: - Private

    /// Loads the favicon PNG from the bundle in its original brand color (coral).
    private static func loadBundledIcon() -> NSImage? {
        let bundle = Bundle.main
        let candidates = [
            bundle.bundleURL.appendingPathComponent("Contents/Resources/icons/tray-icon.png"),
            bundle.resourceURL?.appendingPathComponent("icons/tray-icon.png"),
        ]

        for candidate in candidates {
            guard let url = candidate, FileManager.default.fileExists(atPath: url.path),
                  let image = NSImage(contentsOf: url) else { continue }
            image.size = NSSize(width: 18, height: 18)
            image.isTemplate = false // keep original brand color
            return image
        }
        return nil
    }

    /// Fallback "Y" if the bundled icon is missing.
    private static func fallbackIcon() -> NSImage {
        let size = NSSize(width: 18, height: 18)
        let image = NSImage(size: size, flipped: false) { _ in
            let path = NSBezierPath()
            path.lineWidth = 2.2
            path.lineCapStyle = .round
            path.move(to: NSPoint(x: 2, y: 16)); path.line(to: NSPoint(x: 9, y: 9))
            path.move(to: NSPoint(x: 16, y: 16)); path.line(to: NSPoint(x: 9, y: 9))
            path.move(to: NSPoint(x: 9, y: 9)); path.line(to: NSPoint(x: 9, y: 2))
            NSColor.black.setStroke()
            path.stroke()
            return true
        }
        image.isTemplate = true
        return image
    }
}
