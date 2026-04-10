#!/bin/bash
set -euo pipefail

APP_NAME="Yojin.app"
INSTALL_DIR="/Applications"
LAUNCH_AGENT_DIR="$HOME/Library/LaunchAgents"
LAUNCH_AGENT_PLIST="com.yojinhq.tray.plist"

echo "Uninstalling Yojin tray app..."

# 1. Unload LaunchAgent
if [ -f "$LAUNCH_AGENT_DIR/$LAUNCH_AGENT_PLIST" ]; then
    launchctl unload "$LAUNCH_AGENT_DIR/$LAUNCH_AGENT_PLIST" 2>/dev/null || true
    rm "$LAUNCH_AGENT_DIR/$LAUNCH_AGENT_PLIST"
    echo "Removed LaunchAgent"
fi

# 2. Quit running app
pkill -x "YojinTray" 2>/dev/null || true

# 3. Remove app bundle
if [ -d "$INSTALL_DIR/$APP_NAME" ]; then
    rm -rf "${INSTALL_DIR:?}/${APP_NAME:?}"
    echo "Removed $INSTALL_DIR/$APP_NAME"
fi

echo ""
echo "Yojin tray app uninstalled."
echo "Note: ~/.yojin/ data directory was NOT removed."
echo "To also remove data: rm -rf ~/.yojin"
