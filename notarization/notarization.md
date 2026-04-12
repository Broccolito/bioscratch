# Bioscratch macOS Notarization

Credentials are stored in `notarization_credentials.env` (gitignored). **Do not source it directly** — the unquoted parentheses in `SIGNING_IDENTITY` break zsh. Load credentials with `grep`/`cut` instead:

```bash
export APPLE_ID=$(grep '^APPLE_ID=' notarization/notarization_credentials.env | cut -d= -f2)
export APPLE_APP_SPECIFIC_PASSWORD=$(grep '^APPLE_APP_SPECIFIC_PASSWORD=' notarization/notarization_credentials.env | cut -d= -f2)
export APPLE_TEAM_ID=$(grep '^APPLE_TEAM_ID=' notarization/notarization_credentials.env | cut -d= -f2)
export SIGNING_IDENTITY=$(grep '^SIGNING_IDENTITY=' notarization/notarization_credentials.env | cut -d= -f2-)
```

## Prerequisites

**One-time setup** — only needed on a fresh machine:

1. Import the signing certificate into the keychain:
   ```bash
   # Import the G2 intermediate cert from Apple
   curl -s "https://www.apple.com/certificateauthority/DeveloperIDG2CA.cer" -o /tmp/DeveloperIDG2CA.cer
   security import /tmp/DeveloperIDG2CA.cer -k ~/Library/Keychains/login.keychain-db

   # Import the UCSF Developer ID certificate
   security import "$P12_FILE" \
     -k ~/Library/Keychains/login.keychain-db \
     -P "$P12_PASSPHRASE" \
     -T /usr/bin/codesign \
     -T /usr/bin/productsign
   ```

2. Install rustup (needed for cross-compilation to Intel):
   ```bash
   brew install rustup
   export PATH="/opt/homebrew/opt/rustup/bin:$PATH"
   rustup default stable
   rustup target add x86_64-apple-darwin
   ```

## Build

Set the version once at the top — everything below uses it:

```bash
export VERSION=0.1.1   # ← update this each release
export PATH="/opt/homebrew/opt/rustup/bin:/opt/homebrew/bin:$PATH"
```

From `app/`:

```bash
# Apple Silicon
npm run tauri build -- --target aarch64-apple-darwin

# Intel
npm run tauri build -- --target x86_64-apple-darwin
```

Artifacts land in `app/src-tauri/target/<arch>/release/bundle/`.

## Sign

```bash
codesign --deep --force --verify --verbose \
  --sign "$SIGNING_IDENTITY" \
  --options runtime \
  --entitlements notarization/notarization_entitlements.plist \
  app/src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Bioscratch.app

codesign --deep --force --verify --verbose \
  --sign "$SIGNING_IDENTITY" \
  --options runtime \
  --entitlements notarization/notarization_entitlements.plist \
  app/src-tauri/target/x86_64-apple-darwin/release/bundle/macos/Bioscratch.app
```

## Notarize and Staple

Repeat for each architecture (`aarch64` / `x86_64`):

```bash
ARCH=aarch64   # then repeat with x86_64
APP_PATH="app/src-tauri/target/${ARCH}-apple-darwin/release/bundle/macos/Bioscratch.app"
DMG_PATH="app/src-tauri/target/${ARCH}-apple-darwin/release/bundle/dmg/Bioscratch_${VERSION}_${ARCH}.dmg"

# Notarize the .app
ditto -c -k --keepParent "$APP_PATH" /tmp/Bioscratch_${ARCH}.zip
xcrun notarytool submit /tmp/Bioscratch_${ARCH}.zip \
  --apple-id "$APPLE_ID" \
  --password "$APPLE_APP_SPECIFIC_PASSWORD" \
  --team-id "$APPLE_TEAM_ID" \
  --wait

# Staple the .app
xcrun stapler staple "$APP_PATH"

# Recreate DMG with the notarized .app
hdiutil create -volname "Bioscratch" -srcfolder "$APP_PATH" -ov -format UDZO "$DMG_PATH"

# Notarize and staple the DMG
xcrun notarytool submit "$DMG_PATH" \
  --apple-id "$APPLE_ID" \
  --password "$APPLE_APP_SPECIFIC_PASSWORD" \
  --team-id "$APPLE_TEAM_ID" \
  --wait
xcrun stapler staple "$DMG_PATH"
```

Note: Tauri names the Intel DMG with `_x64` (not `_x86_64`), so the actual Intel DMG path is:
`app/src-tauri/target/x86_64-apple-darwin/release/bundle/dmg/Bioscratch_${VERSION}_x64.dmg`

## Publish to GitHub

```bash
# Push commit and tag
git push origin main
git tag v${VERSION}
git push origin v${VERSION}

# Create release and upload both DMGs
gh release create v${VERSION} \
  --title "Bioscratch ${VERSION}" \
  --notes "See commit history for changes." \
  "app/src-tauri/target/aarch64-apple-darwin/release/bundle/dmg/Bioscratch_${VERSION}_aarch64.dmg" \
  "app/src-tauri/target/x86_64-apple-darwin/release/bundle/dmg/Bioscratch_${VERSION}_x64.dmg"
```

## Entitlements

The entitlements plist used for signing (`notarization_entitlements.plist`):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>com.apple.security.cs.allow-jit</key>
    <true/>
    <key>com.apple.security.cs.allow-unsigned-executable-memory</key>
    <true/>
    <key>com.apple.security.cs.disable-library-validation</key>
    <true/>
    <key>com.apple.security.network.client</key>
    <true/>
    <key>com.apple.security.files.user-selected.read-write</key>
    <true/>
</dict>
</plist>
```
