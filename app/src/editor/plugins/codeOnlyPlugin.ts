import { Plugin } from "prosemirror-state";

/**
 * When the document contains exactly one code_block node (non-markdown file),
 * this plugin blocks any transaction that would alter the top-level document
 * structure (e.g. adding paragraphs above/below the code block).
 *
 * Selection clamping is handled upstream in dispatchTransaction so it is
 * synchronous and flicker-free — this plugin is purely a structural guard.
 */
export function buildCodeOnlyPlugin(): Plugin {
  return new Plugin({
    filterTransaction(tr, state) {
      if (!tr.docChanged) return true;
      // Only restrict when the current doc is a single code_block
      if (
        state.doc.childCount !== 1 ||
        state.doc.child(0).type.name !== "code_block"
      ) {
        return true;
      }
      // Allow the transaction only if the result is still a single code_block
      return (
        tr.doc.childCount === 1 &&
        tr.doc.child(0).type.name === "code_block"
      );
    },
  });
}
