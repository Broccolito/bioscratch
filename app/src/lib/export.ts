import { invoke } from "@tauri-apps/api/core";
import DOMPurify from "dompurify";
// The app's real stylesheets, inlined so the exported PDF/HTML looks exactly
// like the editor (banner, code, tables, math layout).
import markdownCss from "../styles/markdown.css?raw";
import editorCss from "../styles/editor.css?raw";

/** Escape text for safe interpolation into HTML markup (e.g. <title>). */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildHtmlBody(): string {
  const editorEl = document.querySelector(".ProseMirror");
  if (!editorEl) return "";

  // Clone DOM so we can transform it without affecting the live editor
  const clone = editorEl.cloneNode(true) as HTMLElement;

  // Replace .mermaid-block-view elements with <div class="mermaid"> for export.
  // Mermaid.js (included in the <head>) will re-render them on page load.
  clone.querySelectorAll(".mermaid-block-view").forEach((block) => {
    const sourceCode = block.querySelector("code.language-mermaid");
    if (sourceCode) {
      const div = document.createElement("div");
      div.className = "mermaid";
      div.textContent = sourceCode.textContent || "";
      block.replaceWith(div);
    }
  });

  return DOMPurify.sanitize(clone.innerHTML, {
    ADD_TAGS: ["math", "mrow", "mi", "mo", "mn", "msup", "msub", "mfrac", "mspace", "mtext", "annotation", "semantics"],
    ADD_ATTR: ["xmlns", "class", "id", "style", "aria-hidden", "focusable"],
  });
}

