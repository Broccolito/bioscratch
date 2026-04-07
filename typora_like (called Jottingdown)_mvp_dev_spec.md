# Typora-like Markdown Editor (TypeScript + Rust) — Development Spec for an AI Coding Agent

## 1. Objective

Build a desktop Markdown editor inspired by Typora, using:

- **Frontend:** TypeScript
- **Desktop shell / native backend:** Rust
- **App framework:** Tauri
- **Editing model:** **single-pane Typora-like inline WYSIWYG editing**
- **Rendering requirement:** text, code blocks, tables, images/figures, and **math** render inline in the editor

This document is written for an autonomous coding agent. It defines:

- product scope
- architecture
- implementation order
- acceptance criteria
- validation procedures for every milestone
- explicit non-goals

The goal is no longer split-pane Markdown editing. The target is a **single-pane, inline, WYSIWYG Markdown editor** with Markdown persistence.

---

## 2. Product Summary

Create a desktop Markdown editor that:

- opens and saves `.md` files
- renders the document in a **Typora-like single-column writing layout**
- allows **full inline WYSIWYG editing** inside the rendered document
- stores the document as Markdown on disk
- correctly supports and renders:
  - headings
  - paragraphs
  - bold / italic / inline code
  - links
  - ordered and unordered lists
  - blockquotes
  - fenced code blocks with syntax highlighting
  - tables
  - images / figures
  - task lists
  - inline math
  - block math
- exports to HTML and PDF
- includes a limited set of practical usability features that are compatible with this editing model

This is intended to be a **real Typora-like MVP**, not a split-view editor.

---

## 3. Core Product Decision

### Chosen editing model

Use a **structured rich-text editor model in memory** and **Markdown as the persisted file format**.

Recommended conceptual model:

- internal editor state = structured document tree
- displayed UI = rendered inline WYSIWYG document
- file format = Markdown
- open flow = Markdown -> parser -> editor document
- save flow = editor document -> Markdown serializer -> disk

### Layout requirement

The app should visually resemble Typora more than a note-taking workspace.

Required layout characteristics:

- **single main document surface** in the center
- no permanent left editor / right preview split
- minimal chrome
- optional top toolbar with low visual weight
- centered writing column with readable max width
- generous whitespace around the document
- status bar can remain but should be visually light

### Important implementation stance

The app must implement **full inline WYSIWYG editing** for the supported feature set.

That means:

- headings are edited as headings
- lists are edited as lists
- code blocks are edited as code blocks
- tables are edited inline as tables
- images appear inline in the document
- math appears rendered inline / block-style in the document
- user edits happen inside the rendered document, not in a separate source pane

### Scope boundary

This spec now includes features that were previously excluded:

- single-pane Typora-like layout
- inline WYSIWYG editing
- Markdown round-trip for supported nodes
- math rendering

However, the build should still avoid unnecessary escalation into the hardest possible editor problems. The agent should choose mature frameworks and keep the supported feature set focused.

---

## 4. Recommended Stack

## 4.1 Desktop framework

- **Tauri v2**
- Rust commands for filesystem access, export helpers, recent files, and recovery storage

## 4.2 Frontend

- **TypeScript**
- **React**
- **Vite**

## 4.3 Editor framework

Use a structured editor framework that supports custom node schemas and Markdown import/export.

Preferred order:

1. **ProseMirror**
2. Lexical only if ProseMirror becomes a blocker

Why ProseMirror:

- strongest fit for structured WYSIWYG editing
- mature ecosystem for block nodes and custom schema
- good foundation for tables, code blocks, images, and math nodes
- better fit than plain text editors for Typora-like inline editing

## 4.4 Markdown parsing / serialization

Preferred stack:

- **remark / unified** for Markdown parse/serialize utilities
- or **markdown-it** for rendering-only helpers where needed
- choose one primary import/export path and keep it consistent

The agent must establish:

- Markdown -> editor document conversion
- editor document -> Markdown serialization

for the supported node types only.

## 4.5 Tables

Preferred:

- ProseMirror table support via mature community package

## 4.6 Math

Preferred:

- parse Markdown math with a remark-compatible math parser or equivalent
- render math using **KaTeX**

Required math support:

- inline math: `$...$`
- block math: `$$...$$`

