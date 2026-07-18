import { Plugin } from "prosemirror-state";
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
  const textblock = slice.content.firstChild;
  if (
    contextMarks.length === 0 ||
    slice.content.childCount !== 1 ||
    !textblock?.isTextblock
  ) {
    return slice;
  }

  const children: ProseMirrorNode[] = [];
  textblock.content.forEach((child) => {
    const marks = contextMarks.reduce(
      (current, mark) => mark.addToSet(current),
      child.marks
    );
    children.push(child.mark(marks));
  });

  const markedTextblock = textblock.copy(Fragment.fromArray(children));
  return new Slice(
    Fragment.from(markedTextblock),
    slice.openStart,
    slice.openEnd
  );
}

/**
 * Handles paste events in Markdown mode. Plain-text clipboard content is
 * parsed as Markdown, while inline rich-text content inherits the formatting
 * marks at the insertion point.
 *
 * This makes pasting things like "# Heading" or "**bold**" from a terminal or
 * plain-text editor automatically produce the correct ProseMirror nodes rather
 * than the raw Markdown source characters.
 *
 * Rich HTML without an inline formatting context is left to ProseMirror's
 * built-in parser.
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

        const selection = view.state.selection;
        const contextMarks =
          view.state.storedMarks ??
          (selection.empty
            ? selection.$from.marks()
            : selection.$from.marksAcross(selection.$to) ?? []);

        // Rich HTML often represents plain inline text as an unmarked slice,
        // even when it was copied from this editor. When pasting into formatted
        // text, merge the surrounding marks into a single inline textblock.
        // Multi-block HTML still uses ProseMirror's default paste behavior.
        if (Array.from(clipboardData.types).includes("text/html")) {
          const markedSlice = addContextMarks(defaultSlice, contextMarks);
          if (markedSlice === defaultSlice) return false;

          view.dispatch(
            view.state.tr.replaceSelection(markedSlice).scrollIntoView()
          );
          return true;
        }

        const text = clipboardData.getData("text/plain");
        if (!text.trim()) return false;

        const parsedDoc = markdownToDoc(text, schema);

        // For a single plain paragraph, use an open slice (openStart/End = 1) so
        // the inline content merges naturally into the surrounding paragraph.
        // For block-level content (headings, lists, code blocks, …) use a closed
        // slice so the block structure is preserved as-is.
        const isSingleParagraph =
          parsedDoc.childCount === 1 &&
          parsedDoc.child(0).type.name === "paragraph";

        const paragraph = isSingleParagraph ? parsedDoc.child(0) : null;
        const firstInline = paragraph?.firstChild;
        const isUnformattedSingleLineText =
          paragraph?.childCount === 1 &&
          firstInline?.isText === true &&
          firstInline.marks.length === 0 &&
          firstInline.text === text &&
          !/[\r\n]/.test(text);

        // ProseMirror's default plain-text slice already carries the marks at
        // the cursor (code, bold, italic, strikethrough, etc.). Reuse it for
        // truly plain inline text instead of discarding that context when we
        // parse the clipboard as a standalone Markdown document.
        const baseSlice = isUnformattedSingleLineText
          ? defaultSlice
          : isSingleParagraph
            ? new Slice(parsedDoc.content, 1, 1)
            : new Slice(parsedDoc.content, 0, 0);
        const slice = addContextMarks(baseSlice, contextMarks);

        view.dispatch(view.state.tr.replaceSelection(slice).scrollIntoView());
        return true;
      },
    },
  });
}
