#!/usr/bin/env bash
# Build the Bioscratch Quick Look preview extension (.appex) and optionally
# embed it into a target .app bundle (e.g. the packaged Bioscratch.app).
#
# Usage:
#   scripts/build-quicklook.sh                          # build appex only
#   scripts/build-quicklook.sh /path/to/Bioscratch.app  # build + embed + sign
#
# Env:
#   BIOSCRATCH_SIGN_ID          codesign identity (default "-" = ad-hoc, local use)
#   BIOSCRATCH_APP_ENTITLEMENTS optional entitlements plist for the host app
#                               (used when signing the .app for notarization)
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
QL_SRC="$APP_DIR/src-tauri/quicklook"
OUT="$APP_DIR/build/quicklook"
APPEX="$OUT/BioscratchQuickLook.appex"
PREVIEW_DIST="$APP_DIR/dist-preview"
TARGET_APP="${1:-}"
SIGN_ID="${BIOSCRATCH_SIGN_ID:--}"
APP_ENTITLEMENTS="${BIOSCRATCH_APP_ENTITLEMENTS:-}"

# Ad-hoc signatures can't use a secure timestamp; real Developer ID signing for
# notarization requires one.
if [[ "$SIGN_ID" == "-" ]]; then TS=(--timestamp=none); else TS=(--timestamp); fi

echo "==> Building read-only preview bundle"
( cd "$APP_DIR" && npm run build:preview )

echo "==> Assembling .appex bundle"
rm -rf "$APPEX"
mkdir -p "$APPEX/Contents/MacOS" "$APPEX/Contents/Resources"
cp "$QL_SRC/Info.plist" "$APPEX/Contents/Info.plist"
cp -R "$PREVIEW_DIST" "$APPEX/Contents/Resources/dist-preview"

echo "==> Compiling Swift extension (universal arm64 + x86_64)"
TMP="$OUT/obj"; mkdir -p "$TMP"
for a in arm64 x86_64; do
  swiftc "$QL_SRC/PreviewViewController.swift" \
    -o "$TMP/ql-$a" \
    -target "${a}-apple-macos11.0" \
    -framework Cocoa -framework Quartz -framework WebKit \
    -Xlinker -e -Xlinker _NSExtensionMain \
    -O
done
lipo -create "$TMP/ql-arm64" "$TMP/ql-x86_64" \
  -output "$APPEX/Contents/MacOS/BioscratchQuickLook"

echo "==> Signing .appex (identity: $SIGN_ID)"
codesign --force --options runtime --sign "$SIGN_ID" \
  --entitlements "$QL_SRC/Extension.entitlements" "${TS[@]}" "$APPEX"

if [[ -n "$TARGET_APP" ]]; then
  echo "==> Embedding into $TARGET_APP"
  mkdir -p "$TARGET_APP/Contents/PlugIns"
  rm -rf "$TARGET_APP/Contents/PlugIns/BioscratchQuickLook.appex"
  cp -R "$APPEX" "$TARGET_APP/Contents/PlugIns/"
  # Inside-out signing: the appex is already signed (with its own sandbox
  # entitlements); sign the host app shallow (no --deep) so codesign seals the
  # nested, already-signed appex by reference instead of re-signing it (which
  # would overwrite its entitlements and break Quick Look registration).
  echo "==> Re-signing host app"
  if [[ -n "$APP_ENTITLEMENTS" ]]; then
    codesign --force --options runtime --sign "$SIGN_ID" \
      --entitlements "$APP_ENTITLEMENTS" "${TS[@]}" "$TARGET_APP"
  else
    codesign --force --options runtime --sign "$SIGN_ID" \
      "${TS[@]}" "$TARGET_APP"
  fi
fi

echo "==> Done: $APPEX"
