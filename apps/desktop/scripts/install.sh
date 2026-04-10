#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
BUILD_DIR="$PROJECT_DIR/.build"
APP_NAME="Yojin.app"
INSTALL_DIR="/Applications"
LAUNCH_AGENT_DIR="$HOME/Library/LaunchAgents"
LAUNCH_AGENT_PLIST="com.yojinhq.tray.plist"

# 1. Build if needed
if [ ! -d "$BUILD_DIR/$APP_NAME" ]; then
    echo "Building first..."
    "$SCRIPT_DIR/build.sh"
fi

# 2. Copy app to /Applications
echo "Installing $APP_NAME to $INSTALL_DIR..."
rm -rf "${INSTALL_DIR:?}/${APP_NAME:?}"
cp -R "$BUILD_DIR/$APP_NAME" "$INSTALL_DIR/$APP_NAME"

# 3. Create LaunchAgent for auto-start on login
echo "Creating LaunchAgent for auto-start..."
mkdir -p "$LAUNCH_AGENT_DIR"
cat > "$LAUNCH_AGENT_DIR/$LAUNCH_AGENT_PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.yojinhq.tray</string>
    <key>ProgramArguments</key>
    <array>
        <string>/Applications/Yojin.app/Contents/MacOS/YojinTray</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <false/>
</dict>
</plist>
EOF

# 4. Load the agent
launchctl unload "$LAUNCH_AGENT_DIR/$LAUNCH_AGENT_PLIST" 2>/dev/null || true
launchctl load "$LAUNCH_AGENT_DIR/$LAUNCH_AGENT_PLIST"

echo ""
echo "Installed! Yojin will appear in your menu bar."
echo "It will auto-start on login."
echo ""
echo "To start now: open /Applications/Yojin.app"
