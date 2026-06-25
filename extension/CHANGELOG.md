# Changelog

## 0.3.1

Version aligned with the Bioscratch desktop app, which ships at the same version.
From this release the VS Code extension and the desktop editor are versioned and
released together.

- Default theme is now GitHub Light.
- "Match VS Code theme" is on by default, so the editor follows your active
  VS Code color theme out of the box.
- Spring/rubber-band overscroll when scrolling past the top or bottom, plus a
  couple of lines of breathing room below the last line — matching the desktop
  app's scroll feel.

## 0.1.0

First release. Bioscratch WYSIWYG Markdown as a VS Code custom editor.

- In-place WYSIWYG editing bound to the `.md` document.
- KaTeX math (inline and block), Mermaid diagrams, highlight.js syntax highlighting.
- Inline image rendering via `webview.asWebviewUri` for local and remote images.
- GFM tables with hover row and column controls.
- 32 built-in themes, importable custom YAML themes, and a "Match VS Code theme" mode.
- Theme selectable from VS Code settings (`bioscratch.theme`) and from the in-editor picker.
- Opens Markdown files by default on first run, with an opt-out setting.
- Find in document, word and character counts, HTML export.
- VS Code owns save, hot exit, and undo and redo. Edits write back with a minimal-diff edit.
