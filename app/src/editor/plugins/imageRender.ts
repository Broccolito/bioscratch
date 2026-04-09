import { Plugin, TextSelection } from "prosemirror-state";
import { Decoration, DecorationSet, EditorView } from "prosemirror-view";
import { Node as ProseMirrorNode } from "prosemirror-model";
import { schema } from "../schema";
import { readFile } from "@tauri-apps/plugin-fs";

// Block image: entire paragraph is exactly one image (with optional quoted title)
//   ![alt](url) or ![alt](url "title") or ![alt](url 'title')
const BLOCK_IMAGE_RE =
  /^!\[([^\[\]]*)\]\(([^\s)]+)(?:\s+["']([^"']*)["'])?\s*\)$/;

// Inline image within a paragraph: one image among other text
// Same syntax — used with .exec() / lastIndex
const INLINE_IMAGE_RE =
  /!\[([^\[\]]*)\]\(([^\s)]+)(?:\s+["']([^"']*)["'])?\s*\)/g;

// Cache resolved local file paths → base64 data URL.
// Prevents re-reading the file on every keystroke while the source line is visible.
const srcCache = new Map<string, string>();

async function resolveSrc(
  src: string,
  filePathRef: { current: string | null }
): Promise<string> {
  if (!src) return src;
  // Remote URLs and data URIs are usable directly
  if (src.startsWith("data:") || src.startsWith("http://") || src.startsWith("https://"))
    return src;

  // Absolute or relative local path — Tauri WebView cannot load file:// paths
  // natively, so we must read the bytes and return a data URL.
  let absolutePath: string;
  if (src.startsWith("/")) {
    absolutePath = src;
  } else {
    const docPath = filePathRef.current;
    if (!docPath) return src;
    const lastSlash = Math.max(docPath.lastIndexOf("/"), docPath.lastIndexOf("\\"));
    absolutePath = docPath.substring(0, lastSlash + 1) + src;
  }

  if (srcCache.has(absolutePath)) return srcCache.get(absolutePath)!;

  const ext = absolutePath.split(".").pop()?.toLowerCase() ?? "jpeg";
  const mimeMap: Record<string, string> = {
    png: "image/png",
    gif: "image/gif",
    webp: "image/webp",
    svg: "image/svg+xml",
  };
  const mime = mimeMap[ext] ?? "image/jpeg";

  const bytes = await readFile(absolutePath);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192)
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  const dataUrl = `data:${mime};base64,${btoa(binary)}`;
  srcCache.set(absolutePath, dataUrl);
  return dataUrl;
}

// ---- Widget factories -------------------------------------------------------

function attachImage(
  container: HTMLElement,
  alt: string,
  src: string,
  title: string | null,
  filePathRef: { current: string | null }
) {
  const img = document.createElement("img");
  img.alt = alt;
  if (title) img.title = title;

  const showPlaceholder = (msg: string) => {
    container.innerHTML = "";
    const ph = document.createElement("span");
    ph.className = "image-placeholder";
    ph.textContent = msg;
    container.appendChild(ph);
  };

  img.onerror = () => showPlaceholder(`Image not found: ${alt || src}`);
  resolveSrc(src, filePathRef)
    .then((r) => { img.src = r; })
    .catch(() => showPlaceholder(`Image not found: ${alt || src}`));

  container.appendChild(img);
}

// Block widget: full-width centered image placed below the (hidden) source paragraph
function createBlockWidget(
  alt: string,
  src: string,
  title: string | null,
  paraPos: number,
  isEditing: boolean,
  filePathRef: { current: string | null },
  view: EditorView
): HTMLElement {
  const wrapper = document.createElement("div");
  wrapper.className = "image-view-wrapper" + (isEditing ? " editing" : "");
  wrapper.setAttribute("data-align", "center");
  wrapper.contentEditable = "false";

  const renderedEl = document.createElement("span");
  renderedEl.className = "image-rendered";
  attachImage(renderedEl, alt, src, title, filePathRef);
  wrapper.appendChild(renderedEl);

  // Click → move cursor into the source paragraph (reveals editable source line)
  wrapper.addEventListener("mousedown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    const state = view.state;
    const safePos = Math.min(paraPos + 1, state.doc.content.size - 1);
    view.dispatch(state.tr.setSelection(TextSelection.near(state.doc.resolve(safePos))));
    view.focus();
  });

  return wrapper;
}

// Inline widget: image placed inline within a paragraph (replaces hidden markdown text)
function createInlineWidget(
  alt: string,
  src: string,
  title: string | null,
  paraPos: number,
  filePathRef: { current: string | null },
  view: EditorView
): HTMLElement {
  const wrapper = document.createElement("span");
  wrapper.className = "image-inline-widget";
  wrapper.contentEditable = "false";

  attachImage(wrapper, alt, src, title, filePathRef);

  // Click → move cursor into the paragraph (reveals all inline markdown text)
  wrapper.addEventListener("mousedown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    const state = view.state;
    const safePos = Math.min(paraPos + 1, state.doc.content.size - 1);
    view.dispatch(state.tr.setSelection(TextSelection.near(state.doc.resolve(safePos))));
    view.focus();
  });

  return wrapper;
}

