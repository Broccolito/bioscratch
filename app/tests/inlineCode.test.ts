// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { Fragment, Slice, type Mark, type Node as PMNode, type Schema } from "prosemirror-model";
import { EditorState, TextSelection } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { splitBlock, toggleMark } from "prosemirror-commands";

import { schema as appSchema } from "../src/editor/schema";
import { markdownToDoc as appMarkdownToDoc } from "../src/editor/serialization/markdownImport";
import { docToMarkdown as appDocToMarkdown } from "../src/editor/serialization/markdownExport";
import { buildMarkdownPastePlugin as buildAppPaste } from "../src/editor/plugins/markdownPaste";
import { buildInputRules as buildAppInputRules } from "../src/editor/plugins/inputRules";

import { schema as extensionSchema } from "../../extension/src/webview/editor/schema";
import { markdownToDoc as extensionMarkdownToDoc } from "../../extension/src/webview/editor/serialization/markdownImport";
import { docToMarkdown as extensionDocToMarkdown } from "../../extension/src/webview/editor/serialization/markdownExport";
import { buildMarkdownPastePlugin as buildExtensionPaste } from "../../extension/src/webview/editor/plugins/markdownPaste";
import { buildInputRules as buildExtensionInputRules } from "../../extension/src/webview/editor/plugins/inputRules";

interface Target {
  name: string;
  schema: Schema;
  markdownToDoc(markdown: string, schema: Schema): PMNode;
  docToMarkdown(doc: PMNode): string;
  buildPaste(ref: { current: "markdown" }): ReturnType<typeof buildAppPaste>;
  buildInputRules(): ReturnType<typeof buildAppInputRules>;
}

const targets: Target[] = [
  {
    name: "Tauri app",
    schema: appSchema,
    markdownToDoc: appMarkdownToDoc,
    docToMarkdown: appDocToMarkdown,
    buildPaste: buildAppPaste,
    buildInputRules: buildAppInputRules,
  },
  {
    name: "VS Code extension",
    schema: extensionSchema,
    markdownToDoc: extensionMarkdownToDoc,
    docToMarkdown: extensionDocToMarkdown,
    buildPaste: buildExtensionPaste,
    buildInputRules: buildExtensionInputRules,
  },
];

const liveViews: EditorView[] = [];
afterEach(() => {
  while (liveViews.length) liveViews.pop()?.destroy();
  document.body.replaceChildren();
});

function marks(schema: Schema, names: string[]): Mark[] {
  return names.map((name) => schema.marks[name].create());
}

function paragraphDoc(target: Target, text: string, markNames: string[] = []): PMNode {
  const textNode = text ? target.schema.text(text, marks(target.schema, markNames)) : null;
  return target.schema.nodes.doc.create(
    null,
    target.schema.nodes.paragraph.create(null, textNode)
  );
}

function viewFor(state: EditorState): EditorView {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const view = new EditorView(host, { state });
  liveViews.push(view);
  return view;
}

function textRuns(doc: PMNode): Array<{ text: string; marks: string[] }> {
  const runs: Array<{ text: string; marks: string[] }> = [];
  doc.descendants((node) => {
    if (node.isText) {
      runs.push({
        text: node.text || "",
        marks: node.marks.map((mark) => mark.type.name).sort(),
      });
    }
  });
  return runs;
}

function inlineSlice(target: Target, text: string, markNames: string[] = []): Slice {
  const content = text
    ? Fragment.from(target.schema.text(text, marks(target.schema, markNames)))
    : Fragment.empty;
  return new Slice(content, 0, 0);
}

function paste(
  target: Target,
  doc: PMNode,
  selection: TextSelection,
  plainText: string,
  options: { html?: string; defaultMarks?: string[] } = {}
): { handled: boolean; doc: PMNode } {
  const plugin = target.buildPaste({ current: "markdown" });
  const state = EditorState.create({ doc, selection, plugins: [plugin] });
  const view = viewFor(state);
  const types = options.html === undefined
    ? ["text/plain"]
    : ["text/plain", "text/html"];
  const clipboardData = {
    items: [],
    types,
    getData(type: string) {
      if (type === "text/plain") return plainText;
      if (type === "text/html") return options.html || "";
      return "";
    },
  } as unknown as DataTransfer;
  const event = { clipboardData } as ClipboardEvent;
  const handler = plugin.props.handlePaste;
  if (!handler) throw new Error("Paste handler was not installed");
  const handled = Boolean(
    handler(view, event, inlineSlice(target, plainText, options.defaultMarks))
  );
  return { handled, doc: view.state.doc };
}