function buildHtmlDocument(title: string, bodyHtml: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${escapeHtml(title)}</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css" />
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github.min.css" />
<style>
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
    font-size: 16px;
    line-height: 1.7;
    max-width: 720px;
    margin: 0 auto;
    padding: 40px 24px;
    color: #1a1a1a;
  }
  h1, h2, h3, h4, h5, h6 { font-weight: 600; margin: 1.5em 0 0.5em; }
  h1 { font-size: 2em; border-bottom: 1px solid #e1e4e8; padding-bottom: 0.3em; }
  h2 { font-size: 1.5em; border-bottom: 1px solid #e1e4e8; padding-bottom: 0.3em; }
  p { margin: 0 0 1em; }
  blockquote { margin: 0 0 1em; padding: 0 1em; border-left: 4px solid #d0d7de; color: #57606a; }
  code { font-family: 'SF Mono', 'Fira Code', monospace; font-size: 0.9em; background: #f3f4f6; padding: 0.1em 0.4em; border-radius: 4px; }
  pre { background: #f6f8fa; padding: 16px; border-radius: 6px; overflow-x: auto; }
  pre code { background: none; padding: 0; }
  table { border-collapse: collapse; width: 100%; margin: 1em 0; }
  th, td { border: 1px solid #d0d7de; padding: 6px 13px; }
  th { background: #f6f8fa; font-weight: 600; }
  img { max-width: 100%; height: auto; }
  hr { border: none; border-top: 1px solid #e1e4e8; margin: 2em 0; }
  .katex-display { margin: 1em 0; }
  .mermaid { text-align: center; margin: 1.2em 0; }
</style>
</head>
<body>
${bodyHtml}
<script type="module">
import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs';
mermaid.initialize({ startOnLoad: false, theme: 'neutral' });
await mermaid.run();
</script>
</body>
</html>`;
}

export async function exportToHtml(
  _doc: unknown,
  title: string = "Bioscratch Document"
): Promise<void> {
  const baseName = title.replace(/\.(md|markdown|txt)$/i, "");
  const suggestedName = `${baseName}.html`;
  const path = await invoke<string | null>("show_html_save_dialog", { filename: suggestedName });
  if (!path) return;

  const html = buildHtmlDocument(title, buildHtmlBody());
  await invoke("export_html", { path, html });
}

/**
 * Build the document body for a *print* render: same as the HTML export body,
 * but with the YAML banner reduced to its rendered form (no editable source) and
 * Mermaid blocks replaced by their already-rendered SVG, so the page is fully
 * static and paginates cleanly.
 */
function buildPrintBody(): string {
  const editorEl = document.querySelector(".ProseMirror");
  if (!editorEl) return "";
  const clone = editorEl.cloneNode(true) as HTMLElement;

  // YAML frontmatter: keep only the rendered banner, drop the YAML source.
  clone.querySelectorAll(".frontmatter-view").forEach((view) => {
    const banner = view.querySelector(".fm-banner");
    if (banner) {
      view.replaceWith(banner.cloneNode(true));
    } else {
      view.remove();
    }
  });

  // Mermaid: replace the editor block with its rendered SVG (static, no JS).
  clone.querySelectorAll(".mermaid-block-view").forEach((block) => {
    const svg = block.querySelector(".mermaid-preview svg");
    const wrapper = document.createElement("div");
    wrapper.className = "mermaid-print";
    if (svg) {
      wrapper.appendChild(svg.cloneNode(true));
    } else {
      const src = block.querySelector("code.language-mermaid");
      wrapper.textContent = src?.textContent || "";
    }
    block.replaceWith(wrapper);
  });

  return DOMPurify.sanitize(clone.innerHTML, {
    ADD_TAGS: [
      "math", "mrow", "mi", "mo", "mn", "msup", "msub", "mfrac", "mspace",
      "mtext", "annotation", "semantics",
      "svg", "g", "path", "rect", "circle", "ellipse", "line", "polyline",
      "polygon", "text", "tspan", "defs", "marker", "foreignObject",
    ],
    ADD_ATTR: [
      "xmlns", "class", "id", "style", "aria-hidden", "focusable",
      "viewBox", "d", "fill", "stroke", "stroke-width", "transform", "x", "y",
      "x1", "y1", "x2", "y2", "cx", "cy", "r", "rx", "ry", "points",
      "width", "height", "preserveAspectRatio", "marker-end", "marker-start",
    ],
  });
}

/** Capture the active theme's CSS custom properties + colour scheme so the
 *  exported document matches the on-screen theme exactly. */
function themeStyle(): { rootVars: string; colorScheme: string } {
  const rootVars = document.documentElement.style.cssText;
  const colorScheme =
    document.documentElement.getAttribute("data-color-scheme") || "light";
  return { rootVars, colorScheme };
}

/** Assemble a fully self-contained HTML document for PDF rendering. Inlines the
 *  app's real CSS and theme tokens; pulls KaTeX/highlight themes from a CDN
 *  (matching the HTML export). No scripts — Mermaid is pre-rendered to SVG. */
function buildPrintDocument(title: string, bodyHtml: string): string {
  const { rootVars, colorScheme } = themeStyle();
  return `<!DOCTYPE html>
<html lang="en" data-color-scheme="${colorScheme}">
<head>
<meta charset="UTF-8" />
<title>${escapeHtml(title)}</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css" />
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github.min.css" />
<style>
:root { ${rootVars} }
${markdownCss}
${editorCss}
/* Print page setup — bounded block flow so pagination terminates cleanly. */
html, body {
  margin: 0;
  padding: 0;
  background: #fff;
  font-family: Arial, sans-serif;
}
* { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
/* Centered reading column with page-like margins (the captured page is 816px
   wide; the column sits inside it with comfortable side/top/bottom margins). */
.print-root {
  color: var(--text-primary, #1a1a1a);
  max-width: 704px;
  margin: 0 auto;
  padding: 48px 0 56px;
  box-sizing: border-box;
}
/* Use the whole printable width; native print margins frame the page. */
.print-root .fm-banner { break-inside: avoid; }
.print-root pre, .print-root blockquote, .print-root table,
.print-root .katex-display, .print-root img, .mermaid-print { break-inside: avoid; }
.print-root h1, .print-root h2, .print-root h3 { break-after: avoid; }
.mermaid-print { text-align: center; margin: 1.2em 0; }
.mermaid-print svg { max-width: 100%; height: auto; }
img { max-width: 100%; height: auto; }
table { width: 100%; border-collapse: collapse; }
</style>
</head>
<body>
<div class="ProseMirror print-root">
${bodyHtml}
</div>
</body>
</html>`;
}

/**
 * Export the current document to PDF. Builds a self-contained HTML rendering
 * (the app's real CSS, the rendered YAML banner, KaTeX math, highlighted code,
 * Mermaid SVG, tables, images) and hands it to the native macOS renderer
 * (`export_pdf_html`), which prints it to PDF via an offscreen WebView. The
 * result is honest to the HTML — no Markdown→LaTeX conversion.
 */
export async function exportToPdf(filename: string): Promise<void> {
  const baseName = filename.replace(/\.(md|markdown|txt)$/i, "");
  const path = await invoke<string | null>("show_pdf_save_dialog", {
    filename: `${baseName}.pdf`,
  });
  if (!path) return;
  const html = buildPrintDocument(baseName, buildPrintBody());
  await invoke("export_pdf_html", { html, outputPath: path });
}

// Dev-only test hooks for the tauri-agent-tools bridge: build the real print
// HTML and run the export to a fixed path, bypassing the native save dialog.
if (import.meta.env?.DEV) {
  (window as unknown as Record<string, unknown>).__buildPrintHtml = (title: string) =>
    buildPrintDocument(title, buildPrintBody());
  (window as unknown as Record<string, unknown>).__testExportPdf = async (
    outputPath: string,
    title = "Document"
  ) => {
    const html = buildPrintDocument(title, buildPrintBody());
    await invoke("export_pdf_html", { html, outputPath });
    return html.length;
  };
}
