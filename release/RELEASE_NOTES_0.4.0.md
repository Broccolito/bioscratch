# Bioscratch 0.4.0

This release keeps the Tauri desktop app and VS Code extension aligned at
version 0.4.0.

## Highlights

- Fixed inline-code insertion, deletion, selection replacement, editing, and
  plain-text/Markdown paste behavior in both editors.
- Preserved active formatting marks during plain-text paste and made inline-code
  Markdown serialization robust at backtick boundaries.
- Hardened HTML export, KaTeX and Mermaid rendering, external URL handling,
  local file access, update downloads, and the Tauri content security policy.
- Added a 44-case regression suite covering inline code, paste, serialization,
  links, math, Mermaid, and related editor behavior.
- Refreshed application icons and desktop diagram/table editing controls.
- Updated Mermaid, DOMPurify, Vite, esbuild, and VS Code packaging dependencies.

## Contributors

- Wanjun Gu
- Tianlu Zhu

## Downloads

- `Bioscratch_0.4.0_aarch64.dmg` — Apple Silicon macOS
- `Bioscratch_0.4.0_x64.dmg` — Intel macOS
- `bioscratch-0.4.0.vsix` — Visual Studio Code extension
