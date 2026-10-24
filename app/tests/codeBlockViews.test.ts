// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorState } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import type { Schema } from "prosemirror-model";
import { schema } from "../src/editor/schema";
import { CodeBlockView, MermaidBlockView } from "../src/components/EditorSurface";
import { isMermaidLanguage } from "../src/editor/plugins/mermaidPlugin";
import { schema as extensionSchema } from "../../extension/src/webview/editor/schema";
import {
  CodeBlockView as ExtensionCodeBlockView,
  MermaidBlockView as ExtensionMermaidBlockView,
} from "../../extension/src/webview/components/EditorSurface";

vi.mock("mermaid", () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn(async () => ({ svg: "<svg><text>Rendered diagram</text></svg>" })),
  },
}));
vi.mock("../../extension/node_modules/mermaid/dist/mermaid.core.mjs", () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn(async () => ({ svg: "<svg><text>Rendered diagram</text></svg>" })),
  },
}));

let view: EditorView | null = null;
afterEach(() => {
  view?.destroy();
  view = null;
  document.body.replaceChildren();
});

function codeState(language: string, text: string, targetSchema: Schema = schema) {
  return EditorState.create({
    doc: targetSchema.nodes.doc.create(null, targetSchema.nodes.code_block.create({ language }, targetSchema.text(text))),
  });
}

const targets = [
  { name: "desktop", schema, CodeBlockView, MermaidBlockView, hasControls: true },
  { name: "extension", schema: extensionSchema, CodeBlockView: ExtensionCodeBlockView, MermaidBlockView: ExtensionMermaidBlockView, hasControls: false },
];

describe.each(targets)("$name code block NodeView switching", (target) => {
  it("recreates the Mermaid preview when restoring a Markdown tab from a code tab", async () => {
    const python = codeState("python", "print('dirty content preserved')", target.schema);
    const markdown = codeState("mermaid", "graph TD; A-->B", target.schema);
    const host = document.createElement("div");
    document.body.appendChild(host);
    view = new EditorView(host, {
      state: python,
      nodeViews: {
        code_block: (node, editor, getPos, decorations) => isMermaidLanguage(node.attrs.language)
          ? new target.MermaidBlockView(node, editor, getPos, decorations)
          : new target.CodeBlockView(node),
      },
    });

    for (let switchCount = 0; switchCount < 3; switchCount++) {
      expect(host.querySelector(".code-block-lang-label")?.textContent).toBe("python");
      expect(view.state.doc.textContent).toBe("print('dirty content preserved')");
      view.updateState(markdown);
      await Promise.resolve();
      if (target.hasControls) expect(host.querySelector(".mermaid-edit-button")?.textContent).toBe("Edit source");
      expect(host.querySelector(".mermaid-preview svg text")?.textContent).toBe("Rendered diagram");
      expect(host.querySelector(".code-block-view")).toBeNull();
      expect(view.state.doc.textContent).toBe("graph TD; A-->B");
      view.updateState(python);
      expect(host.querySelector(".mermaid-block-view")).toBeNull();
    }
  });

  it("still reuses a generic code view for ordinary language changes", () => {
    const nodeView = new target.CodeBlockView(codeState("python", "before", target.schema).doc.firstChild!);
    const dom = nodeView.dom;
    expect(nodeView.update(codeState("javascript", "after", target.schema).doc.firstChild!)).toBe(true);
    expect(nodeView.dom).toBe(dom);
    expect(dom.querySelector(".code-block-lang-label")?.textContent).toBe("javascript");
    expect(nodeView.contentDOM.className).toBe("language-javascript");
  });
});
