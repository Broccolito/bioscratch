import { Schema } from "prosemirror-model";
import { tableNodes } from "prosemirror-tables";

const tableNodeSpecs = tableNodes({
  tableGroup: "block",
  cellContent: "block+",
  cellAttributes: {},
});

export const schema = new Schema({
  nodes: {
    doc: {
      content: "block+",
    },

    paragraph: {
      group: "block",
      content: "inline*",
      parseDOM: [{ tag: "p" }],
      toDOM() {
        return ["p", 0];
      },
    },

    heading: {
      attrs: { level: { default: 1 } },
      content: "inline*",
      group: "block",
      defining: true,
      parseDOM: [
        { tag: "h1", attrs: { level: 1 } },
        { tag: "h2", attrs: { level: 2 } },
        { tag: "h3", attrs: { level: 3 } },
        { tag: "h4", attrs: { level: 4 } },
        { tag: "h5", attrs: { level: 5 } },
        { tag: "h6", attrs: { level: 6 } },
      ],
      toDOM(node) {
        return ["h" + node.attrs.level, 0];
      },
    },

    blockquote: {
      content: "block+",
      group: "block",
      defining: true,
      parseDOM: [{ tag: "blockquote" }],
      toDOM() {
        return ["blockquote", 0];
      },
    },

    bullet_list: {
      group: "block",
      content: "list_item+",
      parseDOM: [{ tag: "ul" }],
      toDOM() {
        return ["ul", 0];
      },
    },

    ordered_list: {
      group: "block",
      content: "list_item+",
      attrs: { order: { default: 1 } },
      parseDOM: [
        {
          tag: "ol",
          getAttrs(dom) {
            const el = dom as HTMLElement;
            return { order: el.hasAttribute("start") ? +el.getAttribute("start")! : 1 };
          },
        },
      ],
      toDOM(node) {
        return node.attrs.order === 1
          ? ["ol", 0]
          : ["ol", { start: node.attrs.order }, 0];
      },
    },

    list_item: {
      content: "paragraph block*",
      parseDOM: [{ tag: "li" }],
      toDOM() {
        return ["li", 0];
      },
      defining: true,
    },

    task_list_item: {
      attrs: { checked: { default: false } },
      content: "paragraph block*",
      parseDOM: [
        {
          tag: "li[data-task]",
          getAttrs(dom) {
            const el = dom as HTMLElement;
            return { checked: el.getAttribute("data-checked") === "true" };
          },
        },
      ],
      toDOM(node) {
        return [
          "li",
          { "data-task": "", "data-checked": node.attrs.checked ? "true" : "false" },
          0,
        ];
      },
      defining: true,
    },

    code_block: {
      content: "text*",
      marks: "",
      group: "block",
      code: true,
      defining: true,
      attrs: { language: { default: "" } },
      parseDOM: [
        {
          tag: "pre",
          preserveWhitespace: "full",
          getAttrs(dom) {
            const el = dom as HTMLElement;
            const code = el.querySelector("code");
            const lang = code?.className.replace("language-", "") || "";
            return { language: lang };
          },
        },
      ],
      toDOM(node) {
        return [
          "pre",
          ["code", { class: node.attrs.language ? `language-${node.attrs.language}` : "" }, 0],
        ];
      },
    },

    image: {
      inline: true,
      attrs: {
        src: {},
        alt: { default: null },
        title: { default: null },
        width: { default: null },
        height: { default: null },
      },
      group: "inline",
      draggable: true,
      parseDOM: [
        {
          tag: "img[src]",
          getAttrs(dom) {
            const el = dom as HTMLElement;
            return {
              src: el.getAttribute("src"),
              alt: el.getAttribute("alt"),
              title: el.getAttribute("title"),
              width: el.getAttribute("width"),
              height: el.getAttribute("height"),
            };
          },
        },
      ],
      toDOM(node) {
        const { src, alt, title, width, height } = node.attrs;
        const attrs: Record<string, string> = { src };
        if (alt) attrs.alt = alt;
        if (title) attrs.title = title;
        if (width) attrs.width = width;
        if (height) attrs.height = height;
        return ["img", attrs];
      },
    },

    math_inline: {
      group: "inline",
      inline: true,
      atom: true,
      attrs: { math: { default: "" } },
      parseDOM: [
        {
          tag: "span[data-math-inline]",
          getAttrs(dom) {
            return { math: (dom as HTMLElement).getAttribute("data-math-inline") || "" };
          },
        },
      ],
      toDOM(node) {
        return [
          "span",
          { "data-math-inline": node.attrs.math },
          node.attrs.math,
        ];
      },
    },

    math_block: {
      group: "block",
      atom: true,
      attrs: { math: { default: "" } },
      parseDOM: [
        {
          tag: "div[data-math-block]",
          getAttrs(dom) {
            return { math: (dom as HTMLElement).getAttribute("data-math-block") || "" };
          },
        },
      ],
      toDOM(node) {
        return [
          "div",
          { "data-math-block": node.attrs.math },
          node.attrs.math,
        ];
      },
    },

    hard_break: {
      inline: true,
      group: "inline",
      selectable: false,
      parseDOM: [{ tag: "br" }],
      toDOM() {
        return ["br"];
      },
    },

    horizontal_rule: {
      group: "block",
      parseDOM: [{ tag: "hr" }],
      toDOM() {
        return ["hr"];
      },
    },

    text: {
      group: "inline",
    },

    ...tableNodeSpecs,
  },

  marks: {
    bold: {
      parseDOM: [
        { tag: "strong" },
        { tag: "b", getAttrs: (node) => (node as HTMLElement).style.fontWeight !== "normal" && null },
        {
          style: "font-weight",
          getAttrs: (value) => /^(bold(er)?|[5-9]\d{2,})$/.test(value as string) && null,
        },
      ],
      toDOM() {
        return ["strong", 0];
      },
    },

    italic: {
      parseDOM: [
        { tag: "em" },
        { tag: "i", getAttrs: (node) => (node as HTMLElement).style.fontStyle !== "normal" && null },
        { style: "font-style=italic" },
      ],
      toDOM() {
        return ["em", 0];
      },
    },

    code: {
      parseDOM: [{ tag: "code" }],
      toDOM() {
        return ["code", 0];
      },
    },

    link: {
      attrs: {
        href: {},
        title: { default: null },
      },
      inclusive: false,
      parseDOM: [
        {
          tag: "a[href]",
          getAttrs(dom) {
            return {
              href: (dom as HTMLElement).getAttribute("href"),
              title: (dom as HTMLElement).getAttribute("title"),
            };
          },
        },
      ],
      toDOM(node) {
        const { href, title } = node.attrs;
        const attrs: Record<string, string> = { href };
        if (title) attrs.title = title;
        return ["a", attrs, 0];
      },
    },

    strikethrough: {
      parseDOM: [
        { tag: "s" },
        { tag: "del" },
        { tag: "strike" },
        { style: "text-decoration=line-through" },
      ],
      toDOM() {
        return ["s", 0];
      },
    },
  },
});

export type JSchema = typeof schema;
