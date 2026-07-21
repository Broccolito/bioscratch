// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import {
  Fragment,
  Slice,
  type Mark,
  type Node as PMNode,
  type Schema,
} from "prosemirror-model";
import { EditorState, TextSelection, type Transaction } from "prosemirror-state";
import { EditorView } from "prosemirror-view";

import { schema as appSchema } from "../src/editor/schema";
import { markdownToDoc as appMarkdownToDoc } from "../src/editor/serialization/markdownImport";
import { docToMarkdown as appDocToMarkdown } from "../src/editor/serialization/markdownExport";
import { buildInputRules as buildAppInputRules } from "../src/editor/plugins/inputRules";
import { buildMarkdownPastePlugin as buildAppPaste } from "../src/editor/plugins/markdownPaste";
import {
  enterInTableCell as appEnterInTableCell,
  enterForMarkdownBlocks as appEnterForMarkdownBlocks,
  moveTableCell as appMoveTableCell,
} from "../src/editor/plugins/keymap";
import { buildTableControlsPlugin } from "../src/editor/plugins/tableControls";

import { schema as extensionSchema } from "../../extension/src/webview/editor/schema";
import { markdownToDoc as extensionMarkdownToDoc } from "../../extension/src/webview/editor/serialization/markdownImport";
import { docToMarkdown as extensionDocToMarkdown } from "../../extension/src/webview/editor/serialization/markdownExport";
import { buildInputRules as buildExtensionInputRules } from "../../extension/src/webview/editor/plugins/inputRules";
import { buildMarkdownPastePlugin as buildExtensionPaste } from "../../extension/src/webview/editor/plugins/markdownPaste";
import {
  enterInTableCell as extensionEnterInTableCell,
  enterForMarkdownBlocks as extensionEnterForMarkdownBlocks,
  moveTableCell as extensionMoveTableCell,
} from "../../extension/src/webview/editor/plugins/keymap";

type Command = (
  state: EditorState,
  dispatch?: (tr: Transaction) => void
) => boolean;

interface Target {
  name: string;
  schema: Schema;
  markdownToDoc(markdown: string, schema: Schema): PMNode;
  docToMarkdown(doc: PMNode): string;
  buildInputRules(): ReturnType<typeof buildAppInputRules>;
  buildPaste(ref: { current: "markdown" }): ReturnType<typeof buildAppPaste>;
  enterInTableCell: Command;
  enterForMarkdownBlocks: Command;
  moveTableCell(direction: 1 | -1): Command;
}

const targets: Target[] = [
  {
    name: "Tauri app",
    schema: appSchema,
    markdownToDoc: appMarkdownToDoc,
    docToMarkdown: appDocToMarkdown,
    buildInputRules: buildAppInputRules,
    buildPaste: buildAppPaste,
    enterInTableCell: appEnterInTableCell,
    enterForMarkdownBlocks: appEnterForMarkdownBlocks,
    moveTableCell: appMoveTableCell,
  },
  {
    name: "VS Code extension",
    schema: extensionSchema,
    markdownToDoc: extensionMarkdownToDoc,
    docToMarkdown: extensionDocToMarkdown,
    buildInputRules: buildExtensionInputRules,
    buildPaste: buildExtensionPaste,
    enterInTableCell: extensionEnterInTableCell,
    enterForMarkdownBlocks: extensionEnterForMarkdownBlocks,
    moveTableCell: extensionMoveTableCell,
  },
];

const liveViews: EditorView[] = [];

afterEach(() => {
  while (liveViews.length) liveViews.pop()?.destroy();
  document.body.replaceChildren();
});

