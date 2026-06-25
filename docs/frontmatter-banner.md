# YAML Front Matter Banner

Bioscratch renders a leading YAML front-matter block (`--- … ---`) as an
aesthetic **page banner** instead of raw text — a widget that sits
alongside images, code blocks and Mermaid diagrams. This document is the
implementation checklist and reference.

## What it does

- A Markdown file that begins with a YAML front-matter block is rendered as a
  **generic, unlabelled banner** — like a Mermaid block, it just renders the
  content without announcing what it is. Every property is one bullet line,
  rendered recursively (nested maps and lists of objects indent beneath their
  key). There is **no** "Front Matter" label, no title styling, no chips, no
  per-key icons, and no special-casing of `tags`/`authors`/`status`/etc.
- Moving the caret into the banner reveals the **editable YAML source** above a
  live banner preview; moving it out collapses the source and shows only the
  banner. (Same cursor-active toggle as Mermaid blocks and images.)
- Users **create** a banner the same way they create other widgets: on a blank
  first line, type `---` and press **Enter**. The paragraph becomes a
  frontmatter block seeded with `title:` / `tags:`, caret inside. (macOS
  "smart dashes" rewrites `---` to an em dash `—`; the keymap normalizes em/en
  dashes back before matching so the trigger fires for real typing.)
- Empty front matter renders an **empty banner card with no placeholder text**.
- It round-trips losslessly back to `--- … ---` on save.

## Supported front-matter shapes

Researched across Jekyll, Hugo, Obsidian (+ Templater), Pandoc, R Markdown,
Quarto, Zola, Eleventy, Gatsby, MkDocs, Docusaurus, Pelican. Handled:

- Scalars (quoted/unquoted), numbers, booleans, null/empty values
- Dates and datetimes
- Block sequences (`- item`) and flow sequences (`[a, b, c]`)
- Comma-separated and space-separated "lists" that are really strings
- Nested mappings and **lists of objects** (e.g. Pandoc/Quarto `author:`)
- Multiline block scalars (`|` and `>`)
- Templater `<% … %>` / `{{ … }}` / `` `r …` `` template expressions (opaque)
- The Pandoc/MkDocs closing `...` fence (in addition to `---`)
- Malformed-but-common YAML → **fail-soft** line parser rather than crashing
- Empty front matter (`---` / `---`, valid in Jekyll) → empty banner

## Implementation checklist

- [x] **Schema** — `frontmatter` node (`content: "text*"`, `code: true`,
      `isolating`, `defining`); `doc` content is `"frontmatter? block+"` so it is
      only ever the document's first child. (`editor/schema.ts`)
- [x] **Import** — `remark-frontmatter` added to the unified pipeline with both
      `---/---` and `---/...` fences; mdast `yaml` node → `frontmatter` node;
      trailing paragraph appended if the file is only front matter.
      (`serialization/markdownImport.ts`)
- [x] **Export** — `frontmatter` node → `--- … ---` verbatim.
      (`serialization/markdownExport.ts`)
- [x] **Banner renderer** — tolerant YAML parse (`yaml`, `strict:false`) with a
      line-parser fallback; generic recursive key→value bullet rendering (no key
      classification); safe DOM construction (`textContent` only — CSP is
      disabled). (`lib/frontmatter.ts`)
- [x] **NodeView** — `FrontmatterView`: collapsed source + banner preview;
      clicking the banner drops the caret inside the YAML (reveal-on-click, like
      Mermaid) via `TextSelection.create` at the first inside position.
      (`components/EditorSurface.tsx`)
- [x] **Cursor-active plugin** — `frontmatterPlugin` adds a node decoration that
      carries `class: "frontmatter-active"` as a DOM attribute (PM applies it
      straight to the NodeView element — more reliable than reading the spec in
      `update()`). (`editor/plugins/frontmatterPlugin.ts`)
- [x] **Creation** — typing `---` (or its smart-dash em/en-dash form) + Enter at
      doc top builds a seeded frontmatter block; ArrowDown exits into the body;
      Backspace/Delete removes an empty banner. (`editor/plugins/keymap.ts`)
- [x] **Styling** — minimal document masthead (no card/border/shadow, just a
      hairline bottom divider); top-level properties are flush-left header-like
      lines, nested values indent as bullets. CSS custom properties so it adapts
      to all 32 themes. (`styles/editor.css`)
- [x] **Quick Look preview** — registered in the read-only preview entry so the
      Finder spacebar preview matches the editor. (`preview/main.tsx`)
- [x] **Fixtures** — `tests/fixtures/frontmatter/01..09` covering Templater,
      Obsidian, Hugo (nested), Pandoc (author objects + `...`), Quarto (deep),
      Jekyll, malformed, empty, and a full showcase.
- [x] **Tests** — headless round-trip + parse harness (27/27 pass,
      `app/scripts/test-frontmatter.mts`); live verification via the
      `tauri-debug` bridge (render, source toggle both directions, `---`
      creation, malformed fallback, empty hint, Pandoc `...`).

## Manual test

```bash
cd app && npm run tauri dev
# Open any tests/fixtures/frontmatter/*.md, or in a new doc type "---" + Enter.
```

Headless pipeline test:

```bash
cd app
npx esbuild scripts/test-frontmatter.mts --bundle --platform=node \
  --format=cjs --outfile=scripts/.fmtest.cjs
node scripts/.fmtest.cjs && rm scripts/.fmtest.cjs
```
