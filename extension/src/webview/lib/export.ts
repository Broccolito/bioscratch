import DOMPurify from "dompurify";
import { saveHtml } from "../bridge";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function buildHtmlBody(): string {
  const editorEl = document.querySelector(".ProseMirror");
  if (!editorEl) return "";

  // Clone DOM so we can transform it without affecting the live editor
  const clone = editorEl.cloneNode(true) as HTMLElement;

  // Export the already-rendered, sanitized SVG instead of executing Mermaid in
  // the generated file. This keeps exported documents script-free.
  clone.querySelectorAll(".mermaid-block-view").forEach((block) => {
    const preview = block.querySelector(".mermaid-preview");
    if (preview) {
      const div = document.createElement("div");
      div.className = "mermaid";
      div.append(...Array.from(preview.childNodes).map((node) => node.cloneNode(true)));
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
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: https:; style-src 'unsafe-inline' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com; font-src data: https://cdn.jsdelivr.net https://cdnjs.cloudflare.com" />
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
