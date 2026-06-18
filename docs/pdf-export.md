# PDF Export — HTML-faithful

Bioscratch exports PDFs that are **honest to the rendered HTML** — the same thing
you see in the editor, including the YAML front-matter banner, KaTeX math,
syntax-highlighted code, rendered Mermaid SVG, tables and images. There is no
Markdown→LaTeX round-trip (the old Pandoc/LaTeX path mangled the banner and is no
longer used).

## How it works

1. **Frontend** (`app/src/lib/export.ts`)
   - `buildPrintBody()` clones the live `.ProseMirror` DOM and:
     - reduces each YAML banner to its rendered `.fm-banner` (drops the raw YAML
       source section),
     - replaces each Mermaid block with its already-rendered `<svg>` (static, no
       JS needed),
     - keeps KaTeX HTML, tables, and data-URL images as-is,
     - sanitizes with DOMPurify (math + SVG tags allowed).
   - `buildPrintDocument()` wraps that in a self-contained HTML document with the
     app's **real CSS inlined** (`markdown.css` + `editor.css` via `?raw`), the
     active theme's `:root` custom properties and `data-color-scheme`, and KaTeX/
     highlight themes from a CDN. `print-color-adjust: exact` preserves
     backgrounds/colors.
   - `exportToPdf()` opens a native save dialog (`show_pdf_save_dialog`) and hands
     the HTML + path to `export_pdf_html`.

2. **Backend** (`app/src-tauri/src/lib.rs`, macOS)
   - `export_pdf_html` runs on the main thread and calls `render_html_to_pdf`,
     which loads the HTML into an **offscreen `WKWebView`**, waits for load +
     a short settle, then captures it via
     `-[WKWebView createPDFWithConfiguration:completionHandler:]` (macOS 11+) and
     writes the returned PDF bytes to disk.

### Why `createPDF`, not `NSPrintOperation`

`NSPrintOperation` (and printing the live app window) produced **runaway infinite
pagination** here — multi-GB PDFs with millions of objects — because the app's
flex/`100vh`/scroll layout doesn't translate to paged media. `createPDF` captures
the rendered content directly to a single faithful, bounded PDF, so it can't run
away and never splits content awkwardly across page breaks.

## Testing

PDF export needs the native WebView, so it's exercised against the running dev
app via the `tauri-debug` bridge. A dev-only hook
(`window.__testExportPdf(path, title)`, gated by `import.meta.env.DEV`) builds the
real print HTML and runs the export to a fixed path, bypassing the save dialog.

Validated fixtures (text via `pdftotext`, visuals via `pdftoppm`):

| Fixture | Checked |
|---|---|
| `frontmatter/02-obsidian.md` | banner: bold keys, nested bullets, divider; body |
| `frontmatter/04-pandoc-authors.md` | author-object banner |
| `frontmatter/07-malformed.md` | fail-soft banner still renders |
| `frontmatter/09-showcase.md` | full banner + body + inline code |
| `math.md` | KaTeX math rendered (E = mc², quadratic formula) |
| `mermaid.md` | all 7 diagram types captured as SVG (incl. pie colors) |
| `table.md` | GFM table |

Each produced a valid, reasonably-sized (40–60 KB) PDF with one bounded page and
the expected content — no runaway.

Quick manual test:

```bash
cd app && npm run tauri dev
# Open any tests/fixtures/**.md, then Toolbar → Export PDF (or File menu).
```