## 4.7 Code blocks

Preferred:

- syntax highlighting via **Shiki** or **highlight.js**
- code block node should remain editable as text inside the WYSIWYG document

## 4.8 Sanitization

- sanitize any HTML-rendered surfaces as needed
- prefer **DOMPurify** for preview/export HTML if raw HTML is allowed later

## 4.9 PDF export

Preferred order:

1. HTML export plus print-to-PDF using webview/browser path
2. fallback Rust-side PDF pipeline only if necessary

## 4.10 State management

Keep state minimal.

Use:

- React local state and context
- editor state managed primarily by ProseMirror
- no Redux unless proven necessary

---

## 5. Scope: Features to Build

Ordered from MVP core to slightly-more-usable.

## 5.1 Core WYSIWYG MVP features

1. desktop app shell launches successfully
2. single-pane Typora-like layout
3. inline WYSIWYG editor surface
4. open Markdown file
5. save Markdown file
6. save as
7. dirty-state tracking
8. Markdown import into the editor for supported nodes
9. Markdown export from the editor for supported nodes
10. inline rendering + editing for:
    - headings
    - paragraphs
    - bold / italic
    - inline code
    - links
    - unordered lists
    - ordered lists
    - task lists
    - blockquotes
    - fenced code blocks
    - tables
    - images
    - inline math
    - block math
11. syntax highlighting in code blocks
12. toolbar for common block/inline formatting
13. keyboard shortcuts for common formatting and save/open/find
14. export to HTML
15. export to PDF

## 5.2 Slightly-more-usable features compatible with WYSIWYG scope

16. recent files list
17. autosave draft cache for unsaved changes
18. restore unsaved draft after crash/relaunch
19. basic search within current document
20. light/dark theme toggle
21. status bar with:
    - file path
    - modified state
    - word count
    - character count
22. drag-and-drop image insertion
23. centered writing column with readable width controls or a fixed max width
24. optional focus mode that hides nonessential chrome

---

## 6. Non-Goals / Features Still Excluded

The agent must **not** build these in this version:

- collaborative editing
- plugin system
- footnotes
- Mermaid / diagrams
- comments / annotations
- multi-document tabs unless trivial later
- semantic paste from Word / Google Docs into perfect Markdown
- track changes
- image resize handles
- figure caption UI beyond Markdown-supported text content
- advanced source-preserving serialization that exactly preserves all original whitespace/style conventions
- full compatibility with arbitrary raw HTML embedded in Markdown
- every Markdown extension on the internet

The app only needs to be correct and stable for the **supported node set** defined in this document.

---

## 7. Information Architecture

## 7.1 App layout

Required layout:

- minimal top toolbar or compact header
- central editor canvas occupying most of the app
- centered document column
- optional subtle status bar at bottom

### Layout guidance

Visual behavior should be closer to:

- a writing surface
- low-distraction editing
- direct manipulation of the document

and not closer to:

- an IDE
- a split-view Markdown previewer
- a block-database workspace

### Acceptance criteria for layout

- there is only **one main document surface**
- document content is centered with a comfortable max width
- on launch, the UI reads as a writing app rather than a dual-pane tool

## 7.2 Primary screens

Only one primary screen is required:

- **Editor workspace**

Optional dialogs:

- open file
- save as
- export HTML
- export PDF
- unsaved changes confirmation
- draft recovery prompt

---

## 8. Supported Document Model

The coding agent must implement only the following supported node types and marks.

## 8.1 Block nodes

- document root
- paragraph
- heading
- blockquote
- ordered list
- unordered list
- task list item
- list item
- fenced code block
- table
- table row
- table cell
- image block or inline image node depending on chosen schema
- block math
- horizontal rule optional if trivial

## 8.2 Inline marks / inline nodes

- bold
- italic
- inline code
- link
- inline math
- plain text

## 8.3 Serialization rule

Every supported node must have:

1. Markdown import behavior
2. in-editor rendering behavior
3. Markdown export behavior

The agent must not add a node unless all three exist.

---

## 9. Functional Requirements

## 9.1 File operations

The app must support:

- create new document
- open existing `.md`
- save to existing path
- save as new path
- detect unsaved changes
- preserve Markdown semantics for supported nodes on save

### Acceptance criteria

