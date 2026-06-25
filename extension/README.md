# Bioscratch

A WYSIWYG Markdown editor for VS Code. Bioscratch renders your `.md` files as a
live document you edit in place. Math, diagrams, code, tables, and images all
render as you type, while the file on disk stays plain Markdown.

This is a VS Code port of the [Bioscratch desktop editor](https://github.com/Broccolito/bioscratch).

## Features

- WYSIWYG editing for headings, lists, task lists, blockquotes, bold and italic
  text, and links. They render live and you edit them in place. The file on disk
  stays clean Markdown.
- KaTeX math, both inline `$...$` and block `$$...$$`. Click to edit.
- Mermaid diagrams. A ` ```mermaid ` code block renders as a diagram. Click it to
  reveal the source.
- Syntax highlighting for fenced code blocks via highlight.js.
- Inline image rendering for local and remote images. Local paths resolve
  relative to the document.
- GFM tables with hover controls to add and remove rows and columns.
- 32 built-in themes, importable custom YAML themes, and a "Match VS Code theme"
  mode that follows your active color theme.
- Find in document, word and character counts, and HTML export.

## Default editor

By default, Bioscratch opens your Markdown files automatically the first time it
runs. If you would rather keep the plain text editor or use another editor, turn
off `bioscratch.setAsDefaultEditor`, or change the association under
`workbench.editorAssociations`. You can also open a single file in a different
editor with the "Reopen Editor With..." command.

## How it works

Bioscratch registers a custom editor for `.md` files. The editing surface runs in
a webview, and VS Code owns the document, save, hot exit, and undo and redo
(`Ctrl+Z` / `Cmd+Z` go to VS Code's document history). Edits write back to the
document with a minimal-diff edit that touches only the changed range, so the
file, the dirty indicator, and Git all behave the same as for a normal text file.

## Settings

- `bioscratch.theme`: the theme used to render documents. You can also pick a
  theme, including imported custom themes, from the in-editor theme picker.
- `bioscratch.matchVscodeTheme`: follow the active VS Code color theme instead of
  the `bioscratch.theme` setting.
- `bioscratch.setAsDefaultEditor`: open Markdown files in Bioscratch by default.
- `bioscratch.editDebounceMs`: delay in milliseconds before edits are written back
  to the document.

## Commands

- Bioscratch: Find in Document (`Ctrl+F` / `Cmd+F` while focused)
- Bioscratch: Export to HTML
- Bioscratch: Select Theme
- Bioscratch: Toggle Match VS Code Theme

## License

MIT
