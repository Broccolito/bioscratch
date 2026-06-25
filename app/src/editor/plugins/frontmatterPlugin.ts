import { Plugin } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import { schema } from "../schema";

/**
 * Adds a node decoration with spec.frontmatterActive = true when the cursor is
 * inside the frontmatter node. FrontmatterView.update() reads this to toggle
 * between the rendered banner (inactive) and the editable YAML source (active),
 * the same toggle used for Mermaid blocks and images.
 */
export function buildFrontmatterPlugin(): Plugin {
  return new Plugin({
    props: {
      decorations(state) {
        const { $head } = state.selection;
        const decos: Decoration[] = [];

        state.doc.descendants((node, pos) => {
          if (node.type !== schema.nodes.frontmatter) return false;

          const nodeEnd = pos + node.nodeSize;
          // Strict bounds: a caret exactly at nodeEnd belongs to the block that
          // follows, so it should not keep the source open.
          if ($head.pos > pos && $head.pos < nodeEnd) {
            // Carry the active class as a DOM attribute so ProseMirror applies it
            // straight onto the NodeView's element — this is far more reliable
            // than reading the decoration spec inside NodeView.update(). The spec
            // is kept too so update() can mirror it as a backup.
            decos.push(
              Decoration.node(
                pos,
                nodeEnd,
                { class: "frontmatter-active" },
                { frontmatterActive: true }
              )
            );
          }
          return false;
        });

        return DecorationSet.create(state.doc, decos);
      },
    },
  });
}