function viewFor(state: EditorState): EditorView {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const view = new EditorView(host, { state });
  liveViews.push(view);
  return view;
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

function cursorInCell(doc: PMNode, cellIndex: number, atEnd = true): TextSelection {
  let seen = 0;
  let position: number | null = null;
  doc.descendants((node, pos) => {
    if (position !== null) return false;
    const role = node.type.spec.tableRole;
    if (role !== "cell" && role !== "header_cell") return true;
    if (seen === cellIndex) {
      const paragraph = node.firstChild;
      position = pos + 2 + (atEnd ? paragraph?.content.size ?? 0 : 0);
      return false;
    }
    seen += 1;
    return true;
  });
  if (position === null) throw new Error(`Could not find table cell ${cellIndex}`);
  return TextSelection.create(doc, position);
}

function countNodes(doc: PMNode, typeName: string): number {
  let count = 0;
  doc.descendants((node) => {
    if (node.type.name === typeName) count += 1;
  });
  return count;
}

function textMarks(doc: PMNode): Array<{ text: string; marks: string[] }> {
  const runs: Array<{ text: string; marks: string[] }> = [];
  doc.descendants((node) => {
    if (node.isText) {
      runs.push({
        text: node.text ?? "",
        marks: node.marks.map((mark) => mark.type.name).sort(),
      });
    }
  });
  return runs;
}

function tableDoc(target: Target): PMNode {
  return target.markdownToDoc(
    "| A | B |\n| --- | --- |\n| C | D |\n",
    target.schema
  );
}

function inlineSlice(target: Target, text: string, marks: readonly Mark[] = []): Slice {
  return new Slice(Fragment.from(target.schema.text(text, marks)), 0, 0);
}

function pasteIntoCell(
  target: Target,
  plainText: string,
  options: { html?: string; defaultSlice?: Slice } = {}
): PMNode {
  const plugin = target.buildPaste({ current: "markdown" });
  const doc = tableDoc(target);
  const state = EditorState.create({
    doc,
    selection: cursorInCell(doc, 0),
    plugins: [plugin],
  });
  const view = viewFor(state);
  const clipboardData = {
    items: [],
    types: options.html === undefined ? ["text/plain"] : ["text/plain", "text/html"],
    getData(type: string) {
      if (type === "text/plain") return plainText;
      if (type === "text/html") return options.html ?? "";
      return "";
    },
  } as unknown as DataTransfer;
  const handler = plugin.props.handlePaste;
  if (!handler) throw new Error("Paste handler was not installed");
  const handled = handler(
    view,
    { clipboardData } as ClipboardEvent,
    options.defaultSlice ?? inlineSlice(target, plainText)
  );
  expect(handled).toBe(true);
  return view.state.doc;
}

for (const target of targets) {
  describe(`${target.name} Markdown table interactions`, () => {
    it("supports underscore emphasis and plus-marker lists while typing", () => {
      for (const [source, mark] of [
        ["__bold__", "bold"],
        ["_italic_", "italic"],
      ] as const) {
        const doc = target.schema.nodes.doc.create(
          null,
          target.schema.nodes.paragraph.create()
        );
        const view = viewFor(EditorState.create({
          doc,
          selection: TextSelection.create(doc, 1),
          plugins: [target.buildInputRules()],
        }));
        typeText(view, source);
        expect(textMarks(view.state.doc)).toEqual([
          { text: source.replaceAll("_", ""), marks: [mark] },
        ]);
      }

      // Wrapping rules from the extension use its bundled ProseMirror runtime,
      // which cannot be mounted into the app test runtime without duplicate
      // Fragment constructors. Exercise the shared behavior live there; the
      // app-side command test guards the actual + marker rule.
      if (target.name === "Tauri app") {
        const listDoc = target.schema.nodes.doc.create(
          null,
          target.schema.nodes.paragraph.create()
        );
        const listView = viewFor(EditorState.create({
          doc: listDoc,
          selection: TextSelection.create(listDoc, 1),
          plugins: [target.buildInputRules()],
        }));
        typeText(listView, "+ ");
        expect(listView.state.doc.firstChild?.type.name).toBe("bullet_list");
      }
    });

    it("does not treat intraword underscores as emphasis", () => {
      const doc = target.schema.nodes.doc.create(
        null,
        target.schema.nodes.paragraph.create()
      );
      const view = viewFor(EditorState.create({
        doc,
        selection: TextSelection.create(doc, 1),
        plugins: [target.buildInputRules()],
      }));
      typeText(view, "snake_case_");
      expect(textMarks(view.state.doc)).toEqual([
        { text: "snake_case_", marks: [] },
      ]);
    });

    it("keeps Markdown-looking content literal inside a typed code span", () => {
      for (const source of [
        "`**literal**`",
        "`[x](https://example.test) `",
        "`$x$ `",
      ]) {
        const doc = target.schema.nodes.doc.create(
          null,
          target.schema.nodes.paragraph.create()
        );
        const view = viewFor(EditorState.create({
          doc,
          selection: TextSelection.create(doc, 1),
          plugins: [target.buildInputRules()],
        }));
        typeText(view, source);
        expect(textMarks(view.state.doc)).toEqual([
          { text: source.slice(1, -1), marks: ["code"] },
        ]);
        expect(countNodes(view.state.doc, "math_inline")).toBe(0);
      }
    });

    it("does not convert link or math syntax already marked as code on Return", () => {
      for (const source of ["[x](https://example.test)", "$x$"]) {
        const code = target.schema.marks.code.create();
        const paragraph = target.schema.nodes.paragraph.create(
          null,
          target.schema.text(source, [code])
        );
        const doc = target.schema.nodes.doc.create(null, paragraph);
        const state = EditorState.create({
          doc,
          selection: TextSelection.create(doc, 1 + source.length),
        });
        let dispatched = false;
        expect(target.enterForMarkdownBlocks(state, () => { dispatched = true; }))
          .toBe(false);
        expect(dispatched).toBe(false);
        expect(textMarks(state.doc)).toEqual([{ text: source, marks: ["code"] }]);
      }
    });

    it("commits a thematic break with Return away from frontmatter", () => {
      const first = target.schema.nodes.paragraph.create(
        null,
        target.schema.text("intro")
      );
      const trigger = target.schema.nodes.paragraph.create(
        null,
        target.schema.text("---")
      );
      const doc = target.schema.nodes.doc.create(null, [first, trigger]);
      let state = EditorState.create({
        doc,
        selection: TextSelection.create(doc, first.nodeSize + 1 + 3),
      });
      expect(target.enterForMarkdownBlocks(state, (tr) => { state = state.apply(tr); }))
        .toBe(true);
      expect(state.doc.child(1).type.name).toBe("horizontal_rule");
      expect(state.doc.child(2).type.name).toBe("paragraph");
    });

    it("converts inline math when Space commits the syntax", () => {
      const paragraph = target.schema.nodes.paragraph.create();
      const doc = target.schema.nodes.doc.create(null, paragraph);
      const view = viewFor(EditorState.create({
        doc,
        selection: TextSelection.create(doc, 1),
        plugins: [target.buildInputRules()],
      }));

      typeText(view, "$x+y$ ");

      expect(view.state.doc.firstChild?.child(0).type.name).toBe("math_inline");
      expect(view.state.doc.firstChild?.child(0).attrs.math).toBe("x+y");
      expect(view.state.doc.textBetween(0, view.state.doc.content.size)).toBe(" ");
    });

    it("commits links and inline math before Return adds a table line break", () => {
      for (const [source, expected] of [
        ["$x+y$", "math_inline"],
        ["[site](https://example.test)", "link"],
      ] as const) {
        const doc = target.markdownToDoc(
          `| ${source} | B |\n| --- | --- |\n| C | D |\n`,
          target.schema
        );
        let state = EditorState.create({
          doc,
          selection: cursorInCell(doc, 0),
        });

        expect(target.enterInTableCell(state, (tr) => { state = state.apply(tr); }))
          .toBe(true);

        const firstCell = state.doc.firstChild?.firstChild?.firstChild;
        expect(firstCell?.firstChild?.lastChild?.type.name).toBe("hard_break");
        if (expected === "math_inline") {
          expect(firstCell?.firstChild?.firstChild?.type.name).toBe("math_inline");
        } else {
          expect(firstCell?.firstChild?.firstChild?.marks[0]?.type.name).toBe("link");
        }
      }
    });

    it("creates a row and moves to it when Tab leaves the final cell", () => {
      const doc = tableDoc(target);
      let state = EditorState.create({
        doc,
        selection: cursorInCell(doc, 3),
      });

      expect(target.moveTableCell(1)(state, (tr) => { state = state.apply(tr); }))
        .toBe(true);
      state = state.apply(state.tr.insertText("new row"));

      const table = state.doc.firstChild;
      expect(table?.childCount).toBe(3);
      expect(table?.lastChild?.firstChild?.textContent).toBe("new row");
      expect(state.doc.textContent).not.toContain("\t");
    });

    it("keeps Shift-Tab in the first cell from escaping the editor", () => {
      const doc = tableDoc(target);
      const state = EditorState.create({
        doc,
        selection: cursorInCell(doc, 0, false),
      });
      let dispatched = false;
      expect(target.moveTableCell(-1)(state, () => { dispatched = true; })).toBe(true);
      expect(dispatched).toBe(false);
    });

    it("keeps block-only Markdown literal inside GFM cells", () => {
      for (const syntax of ["# ", "> ", "- ", "```js "]) {
        const doc = tableDoc(target);
        const view = viewFor(EditorState.create({
          doc,
          selection: cursorInCell(doc, 0, false),
          plugins: [target.buildInputRules()],
        }));

        typeText(view, syntax);

        const firstCell = view.state.doc.firstChild?.firstChild?.firstChild;
        expect(firstCell?.childCount).toBe(1);
        expect(firstCell?.firstChild?.type.name).toBe("paragraph");
        expect(firstCell?.textContent).toBe(`${syntax}A`);
      }
    });

    it("rejects nested tables at the schema boundary", () => {
      const table = tableDoc(target).firstChild;
      if (!table) throw new Error("Expected a table");
      expect(
        target.schema.nodes.table_cell.validContent(Fragment.from(table))
      ).toBe(false);
    });

    it("pastes a Markdown table into a cell as literal, line-broken text", () => {
      const source = "| N | M |\n| --- | --- |\n| 1 | 2 |";
      const doc = pasteIntoCell(target, source);

      expect(countNodes(doc, "table")).toBe(1);
      expect(countNodes(doc, "hard_break")).toBe(2);
      expect(doc.firstChild?.firstChild?.firstChild?.textContent).toContain("| N | M |");
      expect(target.docToMarkdown(doc)).toContain("\\| N \\| M \\|");
    });

    it("parses a Markdown table echoed by a generic HTML clipboard wrapper", () => {
      const plugin = target.buildPaste({ current: "markdown" });
      const paragraph = target.schema.nodes.paragraph.create();
      const doc = target.schema.nodes.doc.create(null, paragraph);
      const view = viewFor(EditorState.create({
        doc,
        selection: TextSelection.create(doc, 1),
        plugins: [plugin],
      }));
      const source = "| N | M |\n| --- | --- |\n| 1 | 2 |";
      const clipboardData = {
        items: [],
        types: ["text/plain", "text/html"],
        getData(type: string) {
          if (type === "text/plain") return source;
          if (type === "text/html") return `<div>${source}</div>`;
          return "";
        },
      } as unknown as DataTransfer;
      const handler = plugin.props.handlePaste;
      if (!handler) throw new Error("Paste handler was not installed");

      expect(handler(
        view,
        { clipboardData } as ClipboardEvent,
        inlineSlice(target, source)
      )).toBe(true);
      expect(countNodes(view.state.doc, "table")).toBe(1);
    });

    it("flattens a rich clipboard table instead of nesting it", () => {
      const nestedDoc = target.markdownToDoc(
        "| N | M |\n| --- | --- |\n| 1 | 2 |\n",
        target.schema
      );
      const source = "N\tM\n1\t2";
      const doc = pasteIntoCell(target, source, {
        html: "<table><tr><td>N</td><td>M</td></tr></table>",
        defaultSlice: new Slice(nestedDoc.content, 0, 0),
      });

      expect(countNodes(doc, "table")).toBe(1);
      expect(countNodes(doc, "hard_break")).toBe(1);
      expect(doc.firstChild?.firstChild?.firstChild?.textContent).toContain("N\tM");
    });

    it("round-trips inline formatting, hard breaks, and literal pipes in cells", () => {
      const source =
        "| Format | Literal |\n" +
        "| --- | --- |\n" +
        "| **bold** *italic* `code` $x$ [link](https://example.test)<br>next | a\\|b |\n";
      const doc = target.markdownToDoc(source, target.schema);
      const serialized = target.docToMarkdown(doc);
      const reparsed = target.markdownToDoc(serialized, target.schema);

      expect(countNodes(doc, "hard_break")).toBe(1);
      expect(serialized).toContain("a\\|b");
      expect(reparsed.toJSON()).toEqual(doc.toJSON());
    });
  });
}

describe("Tauri table context menu", () => {
  it("deletes the rendered table rather than comparing against its wrapper", () => {
    const doc = appMarkdownToDoc(
      "| A | B |\n| --- | --- |\n| C | D |\n",
      appSchema
    );
    const view = viewFor(EditorState.create({
      doc,
      selection: cursorInCell(doc, 0),
      plugins: [buildTableControlsPlugin()],
    }));
    const cell = view.dom.querySelector("th");
    if (!cell) throw new Error("Expected a rendered header cell");

    cell.dispatchEvent(new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX: 10,
      clientY: 10,
    }));
    const deleteButton = [...document.querySelectorAll<HTMLButtonElement>(".table-ctx-item")]
      .find((button) => button.textContent === "Delete table");
    if (!deleteButton) throw new Error("Delete table action was not rendered");
    deleteButton.dispatchEvent(new MouseEvent("mousedown", {
      bubbles: true,
      cancelable: true,
      button: 0,
    }));

    expect(countNodes(view.state.doc, "table")).toBe(0);
    expect(view.state.doc.firstChild?.type.name).toBe("paragraph");
  });
});