- user can open a Markdown file and see it as rendered editable content
- save writes valid Markdown to disk
- reopening a saved file reconstructs the same supported structure
- dirty indicator clears after successful save
- closing or opening another file with unsaved changes prompts the user

---

## 9.2 Inline WYSIWYG editing

The editor must allow direct inline editing of rendered content.

Required editing behavior:

- typing in a heading edits heading text in place
- typing in a paragraph edits paragraph text in place
- Enter creates the expected next block for supported block types
- Backspace merges/exits simple structures where editor framework normally supports it
- lists behave as lists during editing
- tables are editable in cells
- code blocks remain editable as code text
- inline math and block math render visibly after insertion / parse

### Acceptance criteria

- no separate source pane is required for normal editing
- user can edit all supported node types directly in the document
- editing operations do not corrupt editor state during normal use

---

## 9.3 Markdown round-trip for supported nodes

The editor must round-trip supported Markdown with acceptable fidelity.

Required supported syntax examples:

- headings: `# Heading`
- emphasis: `**bold**`, `*italic*`
- inline code: `` `x` ``
- blockquote: `> quote`
- code fences:

```md
```ts
const x = 1
```
```

- tables
- task lists: `- [ ] item`
- images: `![alt](path)`
- inline math: `$a+b$`
- block math:

```md
$$
E = mc^2
$$
```

### Acceptance criteria

- supported Markdown imports into correct editor nodes
- saving immediately after opening a supported document produces valid Markdown
- reopening the saved document reconstructs equivalent supported structure

---

## 9.4 Math support

The app must support math in both import/export and rendering.

Required:

- inline math renders inline with surrounding text
- block math renders as a centered display block
- math is editable through an editor interaction chosen by the agent

Permitted implementation approaches:

- editable source text in math node with rendered display around or after commit
- node view with render-on-blur or render-when-not-selected

### Acceptance criteria

- inline math appears rendered for common expressions
- block math appears rendered for common expressions
- saving exports math back to Markdown delimiters correctly
- invalid math fails safely without crashing the editor

---

## 9.5 Tables

The app must support:

- parsing Markdown tables into table nodes
- inline table display
- editing table cell text
- exporting table content back to Markdown

### Acceptance criteria

- table imports from Markdown
- user can place cursor in a cell and edit content
- saving exports a valid Markdown table
- reopening restores equivalent table structure

Note: sophisticated row/column manipulation UI is not required.

---

## 9.6 Images

The app must support:

- Markdown image import
- inline image rendering
- drag-and-drop image insertion
- local relative path resolution based on current document location
- broken image fallback state

### Acceptance criteria

- image appears inline when path resolves
- broken paths fail safely with visible placeholder
- dropped image inserts Markdown-compatible representation

---

## 9.7 Code blocks

The app must support:

- fenced code block import/export
- inline code block rendering
- editable code text inside block
- syntax highlighting when language is available

### Acceptance criteria

- code block renders with monospaced styling and highlighting
- user can edit code without leaving the WYSIWYG document
- saving exports fenced Markdown code block correctly

---

## 9.8 Export

Support:

- export to HTML
- export to PDF

### Acceptance criteria

- exported HTML visually matches editor rendering for supported content
- exported PDF includes headings, paragraphs, tables, code blocks, images, and math where resolvable
- export failures surface a clear error message

---

## 9.9 Recovery / autosave

Support basic resilience:

- local draft autosave for unsaved documents and unsaved changes
- restore prompt on relaunch if previous session ended without save

### Acceptance criteria

- unsaved edits are recoverable after force-close or crash simulation
- restored draft does not overwrite original file without explicit save

---

## 10. Suggested Repository Structure

