#!/usr/bin/env bash
# Build, sign, notarize and package signed+notarized DMGs for both macOS arches.
#
# Required env (do NOT hardcode — these are secrets):
#   APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID, SIGNING_IDENTITY
# Optional:
#   VERSION   (default: read from package.json)
#   ARCHES    (default: "aarch64 x86_64")
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$APP_DIR"
VERSION="${VERSION:-$(node -p "require('./package.json').version")}"
ARCHES="${ARCHES:-aarch64 x86_64}"
ENT="$APP_DIR/../notarization/notarization_entitlements.plist"
export BIOSCRATCH_SIGN_ID="$SIGNING_IDENTITY"
export BIOSCRATCH_APP_ENTITLEMENTS="$ENT"

notarize() { # $1 = path to .zip or .dmg
  xcrun notarytool submit "$1" \
    --apple-id "$APPLE_ID" --password "$APPLE_APP_SPECIFIC_PASSWORD" \
    --team-id "$APPLE_TEAM_ID" --wait
}

echo "### Releasing Bioscratch $VERSION for: $ARCHES"
OUTDIR="$APP_DIR/build/release"; mkdir -p "$OUTDIR"

for ARCH in $ARCHES; do
  echo "================ $ARCH ================"
  TARGET="${ARCH}-apple-darwin"
  APP="src-tauri/target/${TARGET}/release/bundle/macos/Bioscratch.app"
  DMG_NAME="Bioscratch_${VERSION}_$([[ $ARCH == x86_64 ]] && echo x64 || echo "$ARCH").dmg"
  DMG="$OUTDIR/$DMG_NAME"

  echo "--> tauri build (.app only)"
  npm run tauri build -- --target "$TARGET" --bundles app

  echo "--> embed Quick Look extension + sign (Developer ID, hardened runtime)"
  bash scripts/build-quicklook.sh "$APP_DIR/$APP"

  echo "--> verify signature"
  codesign --verify --deep --strict --verbose=2 "$APP_DIR/$APP"

  echo "--> notarize + staple .app"
  ditto -c -k --keepParent "$APP_DIR/$APP" "/tmp/Bioscratch_${ARCH}.zip"
  notarize "/tmp/Bioscratch_${ARCH}.zip"
  xcrun stapler staple "$APP_DIR/$APP"

  echo "--> build DMG"
  rm -f "$DMG"
  hdiutil create -volname "Bioscratch" -srcfolder "$APP_DIR/$APP" -ov -format UDZO "$DMG"

  echo "--> notarize + staple DMG"
  notarize "$DMG"
  xcrun stapler staple "$DMG"
  echo "--> done: $DMG"
done

echo "### All DMGs in $OUTDIR:"; ls -la "$OUTDIR"
