import katex from "katex";

export function renderMath(latex: string, displayMode: boolean = false): string {
  try {
    return katex.renderToString(latex, {
      displayMode,
      throwOnError: false,
      output: "htmlAndMathml",
    });
  } catch (e) {
    return `<span class="math-error">${latex}</span>`;
  }
}

export function renderMathInline(latex: string): string {
  return renderMath(latex, false);
}

export function renderMathBlock(latex: string): string {
  return renderMath(latex, true);
}
