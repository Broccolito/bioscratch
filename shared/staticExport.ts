/** Capture rendered content without the editor's source fields or controls. */
export function cloneStaticEditor(
  editor: Element,
  renderMath: (latex: string, displayMode: boolean) => string,
): HTMLElement {
  const clone = editor.cloneNode(true) as HTMLElement;
  clone.querySelectorAll(".frontmatter-view").forEach((view) => {
    const banner = view.querySelector(".fm-banner");
    if (banner && !view.classList.contains("frontmatter-tags-only")) {
      view.replaceWith(banner.cloneNode(true));
    } else {
      view.remove();
    }
  });
  clone.querySelectorAll<HTMLElement>(".math-inline-view, .math-block-view").forEach((view) => {
    const input = view.querySelector<HTMLInputElement | HTMLTextAreaElement>("input, textarea");
    if (input) {
      view.innerHTML = renderMath(input.value, view.classList.contains("math-block-view"));
    } else if (view.firstElementChild instanceof HTMLElement) {
      view.firstElementChild.style.removeProperty("display");
    }
    view.classList.remove("editing");
  });
  clone.querySelectorAll(".mermaid-block-view").forEach((block) => {
    const svg = block.querySelector(".mermaid-preview svg");
    const wrapper = document.createElement("div");
    wrapper.className = "mermaid-print";
    if (svg) {
      wrapper.appendChild(svg.cloneNode(true));
    } else {
      // Preserve source when a diagram is empty, invalid, or still rendering.
      const source = document.createElement("pre");
      source.textContent = block.querySelector("code.language-mermaid")?.textContent || "";
      wrapper.appendChild(source);
    }
    block.replaceWith(wrapper);
  });
  clone.querySelectorAll(".image-view-wrapper").forEach((image) => {
    const source = image.previousElementSibling;
    if (source?.tagName === "P" && /^!\[/.test(source.textContent || "")) source.remove();
    image.classList.remove("editing");
  });
  clone.querySelectorAll(
    ".image-source-hidden, .image-inline-hidden, .table-ctrl-btn, .table-delete-hint, " +
    ".column-resize-handle, .ProseMirror-gapcursor, button, textarea, input:not([type=checkbox])",
  ).forEach((control) => control.remove());
  clone.querySelectorAll<HTMLInputElement>("input[type=checkbox]").forEach((checkbox) => {
    checkbox.disabled = true;
    checkbox.toggleAttribute("checked", checkbox.checked);
  });
  clone.querySelectorAll<HTMLElement>("*").forEach((element) => {
    element.removeAttribute("contenteditable");
    element.classList.remove("ProseMirror-selectednode", "selectedCell", "search-match", "search-match-current");
  });
  return clone;
}
