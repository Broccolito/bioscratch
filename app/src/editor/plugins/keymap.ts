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
} from "prosemirror-schema-list";
import { goToNextCell } from "prosemirror-tables";
import { schema } from "../schema";
import { EditorState, TextSelection, Transaction } from "prosemirror-state";

type Command = (state: EditorState, dispatch?: (tr: Transaction) => void) => boolean;

function isMac(): boolean {
  return typeof navigator !== "undefined" && /Mac/.test(navigator.platform);
}

// Convert any $...$ patterns in the given paragraph to math_inline nodes.
// Returns a transaction if any conversions were made, null otherwise.
function convertInlineMathInNode(state: EditorState, nodePos: number): Transaction | null {
  const node = state.doc.nodeAt(nodePos);
  if (!node || node.type !== schema.nodes.paragraph) return null;

  const MATH_RE = /\$([^$\n]+)\$/g;
  // Collect all text runs in the paragraph with their offsets
  const textParts: Array<{ text: string; offset: number }> = [];
  let offset = 0;
  node.forEach((child) => {
    if (child.isText) {
      textParts.push({ text: child.text!, offset });
    }
    offset += child.nodeSize;
  });

  // Find all $...$ matches in the full text
  const fullText = node.textContent;
  const matches: Array<{ start: number; end: number; math: string }> = [];
  let m: RegExpExecArray | null;
  while ((m = MATH_RE.exec(fullText)) !== null) {
    matches.push({ start: m.index, end: m.index + m[0].length, math: m[1] });
  }
  if (matches.length === 0) return null;

  // Apply replacements right-to-left to preserve positions
  let tr = state.tr;
  for (let i = matches.length - 1; i >= 0; i--) {
    const { start, end, math } = matches[i];
    // +1 because nodePos points to the node start token, content starts at nodePos+1
    const from = nodePos + 1 + start;
    const to = nodePos + 1 + end;
    tr = tr.replaceWith(from, to, schema.nodes.math_inline.create({ math }));
  }
  return tr;
}

// On Enter: first convert any $...$ in the current paragraph to math_inline,
// then check for block-level triggers (```, $$).
const enterForMarkdownBlocks: Command = (state, dispatch) => {
  const { $head, empty } = state.selection;
  if (!empty) return false;

  const node = $head.parent;
  if (node.type !== schema.nodes.paragraph) return false;

  const nodeStart = $head.before();
  const text = node.textContent;

  // Convert any $...$ in the paragraph to math_inline first.
  // Do this regardless of cursor position.
  // Only convert and stop here if there were math patterns but the line
  // is NOT a block trigger — in that case let the normal Enter proceed.
  const mathTr = convertInlineMathInNode(state, nodeStart);
  const MATH_RE = /\$([^$\n]+)\$/;
  const hasInlineMath = MATH_RE.test(text);

  // cursor must be at the end of the paragraph for block-level triggers
  if ($head.parentOffset !== text.length) {
    // If there's inline math to convert, apply conversion but don't consume Enter
    if (mathTr && hasInlineMath) {
      if (dispatch) dispatch(mathTr);
      return false; // let Enter proceed to split the block
    }
    return false;
  }

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

  // $$ or $$content$$ → block math node
  // "$$" alone: empty math block (NodeView will open textarea)
  // "$$content$$": pre-fill math content
  if (text === "$$" || (text.startsWith("$$") && text.endsWith("$$") && text.length > 4)) {
    if (dispatch) {
      const mathContent = text.length > 4 ? text.slice(2, -2).trim() : "";
      const mathBlock = schema.nodes.math_block.create({ math: mathContent });
      const tr = state.tr.replaceWith(nodeStart, nodeStart + node.nodeSize, mathBlock);
      dispatch(tr.scrollIntoView());
    }
    return true;
  }

  // No block trigger matched — apply any inline $...$ conversions and let
  // the normal Enter (splitBlock) handle the rest.
  if (mathTr && hasInlineMath) {
    if (dispatch) dispatch(mathTr);
    return false; // return false so Enter continues to splitBlock
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

  keys["Tab"] = (state, dispatch) => {
    if (dispatch) dispatch(state.tr.insertText("\t").scrollIntoView());
    return true;
  };

  keys["Shift-Tab"] = chainCommands(
    liftListItem(schema.nodes.list_item),
    goToNextCell(-1)
  );

  // ArrowDown at last line of code_block or math_block: insert paragraph after and move there
  const exitBlockDown: Command = (state, dispatch) => {
    const { $head, empty } = state.selection;
    if (!empty) return false;

    const parent = $head.parent;
    const grandParent = $head.node($head.depth - 1);

    // Inside a code_block: only exit when on the last line
    if (parent.type === schema.nodes.code_block) {
      const text = parent.textContent;
      const offset = $head.parentOffset;
      const afterCursor = text.slice(offset);
      // If there's another newline after the cursor, let normal navigation handle it
      if (afterCursor.includes("\n")) return false;
      if (dispatch) {
        const after = $head.after($head.depth); // position after the code_block
        const tr = state.tr;
        // Insert a paragraph after the code block if nothing follows
        const docEnd = state.doc.content.size;
        if (after >= docEnd) {
          tr.insert(after, schema.nodes.paragraph.create());
        }
        tr.setSelection(TextSelection.near(tr.doc.resolve(after + 1)));
        dispatch(tr.scrollIntoView());
      }
      return true;
    }

    // Inside a math_block (atom node): always exit down
    if (
      grandParent &&
      (grandParent.type === schema.nodes.math_block ||
        parent.type === schema.nodes.math_block)
    ) {
      const blockDepth = parent.type === schema.nodes.math_block
        ? $head.depth
        : $head.depth - 1;
      if (dispatch) {
        const after = $head.after(blockDepth);
        const tr = state.tr;
        const docEnd = state.doc.content.size;
        if (after >= docEnd) {
          tr.insert(after, schema.nodes.paragraph.create());
        }
        tr.setSelection(TextSelection.near(tr.doc.resolve(after + 1)));
        dispatch(tr.scrollIntoView());
      }
      return true;
    }

    return false;
  };

  keys["ArrowDown"] = exitBlockDown;

  // Backspace
  keys["Backspace"] = chainCommands(
    deleteSelection,
    joinBackward,
    selectNodeBackward
  );

  return keymap(keys);
}