// ---- Position mapping -------------------------------------------------------

interface InlineImageMatch {
  pmStart: number; // document position of first char of ![
  pmEnd: number;   // document position after last char of )
  alt: string;
  src: string;
  title: string | null;
}

// Map character offsets in a paragraph's textContent to document offsets.
// Non-text inline nodes (math_inline, hard_break …) occupy document positions
// but contribute no characters to textContent, so we must walk the children.
function buildCharMap(paraNode: ProseMirrorNode): number[] {
  const charToDocOffset: number[] = [];
  paraNode.forEach((child, childDocOffset) => {
    if (child.isText) {
      for (let i = 0; i < child.text!.length; i++)
        charToDocOffset.push(childDocOffset + i);
    }
    // Non-text inline nodes: skip — they don't appear in textContent
  });
  return charToDocOffset;
}

function findInlineImages(paraNode: ProseMirrorNode, paraPos: number): InlineImageMatch[] {
  const text = paraNode.textContent;
  const charMap = buildCharMap(paraNode);
  const results: InlineImageMatch[] = [];

  INLINE_IMAGE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = INLINE_IMAGE_RE.exec(text)) !== null) {
    const tStart = m.index;
    const tEnd = m.index + m[0].length;
    // charMap[i] = document offset of character i from para content start
    const docStart = charMap[tStart] ?? tStart;
    const docEnd = tEnd > 0 ? (charMap[tEnd - 1] ?? tEnd - 1) + 1 : docStart;
    results.push({
      pmStart: paraPos + 1 + docStart,
      pmEnd: paraPos + 1 + docEnd,
      alt: m[1],
      src: m[2],
      title: m[3] || null,
    });
  }
  return results;
}

// ---- Plugin -----------------------------------------------------------------

// Typora-style image rendering via ProseMirror decorations.
//
// Two rendering modes:
//
// BLOCK image (paragraph = exactly one image syntax):
//   Inactive  →  source paragraph collapsed, full-width image widget below
//   Active    →  source line shown in monospace above image (both visible)
//
// INLINE image (image syntax mixed with other text):
//   Inactive  →  markdown text hidden, inline image widget in its place
//   Active    →  markdown text shown as-is (all images and surrounding text visible)
//
// In all cases the underlying paragraph text is unchanged, so Cmd+Z, copy,
// and deletion all work exactly as for any other paragraph text.
export function buildImageRenderPlugin(
  filePathRef: { current: string | null }
): Plugin {
  return new Plugin({
    props: {
      decorations(state) {
        const decos: Decoration[] = [];

        const { $head } = state.selection;
        const cursorParaPos =
          $head.parent.type === schema.nodes.paragraph ? $head.before() : -1;

        state.doc.descendants((node, pos) => {
          if (node.type !== schema.nodes.paragraph) return true;

          const text = node.textContent;
          const isEditing = pos === cursorParaPos;

          // ── Block image ──────────────────────────────────────────────────
          const blockMatch = text.match(BLOCK_IMAGE_RE);
          if (blockMatch) {
            const alt = blockMatch[1];
            const src = blockMatch[2];
            const title = blockMatch[3] || null;

            if (!isEditing) {
              decos.push(
                Decoration.node(pos, pos + node.nodeSize, { class: "image-source-hidden" })
              );
            } else {
              decos.push(
                Decoration.node(pos, pos + node.nodeSize, { class: "image-source-editing" })
              );
            }

            decos.push(
              Decoration.widget(
                pos + node.nodeSize,
                (view) => createBlockWidget(alt, src, title, pos, isEditing, filePathRef, view),
                {
                  side: 1,
                  key: `img-block-${pos}-${alt}\x00${src}`,
                  stopEvent: () => true,
                }
              )
            );

            return false;
          }

          // ── Inline images within a paragraph ─────────────────────────────
          const inlineMatches = findInlineImages(node, pos);
          if (inlineMatches.length === 0) return false;

          if (!isEditing) {
            for (const { pmStart, pmEnd, alt, src, title } of inlineMatches) {
              // Hide the raw markdown text
              decos.push(
                Decoration.inline(pmStart, pmEnd, { class: "image-inline-hidden" })
              );
              // Show the image in its place (placed just before the hidden text)
              decos.push(
                Decoration.widget(
                  pmStart,
                  (view) => createInlineWidget(alt, src, title, pos, filePathRef, view),
                  {
                    side: -1,
                    key: `img-inline-${pmStart}-${alt}\x00${src}`,
                    stopEvent: () => true,
                  }
                )
              );
            }
          }
          // When editing: leave all text visible as-is (no widget, no hiding)

          return false;
        });

        return DecorationSet.create(state.doc, decos);
      },
    },
  });
}
