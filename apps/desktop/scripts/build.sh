#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
BUILD_DIR="$PROJECT_DIR/.build"
APP_NAME="Yojin.app"
APP_DIR="$BUILD_DIR/$APP_NAME"

echo "Building YojinTray..."
cd "$PROJECT_DIR"
swift build -c release

echo "Assembling $APP_NAME bundle..."
rm -rf "$APP_DIR"
mkdir -p "$APP_DIR/Contents/MacOS"
mkdir -p "$APP_DIR/Contents/Resources"

# Copy binary
cp "$BUILD_DIR/release/YojinTray" "$APP_DIR/Contents/MacOS/YojinTray"

# Copy Info.plist
cp "$PROJECT_DIR/Resources/Info.plist" "$APP_DIR/Contents/Info.plist"

# Copy icon resources
cp -R "$PROJECT_DIR/Resources/icons" "$APP_DIR/Contents/Resources/icons"

echo "Built: $APP_DIR"
echo ""
echo "To install, run: ./scripts/install.sh"
