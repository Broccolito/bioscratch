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

  return new Slice(
    Fragment.from(first.copy(markChildren(first.content))),
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
        if (fileModeRef.current !== "markdown") return false;

        const clipboardData = event.clipboardData;
        if (!clipboardData) return false;

        const items = Array.from(clipboardData.items);
        if (items.some((item) => item.type.startsWith("image/"))) return false;

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
