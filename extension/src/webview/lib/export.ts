import DOMPurify from "dompurify";
import { renderMath } from "./math";
import { cloneStaticEditor } from "../../../../shared/staticExport";
import katexCss from "katex/dist/katex.min.css?embedded";
import highlightCss from "highlight.js/styles/github.css?embedded";
import { saveHtml } from "../bridge";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function buildHtmlBody(): string {
  const editorEl = document.querySelector(".ProseMirror");
  if (!editorEl) return "";
  const clone = cloneStaticEditor(editorEl, renderMath);

  return DOMPurify.sanitize(clone.innerHTML, {
    // Mermaid labels use HTML inside SVG foreignObject; its children still
    // pass through the normal HTML sanitizer.
    HTML_INTEGRATION_POINTS: { foreignobject: true },
    ADD_TAGS: ["math", "mrow", "mi", "mo", "mn", "msup", "msub", "mfrac", "mspace", "mtext", "annotation", "semantics", "foreignObject"],
    ADD_ATTR: ["xmlns", "class", "id", "style", "aria-hidden", "focusable"],
  });
}

export function buildHtmlDocument(title: string, bodyHtml: string): string {
  // Resolve VS Code's injected theme references while still inside the webview;
  // the exported file cannot inherit its --vscode-* custom properties.
  const root = document.documentElement;
  const computed = getComputedStyle(root);
  const rootVars = [
    "bg-editor", "text-primary", "text-secondary", "border-color", "border-subtle",
    "code-bg", "code-inline-bg", "accent",
  ].map((token) => {
    const value = computed.getPropertyValue(`--${token}`).trim();
    return value ? `--${token}: ${value};` : "";
  }).join(" ").replace(/</g, "\\3c ");
  const colorScheme = root.getAttribute("data-color-scheme") === "dark" ? "dark" : "light";
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
  html, body { background: var(--bg-editor, #fafafa); }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
    font-size: 16px;
    line-height: 1.7;
    max-width: 720px;
    margin: 0 auto;
    padding: 40px 24px;
    color: var(--text-primary, #1a1a1a);
  }
  h1, h2, h3, h4, h5, h6 { font-weight: 600; margin: 1.5em 0 0.5em; }
  h1 { font-size: 2em; border-bottom: 1px solid var(--border-color, #e1e4e8); padding-bottom: 0.3em; }
  h2 { font-size: 1.5em; border-bottom: 1px solid var(--border-color, #e1e4e8); padding-bottom: 0.3em; }
  p { margin: 0 0 1em; }
  blockquote { margin: 0 0 1em; padding: 0 1em; border-left: 4px solid var(--border-color, #d0d7de); color: var(--text-secondary, #57606a); }
  code { font-family: 'SF Mono', 'Fira Code', monospace; font-size: 0.9em; background: var(--code-inline-bg, #f3f4f6); padding: 0.1em 0.4em; border-radius: 4px; }
  pre { background: var(--code-bg, #f6f8fa); padding: 16px; border-radius: 6px; overflow-x: auto; }
  pre code { background: none; padding: 0; }
  table { border-collapse: collapse; width: 100%; margin: 1em 0; }
  th, td { border: 1px solid var(--border-color, #d0d7de); padding: 6px 13px; }
  th { background: var(--code-bg, #f6f8fa); font-weight: 600; }
  img { max-width: 100%; height: auto; }
  hr { border: none; border-top: 1px solid var(--border-color, #e1e4e8); margin: 2em 0; }
  a { color: var(--accent, #0969da); }
  .katex-display { margin: 1em 0; }
  .mermaid-print { text-align: center; margin: 1.2em 0; }
  .mermaid-print svg { max-width: 100%; height: auto; }
</style>
</head>
<body>
${bodyHtml}
</body>
</html>`;
}

export function exportToHtml(title: string = "Bioscratch Document"): void {
  const baseName = title.replace(/\.(md|markdown|txt)$/i, "");
  const suggestedName = `${baseName}.html`;
  const html = buildHtmlDocument(title, buildHtmlBody());
  // Hand the rendered HTML to the extension host, which prompts for a save
  // location (vscode.window.showSaveDialog) and writes the file.
  saveHtml(suggestedName, html);
}
