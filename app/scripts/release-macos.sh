#!/usr/bin/env bash
# Build, sign, notarize and package signed+notarized DMGs for both macOS arches.
#
# Required env (do NOT hardcode — these are secrets):
#   APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID, SIGNING_IDENTITY
# Optional:
#   VERSION   (default: read from package.json)
#   ARCHES    (default: "aarch64 x86_64")
# Never trace commands that expand signing or notarization credentials, including
# when this script is invoked with bash -x or inherits SHELLOPTS.
set +x
set -euo pipefail
umask 077

fail() {
  printf 'Release failed: %s\n' "$1" >&2
  exit 1
}

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$APP_DIR"
node scripts/check-release-version.mjs
PACKAGE_VERSION="$(node -p "require('./package.json').version")"
VERSION="${VERSION-$PACKAGE_VERSION}"
[[ "$VERSION" == "$PACKAGE_VERSION" ]] || fail "VERSION must match package.json."
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$ ]] || fail "Invalid release version."

ARCHES="${ARCHES-aarch64 x86_64}"
[[ "$ARCHES" != *$'\n'* && "$ARCHES" != *$'\r'* ]] || fail "ARCHES must be a single line."
[[ "$ARCHES" =~ [^[:space:]] ]] || fail "ARCHES must not be empty."
IFS=$' \t' read -r -a RELEASE_ARCHES <<< "$ARCHES"
SEEN_ARCHES=" "
for ARCH in "${RELEASE_ARCHES[@]}"; do
  case "$ARCH" in
    aarch64|x86_64) ;;
    *) fail "Unsupported architecture; use aarch64 or x86_64." ;;
  esac
  [[ "$SEEN_ARCHES" != *" $ARCH "* ]] || fail "ARCHES contains a duplicate architecture."
  SEEN_ARCHES="$SEEN_ARCHES$ARCH "
done

for REQUIRED_ENV in APPLE_ID APPLE_APP_SPECIFIC_PASSWORD APPLE_TEAM_ID SIGNING_IDENTITY; do
  [[ -n "${!REQUIRED_ENV:-}" ]] || fail "$REQUIRED_ENV must be set and nonempty."
done
ENT="$APP_DIR/../notarization/notarization_entitlements.plist"
[[ -f "$ENT" ]] || fail "Signing entitlements file is missing."
export BIOSCRATCH_SIGN_ID="$SIGNING_IDENTITY"
export BIOSCRATCH_APP_ENTITLEMENTS="$ENT"

RELEASE_TMP="$(mktemp -d "${TMPDIR:-/tmp}/bioscratch-release.XXXXXXXX")"
cleanup() {
  local status=$?
  trap - EXIT
  if ! rm -rf -- "$RELEASE_TMP"; then
    printf 'Release temporary-file cleanup failed.\n' >&2
    [[ "$status" -ne 0 ]] || status=1
  fi
  exit "$status"
}
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

notarize() { # $1 = path to .zip or .dmg
  # notarytool diagnostics can contain private account information. Keep both
  # streams private, never echo them, and require an explicit Accepted result.
  if ! xcrun notarytool submit "$1" \
    --apple-id "$APPLE_ID" --password "$APPLE_APP_SPECIFIC_PASSWORD" \
    --team-id "$APPLE_TEAM_ID" --wait --output-format json \
    >"$RELEASE_TMP/notarization.json" 2>"$RELEASE_TMP/notarization.err"; then
    fail "Notarization command failed; refusing to staple."
  fi
  node scripts/check-notarization-result.mjs "$RELEASE_TMP/notarization.json" \
    || fail "Notarization was not accepted; refusing to staple."
}

check_destination() {
  [[ ! -L "$1" && ( ! -e "$1" || -f "$1" ) ]] \
    || fail "Release artifact destination must be a regular file path."
}

echo "### Releasing Bioscratch $VERSION for: $ARCHES"
OUTDIR="$APP_DIR/build/release"
mkdir -p "$OUTDIR"

for ARCH in "${RELEASE_ARCHES[@]}"; do
  echo "================ $ARCH ================"
  TARGET="${ARCH}-apple-darwin"
  APP="src-tauri/target/${TARGET}/release/bundle/macos/Bioscratch.app"
  DMG_NAME="Bioscratch_${VERSION}_$([[ $ARCH == x86_64 ]] && echo x64 || echo "$ARCH").dmg"
  DMG="$OUTDIR/$DMG_NAME"
  STAGED_DMG="$RELEASE_TMP/$DMG_NAME"
  check_destination "$DMG"

  echo "--> tauri build (.app only)"
  npm run tauri build -- --target "$TARGET" --bundles app

  echo "--> embed Quick Look extension + sign (Developer ID, hardened runtime)"
  if ! bash scripts/build-quicklook.sh "$APP_DIR/$APP" \
    >"$RELEASE_TMP/quicklook.log" 2>&1; then
    fail "Quick Look build or signing failed."
  fi

  echo "--> verify signature"
  codesign --verify --deep --strict --verbose=2 "$APP_DIR/$APP"

  echo "--> notarize + staple .app"
  APP_ZIP="$RELEASE_TMP/Bioscratch_${ARCH}.zip"
  ditto -c -k --keepParent "$APP_DIR/$APP" "$APP_ZIP"
  notarize "$APP_ZIP"
  xcrun stapler staple "$APP_DIR/$APP"
  xcrun stapler validate "$APP_DIR/$APP"

  echo "--> build + sign DMG"
  hdiutil create -volname "Bioscratch" -srcfolder "$APP_DIR/$APP" -ov -format UDZO "$STAGED_DMG"
  if ! codesign --sign "$SIGNING_IDENTITY" --timestamp "$STAGED_DMG" \
    >"$RELEASE_TMP/dmg-signing.log" 2>&1; then
    fail "DMG signing failed."
  fi
  codesign --verify --strict "$STAGED_DMG"

  echo "--> notarize + staple DMG"
  notarize "$STAGED_DMG"
  xcrun stapler staple "$STAGED_DMG"
  xcrun stapler validate "$STAGED_DMG"
  check_destination "$DMG"
  mv -f "$STAGED_DMG" "$DMG"
  echo "--> done: $DMG"
done

echo "### All DMGs in $OUTDIR:"
ls -la "$OUTDIR"
