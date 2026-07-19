import katex from "katex";

/** Escape HTML so raw LaTeX in the error fallback can't inject markup. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
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