function typeText(view: EditorView, text: string): void {
  for (const character of text) {
    const { from, to } = view.state.selection;
    const handled = Boolean(
      view.someProp("handleTextInput", (handler) =>
        handler(view, from, to, character)
      )
    );
    if (!handled) view.dispatch(view.state.tr.insertText(character, from, to));
  }
}

function inputText(view: EditorView, text: string): void {
  const { from, to } = view.state.selection;
  const handled = Boolean(
    view.someProp("handleTextInput", (handler) =>
      handler(view, from, to, text)
    )
  );
  if (!handled) view.dispatch(view.state.tr.insertText(text, from, to));
}

for (const target of targets) {
  describe(`${target.name} inline code`, () => {
    it("round-trips an ordinary code span", () => {
      const source = "before `alpha` after\n";
      const parsed = target.markdownToDoc(source, target.schema);
      expect(target.docToMarkdown(parsed)).toBe(source);
      expect(textRuns(parsed)).toContainEqual({ text: "alpha", marks: ["code"] });
    });

    it("toggles code on and off for a selection", () => {
      const doc = paragraphDoc(target, "alpha");
      let state = EditorState.create({
        doc,
        selection: TextSelection.create(doc, 1, 6),
      });
      const command = toggleMark(target.schema.marks.code);
      expect(command(state, (tr) => { state = state.apply(tr); })).toBe(true);
      expect(textRuns(state.doc)).toEqual([{ text: "alpha", marks: ["code"] }]);
      expect(command(state, (tr) => { state = state.apply(tr); })).toBe(true);
      expect(textRuns(state.doc)).toEqual([{ text: "alpha", marks: [] }]);
    });

    it("converts typed backtick syntax into inline code", () => {
      const doc = paragraphDoc(target, "");
      const view = viewFor(EditorState.create({
        doc,
        selection: TextSelection.create(doc, 1),
        plugins: [target.buildInputRules()],
      }));
      typeText(view, "`alpha`");
      expect(textRuns(view.state.doc)).toEqual([{ text: "alpha", marks: ["code"] }]);
    });

    it("converts a complete code span delivered in one text-input event", () => {
      const doc = paragraphDoc(target, "");
      const view = viewFor(EditorState.create({
        doc,
        selection: TextSelection.create(doc, 1),
        plugins: [target.buildInputRules()],
      }));
      inputText(view, "`alpha`");
      expect(textRuns(view.state.doc)).toEqual([{ text: "alpha", marks: ["code"] }]);
    });

    it("converts a code span completed by a multi-character text-input event", () => {
      const doc = paragraphDoc(target, "");
      const view = viewFor(EditorState.create({
        doc,
        selection: TextSelection.create(doc, 1),
        plugins: [target.buildInputRules()],
      }));
      inputText(view, "`al");
      inputText(view, "pha`");
      expect(textRuns(view.state.doc)).toEqual([{ text: "alpha", marks: ["code"] }]);
    });

    it("retains code while typing inside a span", () => {
      const doc = paragraphDoc(target, "LR", ["code"]);
      const state = EditorState.create({ doc, selection: TextSelection.create(doc, 2) });
      const next = state.apply(state.tr.insertText("x"));
      expect(textRuns(next.doc)).toEqual([{ text: "LxR", marks: ["code"] }]);
    });

    it("retains code while replacing selected text by typing", () => {
      const doc = paragraphDoc(target, "abc", ["code"]);
      const state = EditorState.create({ doc, selection: TextSelection.create(doc, 2, 3) });
      const next = state.apply(state.tr.insertText("X"));
      expect(textRuns(next.doc)).toEqual([{ text: "aXc", marks: ["code"] }]);
    });

    it("retains code while typing at either span boundary", () => {
      const doc = paragraphDoc(target, "abc", ["code"]);
      const atStart = EditorState.create({
        doc,
        selection: TextSelection.create(doc, 1),
      });
      expect(textRuns(atStart.apply(atStart.tr.insertText("S")).doc))
        .toEqual([{ text: "Sabc", marks: ["code"] }]);

      const atEnd = EditorState.create({
        doc,
        selection: TextSelection.create(doc, 4),
      });
      expect(textRuns(atEnd.apply(atEnd.tr.insertText("E")).doc))
        .toEqual([{ text: "abcE", marks: ["code"] }]);
    });

    it("preserves code on both sides of a paragraph split", () => {
      const doc = paragraphDoc(target, "ab", ["code"]);
      let state = EditorState.create({ doc, selection: TextSelection.create(doc, 2) });
      expect(splitBlock(state, (tr) => { state = state.apply(tr); })).toBe(true);
      expect(textRuns(state.doc)).toEqual([
        { text: "a", marks: ["code"] },
        { text: "b", marks: ["code"] },
      ]);
    });

    it("supports middle, edge, and complete deletion", () => {
      const base = paragraphDoc(target, "abc", ["code"]);
      const middle = EditorState.create({ doc: base }).apply(
        EditorState.create({ doc: base }).tr.delete(2, 3)
      ).doc;
      expect(textRuns(middle)).toEqual([{ text: "ac", marks: ["code"] }]);
      const edgeState = EditorState.create({ doc: base });
      expect(textRuns(edgeState.apply(edgeState.tr.delete(1, 2)).doc))
        .toEqual([{ text: "bc", marks: ["code"] }]);
      const fullState = EditorState.create({ doc: base });
      const empty = fullState.apply(fullState.tr.delete(1, 4)).doc;
      expect(empty.textContent).toBe("");
      expect(empty.check()).toBeUndefined();
    });

    it("parses Markdown code syntax pasted into plain text", () => {
      const doc = paragraphDoc(target, "LR");
      const result = paste(target, doc, TextSelection.create(doc, 2), "`x`");
      expect(result.handled).toBe(true);
      expect(textRuns(result.doc)).toEqual([
        { text: "L", marks: [] },
        { text: "x", marks: ["code"] },
        { text: "R", marks: [] },
      ]);
    });

    it("keeps a code-marked HTML paste marked", () => {
      const doc = paragraphDoc(target, "LR", ["code"]);
      const result = paste(
        target,
        doc,
        TextSelection.create(doc, 2),
        "x",
        { html: "<code>x</code>", defaultMarks: ["code"] }
      );
      expect(textRuns(result.doc)).toEqual([{ text: "LxR", marks: ["code"] }]);
    });

    it("inherits code for a plain-text paste", () => {
      const doc = paragraphDoc(target, "LR", ["code"]);
      const result = paste(target, doc, TextSelection.create(doc, 2), "x");
      expect(result.handled).toBe(true);
      expect(textRuns(result.doc)).toEqual([{ text: "LxR", marks: ["code"] }]);
    });

    it("keeps pasted Markdown punctuation literal inside inline code", () => {
      for (const source of ["**x**", "[x](https://example.test)", "$x$", "`x`"]) {
        const doc = paragraphDoc(target, "LR", ["code"]);
        const result = paste(target, doc, TextSelection.create(doc, 2), source);
        expect(result.handled).toBe(true);
        expect(textRuns(result.doc), source).toEqual([
          { text: `L${source}R`, marks: ["code"] },
        ]);
      }
    });

    it("inherits code for unmarked HTML", () => {
      const doc = paragraphDoc(target, "LR", ["code"]);
      const result = paste(
        target,
        doc,
        TextSelection.create(doc, 2),
        "x",
        { html: "<span>x</span>" }
      );
      expect(result.handled).toBe(true);
      expect(textRuns(result.doc)).toEqual([{ text: "LxR", marks: ["code"] }]);
    });

    it("inherits nested bold and code marks", () => {
      const doc = paragraphDoc(target, "LR", ["bold", "code"]);
      const result = paste(target, doc, TextSelection.create(doc, 2), "x");
      expect(textRuns(result.doc)).toEqual([
        { text: "LxR", marks: ["bold", "code"] },
      ]);
    });

    it("retains code when paste replaces the complete span", () => {
      const doc = paragraphDoc(target, "LR", ["code"]);
      const result = paste(target, doc, TextSelection.create(doc, 1, 3), "x");
      expect(textRuns(result.doc)).toEqual([{ text: "x", marks: ["code"] }]);
    });

    it("parses Markdown echoed by an unformatted HTML clipboard wrapper", () => {
      const doc = paragraphDoc(target, "");
      const source = "**bold** and `code`";
      const result = paste(
        target,
        doc,
        TextSelection.create(doc, 1),
        source,
        { html: `<p>${source}</p>` }
      );
      expect(result.handled).toBe(true);
      expect(textRuns(result.doc)).toEqual([
        { text: "bold", marks: ["bold"] },
        { text: " and ", marks: [] },
        { text: "code", marks: ["code"] },
      ]);
    });

    it("round-trips Unicode and Markdown punctuation literally", () => {
      const value = "λ_*~[]🙂";
      const doc = paragraphDoc(target, value, ["code"]);
      const reparsed = target.markdownToDoc(target.docToMarkdown(doc), target.schema);
      expect(textRuns(reparsed)).toEqual([{ text: value, marks: ["code"] }]);
    });

    it("round-trips literal backtick runs", () => {
      const values = ["a`b", "`edge`", "a``b", "```"];
      for (const value of values) {
        const doc = paragraphDoc(target, value, ["code"]);
        const reparsed = target.markdownToDoc(target.docToMarkdown(doc), target.schema);
        expect(textRuns(reparsed), value).toEqual([{ text: value, marks: ["code"] }]);
      }
    });

    it("round-trips meaningful spaces at both code-span edges", () => {
      for (const value of [" a ", "  a  ", " a  ", " `a` "]) {
        const doc = paragraphDoc(target, value, ["code"]);
        const reparsed = target.markdownToDoc(target.docToMarkdown(doc), target.schema);
        expect(textRuns(reparsed), JSON.stringify(value))
          .toEqual([{ text: value, marks: ["code"] }]);
      }
    });

    it("keeps surrounding bold marks stable across an inline code span", () => {
      const bold = target.schema.marks.bold.create();
      const code = target.schema.marks.code.create();
      const paragraph = target.schema.nodes.paragraph.create(null, [
        target.schema.text("before ", [bold]),
        target.schema.text("code", [bold, code]),
        target.schema.text(" after", [bold]),
      ]);
      const doc = target.schema.nodes.doc.create(null, paragraph);
      const markdown = target.docToMarkdown(doc);
      expect(markdown).toBe("**before `code` after**\n");
      const reparsed = target.markdownToDoc(markdown, target.schema);
      expect(textRuns(reparsed)).toEqual([
        { text: "before ", marks: ["bold"] },
        { text: "code", marks: ["bold", "code"] },
        { text: " after", marks: ["bold"] },
      ]);
    });

    it("keeps the rich-clipboard Mermaid fence exception", () => {
      const doc = paragraphDoc(target, "");
      const source = "```mermaid\ngraph TD; A-->B\n```";
      const result = paste(
        target,
        doc,
        TextSelection.create(doc, 1),
        source,
        { html: `<pre>${source}</pre>` }
      );
      expect(result.handled).toBe(true);
      expect(result.doc.firstChild?.type.name).toBe("code_block");
      expect(result.doc.firstChild?.attrs.language).toBe("mermaid");
    });
  });
}

describe("link rendering security", () => {
  for (const target of targets) {
    it(`${target.name} neutralizes executable href schemes`, () => {
      const link = target.schema.marks.link.create({ href: "javascript:alert(1)" });
      const doc = target.schema.nodes.doc.create(
        null,
        target.schema.nodes.paragraph.create(
          null,
          target.schema.text("unsafe", [link])
        )
      );
      const host = document.createElement("div");
      const serializer = target.schema.cached.domSerializer;
      // DOMSerializer is created lazily by EditorView; use a mounted view to
      // exercise the schema's real toDOM path.
      const view = viewFor(EditorState.create({ doc }));
      host.append(view.dom.cloneNode(true));
      expect(host.querySelector("a")?.getAttribute("href")).toBe("#");
      expect(serializer).toBeUndefined();
    });
  }
});
