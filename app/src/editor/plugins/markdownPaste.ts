import { Plugin } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import {
  Fragment,
  Slice,
  type Mark,
  type Node as ProseMirrorNode,
} from "prosemirror-model";
import { schema } from "../schema";
import { markdownToDoc } from "../serialization/markdownImport";
import type { MutableRefObject } from "react";
import type { FileMode } from "../../lib/fileMode";

function addContextMarks(slice: Slice, contextMarks: readonly Mark[]): Slice {
  if (contextMarks.length === 0) return slice;

  const markChildren = (content: Fragment): Fragment => {
    const children: ProseMirrorNode[] = [];
    content.forEach((child) => {
      const marks = contextMarks.reduce(
        (current, mark) => mark.addToSet(current),
        child.marks
      );
      children.push(child.mark(marks));
    });
    return Fragment.fromArray(children);
  };

  const first = slice.content.firstChild;
  if (first?.isInline) {
    return new Slice(markChildren(slice.content), slice.openStart, slice.openEnd);
  }
  if (slice.content.childCount !== 1 || !first?.isTextblock) return slice;

  const markedContent = markChildren(first.content);
  return new Slice(
    Fragment.from(first.copy(markedContent)),
    slice.openStart,
    slice.openEnd
  );
}

function selectionIsInTableCell(view: EditorView): boolean {
  const { $from } = view.state.selection;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const role = $from.node(depth).type.spec.tableRole;
    if (role === "cell" || role === "header_cell") return true;
  }
  return false;
}

function isInlineCellSlice(slice: Slice): boolean {
  const first = slice.content.firstChild;
  if (!first) return true;
  if (slice.content.childCount !== 1) return false;
  if (first.isInline) return true;
  return first.type.name === "paragraph";
}

function literalCellSlice(text: string, contextMarks: readonly Mark[]): Slice {
  const nodes: ProseMirrorNode[] = [];
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  lines.forEach((line, index) => {
    if (line) nodes.push(schema.text(line, contextMarks));
    if (index < lines.length - 1) nodes.push(schema.nodes.hard_break.create());
  });
  return new Slice(Fragment.fromArray(nodes), 0, 0);
}

function nodeHasMarkdownSemantics(root: ProseMirrorNode): boolean {
  let semantic = false;
  root.descendants((node) => {
    if (node.marks.length > 0) semantic = true;
    if (!["paragraph", "text", "hard_break"].includes(node.type.name)) {
      semantic = true;
    }
    return !semantic;
  });
  return semantic;
}

function sliceHasMarkdownSemantics(slice: Slice): boolean {
  let semantic = false;
  slice.content.nodesBetween(0, slice.content.size, (node) => {
    if (node.marks.length > 0) semantic = true;
    if (!["paragraph", "text", "hard_break"].includes(node.type.name)) {
      semantic = true;
    }
    return !semantic;
  });
  return semantic;
}

/**
 * Handles paste events in Markdown mode. Plain text is parsed as Markdown,
 * while inline content inherits formatting at the insertion point. Rich
 * multi-block HTML stays with ProseMirror's parser; fenced Mermaid source is
 * always parsed as Markdown even when the clipboard also supplies HTML.
 */
