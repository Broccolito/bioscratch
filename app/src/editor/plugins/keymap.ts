import { keymap } from "prosemirror-keymap";
import { undo, redo } from "prosemirror-history";
import {
  toggleMark,
  setBlockType,
  wrapIn,
  chainCommands,
  exitCode,
  joinBackward,
  selectNodeBackward,
  deleteSelection,
} from "prosemirror-commands";
import {
  splitListItem,
  liftListItem,
  sinkListItem,
} from "prosemirror-schema-list";
import { goToNextCell } from "prosemirror-tables";
import { schema } from "../schema";
import { EditorState, TextSelection, Transaction } from "prosemirror-state";

type Command = (state: EditorState, dispatch?: (tr: Transaction) => void) => boolean;

function isMac(): boolean {
  return typeof navigator !== "undefined" && /Mac/.test(navigator.platform);
}

// On Enter: if current paragraph text matches ``` or $$ at start of line,
// convert the paragraph to the appropriate block node.
const enterForMarkdownBlocks: Command = (state, dispatch) => {
  const { $head, empty } = state.selection;
  if (!empty) return false;

  const node = $head.parent;
  if (node.type !== schema.nodes.paragraph) return false;

  const text = node.textContent;
  // cursor must be at the end of the paragraph
  if ($head.parentOffset !== text.length) return false;

  const nodeStart = $head.before();

  // ``` or ```lang → fenced code block
  const codeMatch = text.match(/^```([a-zA-Z0-9_-]*)$/);
  if (codeMatch) {
    if (dispatch) {
      const language = codeMatch[1] || "";
      const codeBlock = schema.nodes.code_block.create({ language });
      const tr = state.tr.replaceWith(nodeStart, nodeStart + node.nodeSize, codeBlock);
      // place cursor inside the code block
      tr.setSelection(TextSelection.near(tr.doc.resolve(nodeStart + 1)));
      dispatch(tr.scrollIntoView());
    }
    return true;
  }

  // $$ → block math node
  if (text === "$$") {
    if (dispatch) {
      const mathBlock = schema.nodes.math_block.create({ math: "" });
      const tr = state.tr.replaceWith(nodeStart, nodeStart + node.nodeSize, mathBlock);
      dispatch(tr.scrollIntoView());
    }
    return true;
  }

  return false;
};

// Toggle checked state on a task_list_item when cursor is inside it.
export const toggleTaskItem: Command = (state, dispatch) => {
  const { $head } = state.selection;
  for (let depth = $head.depth; depth > 0; depth--) {
    const node = $head.node(depth);
    if (node.type === schema.nodes.task_list_item) {
      if (dispatch) {
        const pos = $head.before(depth);
        dispatch(
          state.tr.setNodeMarkup(pos, undefined, {
            ...node.attrs,
            checked: !node.attrs.checked,
          })
        );
      }
      return true;
    }
  }
  return false;
};

export function buildKeymap(
  onSave: () => void,
  onSearch: () => void
): ReturnType<typeof keymap> {
  const mod = isMac() ? "Mod" : "Ctrl";

  const keys: Record<string, Command> = {};

  // Save
  keys[`${mod}-s`] = () => {
    onSave();
    return true;
  };

  // Undo/Redo
  keys[`${mod}-z`] = undo;
  keys[`Shift-${mod}-z`] = redo;
  if (!isMac()) {
    keys[`${mod}-y`] = redo;
  }

  // Bold / Italic / Code
  keys[`${mod}-b`] = toggleMark(schema.marks.bold);
  keys[`${mod}-i`] = toggleMark(schema.marks.italic);
  keys[`${mod}-\``] = toggleMark(schema.marks.code);

  // Search
  keys[`${mod}-f`] = () => {
    onSearch();
    return true;
  };

  // Headings
  for (let i = 1; i <= 6; i++) {
    keys[`Shift-${mod}-${i}`] = setBlockType(schema.nodes.heading, { level: i });
  }

  // Paragraph
  keys[`Shift-${mod}-0`] = setBlockType(schema.nodes.paragraph);

  // Blockquote
  keys[`${mod}->`] = wrapIn(schema.nodes.blockquote);

  // Hard break inside code blocks / other atoms
  keys["Shift-Enter"] = chainCommands(exitCode, (state, dispatch) => {
    if (dispatch) {
      dispatch(
        state.tr.replaceSelectionWith(schema.nodes.hard_break.create()).scrollIntoView()
      );
    }
    return true;
  });

  // Enter: first check markdown block starters, then list item split
  keys["Enter"] = chainCommands(
    enterForMarkdownBlocks,
    splitListItem(schema.nodes.list_item),
    splitListItem(schema.nodes.task_list_item)
  );

  // Tab
  keys["Tab"] = chainCommands(
    sinkListItem(schema.nodes.list_item),
    goToNextCell(1)
  );
  keys["Shift-Tab"] = chainCommands(
    liftListItem(schema.nodes.list_item),
    goToNextCell(-1)
  );

  // Backspace
  keys["Backspace"] = chainCommands(
    deleteSelection,
    joinBackward,
    selectNodeBackward
  );

  return keymap(keys);
}
