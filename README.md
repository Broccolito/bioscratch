# Jottingdown

A Typora-like WYSIWYG Markdown editor built with Tauri v2, React, TypeScript, and ProseMirror.

## Features

- Single-pane WYSIWYG editor (no split view)
- Centered writing column (max 720px), minimal chrome
- Full Markdown round-trip: open `.md` files, edit, save back as Markdown
- Inline editing of all node types
- Light and dark themes
- Autosave every 30 seconds with crash recovery

### Supported node types
- Headings (H1–H6)
- Paragraphs
- Bold, italic, strikethrough, inline code
- Links
- Bullet lists, ordered lists, task lists
- Blockquotes
- Fenced code blocks with syntax highlighting (highlight.js)
- Tables (GFM-style)
- Inline math (`$...$`) and block math (`$$...$$`) via KaTeX
- Images (drag-and-drop supported)
- Horizontal rules

### Keyboard shortcuts
| Action | Mac | Windows/Linux |
|--------|-----|---------------|
| Save | Cmd+S | Ctrl+S |
| Open | Cmd+O | Ctrl+O |
| New | Cmd+N | Ctrl+N |
| Find | Cmd+F | Ctrl+F |
| Bold | Cmd+B | Ctrl+B |
| Italic | Cmd+I | Ctrl+I |
| Inline code | Cmd+` | Ctrl+` |
| Undo | Cmd+Z | Ctrl+Z |
| Redo | Cmd+Shift+Z | Ctrl+Shift+Z |

### Markdown shortcuts (input rules)
- `# ` → Heading 1, `## ` → Heading 2, etc.
- `- ` or `* ` → Bullet list
- `1. ` → Ordered list
- `- [ ] ` → Task list item
- `> ` → Blockquote
- ` ``` ` → Code block
- `---` → Horizontal rule

## Tech stack

- **Desktop shell**: Tauri v2
- **Frontend**: React 19 + TypeScript + Vite
- **Editor**: ProseMirror
- **Markdown**: unified / remark-parse / remark-gfm / remark-math
- **Math**: KaTeX
- **Code highlighting**: highlight.js
- **Tables**: prosemirror-tables

## Development

```bash
cd app
npm install
npm run tauri dev
```

## Build

```bash
cd app
npm run tauri build
```

## Project structure

```
app/
  src/
    components/       React UI components
    editor/
      schema.ts       ProseMirror schema
      nodes/          (reserved for future node extractors)
      marks/          (reserved for future mark extractors)
      plugins/        ProseMirror plugins (keymap, inputRules, search, etc.)
      serialization/  Markdown import/export
    hooks/            React hooks
    lib/              Utility functions
    styles/           CSS files
  src-tauri/          Tauri/Rust backend
tests/
  fixtures/           Sample Markdown files for testing
```
