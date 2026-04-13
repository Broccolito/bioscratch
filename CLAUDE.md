# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commit Rules

**Never add `Co-Authored-By` lines to commit messages in this repo.** A `commit-msg` hook in `.githooks/commit-msg` enforces this and will reject any commit containing a `Co-Authored-By: Claude ...` line.

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
- **`components/`** — `EditorSurface.tsx` (mounts the single shared `EditorView`, houses all NodeViews: `MathInlineView`, `MathBlockView`, `MermaidBlockView`; NodeViews live here, not in `schema.ts`), `SearchBar.tsx`, `StatusBar.tsx`, `RecoveryDialog.tsx` (autosave recovery modal), `LargeFileDialog.tsx`, `UpdateDialog.tsx` (auto-update UI)
- **`editor/schema.ts`** — ProseMirror schema: all nodes (headings, lists, task lists, code blocks, tables, math, images) and marks
- **`editor/plugins/`** — keymap, inputRules (Markdown shortcuts), history, search, dropImage, highlight, imageRender (Typora-style image decoration), mermaidPlugin (cursor-active decoration for Mermaid blocks), codeOnlyPlugin (non-Markdown file editing mode), markdownPaste (intercepts plain-text pastes in markdown mode and parses them as Markdown)
- **`editor/serialization/`** — bidirectional Markdown ↔ ProseMirror doc via unified/remark ecosystem
- **`hooks/`** — `useDocumentState` (filePath/dirty/content state + load/save logic), `useAutosave` (30s polling), `useRecentFiles` (recent file list via Tauri), `useTheme` (localStorage + CSS var application)
- **`lib/`** — `themeLoader.ts` (YAML → CSS vars), `export.ts` (HTML export), `stats.ts` (word/char counts), `math.ts` (KaTeX helpers), `imagePaths.ts` (path resolution for local images)

### Rust backend (`app/src-tauri/src/lib.rs`)

Tauri commands: `read_file`, `write_file`, `show_open_dialog`, `show_save_dialog`, `show_html_save_dialog`, `save_autosave`, `load_autosave`, `delete_autosave`, recent files (`read_recent_files`, `save_recent_files`), `export_html`, `export_pdf_pandoc`, `open_url`, `open_new_window`, `get_app_data_dir`, `get_initial_file`, `list_user_themes`, `save_user_theme`, `delete_user_theme`, `check_for_updates`, `download_and_install`, `quit_app`. New windows are spawned from Rust (via `tauri::WebviewWindowBuilder`), not from JS — Tauri v2's JS window API has limitations that make this necessary.

