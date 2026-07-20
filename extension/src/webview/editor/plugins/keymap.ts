import { keymap } from "prosemirror-keymap";
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
import { addRowAfter, goToNextCell } from "prosemirror-tables";
import { schema } from "../schema";
import { EditorState, TextSelection, Transaction } from "prosemirror-state";

type Command = (state: EditorState, dispatch?: (tr: Transaction) => void) => boolean;

function isMac(): boolean {
  return typeof navigator !== "undefined" && /Mac/.test(navigator.platform);
}

// Convert $...$ and [text](url) patterns in the given paragraph to their ProseMirror
// equivalents. Returns a transaction if any conversions were made, null otherwise.
function convertInlinePatternsInNode(state: EditorState, nodePos: number): Transaction | null {
  const node = state.doc.nodeAt(nodePos);
  if (!node || node.type !== schema.nodes.paragraph) return null;

  const fullText = node.textContent;
  const isCodeProtected = (start: number, end: number): boolean => {
    let hasCodeMark = false;
    node.nodesBetween(start, end, (child) => {
      if (child.isText && child.marks.some((mark) => mark.type === schema.marks.code)) {
        hasCodeMark = true;
      }
      return !hasCodeMark;
    });
    if (hasCodeMark) return true;

    let unmatchedTicks = 0;
    for (let index = 0; index < start; index += 1) {
      if (fullText[index] === "`" && (index === 0 || fullText[index - 1] !== "\\")) {
        unmatchedTicks += 1;
      }
    }
    return unmatchedTicks % 2 === 1;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const allMatches: Array<{ start: number; end: number; makeNode: () => any }> = [];

  // Inline math: $...$
  const MATH_RE = /\$([^$\n]+)\$/g;
  let m: RegExpExecArray | null;
  while ((m = MATH_RE.exec(fullText)) !== null) {
    const math = m[1];
    const start = m.index, end = m.index + m[0].length;
    if (isCodeProtected(start, end)) continue;
    allMatches.push({ start, end, makeNode: () => schema.nodes.math_inline.create({ math }) });
  }

  // Markdown links: [text](url) — negative lookbehind prevents matching inside ![alt](url)
  const LINK_RE = /(?<!!)\[([^\[\]]+)\]\(([^)]+)\)/g;
  while ((m = LINK_RE.exec(fullText)) !== null) {
    const linkText = m[1], href = m[2].trim();
    const start = m.index, end = m.index + m[0].length;
    if (isCodeProtected(start, end)) continue;
    allMatches.push({
      start, end,
      makeNode: () => schema.text(linkText, [schema.marks.link.create({ href })]),
    });
  }

  if (allMatches.length === 0) return null;

  // Process right-to-left so earlier positions stay valid; skip overlapping matches.
  allMatches.sort((a, b) => b.start - a.start);
  let lastStart = Infinity;
  let tr = state.tr;
  for (const { start, end, makeNode } of allMatches) {
    if (end > lastStart) continue; // overlaps a previously processed match
    lastStart = start;
    // +1 because nodePos points to the node start token; content starts at nodePos+1
    tr = tr.replaceWith(nodePos + 1 + start, nodePos + 1 + end, makeNode());
  }
  return tr;
}

