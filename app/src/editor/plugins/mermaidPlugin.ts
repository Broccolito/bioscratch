import { Plugin } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import { schema } from "../schema";

export function isMermaidLanguage(language: unknown): boolean {
  return typeof language === "string" && language.trim().toLowerCase() === "mermaid";
}

/**
 * Adds a node decoration with spec.mermaidActive = true when the cursor is
 * inside a mermaid code_block. MermaidBlockView.update() reads this to toggle
 * the active (source-visible + preview) state.
 */
export function buildMermaidPlugin(): Plugin {
  return new Plugin({
    props: {
      decorations(state) {
        const { $head } = state.selection;
        const decos: Decoration[] = [];

        state.doc.descendants((node, pos) => {
          if (node.type !== schema.nodes.code_block) return true;
          if (!isMermaidLanguage(node.attrs.language)) return false;

          const nodeEnd = pos + node.nodeSize;
          // nodeEnd is the position *after* the block; a cursor there belongs to
          // the following block, so use a strict upper bound to avoid keeping the
          // source visible when the caret has already left the diagram.
          if ($head.pos > pos && $head.pos < nodeEnd) {
            decos.push(
              Decoration.node(pos, nodeEnd, {}, { mermaidActive: true })
            );
          }
          return false;
        });

        return DecorationSet.create(state.doc, decos);
      },
    },
  });
}
