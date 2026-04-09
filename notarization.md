# Bioscratch macOS Notarization

Credentials are stored in `notarization_credentials.env` (gitignored). Source it or copy values as needed.

## Prerequisites

**One-time setup** — only needed on a fresh machine:

1. Import the signing certificate into the keychain:
   ```bash
   # Import the G2 intermediate cert from Apple
   curl -s "https://www.apple.com/certificateauthority/DeveloperIDG2CA.cer" -o /tmp/DeveloperIDG2CA.cer
   security import /tmp/DeveloperIDG2CA.cer -k ~/Library/Keychains/login.keychain-db

   # Import the UCSF Developer ID certificate
   security import UCSF-AppleDeveloper-Main_Application.p12 \
     -k ~/Library/Keychains/login.keychain-db \
     -P "<P12_PASSPHRASE from notarization_credentials.env>" \
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

From `app/`:

```bash
export PATH="/opt/homebrew/opt/rustup/bin:/opt/homebrew/bin:$PATH"

# Apple Silicon
npm run tauri build -- --target aarch64-apple-darwin

# Intel
npm run tauri build -- --target x86_64-apple-darwin
```

Artifacts land in `app/src-tauri/target/<arch>/release/bundle/`.

## Sign

```bash
IDENTITY="Developer ID Application: University of California at San Francisco (F3YYBXAFJ8)"

codesign --deep --force --verify --verbose \
  --sign "$IDENTITY" \
  --options runtime \
  --entitlements notarization_entitlements.plist \
  app/src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Bioscratch.app

codesign --deep --force --verify --verbose \
  --sign "$IDENTITY" \
  --options runtime \
  --entitlements notarization_entitlements.plist \
  app/src-tauri/target/x86_64-apple-darwin/release/bundle/macos/Bioscratch.app
```

## Notarize and Staple

Repeat for each architecture (`aarch64` / `x86_64`):

```bash
ARCH=aarch64   # or x86_64
APP_PATH="app/src-tauri/target/${ARCH}-apple-darwin/release/bundle/macos/Bioscratch.app"
DMG_PATH="app/src-tauri/target/${ARCH}-apple-darwin/release/bundle/dmg/Bioscratch_0.1.0_${ARCH}.dmg"

# Notarize the .app
ditto -c -k --keepParent "$APP_PATH" /tmp/Bioscratch_${ARCH}.zip
xcrun notarytool submit /tmp/Bioscratch_${ARCH}.zip \
  --apple-id wanjungu001@gmail.com \
  --password <APPLE_APP_SPECIFIC_PASSWORD> \
  --team-id F3YYBXAFJ8 \
  --wait

# Staple the .app
xcrun stapler staple "$APP_PATH"

# Recreate DMG with the notarized .app
hdiutil create -volname "Bioscratch" -srcfolder "$APP_PATH" -ov -format UDZO "$DMG_PATH"

# Notarize and staple the DMG
xcrun notarytool submit "$DMG_PATH" \
  --apple-id wanjungu001@gmail.com \
  --password <APPLE_APP_SPECIFIC_PASSWORD> \
  --team-id F3YYBXAFJ8 \
  --wait
xcrun stapler staple "$DMG_PATH"
```

## Publish to GitHub

```bash
# Delete existing assets and re-upload notarized DMGs
gh release delete-asset v0.1.0 Bioscratch_0.1.0_aarch64.dmg --yes
gh release delete-asset v0.1.0 Bioscratch_0.1.0_x64.dmg --yes

gh release upload v0.1.0 \
  app/src-tauri/target/aarch64-apple-darwin/release/bundle/dmg/Bioscratch_0.1.0_aarch64.dmg \
  app/src-tauri/target/x86_64-apple-darwin/release/bundle/dmg/Bioscratch_0.1.0_x64.dmg
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
