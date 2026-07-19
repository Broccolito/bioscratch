import katex from "katex";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function renderMath(latex: string, displayMode: boolean = false): string {
  try {
    return katex.renderToString(latex, {
      displayMode,
      throwOnError: false,
      output: "htmlAndMathml",
    });
  } catch (e) {
    return `<span class="math-error">${escapeHtml(latex)}</span>`;
  }
}

export function renderMathInline(latex: string): string {
  return renderMath(latex, false);
}

export function renderMathBlock(latex: string): string {
  return renderMath(latex, true);
}
