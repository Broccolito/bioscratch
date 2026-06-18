import { Node as ProseMirrorNode, Schema } from "prosemirror-model";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkFrontmatter from "remark-frontmatter";
import type { Root, Content, PhrasingContent, TableRow } from "mdast";

const processor = unified()
  .use(remarkParse)
  // Recognize a leading YAML frontmatter block (mdast `yaml` node) instead of a
  // thematic break + paragraphs. Two fence variants are accepted: the standard
  // "---\n…\n---", and Pandoc/MkDocs style "---\n…\n..." (closing dots).
  .use(remarkFrontmatter, [
    "yaml",
    { type: "yaml", fence: { open: "---", close: "..." }, anywhere: false },
  ])
  .use(remarkGfm)
  .use(remarkMath);

type MdastNode = Content | Root | PhrasingContent;

// Link/image reference definitions ([id]: url "title"), collected up-front so
// reference-style links/images can be resolved to real links during conversion.
let currentDefinitions: Record<string, { url: string; title: string | null }> = {};

function collectDefinitions(node: any): void {
  if (!node || typeof node !== "object") return;
  if (node.type === "definition" && node.identifier) {
    currentDefinitions[String(node.identifier).toLowerCase()] = {
      url: node.url || "",
      title: node.title ?? null,
    };
  }
  if (Array.isArray(node.children)) {
    for (const child of node.children) collectDefinitions(child);
  }
}

function convertInlineChildren(
  nodes: PhrasingContent[],
  schema: Schema,
  marks: readonly ReturnType<Schema["mark"]>[] = []
): ProseMirrorNode[] {
  const result: ProseMirrorNode[] = [];
  for (const node of nodes) {
    result.push(...convertInline(node, schema, marks));
  }
  return result;
}

function convertInline(
  node: PhrasingContent | MdastNode,
  schema: Schema,
  marks: readonly ReturnType<Schema["mark"]>[] = []
): ProseMirrorNode[] {
  switch (node.type) {
    case "text": {
      const n = node as { type: "text"; value: string };
      return [schema.text(n.value, marks as any)];
    }

    case "strong": {
      const n = node as { type: "strong"; children: PhrasingContent[] };
      const boldMark = schema.marks.bold.create();
      const newMarks = [...marks, boldMark];
      return convertInlineChildren(n.children, schema, newMarks);
    }

    case "emphasis": {
      const n = node as { type: "emphasis"; children: PhrasingContent[] };
      const italicMark = schema.marks.italic.create();
      const newMarks = [...marks, italicMark];
      return convertInlineChildren(n.children, schema, newMarks);
    }

    case "delete": {
      const n = node as { type: "delete"; children: PhrasingContent[] };
      if (schema.marks.strikethrough) {
        const strikeMark = schema.marks.strikethrough.create();
        const newMarks = [...marks, strikeMark];
        return convertInlineChildren(n.children, schema, newMarks);
      }
      return convertInlineChildren(n.children, schema, marks);
    }

    case "inlineCode": {
      const n = node as { type: "inlineCode"; value: string };
      const codeMark = schema.marks.code.create();
      return [schema.text(n.value, [...marks, codeMark] as any)];
    }

    case "link": {
      const n = node as { type: "link"; url: string; title: string | null; children: PhrasingContent[] };
      const linkMark = schema.marks.link.create({ href: n.url, title: n.title });
      const newMarks = [...marks, linkMark];
      return convertInlineChildren(n.children, schema, newMarks);
    }

    case "image": {
      // Store images as raw markdown text so the imageRender decoration plugin
      // can handle rendering.  This keeps the text fully editable (undo, copy,
      // delete all work) and lets the plugin show the image as a widget below.
      const n = node as { type: "image"; url: string; alt: string | null; title: string | null };
      const titlePart = n.title ? ` "${n.title}"` : "";
      return [schema.text(`![${n.alt ?? ""}](${n.url}${titlePart})`)];
    }

    case "linkReference": {
      // Reference-style link [text][id] / [text][] / [id]. Resolve via the
      // collected definitions; fall back to plain text if the ref is unknown.
      const n = node as { type: "linkReference"; identifier: string; children: PhrasingContent[] };
      const def = currentDefinitions[String(n.identifier).toLowerCase()];
      if (def) {
        const linkMark = schema.marks.link.create({ href: def.url, title: def.title });
        return convertInlineChildren(n.children, schema, [...marks, linkMark]);
      }
      return convertInlineChildren(n.children, schema, marks);
    }

    case "imageReference": {
      // Reference-style image ![alt][id]. Resolve to the image-as-text form.
      const n = node as { type: "imageReference"; identifier: string; alt: string | null };
      const def = currentDefinitions[String(n.identifier).toLowerCase()];
      if (def) {
        const titlePart = def.title ? ` "${def.title}"` : "";
        return [schema.text(`![${n.alt ?? ""}](${def.url}${titlePart})`, marks as any)];
      }
      return n.alt ? [schema.text(n.alt, marks as any)] : [];
    }

    case "html": {
      const n = node as { type: "html"; value: string };
      // <br> written by serializeCellContent should round-trip as a hard break
      if (/^<br\s*\/?>$/i.test(n.value.trim())) {
        return [schema.nodes.hard_break.create()];
      }
      return [schema.text(n.value, marks as any)];
    }

    case "break": {
      return [schema.nodes.hard_break.create()];
    }

    case "inlineMath": {
      const n = node as { type: "inlineMath"; value: string };
      return [schema.nodes.math_inline.create({ math: n.value })];
    }

    default: {
      // fallback: try to get text from value
      const anyNode = node as any;
      if (anyNode.value && typeof anyNode.value === "string") {
        return [schema.text(anyNode.value, marks as any)];
      }
      if (anyNode.children) {
        return convertInlineChildren(anyNode.children, schema, marks);
      }
      return [];
    }
  }
}

