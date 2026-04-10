#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
BUILD_DIR="$PROJECT_DIR/.build"
APP_NAME="Yojin.app"
DMG_NAME="Yojin.dmg"
VOLUME_NAME="Yojin"
DMG_DIR="$BUILD_DIR/dmg"

# Ensure the .app exists
if [ ! -d "$BUILD_DIR/$APP_NAME" ]; then
    echo "Error: $BUILD_DIR/$APP_NAME not found. Run build.sh first."
    exit 1
fi

echo "Creating DMG..."

# Clean up previous DMG artifacts
rm -rf "$DMG_DIR" "$BUILD_DIR/$DMG_NAME"
mkdir -p "$DMG_DIR"

# Copy app to staging directory
cp -R "$BUILD_DIR/$APP_NAME" "$DMG_DIR/$APP_NAME"

# Create a symlink to /Applications for drag-and-drop install
ln -s /Applications "$DMG_DIR/Applications"

# Create the DMG
hdiutil create \
    -volname "$VOLUME_NAME" \
    -srcfolder "$DMG_DIR" \
    -ov \
    -format UDZO \
    "$BUILD_DIR/$DMG_NAME"

# Clean up staging
rm -rf "$DMG_DIR"

echo "Created: $BUILD_DIR/$DMG_NAME"