```text
app/
  src/
    components/
      Toolbar.tsx
      StatusBar.tsx
      EditorSurface.tsx
      RecoveryDialog.tsx
      SearchBar.tsx
    editor/
      schema.ts
      nodes/
        heading.ts
        paragraph.ts
        blockquote.ts
        codeBlock.ts
        table.ts
        image.ts
        mathInline.ts
        mathBlock.ts
        taskList.ts
      marks/
        bold.ts
        italic.ts
        inlineCode.ts
        link.ts
      plugins/
        keymap.ts
        inputRules.ts
        history.ts
        dropImage.ts
        search.ts
      serialization/
        markdownImport.ts
        markdownExport.ts
    hooks/
      useDocumentState.ts
      useRecentFiles.ts
      useAutosave.ts
      useTheme.ts
    lib/
      export.ts
      imagePaths.ts
      stats.ts
      math.ts
    styles/
      app.css
      editor.css
      markdown.css
    App.tsx
    main.tsx
  src-tauri/
    src/
      main.rs
      commands/
        file.rs
        export.rs
        recent.rs
        autosave.rs
    tauri.conf.json
  tests/
    fixtures/
      basic.md
      code.md
      table.md
      images.md
      math.md
      mixed.md
```

---

## 11. Architecture and Responsibilities

## 11.1 Frontend responsibilities

Frontend should handle:

- editor schema and node views
- inline editing interactions
- Markdown import/export bridging
- toolbar actions
- search UI
- dirty-state and document state
- theme switching
- invoking Rust commands through Tauri
- math rendering in editor and exported HTML flow

## 11.2 Rust responsibilities

Rust should handle:

- open/save dialogs if implemented natively
- secure file I/O
- recent file persistence
- autosave storage location and retrieval
- export support where native operations are needed
- app lifecycle hooks

## 11.3 Boundary rule

Do not push normal editor logic into Rust.

Keep Rust limited to:

- filesystem
- persistence
- native integration
- export plumbing

All editor behavior belongs in TypeScript.

---

## 12. Milestone Plan

Implement in the following order. Do not skip validation.

# Milestone 1 — Bootstrap desktop shell and Typora-like layout

## Goal

Create a Tauri + TypeScript app that launches and shows a single centered writing surface.

## Build tasks

1. initialize Tauri project with React + TypeScript
2. create app shell layout:
   - compact header/toolbar area
   - centered document surface
   - subtle status bar
3. define max width, padding, and typography for Typora-like feel
4. confirm dev and production build both run

## Validation steps

### Automated checks

Commands the agent should wire up:

```bash
npm run typecheck
npm run build
cargo check --manifest-path src-tauri/Cargo.toml
```

### Manual validation

1. launch app
2. verify there is only one main document surface
3. verify document column is centered and readable
4. verify resizing window does not break layout
5. verify UI feels like a writing app, not a split pane app

### Acceptance

- app launches successfully in dev mode
- production build completes
- no uncaught startup errors
- single-pane centered layout exists

---

# Milestone 2 — ProseMirror editor surface

## Goal

Integrate ProseMirror and provide stable inline editing for basic paragraphs and headings.

## Build tasks

1. add editor surface component
2. configure base schema with:
   - doc
   - paragraph
   - text
   - heading
3. mount editor inside centered document column
4. support selection, typing, Enter, Backspace, undo/redo
5. expose editor state to app state wrapper

## Validation steps

### Automated checks

- lint and typecheck pass
- editor component renders in test environment
- smoke test editor can initialize with empty document

### Manual validation

1. type multiple paragraphs
2. create headings via toolbar or command
3. verify cursor movement and selection work normally
4. verify undo/redo works
5. verify typing does not require a source pane

### Acceptance

- text editing is stable
- headings and paragraphs are editable inline
- undo/redo works through native editor behavior

---

# Milestone 3 — Core schema and formatting marks

## Goal

Support inline formatting and basic block structures.

## Build tasks

1. add marks:
   - bold
   - italic
   - inline code
   - link
2. add blocks:
   - blockquote
   - bullet list
   - ordered list
   - list item
   - task list item
3. add toolbar actions and keyboard shortcuts for supported formatting
4. add input rules for common Markdown shortcuts where practical

## Validation steps

### Automated checks

Create tests for:

- toggling bold on selection
- toggling italic on selection
- wrapping selection in link
- creating list and blockquote nodes
- task list parsing and export later compatibility

### Manual validation

1. select text and apply bold / italic
2. insert and edit lists
3. create task list items and toggle text content editing
4. create a blockquote and continue typing inside it
5. verify shortcuts work
6. verify undo after each action

### Acceptance

- inline formatting works inside the WYSIWYG document
- lists and blockquotes are editable inline
- toolbar and shortcuts behave deterministically

---

# Milestone 4 — Markdown import/export pipeline

