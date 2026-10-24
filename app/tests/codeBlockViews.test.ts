// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorState } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { schema } from "../src/editor/schema";
import { CodeBlockView, MermaidBlockView } from "../src/components/EditorSurface";
import { isMermaidLanguage } from "../src/editor/plugins/mermaidPlugin";

vi.mock("mermaid", () => ({
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

function codeState(language: string, text: string) {
  return EditorState.create({
    doc: schema.nodes.doc.create(null, schema.nodes.code_block.create({ language }, schema.text(text))),
  });
}

describe("code block NodeView switching", () => {
  it("recreates Mermaid controls and preview when restoring a Markdown tab from a code tab", async () => {
    const python = codeState("python", "print('dirty content preserved')");
    const markdown = codeState("mermaid", "graph TD; A-->B");
    const host = document.createElement("div");
    document.body.appendChild(host);
    view = new EditorView(host, {
      state: python,
      nodeViews: {
        code_block: (node, editor, getPos, decorations) => isMermaidLanguage(node.attrs.language)
          ? new MermaidBlockView(node, editor, getPos, decorations)
          : new CodeBlockView(node),
      },
    });

    for (let switchCount = 0; switchCount < 3; switchCount++) {
      expect(host.querySelector(".code-block-lang-label")?.textContent).toBe("python");
      expect(view.state.doc.textContent).toBe("print('dirty content preserved')");
      view.updateState(markdown);
      await Promise.resolve();
      expect(host.querySelector(".mermaid-edit-button")?.textContent).toBe("Edit source");
      expect(host.querySelector(".mermaid-preview svg text")?.textContent).toBe("Rendered diagram");
      expect(host.querySelector(".code-block-view")).toBeNull();
      expect(view.state.doc.textContent).toBe("graph TD; A-->B");
      view.updateState(python);
      expect(host.querySelector(".mermaid-block-view")).toBeNull();
    }
  });

  it("still reuses a generic code view for ordinary language changes", () => {
    const nodeView = new CodeBlockView(codeState("python", "before").doc.firstChild!);
    const dom = nodeView.dom;
    expect(nodeView.update(codeState("javascript", "after").doc.firstChild!)).toBe(true);
    expect(nodeView.dom).toBe(dom);
    expect(dom.querySelector(".code-block-lang-label")?.textContent).toBe("javascript");
    expect(nodeView.contentDOM.className).toBe("language-javascript");
  });
});
