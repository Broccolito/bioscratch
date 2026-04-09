# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

All commands run from the `app/` directory:

```bash
npm run tauri dev      # Start dev server (Vite on :1420 + Tauri window)
npm run tauri build    # Production build
npm run dev            # Vite frontend only (no Tauri shell)
npm run build          # TypeScript check + Vite bundle
```

There is no test runner. The `tests/fixtures/` directory contains Markdown files for manual testing: `basic.md`, `code.md`, `math.md`, `table.md`, `mixed.md`, `images.md`. Image fixtures use `tests/fixtures/img/` as their asset directory.

## Architecture

Bioscratch is a Typora-style WYSIWYG Markdown desktop editor built with Tauri v2 (Rust) + React 19 + ProseMirror.

```
Tauri (Rust) — file I/O, dialogs, autosave, new windows
      ↕ invoke() IPC
React (TypeScript) — app state, multi-tab management, UI
      ↕ React hooks / refs
ProseMirror — WYSIWYG editing, schema, plugins, serialization
```

### Frontend (`app/src/`)

- **`App.tsx`** — root orchestrator: tab state, file open/save, autosave polling, file-change polling, drag-drop coordination
- **`components/EditorSurface.tsx`** — mounts the single shared `EditorView` and houses custom ProseMirror node views (`MathInlineView`, `MathBlockView`, `MermaidBlockView`). Note: all NodeViews live here, not in `schema.ts`
- **`editor/schema.ts`** — ProseMirror schema: all nodes (headings, lists, task lists, code blocks, tables, math, images) and marks
- **`editor/plugins/`** — keymap, inputRules (Markdown shortcuts), history, search, dropImage, highlight, imageRender (Typora-style image decoration), mermaidPlugin (cursor-active decoration for Mermaid blocks)
- **`editor/serialization/`** — bidirectional Markdown ↔ ProseMirror doc via unified/remark ecosystem
- **`hooks/`** — `useDocumentState` (filePath/dirty/content state + load/save logic), `useAutosave` (30s polling), `useRecentFiles` (recent file list via Tauri), `useTheme` (localStorage + CSS var application)
- **`lib/`** — `themeLoader.ts` (YAML → CSS vars), `export.ts` (HTML export), `stats.ts` (word/char counts), `math.ts` (KaTeX helpers), `imagePaths.ts` (path resolution for local images)

### Rust backend (`app/src-tauri/src/lib.rs`)

Tauri commands: `read_file`, `write_file`, `show_open_dialog`, `show_save_dialog`, `show_html_save_dialog`, `save_autosave`, `load_autosave`, `delete_autosave`, recent files (`add_recent_file`, `get_recent_files`, `clear_recent_files`), `export_html`, `export_pdf_pandoc`, `open_url`, `open_new_window`, `get_app_data_dir`, `list_user_themes`, `save_user_theme`, `delete_user_theme`. New windows are spawned from Rust (via `tauri::WebviewWindowBuilder`), not from JS — Tauri v2's JS window API has limitations that make this necessary.

## Key Patterns

**Single EditorView, multiple tabs** — One `EditorView` instance is shared across all tabs. Inactive tab states are stashed in `storedTabsRef` (a `Map` ref). On tab switch: stash active state → restore from map → `view.updateState(newState)`. This avoids expensive mount/unmount cycles.

**Ref-heavy async pattern** — Stale closure bugs in async handlers (polling, drag-drop, file reads) are avoided by keeping current values in refs (`viewRef`, `activeTabIdRef`, `filePathRef`, `contentRef`, `storedTabsRef`, `suppressWatchUntilRef`, `loadDocContentRef`). Use refs, not state, when async callbacks need current values.

**File polling, not watchers** — External file change detection uses a 1.5s `setInterval` instead of native fs watchers (avoids permission requirements). After the user saves, watches are suppressed for 2s to prevent self-reload.

**Atomic multi-file drop** — When multiple files are dropped, all are read in parallel then applied in a single synchronous pass. Never apply tabs sequentially across React renders.

**Autosave** — Every 30s to `{app_data_dir}/autosave/{sanitized_path}.md`. On file open, if autosave differs from disk, a modal recovery dialog is shown.

**Tab drag-to-detach** — Uses mouse events (not HTML5 drag API). When a tab is dragged outside the tab bar, the file is saved to disk, a new Tauri window is spawned with `?file={path}`, and the tab is closed in the original window.

**CSS structure** — Three CSS files: `app.css` (layout/toolbar/tabs/welcome), `editor.css` (ProseMirror internals), `markdown.css` (content rendering — also inlined into HTML exports). All colors are CSS custom properties (`--bg-editor`, `--text-primary`, etc.) — never hardcode color values in CSS. Theme tokens are defined in `app/src/themes/*.yaml` and applied to `:root` by `themeLoader.ts`.

**Theme system** — Each theme is a flat YAML file in `app/src/themes/`. Keys map directly to `--key` CSS custom properties set on `:root`. `useTheme.ts` reads/writes `localStorage` and applies via `useLayoutEffect` to avoid flash. To add a theme: create the YAML, import it in `themeLoader.ts`, extend `ThemeName`, add to `themeConfigs`, and add to `ThemeSelector.tsx`'s `THEMES` array.

**Image rendering** — Images are stored as plain ProseMirror paragraphs containing `![alt](src)` text (not as image nodes). `imageRender.ts` is a decoration plugin that implements Typora-style rendering: when the cursor is elsewhere the source paragraph is collapsed and an image widget is shown below it; when the cursor enters the paragraph the source text becomes visible. Tauri's WebView cannot load `file://` URLs, so local images are read via `readFile()` and converted to base64 data URLs. A module-level `srcCache` prevents re-reading files on every keystroke.

**Mermaid rendering** — `mermaidPlugin.ts` adds a node decoration (`mermaidActive: true`) when the cursor is inside a `mermaid` code block. `MermaidBlockView` in `EditorSurface.tsx` reads this decoration to toggle between source-visible (active) and rendered diagram (inactive) states — same Typora-style toggle pattern as image rendering.

**HTML export** — Single self-contained `.html` file with KaTeX, highlight.js, and all CSS inlined. DOMPurify sanitizes content.

**PDF export** — `export_pdf_pandoc` in lib.rs shells out to Pandoc with a generated temp HTML file and resolves relative image paths before conversion. Requires Pandoc installed on the host.

**User themes** — In addition to the 26+ built-in YAML themes in `app/src/themes/`, users can import custom YAML theme files via `handleImportTheme()` in `App.tsx`. Custom themes are stored in `{app_data_dir}/user_themes/` via `save_user_theme` and listed/deleted via the corresponding Tauri commands. `themeLoader.ts` merges built-in (`BUILTIN_THEME_RAWS`) and user themes at runtime.

## Styling Conventions

- Font: Arial (not system-ui or sans-serif)
- Toolbar text: black in both themes
- Editor background: off-white (`#fafafa`) in light mode
