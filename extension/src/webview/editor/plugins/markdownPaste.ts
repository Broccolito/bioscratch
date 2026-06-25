import { Plugin } from "prosemirror-state";
import { Slice } from "prosemirror-model";
import { schema } from "../schema";
import { markdownToDoc } from "../serialization/markdownImport";
import type { MutableRefObject } from "react";
import type { FileMode } from "../../lib/fileMode";

/**
 * Intercepts plain-text paste events (no HTML on clipboard) when in markdown
 * mode and parses the pasted text as Markdown instead of inserting it verbatim.
 *
 * This makes pasting things like "# Heading" or "**bold**" from a terminal or
 * plain-text editor automatically produce the correct ProseMirror nodes rather
 * than the raw Markdown source characters.
 *
 * When `text/html` is also on the clipboard (copy from browser, within-editor
 * copy, VS Code, etc.) we return false so ProseMirror's built-in HTML parser
 * handles the paste as usual.
 */
export function buildMarkdownPastePlugin(
  fileModeRef: MutableRefObject<FileMode>
): Plugin {
  return new Plugin({
    props: {
      handlePaste(view, event) {
        // Only active in markdown mode
        if (fileModeRef.current !== "markdown") return false;

        const clipboardData = event.clipboardData;
        if (!clipboardData) return false;

        // Image pastes are handled by the dropImage plugin
        const items = Array.from(clipboardData.items);
        if (items.some((item) => item.type.startsWith("image/"))) return false;

        // If rich HTML is on the clipboard, let ProseMirror's default HTML
        // parser handle the paste (covers copy from browser, within-editor copy,
        // etc. where the HTML already represents the correct structure).
        if (Array.from(clipboardData.types).includes("text/html")) return false;

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

        const slice = isSingleParagraph
          ? new Slice(parsedDoc.content, 1, 1)
          : new Slice(parsedDoc.content, 0, 0);

        view.dispatch(view.state.tr.replaceSelection(slice).scrollIntoView());
        return true;
      },
    },
  });
}
