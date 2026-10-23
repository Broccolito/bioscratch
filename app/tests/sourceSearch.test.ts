import { describe, expect, it } from "vitest";
import { EditorState } from "prosemirror-state";
import { schema } from "../src/editor/schema";
import { markdownSearchTarget, markdownToDoc } from "../src/editor/serialization/markdownImport";
import { buildSearchPlugin, navigateSearch, searchPluginKey, setSearch } from "../src/editor/plugins/search";

function search(markdown: string, query = "needle") {
  let state = EditorState.create({ doc: markdownToDoc(markdown, schema), plugins: [buildSearchPlugin()] });
  const found = setSearch(query, state, tr => { state = state.apply(tr); });
  return { state, found };
}

describe("folder search source-line navigation", () => {
  it("does not count hidden link URLs before visible hits", () => {
    const markdown = "[link](https://example.com/needle)\n\nneedle first\n\nneedle second";
    const { state, found } = search(markdown);
    expect(found.matches).toHaveLength(2);
    expect(markdownSearchTarget(markdown, "needle", 1, schema)).toEqual({ matchIndex: null, anchor: 1 });
    for (const [line, index, text] of [[3, 0, "needle first"], [5, 1, "needle second"]] as const) {
      const target = markdownSearchTarget(markdown, "needle", line, schema);
      expect(target.matchIndex).toBe(index);
      expect(state.doc.resolve(found.matches[index].from).parent.textContent).toBe(text);
    }
  });

  it("maps marked labels and reference links without counting destination definitions", () => {
    const markdown = "[ref]: https://example.com/needle\n\n[**needle label**][ref]\n\nneedle last";
    expect(markdownSearchTarget(markdown, "needle", 1, schema).matchIndex).toBeNull();
    expect(markdownSearchTarget(markdown, "needle", 3, schema).matchIndex).toBe(0);
    expect(markdownSearchTarget(markdown, "needle", 5, schema).matchIndex).toBe(1);
  });

  it("uses rendered text ordering through lists, tables, and code fences", () => {
    const markdown = [
      "[link](https://example.com/needle)", "", "- needle list", "",
      "| heading |", "| --- |", "| needle table |", "",
      "```text", "needle code", "```", "", "needle final",
    ].join("\n");
    const { state, found } = search(markdown);
    expect(found.matches).toHaveLength(4);
    for (const [line, index, text] of [
      [3, 0, "needle list"], [7, 1, "needle table"], [10, 2, "needle code"], [13, 3, "needle final"],
    ] as const) {
      expect(markdownSearchTarget(markdown, "needle", line, schema).matchIndex).toBe(index);
      expect(state.doc.resolve(found.matches[index].from).parent.textContent).toBe(text);
    }
  });

  it("opens syntax-only hits near their block without selecting an unrelated visible match", () => {
    const markdown = "needle before\n\n[link](https://example.com/needle)\n\nneedle after";
    const target = markdownSearchTarget(markdown, "needle", 3, schema);
    const { state } = search(markdown);
    expect(target.matchIndex).toBeNull();
    expect(state.doc.resolve(target.anchor).parent.textContent).toBe("link");
  });

  it("does not turn a hard-break HTML token into a visible search match", () => {
    const markdown = "first<br>second\n\nbr elsewhere";
    expect(markdownSearchTarget(markdown, "br", 1, schema).matchIndex).toBeNull();
    expect(markdownSearchTarget(markdown, "br", 3, schema).matchIndex).toBe(0);
  });

  it("navigates from an unselected syntax-only hit to the first or last visible match", () => {
    const { state: initial, found } = search("needle first\n\nneedle second");
    for (const [direction, index] of [[1, 0], [-1, 1]] as const) {
      let state = initial.apply(initial.tr.setMeta(searchPluginKey, { ...found, currentIndex: -1 }));
      navigateSearch(direction, state, tr => { state = state.apply(tr); });
      expect(searchPluginKey.getState(state)?.currentIndex).toBe(index);
      expect(state.selection.from).toBe(found.matches[index].from);
    }
  });
});
