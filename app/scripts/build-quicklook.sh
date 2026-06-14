#!/usr/bin/env bash
# Build the Bioscratch Quick Look preview extension (.appex) and optionally
# embed it into a target .app bundle (e.g. the packaged Bioscratch.app).
#
# Usage:
#   scripts/build-quicklook.sh                          # build appex only
#   scripts/build-quicklook.sh /path/to/Bioscratch.app  # build + embed + sign
#
# Env:
#   BIOSCRATCH_SIGN_ID   codesign identity (default "-" = ad-hoc, for local use)
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
QL_SRC="$APP_DIR/src-tauri/quicklook"
OUT="$APP_DIR/build/quicklook"
APPEX="$OUT/BioscratchQuickLook.appex"
PREVIEW_DIST="$APP_DIR/dist-preview"
TARGET_APP="${1:-}"
SIGN_ID="${BIOSCRATCH_SIGN_ID:--}"

echo "==> Building read-only preview bundle"
( cd "$APP_DIR" && npm run build:preview )

echo "==> Assembling .appex bundle"
rm -rf "$APPEX"
mkdir -p "$APPEX/Contents/MacOS" "$APPEX/Contents/Resources"
cp "$QL_SRC/Info.plist" "$APPEX/Contents/Info.plist"
cp -R "$PREVIEW_DIST" "$APPEX/Contents/Resources/dist-preview"

echo "==> Compiling Swift extension"
ARCH="$(uname -m)"
swiftc "$QL_SRC/PreviewViewController.swift" \
  -o "$APPEX/Contents/MacOS/BioscratchQuickLook" \
  -target "${ARCH}-apple-macos11.0" \
  -framework Cocoa -framework Quartz -framework WebKit \
  -Xlinker -e -Xlinker _NSExtensionMain \
  -O

echo "==> Signing .appex (identity: $SIGN_ID)"
codesign --force --options runtime --sign "$SIGN_ID" \
  --entitlements "$QL_SRC/Extension.entitlements" --timestamp=none "$APPEX"

if [[ -n "$TARGET_APP" ]]; then
  echo "==> Embedding into $TARGET_APP"
  mkdir -p "$TARGET_APP/Contents/PlugIns"
  rm -rf "$TARGET_APP/Contents/PlugIns/BioscratchQuickLook.appex"
  cp -R "$APPEX" "$TARGET_APP/Contents/PlugIns/"
  # Inside-out signing: the appex is already signed (with its own entitlements);
  # sign the host app shallow so codesign seals the nested, already-signed appex
  # by reference instead of re-signing (which would strip its entitlements).
  echo "==> Re-signing host app"
  codesign --force --options runtime --sign "$SIGN_ID" --timestamp=none "$TARGET_APP"
fi

echo "==> Done: $APPEX"