function convertBlock(node: MdastNode, schema: Schema): ProseMirrorNode | ProseMirrorNode[] | null {
  switch (node.type) {
    case "paragraph": {
      const n = node as { type: "paragraph"; children: PhrasingContent[] };
      const inlineNodes = convertInlineChildren(n.children, schema);
      if (inlineNodes.length === 0) {
        return schema.nodes.paragraph.create();
      }
      return schema.nodes.paragraph.create(null, inlineNodes);
    }

    case "heading": {
      const n = node as { type: "heading"; depth: 1 | 2 | 3 | 4 | 5 | 6; children: PhrasingContent[] };
      const inlineNodes = convertInlineChildren(n.children, schema);
      return schema.nodes.heading.create({ level: n.depth }, inlineNodes);
    }

    case "blockquote": {
      const n = node as { type: "blockquote"; children: Content[] };
      const children = convertBlocks(n.children as MdastNode[], schema);
      if (children.length === 0) {
        children.push(schema.nodes.paragraph.create());
      }
      return schema.nodes.blockquote.create(null, children);
    }

    case "list": {
      const n = node as { type: "list"; ordered: boolean | null; start: number | null; children: Content[] };
      const isOrdered = !!n.ordered;

      // Convert each item independently: an item with a `checked` flag becomes a
      // task_list_item, others stay plain list_items. The schema allows both
      // inside a (bullet|ordered)_list, so mixed lists round-trip correctly.
      const items = n.children.map((item: any) => {
        const blocks = convertBlocks(item.children as MdastNode[], schema);
        if (blocks.length === 0) blocks.push(schema.nodes.paragraph.create());
        if (item.checked !== null && item.checked !== undefined) {
          return schema.nodes.task_list_item.create({ checked: item.checked === true }, blocks);
        }
        return schema.nodes.list_item.create(null, blocks);
      });

      if (isOrdered) {
        return schema.nodes.ordered_list.create({ order: n.start || 1 }, items);
      } else {
        return schema.nodes.bullet_list.create(null, items);
      }
    }

    case "code": {
      const n = node as { type: "code"; value: string; lang: string | null };
      const text = n.value ? schema.text(n.value) : null;
      return schema.nodes.code_block.create(
        { language: n.lang || "" },
        text ? [text] : []
      );
    }

    case "math": {
      const n = node as { type: "math"; value: string };
      return schema.nodes.math_block.create({ math: n.value });
    }

    case "yaml": {
      // Leading YAML frontmatter. Store the raw inner text (without the ---
      // fences) as the node's content; FrontmatterView renders the banner.
      const n = node as { type: "yaml"; value: string };
      const text = n.value ? schema.text(n.value) : null;
      return schema.nodes.frontmatter.create(null, text ? [text] : []);
    }

    case "table": {
      const n = node as { type: "table"; align?: (string | null)[]; children: TableRow[] };
      const align = n.align || [];
      const rows = n.children.map((row: TableRow, rowIndex: number) => {
        const cells = row.children.map((cell: any, colIndex: number) => {
          const inlineNodes = convertInlineChildren(cell.children || [], schema);
          const para = schema.nodes.paragraph.create(null, inlineNodes.length ? inlineNodes : []);
          const cellAttrs = align[colIndex] ? { align: align[colIndex] } : null;
          if (rowIndex === 0) {
            return schema.nodes.table_header.create(cellAttrs, [para]);
          }
          return schema.nodes.table_cell.create(cellAttrs, [para]);
        });
        return schema.nodes.table_row.create(null, cells);
      });
      return schema.nodes.table.create(null, rows);
    }

    case "thematicBreak": {
      return schema.nodes.horizontal_rule.create();
    }

    case "html": {
      const n = node as { type: "html"; value: string };
      return schema.nodes.paragraph.create(null, [schema.text(n.value)]);
    }

    case "definition":
    case "footnoteDefinition":
      return null;

    default: {
      const anyNode = node as any;
      if (anyNode.children) {
        const children = convertBlocks(anyNode.children, schema);
        if (children.length > 0) return children;
      }
      return null;
    }
  }
}

function convertBlocks(nodes: MdastNode[], schema: Schema): ProseMirrorNode[] {
  const result: ProseMirrorNode[] = [];
  for (const node of nodes) {
    const converted = convertBlock(node, schema);
    if (converted === null) continue;
    if (Array.isArray(converted)) {
      result.push(...converted);
    } else {
      result.push(converted);
    }
  }
  return result;
}

export function markdownToDoc(markdown: string, schema: Schema): ProseMirrorNode {
  const tree = processor.parse(markdown) as Root;

  // Collect link/image reference definitions before converting, so
  // reference-style links/images can be resolved wherever they appear.
  currentDefinitions = {};
  collectDefinitions(tree);

  let blocks = convertBlocks(tree.children as MdastNode[], schema);

  if (blocks.length === 0) {
    blocks = [schema.nodes.paragraph.create()];
  }

  // The schema requires at least one block after an optional frontmatter. A
  // file that is *only* frontmatter would otherwise produce an invalid doc, so
  // append an empty paragraph for the caret to land in.
  if (blocks[blocks.length - 1].type === schema.nodes.frontmatter) {
    blocks.push(schema.nodes.paragraph.create());
  }

  return schema.nodes.doc.create(null, blocks);
}
