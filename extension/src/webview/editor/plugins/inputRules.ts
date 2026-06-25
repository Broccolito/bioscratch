import { inputRules, InputRule, wrappingInputRule, textblockTypeInputRule } from "prosemirror-inputrules";
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
  /^\s*[-*]\s$/,
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
  (match) => ({ language: match[1] || "" })
);

// Task list: "- [ ] " or "- [x] "
const taskListRule = new InputRule(
  /^\s*-\s\[([x ])\]\s$/,
  (state, match, start, end) => {
    const checked = match[1] === "x";
    const { tr } = state;
    const $start = state.doc.resolve(start);

    const range = $start.blockRange();
    if (!range) return null;

    const para = schema.nodes.paragraph.create();
    const item = schema.nodes.task_list_item.create({ checked }, [para]);
    const listNode = schema.nodes.bullet_list.create(null, [item]);

    tr.replaceWith(range.start - 1, end, listNode);
    return tr;
  }
);

// Horizontal rule: "---" + space
const hrRule = new InputRule(/^---\s$/, (state, _match, start, end) => {
  const { tr } = state;
  const $start = state.doc.resolve(start);
  const range = $start.blockRange();
  if (!range) return null;
  tr.replaceWith(range.start - 1, end, schema.nodes.horizontal_rule.create());
  return tr;
});

// Inline math is handled by the Enter key (see keymap.ts).
// No immediate conversion on closing $, letting the user complete the expression first.

// Markdown link: [text](url) — converts as soon as any character is typed after the closing )
// Negative lookbehind (?<!!) prevents matching inside image syntax ![alt](url)
const linkRule = new InputRule(
  /(?<!!)\[([^\[\]]+)\]\(([^)]+)\)(.)$/,
  (state, match, start, end) => {
    const [, linkText, href, trailing] = match;
    const { tr } = state;
    const mark = schema.marks.link.create({ href: href.trim() });
    tr.replaceWith(start, end, [schema.text(linkText, [mark]), schema.text(trailing)]);
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
      bulletListRule,
      orderedListRule,
      codeBlockRule,
      taskListRule,
      hrRule,
      linkRule,
    ],
  });
}
