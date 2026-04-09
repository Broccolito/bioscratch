import { invoke } from "@tauri-apps/api/core";
import DOMPurify from "dompurify";

export async function exportToHtml(
  _doc: unknown,
  title: string = "Bioscratch Document"
): Promise<void> {
  const path = await invoke<string | null>("show_html_save_dialog");
  if (!path) return;

  // Get rendered HTML from the editor element
  const editorEl = document.querySelector(".ProseMirror");
  let bodyHtml = "";
  if (editorEl) {
    bodyHtml = DOMPurify.sanitize(editorEl.innerHTML, {
      ADD_TAGS: ["math", "mrow", "mi", "mo", "mn", "msup", "msub", "mfrac", "mspace", "mtext", "annotation", "semantics"],
      ADD_ATTR: ["xmlns", "class", "id", "style", "aria-hidden", "focusable"],
    });
  }

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${title}</title>
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
</style>
</head>
<body>
${bodyHtml}
</body>
</html>`;

  await invoke("export_html", { path, html });
}

export async function exportToPdf(): Promise<void> {
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  await getCurrentWindow().print();
}
