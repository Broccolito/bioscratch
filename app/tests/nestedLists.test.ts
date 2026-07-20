// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import type { Node as PMNode, Schema } from "prosemirror-model";
import { EditorState, TextSelection } from "prosemirror-state";
import { sinkListItem } from "prosemirror-schema-list";

import { schema as appSchema } from "../src/editor/schema";
import { markdownToDoc as appMarkdownToDoc } from "../src/editor/serialization/markdownImport";
import { docToMarkdown as appDocToMarkdown } from "../src/editor/serialization/markdownExport";
import { schema as extensionSchema } from "../../extension/src/webview/editor/schema";
import { markdownToDoc as extensionMarkdownToDoc } from "../../extension/src/webview/editor/serialization/markdownImport";
import { docToMarkdown as extensionDocToMarkdown } from "../../extension/src/webview/editor/serialization/markdownExport";

interface Target {
  name: string;
  schema: Schema;
  markdownToDoc(markdown: string, schema: Schema): PMNode;
  docToMarkdown(doc: PMNode): string;
}

const targets: Target[] = [
  {
    name: "Tauri app",
    schema: appSchema,
    markdownToDoc: appMarkdownToDoc,
    docToMarkdown: appDocToMarkdown,
  },
  {
    name: "VS Code extension",
    schema: extensionSchema,
    markdownToDoc: extensionMarkdownToDoc,
    docToMarkdown: extensionDocToMarkdown,
  },
];

function cursorIn(doc: PMNode, text: string): TextSelection {
  let position: number | null = null;
  doc.descendants((node, pos) => {
    if (position === null && node.type.name === "paragraph" && node.textContent === text) {
      position = pos + 1 + node.content.size;
      return false;
    }
    return position === null;
  });
  if (position === null) throw new Error(`Could not find paragraph: ${text}`);
  return TextSelection.create(doc, position);
}

describe("Tauri app nested-list command", () => {
  it("nests the current bullet under its previous sibling", () => {
    const doc = appMarkdownToDoc("- parent\n- child\n", appSchema);
    let state = EditorState.create({ doc, selection: cursorIn(doc, "child") });

    const handled = sinkListItem(appSchema.nodes.list_item)(state, (tr) => {
      state = state.apply(tr);
    });

    expect(handled).toBe(true);
    expect(state.doc.toJSON()).toMatchObject({
      content: [{
        type: "bullet_list",
        content: [{
          type: "list_item",
          content: [
            { type: "paragraph", content: [{ type: "text", text: "parent" }] },
            {
              type: "bullet_list",
              content: [{
                type: "list_item",
                content: [{ type: "paragraph", content: [{ type: "text", text: "child" }] }],
              }],
            },
          ],
        }],
      }],
    });
    expect(appDocToMarkdown(state.doc)).toBe("- parent\n  - child\n");
  });
});

for (const target of targets) {
  describe(`${target.name} nested-list serialization`, () => {
    it("round-trips mixed nested ordered and bullet lists", () => {
      const markdown = "1. parent\n   - child\n     1. grandchild\n2. sibling\n";
      const doc = target.markdownToDoc(markdown, target.schema);
      const serialized = target.docToMarkdown(doc);
      const reparsed = target.markdownToDoc(serialized, target.schema);

      expect(serialized).toContain("   - child");
      expect(serialized).toContain("     1. grandchild");
      expect(reparsed.toJSON()).toEqual(doc.toJSON());
    });
  });
}