## Goal

Create the round-trip path for supported core nodes.

## Build tasks

1. implement Markdown import for:
   - paragraphs
   - headings
   - bold / italic / inline code / links
   - lists / task lists
   - blockquotes
2. implement Markdown export for same nodes
3. add open/save integration using imported/exported document state
4. verify saving writes Markdown, not HTML or JSON

## Validation steps

### Automated checks

Fixture-based tests:

- import Markdown fixture -> editor document
- export editor document -> Markdown
- reopen exported Markdown -> equivalent structure

Use fixtures:

- `basic.md`
- `lists.md`
- `blockquote.md`

### Manual validation

1. open a Markdown file containing supported nodes
2. verify it renders correctly as editable content
3. make edits inline
4. save file
5. reopen file
6. verify structure is preserved

### Acceptance

- supported Markdown imports successfully
- save produces valid Markdown
- reopen reconstructs equivalent supported structure

---

# Milestone 5 — Code block support

## Goal

Add editable code blocks with syntax highlighting and Markdown round-trip.

## Build tasks

1. add fenced code block node
2. support language info string
3. render syntax highlighting
4. keep code text editable inline
5. add Markdown import/export for code fences

## Validation steps

### Automated checks

Fixture tests for:

- fenced code import
- language preservation
- fenced code export
- reopen equality for code block structure

### Manual validation

Use sample:

```md
```ts
const x = 1;
console.log(x);
```
```

Verify:

1. code block appears inline in the single document
2. code text is editable
3. syntax highlighting is visible
4. saving exports a fenced code block correctly
5. reopening restores the code block

### Acceptance

- code block editing is stable
- syntax highlighting appears when language is present
- Markdown round-trip works for code blocks

---

# Milestone 6 — Table support

## Goal

Add inline table display and basic cell editing with Markdown round-trip.

## Build tasks

1. add table schema support
2. parse Markdown tables into table nodes
3. enable cell text editing
4. export table content back to Markdown table syntax
5. keep scope to basic cell editing only

## Validation steps

### Automated checks

Fixture tests for:

- Markdown table import
- table cell text edits
- Markdown table export
- reopen to equivalent table structure

### Manual validation

Use sample:

```md
| A | B |
|---|---|
| 1 | 2 |
| 3 | 4 |
```

Verify:

1. table renders inline
2. cursor can enter cell text
3. cell edits are retained on save
4. reopened file restores table

### Acceptance

- table imports into editable table structure
- cell editing works
- save/reopen preserves equivalent table structure

---

# Milestone 7 — Image support and drag-drop insertion

## Goal

Add inline image rendering and image insertion workflow.

## Build tasks

1. support Markdown image import/export
2. resolve local relative paths based on current document
3. render image nodes inline
4. add drag-and-drop image insertion
5. show broken-image placeholder when resolution fails

## Validation steps

### Automated checks

- test relative path resolution utility
- test image Markdown export
- test broken path fallback state

### Manual validation

1. open a Markdown file with image reference
2. verify image appears inline
3. drag-drop an image file
4. verify image representation is inserted into document
5. save file and inspect Markdown output
6. change image path to invalid value
7. verify placeholder state appears without crash

### Acceptance

- image appears inline when path resolves
- dropped image inserts valid Markdown-compatible representation
- broken paths fail safely

---

# Milestone 8 — Math support

## Goal

Add inline math and block math rendering plus Markdown round-trip.

## Build tasks

1. add inline math node/mark behavior
2. add block math node
3. parse `$...$` and `$$...$$`
4. render math with KaTeX
5. export math back to Markdown delimiters
6. decide editing UX:
   - render-on-blur
   - render-when-not-selected
   - or inline editable source with rendered view around selection

## Validation steps

### Automated checks

Fixture tests for:

- inline math import/export
- block math import/export
- reopen to equivalent math structure
- invalid math does not crash render pipeline

### Manual validation

Use sample:

```md
Inline math $a^2+b^2=c^2$ inside text.

$$
E = mc^2
$$
```

Verify:

1. inline math renders inline in the sentence
2. block math renders distinctly as display math
3. editing math content is possible
4. save outputs correct Markdown delimiters
5. invalid expression shows safe fallback rather than crash

### Acceptance

