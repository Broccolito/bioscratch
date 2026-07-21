import { inputRules, InputRule, wrappingInputRule, textblockTypeInputRule } from "prosemirror-inputrules";
import { EditorState, TextSelection } from "prosemirror-state";
import { MarkType } from "prosemirror-model";
import { schema } from "../schema";

// Heading input rules: # , ## , etc.
function headingRule(level: number) {
  return textblockTypeInputRule(
    new RegExp(`^(#{${level}})\\s$`),
    schema.nodes.heading,
    () => ({ level })
  );
}

// Blockquote: "> "
const blockquoteRule = wrappingInputRule(
  /^\s*>\s$/,
  schema.nodes.blockquote
);

// Bullet list: "- " or "* "
const bulletListRule = wrappingInputRule(
  /^\s*[-*+]\s$/,
  schema.nodes.bullet_list
);

// Ordered list: "1. " or "1) "
const orderedListRule = wrappingInputRule(
  /^(\d+)[.)]\s$/,
  schema.nodes.ordered_list,
  (match) => ({ order: +match[1] }),
  (match, node) => node.childCount + node.attrs.order === +match[1]
);

// Code block: ```lang<space> — also handles plain ``` followed by space
const codeBlockRule = textblockTypeInputRule(
  /^```([a-zA-Z0-9_-]*)\s$/,
  schema.nodes.code_block,
  (match) => ({ language: (match[1] || "").toLowerCase() })
);

// Task list: "- [ ] " or "- [x] " typed all at once (e.g. via paste-then-type).
// During normal typing the bullet rule fires first on "- ", so the in-list rule
// below handles converting an existing bullet item into a task item.
const taskListRule = new InputRule(
  /^\s*-\s\[([ xX])\]\s$/,
  (state, match, start, end) => {
    const checked = match[1].toLowerCase() === "x";
    const { tr } = state;
    const $start = state.doc.resolve(start);
    const range = $start.blockRange();
    if (!range) return null;
    const para = schema.nodes.paragraph.create();
    const item = schema.nodes.task_list_item.create({ checked }, [para]);
    const listNode = schema.nodes.bullet_list.create(null, [item]);
    tr.replaceWith(range.start, end, listNode);
    return tr;
  }
);

// Convert an existing bullet list item into a task item when "[ ] " / "[x] "
// is typed at its start.
const taskInListRule = new InputRule(
  /^\[([ xX])\]\s$/,
  (state, match, start, end) => {
    const $start = state.doc.resolve(start);
    if ($start.depth < 2) return null;
    const itemDepth = $start.depth - 1;
    const itemNode = $start.node(itemDepth);
    if (itemNode.type !== schema.nodes.list_item) return null;
    if ($start.index(itemDepth) !== 0) return null;
    const checked = match[1].toLowerCase() === "x";
    const itemPos = $start.before(itemDepth);
    const tr = state.tr.delete(start, end);
    tr.setNodeMarkup(itemPos, schema.nodes.task_list_item, { checked });
    return tr;
  }
);

// Horizontal rule: "---" + space. Leave a paragraph after it for the caret.
const hrRule = new InputRule(/^(?:---|\*\*\*|___)\s$/, (state, _match, start) => {
  const $start = state.doc.resolve(start);
  const range = $start.blockRange();
  if (!range) return null;
  const hr = schema.nodes.horizontal_rule.create();
  const para = schema.nodes.paragraph.create();
  const tr = state.tr.replaceWith(range.start, range.end, [hr, para]);
  const caret = tr.doc.resolve(range.start + hr.nodeSize + 1);
  return tr.setSelection(TextSelection.near(caret));
});

// ---- Inline mark input rules (live conversion) ---------------------------

function hasUnclosedBacktickBefore(state: EditorState, start: number): boolean {
  const $start = state.doc.resolve(start);
  const prefix = $start.parent.textBetween(0, $start.parentOffset, "", "");
  let count = 0;
  for (let index = 0; index < prefix.length; index += 1) {
    if (prefix[index] === "`" && (index === 0 || prefix[index - 1] !== "\\")) {
      count += 1;
    }
  }
  return count % 2 === 1;
}

