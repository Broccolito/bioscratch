import { EditorState } from "prosemirror-state";
import { EditorView, type NodeView } from "prosemirror-view";
import { schema } from "../editor/schema";
import { markdownToDoc } from "../editor/serialization/markdownImport";
import { buildImageRenderPlugin } from "../editor/plugins/imageRender";
import { isMermaidLanguage } from "../editor/plugins/mermaidPlugin";
import { buildHighlightPlugin } from "../editor/plugins/highlight";
import { MermaidBlockView, CodeBlockView, TaskListItemView } from "../components/EditorSurface";
import { isTagsOnly, renderFrontmatterBanner } from "../lib/frontmatter";
import { renderMath } from "../lib/math";

/** Quick Look has no Tauri bridge or permission to fetch arbitrary local files.
 * The native host supplies only bounded, contained images it could read;
 * macOS may grant the selected note without granting its neighboring images. */
export function previewImageResolver(images: Record<string, string>) {
  return async (src: string): Promise<string> => {
    if (/^(?:data:|https?:\/\/)/i.test(src)) return src;
    if (Object.prototype.hasOwnProperty.call(images, src)) return images[src];
    throw new Error("Local preview image unavailable");
  };
}

function staticMath(latex: string, block: boolean): NodeView {
  const dom = document.createElement(block ? "div" : "span");
  dom.className = block ? "math-block-view" : "math-inline-view";
  dom.innerHTML = renderMath(latex, block);
  return { dom, ignoreMutation: () => true };
}

/** Render the inactive document presentation. Editor NodeViews can otherwise
 * open source inputs even when ProseMirror's editable property is false. */
export function createPreviewView(
  root: HTMLElement,
  markdown: string,
  filePath: string,
  images: Record<string, string> = {},
): EditorView {
  const state = EditorState.create({
    doc: markdownToDoc(markdown, schema),
    plugins: [
      buildImageRenderPlugin({ current: filePath || null }, {
        readOnly: true,
        resolveSrc: previewImageResolver(images),
        unavailableMessage: (src, alt) => /^(?:data:|https?:\/\/)/i.test(src)
          ? `Image unavailable: ${alt || src}`
          : `Local image unavailable in Quick Look: ${alt || src}. Open this note in Bioscratch to view it.`,
      }),
      buildHighlightPlugin(),
    ],
  });
  const preview: EditorView = new EditorView(root, {
    state,
    editable: () => false,
    dispatchTransaction(transaction) {
      if (!transaction.docChanged) preview.updateState(preview.state.apply(transaction));
    },
    nodeViews: {
      math_inline: (node) => staticMath(node.attrs.math || "", false),
      math_block: (node) => staticMath(node.attrs.math || "", true),
      code_block: (node, view, getPos) => {
        if (!isMermaidLanguage(node.attrs.language)) return new CodeBlockView(node);
        if (!node.textContent.trim()) {
          const dom = document.createElement("div");
          dom.className = "mermaid-empty";
          dom.textContent = "Empty Mermaid diagram";
          return { dom };
        }
        const block = new MermaidBlockView(node, view, getPos);
        block.dom.querySelector(".mermaid-toolbar")?.remove();
        const source = block.dom.querySelector<HTMLElement>(".mermaid-source-section");
        if (source) source.style.display = "none";
        // Preserve the asynchronous SVG renderer while making its preview passive.
        block.dom.addEventListener("mousedown", (event) => {
          event.preventDefault();
          event.stopImmediatePropagation();
        }, true);
        return block;
      },
      frontmatter: (node) => {
        const dom = document.createElement("div");
        const tagsOnly = isTagsOnly(node.textContent);
        dom.className = "frontmatter-view" + (tagsOnly ? " frontmatter-tags-only" : "");
        if (!tagsOnly) dom.appendChild(renderFrontmatterBanner(node.textContent));
        return { dom, ignoreMutation: () => true };
      },
      task_list_item: (node, view, getPos) => {
        const item = new TaskListItemView(node, view, getPos);
        const checkbox = item.dom.querySelector<HTMLInputElement>("input");
        if (checkbox) checkbox.disabled = true;
        return item;
      },
    },
  });
  return preview;
}
