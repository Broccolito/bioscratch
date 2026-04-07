import { Plugin, PluginKey, TextSelection, EditorState, Transaction } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import { Node as ProseMirrorNode } from "prosemirror-model";

export interface SearchState {
  query: string;
  matches: Array<{ from: number; to: number }>;
  currentIndex: number;
}

export const searchPluginKey = new PluginKey<SearchState>("search");

export function buildSearchPlugin(): Plugin<SearchState> {
  return new Plugin<SearchState>({
    key: searchPluginKey,

    state: {
      init(): SearchState {
        return { query: "", matches: [], currentIndex: 0 };
      },

      apply(tr, prev): SearchState {
        const meta = tr.getMeta(searchPluginKey);
        if (meta !== undefined) {
          return meta as SearchState;
        }
        if (tr.docChanged) {
          // Recalculate matches for changed document
          if (prev.query) {
            const matches = findMatches(tr.doc, prev.query);
            return { ...prev, matches, currentIndex: 0 };
          }
        }
        return prev;
      },
    },

    props: {
      decorations(state) {
        const search = searchPluginKey.getState(state);
        if (!search || !search.query || search.matches.length === 0) {
          return DecorationSet.empty;
        }

        const decos = search.matches.map((match, i) =>
          Decoration.inline(match.from, match.to, {
            class:
              i === search.currentIndex
                ? "search-highlight search-highlight-current"
                : "search-highlight",
          })
        );

        return DecorationSet.create(state.doc, decos);
      },
    },
  });
}

function findMatches(
  doc: ProseMirrorNode,
  query: string
): Array<{ from: number; to: number }> {
  if (!query) return [];

  const results: Array<{ from: number; to: number }> = [];
  const lowerQuery = query.toLowerCase();

  doc.descendants((node, pos) => {
    if (!node.isText) return true;
    const text = node.text?.toLowerCase() || "";
    let idx = 0;
    while ((idx = text.indexOf(lowerQuery, idx)) !== -1) {
      results.push({ from: pos + idx, to: pos + idx + query.length });
      idx += query.length;
    }
    return false;
  });

  return results;
}

export function setSearch(
  query: string,
  state: EditorState,
  dispatch: (tr: Transaction) => void
) {
  const matches = query ? findMatches(state.doc, query) : [];
  const newSearchState: SearchState = {
    query,
    matches,
    currentIndex: 0,
  };
  const tr = state.tr.setMeta(searchPluginKey, newSearchState);
  dispatch(tr);
  return newSearchState;
}

export function navigateSearch(
  direction: 1 | -1,
  state: EditorState,
  dispatch: (tr: Transaction) => void
) {
  const prev = searchPluginKey.getState(state);
  if (!prev || prev.matches.length === 0) return;

  let newIndex =
    (prev.currentIndex + direction + prev.matches.length) % prev.matches.length;

  const newSearchState: SearchState = { ...prev, currentIndex: newIndex };
  const tr = state.tr.setMeta(searchPluginKey, newSearchState);
  dispatch(tr);

  // Scroll to match
  const match = prev.matches[newIndex];
  if (match) {
    const selTr = state.tr.setSelection(
      TextSelection.create(state.doc, match.from)
    );
    dispatch(selTr);
  }
}