- inline and block math render
- math is editable using the chosen interaction model
- Markdown round-trip works for supported math

---

# Milestone 9 — File lifecycle, dirty state, recent files

## Goal

Implement real document lifecycle around the WYSIWYG editor.

## Build tasks

1. add new document action
2. add open file action
3. add save and save as
4. add current path state
5. add dirty tracking
6. add unsaved-changes confirmation dialog
7. add recent files persistence

## Validation steps

### Automated checks

- file read/write integration tests using temporary files
- dirty-state transition tests:
  - clean on open
  - dirty after edit
  - clean after save
- recent files persistence tests

### Manual validation

1. open an existing `.md` file
2. edit it inline
3. verify dirty indicator appears
4. save it
5. verify Markdown on disk reflects edited structure
6. attempt to close/open another file while dirty
7. verify confirmation dialog appears
8. open multiple files and verify recent files updates

### Acceptance

- no silent data loss
- save writes valid Markdown derived from editor state
- dirty state is accurate
- recent files are persisted

---

# Milestone 10 — Export to HTML and PDF

## Goal

Allow exporting the current rendered document.

## Build tasks

1. export editor content to HTML
2. ensure exported HTML includes styling for:
   - headings
   - tables
   - code blocks
   - images
   - math
3. implement PDF export from rendered content
4. handle export errors clearly

## Validation steps

### Automated checks

- HTML export test compares output against expected sections
- PDF export smoke test verifies file is produced and non-empty

### Manual validation

Use a mixed content document with:

- heading
- paragraph
- code block
- table
- image
- inline math
- block math

Verify:

1. HTML opens in browser and resembles editor rendering
2. PDF contains all sections in readable layout
3. code block formatting remains readable
4. tables remain structured
5. math remains visible and readable

### Acceptance

- export succeeds for normal documents
- resulting files are viewable and correctly structured

---

# Milestone 11 — Autosave, recovery, search, theme, polish

## Goal

Add the last slightly-more-usable features.

## Build tasks

1. persist unsaved editor state periodically
2. associate draft with file path or untitled document ID
3. on startup, detect recoverable draft
4. prompt user to restore or discard
5. add search within current document
6. add light/dark theme toggle
7. add status bar metrics:
   - path
   - modified state
   - word count
   - character count
8. add optional focus mode if straightforward

## Validation steps

### Automated checks

- autosave write/read tests
- stale draft identification tests
- restore decision tests
- stats calculation tests
- theme preference persistence test if implemented

### Manual validation

1. open document
2. make unsaved edits
3. force-close app
4. relaunch app
5. verify restore prompt appears
6. restore draft and confirm edits are back
7. discard draft and confirm original file remains unchanged
8. search for repeated term and navigate matches
9. toggle theme and confirm editor updates
10. verify word and character counts change as text changes

### Acceptance

- unsaved work is recoverable
- search and theme work reliably
- polish features do not regress editing flow

---

## 13. Validation Matrix by Feature

| Feature | Automated validation | Manual validation | Pass condition |
|---|---|---|---|
| App shell + layout | build/typecheck/cargo check | launch and inspect centered layout | no startup errors, single-pane layout |
| Core editor | component + interaction tests | typing/selecting/undo | stable inline editing |
| Inline formatting | transformation and editor-command tests | apply bold/italic/link | correct WYSIWYG formatting |
| Markdown round-trip | fixture import/export tests | open/edit/save/reopen | equivalent supported structure |
| Code blocks | fixture tests | edit code in place | stable code block editing |
| Tables | table import/export tests | edit table cells | table survives save/reopen |
| Images | path resolution tests | open image + drag-drop | image visible / safe fallback |
| Math | math import/export tests | edit and render math | math visible and saved correctly |
| Save/open | temp-file integration tests | open/edit/save/confirm | no data loss |
| HTML export | file content checks | open in browser | visual match |
| PDF export | file exists/non-empty | inspect PDF | readable export |
| Autosave | persistence tests | crash recovery test | draft restored |
| Search/stats/theme | utility tests | search term, inspect counts, toggle theme | correct results |

---

## 14. Testing Strategy

## 14.1 Unit tests

Use unit tests for:

- Markdown import utilities
- Markdown export utilities
- formatting commands
- stats calculation
- relative image path resolution
- recent file list logic
- autosave metadata handling
- math parse/render guards