// On Enter: first convert any $...$ and [text](url) patterns in the current paragraph,
// then check for block-level triggers (```, $$).
export const enterForMarkdownBlocks: Command = (state, dispatch) => {
  const { $head, empty } = state.selection;
  if (!empty) return false;

  const node = $head.parent;
  if (node.type !== schema.nodes.paragraph) return false;

  const nodeStart = $head.before();
  const text = node.textContent;

  // Convert any $...$ and [text](url) patterns in the paragraph.
  // Do this regardless of cursor position.
  const conversionTr = convertInlinePatternsInNode(state, nodeStart);
  const hasConversions = conversionTr !== null;

  // cursor must be at the end of the paragraph for block-level triggers
  if ($head.parentOffset !== text.length) {
    // Apply inline conversions and split at the cursor; consume Enter.
    if (hasConversions) {
      if (dispatch) {
        const tr = conversionTr!;
        tr.split(tr.mapping.map(state.selection.to));
        dispatch(tr.scrollIntoView());
      }
      return true;
    }
    return false;
  }

  if (/^(?:---|\*\*\*|___)$/.test(text)) {
    if (dispatch) {
      const hr = schema.nodes.horizontal_rule.create();
      const paragraph = schema.nodes.paragraph.create();
      const tr = state.tr.replaceWith(
        nodeStart,
        nodeStart + node.nodeSize,
        [hr, paragraph]
      );
      tr.setSelection(TextSelection.near(tr.doc.resolve(nodeStart + hr.nodeSize + 1)));
      dispatch(tr.scrollIntoView());
    }
    return true;
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

  // No block trigger matched — convert inline patterns and split the block atomically.
  if (hasConversions) {
    if (dispatch) {
      const tr = conversionTr!;
      // Map the cursor through the conversion replacements, then split there.
      tr.split(tr.mapping.map(state.selection.to));
      dispatch(tr.scrollIntoView());
    }
    return true; // consumed — conversion + split done in one transaction
  }

  return false;
};

// Inside a table cell, Enter inserts a hard break rather than splitting the paragraph.
// This keeps cell content self-contained and serialises cleanly as <br>.
export const enterInTableCell: Command = (state, dispatch) => {
  const { $head, empty } = state.selection;
  if (!empty) return false;
  let inTableCell = false;
  for (let d = $head.depth; d > 0; d--) {
    const name = $head.node(d).type.name;
    if (name === "table_cell" || name === "table_header") {
      inTableCell = true;
      break;
    }
    if (name === "doc") break;
  }
  if (!inTableCell) return false;

  if (dispatch) {
    const nodeStart = $head.parent.type === schema.nodes.paragraph
      ? $head.before()
      : -1;
    const tr = nodeStart >= 0
      ? convertInlinePatternsInNode(state, nodeStart) ?? state.tr
      : state.tr;
    dispatch(
      tr.replaceSelectionWith(schema.nodes.hard_break.create()).scrollIntoView()
    );
  }
  return true;
};

export function moveTableCell(direction: 1 | -1): Command {
  return (state, dispatch) => {
    if (goToNextCell(direction)(state, dispatch)) return true;

    const { $head } = state.selection;
    let tableDepth = -1;
    for (let depth = $head.depth; depth > 0; depth -= 1) {
      if ($head.node(depth).type.spec.tableRole === "table") {
        tableDepth = depth;
        break;
      }
    }
    if (tableDepth < 0) return false;
    if (direction === -1) return true;

    if (dispatch) {
      const tablePos = $head.before(tableDepth);
      let rowTr: Transaction | null = null;
      addRowAfter(state, (tr) => { rowTr = tr; });
      if (rowTr) {
        const tr = rowTr as Transaction;
        const table = tr.doc.nodeAt(tablePos);
        if (table?.type.spec.tableRole === "table" && table.childCount > 0) {
          let firstCellPos = tablePos + 1;
          for (let row = 0; row < table.childCount - 1; row += 1) {
            firstCellPos += table.child(row).nodeSize;
          }
          firstCellPos += 1;
          tr.setSelection(
            TextSelection.near(tr.doc.resolve(firstCellPos + 1), 1)
          );
        }
        dispatch(tr.scrollIntoView());
      }
    }
    return true;
  };
}

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
  onSearch: () => void,
  onUndo: () => void,
  onRedo: () => void
): ReturnType<typeof keymap> {
  const mod = isMac() ? "Mod" : "Ctrl";

  const keys: Record<string, Command> = {};

  // Save
  keys[`${mod}-s`] = () => {
    onSave();
    return true;
  };

  // Undo/Redo are owned by VS Code: intercept the keystroke, consume it so the
  // webview's contentEditable does not run a native (out-of-sync) undo, and ask
  // the extension host to run VS Code's `undo`/`redo` command against the
  // underlying TextDocument. The resulting document change flows back as an
  // `update` message and re-hydrates the editor.
  keys[`${mod}-z`] = () => { onUndo(); return true; };
  keys[`Shift-${mod}-z`] = () => { onRedo(); return true; };
  if (!isMac()) {
    keys[`${mod}-y`] = () => { onRedo(); return true; };
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

  // Enter: table cells first (hard break), then markdown triggers, then list split
  keys["Enter"] = chainCommands(
    enterInTableCell,
    enterForMarkdownBlocks,
    splitListItem(schema.nodes.list_item),
    splitListItem(schema.nodes.task_list_item)
  );

  // Keep list/table keyboard behavior aligned with the desktop editor.
  keys["Tab"] = chainCommands(
    sinkListItem(schema.nodes.list_item),
    sinkListItem(schema.nodes.task_list_item),
    moveTableCell(1),
    (state, dispatch) => {
      const { $head } = state.selection;
      for (let depth = $head.depth; depth > 0; depth--) {
        const type = $head.node(depth).type;
        if (type === schema.nodes.list_item || type === schema.nodes.task_list_item) {
          return true;
        }
      }
      if (dispatch) dispatch(state.tr.insertText("\t").scrollIntoView());
      return true;
    }
  );

  keys["Shift-Tab"] = chainCommands(
    liftListItem(schema.nodes.list_item),
    liftListItem(schema.nodes.task_list_item),
    moveTableCell(-1)
  );

  // ArrowUp at first line of code_block or math_block: insert paragraph before and move there
  const exitBlockUp: Command = (state, dispatch) => {
    const { $head, empty } = state.selection;
    if (!empty) return false;

    const parent = $head.parent;
    const grandParent = $head.node($head.depth - 1);

    if (parent.type === schema.nodes.code_block) {
      const text = parent.textContent;
      const offset = $head.parentOffset;
      // If there's a newline before the cursor, we're not on the first line
      if (text.slice(0, offset).includes("\n")) return false;
      if (dispatch) {
        const before = $head.before($head.depth);
        const tr = state.tr;
        if (before === 0) {
          tr.insert(0, schema.nodes.paragraph.create());
          tr.setSelection(TextSelection.near(tr.doc.resolve(1)));
        } else {
          tr.setSelection(TextSelection.near(state.doc.resolve(before - 1), -1));
        }
        dispatch(tr.scrollIntoView());
      }
      return true;
    }

    if (
      grandParent &&
      (grandParent.type === schema.nodes.math_block ||
        parent.type === schema.nodes.math_block)
    ) {
      const blockDepth = parent.type === schema.nodes.math_block
        ? $head.depth
        : $head.depth - 1;
      if (dispatch) {
        const before = $head.before(blockDepth);
        const tr = state.tr;
        if (before === 0) {
          tr.insert(0, schema.nodes.paragraph.create());
          tr.setSelection(TextSelection.near(tr.doc.resolve(1)));
        } else {
          tr.setSelection(TextSelection.near(state.doc.resolve(before - 1), -1));
        }
        dispatch(tr.scrollIntoView());
      }
      return true;
    }

    return false;
  };

  keys["ArrowUp"] = exitBlockUp;

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
      // Strip one trailing newline (remark adds one to code block content) before checking
      const relevantAfter = afterCursor.endsWith("\n") ? afterCursor.slice(0, -1) : afterCursor;
      if (relevantAfter.includes("\n")) return false;
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