export function buildMarkdownPastePlugin(
  fileModeRef: MutableRefObject<FileMode>
): Plugin {
  return new Plugin({
    props: {
      handlePaste(view, event, defaultSlice) {
        // Only active in markdown mode
        if (fileModeRef.current !== "markdown") return false;

        const clipboardData = event.clipboardData;
        if (!clipboardData) return false;

        // Image pastes are handled by the dropImage plugin
        const items = Array.from(clipboardData.items);
        if (items.some((item) => item.type.startsWith("image/"))) return false;

        // Rich clipboard content normally uses ProseMirror's HTML parser. A
        // fenced Mermaid block is the exception: browsers and chat apps often
        // include generic HTML that would otherwise paste the literal backticks
        // instead of creating a renderable Mermaid code block.
        const text = clipboardData.getData("text/plain");
        const hasHtml = Array.from(clipboardData.types).includes("text/html");
        const hasMermaidFence = /(?:^|\n)[ \t]*```[ \t]*mermaid(?:[ \t]+[^\n]*)?[ \t]*(?:\r?\n|$)/i.test(text);
        const selection = view.state.selection;
        const contextMarks =
          view.state.storedMarks ??
          (selection.empty
            ? selection.$from.marks()
            : selection.$from.marksAcross(selection.$to) ?? []);
        const inTableCell = selectionIsInTableCell(view);

        // Pasting into an inline-code span must behave like typing there:
        // Markdown punctuation is literal and must not be parsed into nested
        // emphasis, links, math, or another code span.
        if (text && contextMarks.some((mark) => mark.type === schema.marks.code)) {
          const literal = text.replace(/\r?\n/g, " ");
          view.dispatch(
            view.state.tr.replaceSelection(
              new Slice(Fragment.from(schema.text(literal, contextMarks)), 0, 0)
            ).scrollIntoView()
          );
          return true;
        }

        const parsedDoc = text.trim() ? markdownToDoc(text, schema) : null;
        const shouldParseMarkdown = Boolean(
          parsedDoc &&
          (hasMermaidFence ||
            (nodeHasMarkdownSemantics(parsedDoc) &&
              !sliceHasMarkdownSemantics(defaultSlice)))
        );

        if (hasHtml && !shouldParseMarkdown) {
          // Rich tables, lists, headings and other block structures cannot be
          // nested in a GFM cell. Preserve their clipboard text literally with
          // serializable hard breaks instead of letting ProseMirror fit them by
          // creating a nested/lifted structure.
          if (inTableCell && !isInlineCellSlice(defaultSlice)) {
            view.dispatch(
              view.state.tr
                .replaceSelection(literalCellSlice(text, contextMarks))
                .scrollIntoView()
            );
            return true;
          }
          const markedSlice = addContextMarks(defaultSlice, contextMarks);
          if (markedSlice === defaultSlice) return false;
          view.dispatch(
            view.state.tr.replaceSelection(markedSlice).scrollIntoView()
          );
          return true;
        }

        if (!parsedDoc) return false;

        // For a single plain paragraph, use an open slice (openStart/End = 1) so
        // the inline content merges naturally into the surrounding paragraph.
        // For block-level content (headings, lists, code blocks, …) use a closed
        // slice so the block structure is preserved as-is.
        const isSingleParagraph =
          parsedDoc.childCount === 1 &&
          parsedDoc.child(0).type.name === "paragraph";

        if (inTableCell && !isSingleParagraph) {
          view.dispatch(
            view.state.tr
              .replaceSelection(literalCellSlice(text, contextMarks))
              .scrollIntoView()
          );
          return true;
        }

        const paragraph = isSingleParagraph ? parsedDoc.child(0) : null;
        const firstInline = paragraph?.firstChild;
        const isUnformattedSingleLineText =
          paragraph?.childCount === 1 &&
          firstInline?.isText === true &&
          firstInline.marks.length === 0 &&
          firstInline.text === text &&
          !/[\r\n]/.test(text);

        // ProseMirror's default plain-text slice already carries the marks at
        // the cursor. Reuse it for literal text, and add the surrounding marks
        // when standalone Markdown parsing introduced inline structure.
        const baseSlice = isUnformattedSingleLineText
          ? defaultSlice
          : isSingleParagraph
            ? new Slice(parsedDoc.content, 1, 1)
            : new Slice(parsedDoc.content, 0, 0);
        const slice = hasMermaidFence
          ? baseSlice
          : addContextMarks(baseSlice, contextMarks);

        view.dispatch(view.state.tr.replaceSelection(slice).scrollIntoView());
        return true;
      },
    },
  });
}