## 14.2 Integration tests

Use integration tests for:

- open/save lifecycle
- export generation
- recovery behavior
- import/edit/export/reopen cycles for fixtures

## 14.3 End-to-end tests

If practical, add E2E coverage for:

- launch app
- type into document
- apply formatting
- save and reopen
- export HTML
- restore draft

Prefer Playwright if Tauri setup supports it cleanly.

## 14.4 Manual smoke test document set

Create these fixture files:

### `basic.md`
- headings
- paragraphs
- emphasis
- links

### `code.md`
- multiple fenced blocks with different languages

### `table.md`
- several tables with different widths

### `images.md`
- relative image references
- broken image reference

### `math.md`
- inline math
- block math
- invalid math sample

### `mixed.md`
- everything combined in one realistic document

These fixtures must be used for manual validation after each milestone that touches rendering, editing, serialization, or export.

---

## 15. Definition of Done

The app is considered done for this version only if all of the following are true:

1. launches as a desktop app via Tauri
2. presents a Typora-like single-pane writing layout
3. can create, open, edit, and save Markdown files
4. provides full inline WYSIWYG editing for the supported node set
5. correctly renders tables, code blocks, links, images, and math inline
6. exports to Markdown on save, and to HTML/PDF on export
7. supports autosave draft recovery
8. passes all validation steps in all milestones
9. excludes unsupported advanced features listed in non-goals

---

## 16. Agent Operating Rules

The coding agent must follow these rules throughout implementation.

### Rule 1: Prefer mature editor libraries over custom editing engines

Do not build:

- custom cursor engine
- custom selection engine
- custom document renderer from scratch

Use ProseMirror and mature ecosystem packages where possible.

### Rule 2: Every supported feature must have import, edit, and export behavior

Do not partially add a feature that only renders but cannot save correctly.

### Rule 3: Keep the supported syntax set focused

If a Markdown construct is not in scope, do not silently attempt partial support.

### Rule 4: Validate after every milestone

Do not move to the next milestone until:

- automated checks pass
- manual validation procedure is completed
- acceptance criteria are satisfied

### Rule 5: If a feature becomes unstable, reduce UX ambition before reducing correctness

Examples:

- for math, use render-on-blur instead of always-live if needed
- for tables, support cell text editing only; do not add row tools
- for code blocks, favor stable text editing over elaborate IDE-like behavior

### Rule 6: Protect user data

Never ship behavior that risks silent overwrite or silent draft loss.

### Rule 7: Save valid Markdown, not editor JSON

The application file format is Markdown. Internal editor state is implementation detail only.

---

## 17. Minimal Backlog for Later Versions

These are intentionally deferred:

- perfect preservation of original Markdown whitespace/style choices
- HTML-in-Markdown compatibility expansion
- footnotes
- Mermaid
- image resize UI
- table row/column manipulation UI
- comments / annotations
- tabs and workspace management
- plugin API
- collaboration

Do not include them in this version.

---

## 18. Deliverables

The agent should produce:

1. working Tauri desktop application
2. readable source code with setup instructions
3. test suite covering critical logic
4. fixture Markdown files for validation
5. brief `README.md` with:
   - setup
   - run
   - build
   - test
   - known limitations

---

## 19. Final Acceptance Smoke Test

Before declaring completion, perform this exact end-to-end test:

1. launch app
2. create new document
3. type mixed content including:
   - heading
   - bold text
   - blockquote
   - code block
   - table
   - image reference
   - inline math
   - block math
4. verify all content appears inline in the single document surface
5. save file
6. close and reopen file
7. verify content structure is preserved
8. export HTML
9. export PDF
10. make unsaved edit
11. force-close app
12. relaunch
13. restore draft
14. verify restored content exists
15. drag-drop an image
16. verify inserted representation and inline image rendering
17. use search to find a term
18. verify status bar word count updates
19. verify math is still rendered after reopen and export

Completion requires the full smoke test to pass.

---

## 20. One-Sentence Build Goal

Build a reliable Tauri desktop Markdown editor with a Typora-like single-pane inline WYSIWYG experience that edits and saves Markdown while correctly rendering and round-tripping text, tables, code blocks, images, and math.
