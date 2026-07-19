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
  joinForward,
  selectNodeForward,
  deleteSelection,
} from "prosemirror-commands";
import {
  splitListItem,
  liftListItem,
} from "prosemirror-schema-list";
import { goToNextCell } from "prosemirror-tables";
import { schema } from "../schema";
import { EditorState, TextSelection, Transaction } from "prosemirror-state";
import { deleteTableWithSecondPress } from "./tableControls";

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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const allMatches: Array<{ start: number; end: number; makeNode: () => any }> = [];

  // Inline math: $...$
  const MATH_RE = /\$([^$\n]+)\$/g;
  let m: RegExpExecArray | null;
  while ((m = MATH_RE.exec(fullText)) !== null) {
    const math = m[1];
    const start = m.index, end = m.index + m[0].length;
    allMatches.push({ start, end, makeNode: () => schema.nodes.math_inline.create({ math }) });
  }

  // Markdown links: [text](url) — negative lookbehind prevents matching inside ![alt](url)
  const LINK_RE = /(?<!!)\[([^\[\]]+)\]\(([^)]+)\)/g;
  while ((m = LINK_RE.exec(fullText)) !== null) {
    const linkText = m[1], href = m[2].trim();
    const start = m.index, end = m.index + m[0].length;
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
const enterForMarkdownBlocks: Command = (state, dispatch) => {
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

  // "---" at the very top of the document → YAML frontmatter banner.
  // (Anywhere else "---" stays an ordinary thematic break.) The schema only
  // allows frontmatter as the doc's first child, so this is gated on nodeStart 0.
  //
  // macOS "smart dashes" rewrites a typed "---" to an em dash ("—") and "--" to
  // an en dash ("–"), so normalize those back to plain dashes before matching,
  // otherwise the trigger never fires for real typing.
  const dashNormalized = text.replace(/—/g, "---").replace(/–/g, "--");
  if (nodeStart === 0 && dashNormalized === "---") {
    if (dispatch) {
      const template = "title: \ntags: \n";
      const fmNode = schema.nodes.frontmatter.create(null, schema.text(template));
      // Keep the doc valid ("frontmatter? block+"): if nothing follows the
      // paragraph we're replacing, add a trailing empty paragraph in the same step.
      const hasFollowing = nodeStart + node.nodeSize < state.doc.content.size;
      const repl = hasFollowing
        ? [fmNode]
        : [fmNode, schema.nodes.paragraph.create()];
      const tr = state.tr.replaceWith(nodeStart, nodeStart + node.nodeSize, repl);
      // Drop the caret right after "title: " inside the YAML source.
      const caret = nodeStart + 1 + "title: ".length;
      tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(caret, tr.doc.content.size))));
      dispatch(tr.scrollIntoView());
    }
    return true;
  }

  // ``` or ```lang → fenced code block
  const codeMatch = text.match(/^```([a-zA-Z0-9_-]*)$/);
  if (codeMatch) {
    if (dispatch) {
      const language = (codeMatch[1] || "").toLowerCase();
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
const enterInTableCell: Command = (state, dispatch) => {
  const { $head, empty } = state.selection;
  if (!empty) return false;
  for (let d = $head.depth; d > 0; d--) {
    const name = $head.node(d).type.name;
    if (name === "table_cell" || name === "table_header") {
      if (dispatch) {
        dispatch(
          state.tr.replaceSelectionWith(schema.nodes.hard_break.create()).scrollIntoView()
        );
      }
      return true;
    }
    if (name === "doc") break;
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

// When the cursor sits inside an empty code block, Backspace/Delete removes the
// whole block (ProseMirror's default keeps the empty, `defining` code block alive).
const deleteEmptyCodeBlock: Command = (state, dispatch) => {
  const { $head, empty } = state.selection;
  if (!empty) return false;
  if ($head.parent.type !== schema.nodes.code_block) return false;
  if ($head.parent.textContent.length > 0) return false;

  if (dispatch) {
    const depth = $head.depth;
    const from = $head.before(depth);
    const to = $head.after(depth);
    const tr = state.tr;
    // If the code block is the only block in the document, swap it for an empty
    // paragraph so the doc stays valid; otherwise delete it and merge upward.
    if (state.doc.childCount === 1 && depth === 1) {
      tr.replaceWith(from, to, schema.nodes.paragraph.create());
      tr.setSelection(TextSelection.near(tr.doc.resolve(from + 1)));
    } else {
      tr.delete(from, to);
      const pos = Math.min(Math.max(0, from - 1), tr.doc.content.size);
      tr.setSelection(TextSelection.near(tr.doc.resolve(pos), -1));
    }
    dispatch(tr.scrollIntoView());
  }
  return true;
};

// When the cursor sits inside an empty frontmatter block, Backspace/Delete
// removes the whole banner (it's the doc's first child, so deleting it leaves
// the following block as the new top — still valid).
const deleteEmptyFrontmatter: Command = (state, dispatch) => {
  const { $head, empty } = state.selection;
  if (!empty) return false;
  if ($head.parent.type !== schema.nodes.frontmatter) return false;
  if ($head.parent.textContent.length > 0) return false;

  if (dispatch) {
    const depth = $head.depth;
    const from = $head.before(depth);
    const to = $head.after(depth);
    const tr = state.tr.delete(from, to);
    tr.setSelection(
      TextSelection.near(tr.doc.resolve(Math.min(from, tr.doc.content.size)), 1)
    );
    dispatch(tr.scrollIntoView());
  }
  return true;
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

  // Enter: table cells first (hard break), then markdown triggers, then list split
  keys["Enter"] = chainCommands(
    enterInTableCell,
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

    // Inside a code_block (or frontmatter): only exit when on the last line
    if (
      parent.type === schema.nodes.code_block ||
      parent.type === schema.nodes.frontmatter
    ) {
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
    deleteTableWithSecondPress,
    deleteEmptyFrontmatter,
    deleteEmptyCodeBlock,
    deleteSelection,
    joinBackward,
    selectNodeBackward
  );

  // Delete (forward delete) — also removes an empty code block under the cursor
  keys["Delete"] = chainCommands(
    deleteTableWithSecondPress,
    deleteEmptyFrontmatter,
    deleteEmptyCodeBlock,
    deleteSelection,
    joinForward,
    selectNodeForward
  );

  return keymap(keys);
}
