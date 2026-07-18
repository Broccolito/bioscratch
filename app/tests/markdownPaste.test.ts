import assert from "node:assert/strict";
import { test } from "node:test";
import { Fragment, Slice, type Mark } from "prosemirror-model";
import { EditorState, TextSelection } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import { buildMarkdownPastePlugin } from "../src/editor/plugins/markdownPaste";
import { schema } from "../src/editor/schema";

function markNames(marks: readonly Mark[]): string[] {
  return marks.map((mark) => mark.type.name).sort();
}

function pasteHtmlInsideMarks(
  surroundingMarkNames: string[],
  pastedMarkNames: string[] = []
) {
  const surroundingMarks = surroundingMarkNames.map((name) =>
    schema.marks[name].create()
  );
  const pastedMarks = pastedMarkNames.map((name) =>
    schema.marks[name].create()
  );
  const doc = schema.node("doc", null, [
    schema.node("paragraph", null, [schema.text("123213", surroundingMarks)]),
  ]);

  let state = EditorState.create({
    schema,
    doc,
    selection: TextSelection.create(doc, 4),
  });
  const view = {
    get state() {
      return state;
    },
    dispatch(transaction) {
      state = state.apply(transaction);
    },
  } as Pick<EditorView, "state" | "dispatch"> as EditorView;

  const defaultSlice = new Slice(
    Fragment.from(
      schema.node("paragraph", null, [schema.text("123", pastedMarks)])
    ),
    1,
    1
  );
  const clipboardData = {
    items: [],
    types: ["text/html", "text/plain"],
    getData(type: string) {
      if (type === "text/plain") return "123";
      if (type === "text/html") return '<p data-pm-slice="1 1 []">123</p>';
      return "";
    },
  };
  const event = { clipboardData } as unknown as ClipboardEvent;
  const plugin = buildMarkdownPastePlugin({ current: "markdown" });

  const handled = plugin.props.handlePaste?.(view, event, defaultSlice);
  const paragraph = state.doc.firstChild!;

  return {
    handled,
    text: paragraph.textContent,
    marksAtInsertedText: markNames(state.doc.resolve(5).marks()),
  };
}

test("rich-text paste inherits surrounding inline marks", () => {
  const cases = [
    { surrounding: ["code"], pasted: [], expected: ["code"] },
    {
      surrounding: ["bold", "italic", "strikethrough"],
      pasted: [],
      expected: ["bold", "italic", "strikethrough"],
    },
    {
      surrounding: ["italic", "strikethrough"],
      pasted: ["bold"],
      expected: ["bold", "italic", "strikethrough"],
    },
  ];

  for (const { surrounding, pasted, expected } of cases) {
    const result = pasteHtmlInsideMarks(surrounding, pasted);
    assert.equal(result.handled, true);
    assert.equal(result.text, "123123213");
    assert.deepEqual(result.marksAtInsertedText, expected.slice().sort());
  }
});
