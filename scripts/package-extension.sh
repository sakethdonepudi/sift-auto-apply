#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
EXTENSION_DIR="$PROJECT_DIR/extension"
DIST_DIR="$PROJECT_DIR/dist"
VERSION="$(node -p "JSON.parse(require('fs').readFileSync('$EXTENSION_DIR/manifest.json')).version")"
PACKAGE_ROOT="$(mktemp -d)"
PACKAGE_DIR="$PACKAGE_ROOT/sift-extension"
ARCHIVE="$DIST_DIR/sift-auto-apply-v$VERSION.zip"

trap 'rm -rf "$PACKAGE_ROOT"' EXIT
mkdir -p "$PACKAGE_DIR/icons" "$DIST_DIR"

node --check "$EXTENSION_DIR/background.js"
node --check "$EXTENSION_DIR/linkedin.js"
node --check "$EXTENSION_DIR/popup.js"
node --check "$EXTENSION_DIR/options.js"
node -e "JSON.parse(require('fs').readFileSync('$EXTENSION_DIR/manifest.json'))"
test -f "$EXTENSION_DIR/icons/icon-16.png"
test -f "$EXTENSION_DIR/icons/icon-32.png"
test -f "$EXTENSION_DIR/icons/icon-48.png"
test -f "$EXTENSION_DIR/icons/icon-128.png"

cp "$EXTENSION_DIR/manifest.json" "$PACKAGE_DIR/"
cp "$EXTENSION_DIR/background.js" "$PACKAGE_DIR/"
cp "$EXTENSION_DIR/linkedin.js" "$PACKAGE_DIR/"
cp "$EXTENSION_DIR/popup.html" "$PACKAGE_DIR/"
cp "$EXTENSION_DIR/popup.js" "$PACKAGE_DIR/"
cp "$EXTENSION_DIR/options.html" "$PACKAGE_DIR/"
cp "$EXTENSION_DIR/options.js" "$PACKAGE_DIR/"
cp "$EXTENSION_DIR/extension.css" "$PACKAGE_DIR/"
cp "$EXTENSION_DIR/icons/"*.png "$PACKAGE_DIR/icons/"

rm -f "$ARCHIVE"
(cd "$PACKAGE_DIR" && zip -qr "$ARCHIVE" .)
unzip -t "$ARCHIVE" >/dev/null
echo "$ARCHIVE"