**macOS Open With / file association** — `lib.rs` handles macOS `RunEvent::Opened` to capture files passed before the JS bridge is ready, storing them in a `Mutex<Option<String>>`. The frontend retrieves them via `get_initial_file()` on startup. An `extra-info.plist` in `app/src-tauri/` prevents `NSDocumentController` from intercepting file opens and triggering document restoration (which would break the app's own file handling).

**macOS menu** — `lib.rs` builds the app menu at startup: File (New Tab, Open, Save, Save As, Export HTML, Export PDF), Edit (OS-standard cut/copy/paste/undo), View (Theme), Window (Minimize, New Window), Help (GitHub). Menu events are dispatched to the focused window's webview via `emit_to()`.

## Key Patterns

**Single EditorView, multiple tabs** — One `EditorView` instance is shared across all tabs. Inactive tab states are stashed in `storedTabsRef` (a `Map` ref). On tab switch: stash active state → restore from map → `view.updateState(newState)`. This avoids expensive mount/unmount cycles.

**Ref-heavy async pattern** — Stale closure bugs in async handlers (polling, drag-drop, file reads) are avoided by keeping current values in refs (`viewRef`, `activeTabIdRef`, `filePathRef`, `contentRef`, `storedTabsRef`, `suppressWatchUntilRef`, `loadDocContentRef`). Use refs, not state, when async callbacks need current values.

**File polling, not watchers** — External file change detection uses a 1.5s `setInterval` instead of native fs watchers (avoids permission requirements). After the user saves, watches are suppressed for 2s to prevent self-reload.

**Atomic multi-file drop** — When multiple files are dropped, all are read in parallel then applied in a single synchronous pass. Never apply tabs sequentially across React renders.

**Autosave** — Every 30s to `{app_data_dir}/autosave/{sanitized_path}.md`. On file open, if autosave differs from disk, a modal recovery dialog is shown.

**Tab drag-to-detach** — Uses mouse events (not HTML5 drag API). When a tab is dragged outside the tab bar, the file is saved to disk, a new Tauri window is spawned with `?file={path}`, and the tab is closed in the original window.

**CSS structure** — Three CSS files in `app/src/styles/`: `app.css` (layout/toolbar/tabs/welcome), `editor.css` (ProseMirror internals), `markdown.css` (content rendering — also inlined into HTML exports). `EditorSurface.tsx` also imports `highlight.js/styles/github.css` and `katex/dist/katex.min.css`. All colors are CSS custom properties (`--bg-editor`, `--text-primary`, etc.) — never hardcode color values in CSS. Theme tokens are defined in `app/src/themes/*.yaml` and applied to `:root` by `themeLoader.ts`.

**Theme system** — Each theme is a flat YAML file in `app/src/themes/`. Keys map directly to `--key` CSS custom properties set on `:root`. `useTheme.ts` reads/writes `localStorage` and applies via `useLayoutEffect` to avoid flash. To add a theme: create the YAML, import it in `themeLoader.ts`, extend `ThemeName`, add to `themeConfigs`, and add to `ThemeSelector.tsx`'s `THEMES` array.

**Image rendering** — Images are stored as plain ProseMirror paragraphs containing `![alt](src)` text (not as image nodes). `imageRender.ts` is a decoration plugin that implements Typora-style rendering: when the cursor is elsewhere the source paragraph is collapsed and an image widget is shown below it; when the cursor enters the paragraph the source text becomes visible. Tauri's WebView cannot load `file://` URLs, so local images are read via `readFile()` and converted to base64 data URLs. A module-level `srcCache` prevents re-reading files on every keystroke.

**Mermaid rendering** — `mermaidPlugin.ts` adds a node decoration (`mermaidActive: true`) when the cursor is inside a `mermaid` code block. `MermaidBlockView` in `EditorSurface.tsx` reads this decoration to toggle between source-visible (active) and rendered diagram (inactive) states — same Typora-style toggle pattern as image rendering.

**File mode** — `lib/fileMode.ts` detects file type from extension and sets one of three modes: `markdown`, `plaintext`, or `code`. Code mode maps ~97 extensions to highlight.js language IDs. In code/plaintext mode, `codeOnlyPlugin` replaces the ProseMirror schema with a plain textarea-like experience.

**Auto-update** — `check_for_updates` (in lib.rs) hits the GitHub releases API and compares SemVer. `download_and_install` curls the DMG to `~/Downloads/` and opens it. The `UpdateDialog` component in `components/` drives the UI for this flow.

**HTML export** — Single self-contained `.html` file with KaTeX, highlight.js, and all CSS inlined. DOMPurify sanitizes content.

**PDF export** — `export_pdf_pandoc` in lib.rs shells out to Pandoc with a generated temp HTML file and resolves relative image paths before conversion. Requires Pandoc installed on the host.

**User themes** — In addition to the 32 built-in YAML themes in `app/src/themes/`, users can import custom YAML theme files via `handleImportTheme()` in `App.tsx`. Custom themes are stored in `{app_data_dir}/user_themes/` via `save_user_theme` and listed/deleted via the corresponding Tauri commands. `themeLoader.ts` merges built-in (`BUILTIN_THEME_RAWS`) and user themes at runtime.

## Version Management

Version is declared in two places that must stay in sync: `app/package.json` (`"version"`) and `app/src-tauri/Cargo.toml` (`version = "..."`). The landing page at [broccolito.github.io/bioscratch-landing](https://broccolito.github.io/bioscratch-landing/) and its source at `/Users/wgu/Desktop/bioscratch-landing` also hardcode the version in download links — update those on release too.

## TypeScript Configuration

`tsconfig.json` enables strict mode with `noUnusedLocals` and `noUnusedParameters`. `npm run build` will fail on unused variables — clean these up before committing.

## Styling Conventions

- Font: Arial (not system-ui or sans-serif)
- Toolbar text: black in both themes
- Editor background: off-white (`#fafafa`) in light mode
