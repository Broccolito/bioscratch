# Bioscratch

A minimal, Typora-style WYSIWYG Markdown editor built with Tauri v2, React, TypeScript, and ProseMirror.

## Features

- **Multi-tab editing** — open and switch between multiple documents simultaneously
- **WYSIWYG single-pane editor** — no split view; what you type is what you see
- **Full Markdown round-trip** — open `.md` files, edit, and save back as clean Markdown
- **Autosave + crash recovery** — saves every 30 seconds; prompts recovery on restart
- **Light and dark themes**
- **HTML export** — export to self-contained HTML with embedded styles and math

### Supported content types
- Headings (H1–H6), paragraphs
- Bold, italic, strikethrough, inline code
- Links, images (drag-and-drop)
- Bullet lists, ordered lists, task lists
- Blockquotes
- Fenced code blocks with syntax highlighting (highlight.js)
- Tables (GFM-style)
- Inline math (`$...$`) and block math (`$$...$$`) via KaTeX
- Horizontal rules

### Keyboard shortcuts
| Action | Mac | Windows/Linux |
|--------|-----|---------------|
| Save | Cmd+S | Ctrl+S |
| Open | Cmd+O | Ctrl+O |
| New tab | Cmd+N | Ctrl+N |
| Close tab | Cmd+W | Ctrl+W |
| Find | Cmd+F | Ctrl+F |
| Bold | Cmd+B | Ctrl+B |
| Italic | Cmd+I | Ctrl+I |
| Inline code | Cmd+` | Ctrl+` |
| Undo | Cmd+Z | Ctrl+Z |
| Redo | Cmd+Shift+Z | Ctrl+Shift+Z |

### Markdown input rules
- `# ` → Heading 1, `## ` → Heading 2, etc.
- `- ` or `* ` → Bullet list
- `1. ` → Ordered list
- `- [ ] ` → Task list item
- `> ` → Blockquote
- ` ``` ` → Code block
- `---` → Horizontal rule

## Tech stack

| Layer | Technology |
|-------|-----------|
| Desktop shell | Tauri v2 (Rust) |
| Frontend | React 19 + TypeScript + Vite |
| Editor | ProseMirror |
| Markdown | unified / remark-parse / remark-gfm / remark-math |
| Math rendering | KaTeX |
| Code highlighting | highlight.js |
| Tables | prosemirror-tables |

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
    components/       React UI components (Toolbar, TabBar, EditorSurface, StatusBar, SearchBar)
    editor/
      schema.ts       ProseMirror document schema
      plugins/        Keymap, input rules, search, history, image drop
      serialization/  Markdown import/export
    hooks/            useTheme, useAutosave, useRecentFiles
    lib/              Stats, export, image utilities
    styles/           CSS (app layout, editor, markdown content)
  src-tauri/          Rust backend — file I/O, dialogs, autosave, HTML export
tests/
  fixtures/           Sample Markdown files (basic, code, math, tables, mixed)
```
