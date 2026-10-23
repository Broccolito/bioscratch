import { invoke } from "@tauri-apps/api/core";
import DOMPurify from "dompurify";
import { renderMath } from "./math";
import { cloneStaticEditor } from "../../../shared/staticExport";
import katexCss from "katex/dist/katex.min.css?embedded";
import highlightCss from "highlight.js/styles/github.css?embedded";
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

export function buildHtmlBody(): string {
  return buildPrintBody();
}

export function buildHtmlDocument(title: string, bodyHtml: string): string {
  return buildPrintDocument(title, bodyHtml);
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
export function buildPrintBody(): string {
  const editorEl = document.querySelector(".ProseMirror");
  if (!editorEl) return "";
  const clone = cloneStaticEditor(editorEl, renderMath);

  return DOMPurify.sanitize(clone.innerHTML, {
    // Mermaid labels use HTML inside SVG foreignObject; its children still
    // pass through the normal HTML sanitizer.
    HTML_INTEGRATION_POINTS: { foreignobject: true },
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
  const rootVars = document.documentElement.style.cssText.replace(/</g, "\\3c ");
  const colorScheme =
    document.documentElement.getAttribute("data-color-scheme") === "dark" ? "dark" : "light";
  return { rootVars, colorScheme };
}

/** Assemble a fully self-contained HTML document for PDF rendering. Inlines the
 *  app's real CSS and theme tokens, installed KaTeX/highlight styles, and font
 *  data. No scripts — Mermaid is pre-rendered to SVG. */
export function buildPrintDocument(title: string, bodyHtml: string): string {
  const { rootVars, colorScheme } = themeStyle();
  return `<!DOCTYPE html>
<html lang="en" data-color-scheme="${colorScheme}">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: https:; style-src 'unsafe-inline'; font-src data:; base-uri 'none'; form-action 'none'" />
<title>${escapeHtml(title)}</title>
<style>${katexCss}\n${highlightCss}</style>
<style>
:root { ${rootVars} }
${markdownCss}
${editorCss}
/* Print page setup — bounded block flow so pagination terminates cleanly. */
html, body {
  margin: 0;
  padding: 0;
  background: var(--bg-editor, #fafafa);
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
