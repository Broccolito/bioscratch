# Changelog

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