function markInputRule(regexp: RegExp, markType: MarkType) {
  return new InputRule(regexp, (state, match, start, end) => {
    const $start = state.doc.resolve(start);
    if ($start.parent.type.spec.code) return null;
    if (markType !== schema.marks.code && hasUnclosedBacktickBefore(state, start)) {
      return null;
    }

    const captured = match[match.length - 1];
    if (!captured) return null;

    const tr = state.tr;
    const textStart = start + match[0].indexOf(captured);
    const textEnd = textStart + captured.length;

    // A text-input event can contain multiple characters (IME, dictation,
    // text replacement, or automation). Pending characters are included in
    // the regex match but are not yet in `state.doc`; handle that case with an
    // atomic replacement so mark ranges never extend past the document.
    if (textEnd > end) {
      const activeMarks = state.storedMarks ?? state.selection.$from.marks();
      const outputMarks = markType.create().addToSet(activeMarks);
      tr.replaceWith(start, end, state.schema.text(captured, outputMarks));
      tr.removeStoredMark(markType);
      return tr;
    }

    if (textEnd < end) tr.delete(textEnd, end);
    if (textStart > start) tr.delete(start, textStart);
    const markEnd = start + captured.length;
    tr.addMark(start, markEnd, markType.create());
    tr.removeStoredMark(markType);
    return tr;
  });
}

const boldStarRule = markInputRule(/\*\*([^*]+)\*\*$/, schema.marks.bold);
const italicStarRule = markInputRule(/(?<!\*)\*([^*]+)\*$/, schema.marks.italic);
const boldUnderscoreRule = markInputRule(/(?<![\w_])__([^_\n]+)__$/, schema.marks.bold);
const italicUnderscoreRule = markInputRule(/(?<![\w_])_([^_\n]+)_$/, schema.marks.italic);
const codeRule = markInputRule(/`([^`]+)`$/, schema.marks.code);
const strikeRule = markInputRule(/~~([^~]+)~~$/, schema.marks.strikethrough);

// Markdown link: [text](url) — converts as soon as any character is typed after the closing )
// Negative lookbehind (?<!!) prevents matching inside image syntax ![alt](url)
const linkRule = new InputRule(
  /(?<!!)\[([^\[\]]+)\]\(([^)]+)\)(.)$/,
  (state, match, start, end) => {
    if (hasUnclosedBacktickBefore(state, start)) return null;
    const [, linkText, href, trailing] = match;
    const { tr } = state;
    const mark = schema.marks.link.create({ href: href.trim() });
    tr.replaceWith(start, end, [schema.text(linkText, [mark]), schema.text(trailing)]);
    return tr;
  }
);

const mathInlineRule = new InputRule(
  /(?<![$\\])\$([^$\n]+)\$(.)$/,
  (state, match, start, end) => {
    if (hasUnclosedBacktickBefore(state, start)) return null;
    const [, math, trailing] = match;
    const { tr } = state;
    tr.replaceWith(start, end, [
      schema.nodes.math_inline.create({ math }),
      schema.text(trailing),
    ]);
    return tr;
  }
);

export function buildInputRules() {
  return inputRules({
    rules: [
      headingRule(1),
      headingRule(2),
      headingRule(3),
      headingRule(4),
      headingRule(5),
      headingRule(6),
      blockquoteRule,
      taskListRule,
      bulletListRule,
      orderedListRule,
      codeBlockRule,
      taskInListRule,
      hrRule,
      boldStarRule,
      italicStarRule,
      boldUnderscoreRule,
      italicUnderscoreRule,
      codeRule,
      strikeRule,
      linkRule,
      mathInlineRule,
    ],
  });
}
