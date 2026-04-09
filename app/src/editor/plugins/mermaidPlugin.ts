import { Plugin } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import { schema } from "../schema";

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
          if (node.attrs.language !== "mermaid") return false;

          const nodeEnd = pos + node.nodeSize;
          if ($head.pos > pos && $head.pos <= nodeEnd) {
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
