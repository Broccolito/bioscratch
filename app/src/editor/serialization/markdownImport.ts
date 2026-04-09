import { Node as ProseMirrorNode, Schema } from "prosemirror-model";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import type { Root, Content, PhrasingContent, TableRow } from "mdast";

const processor = unified().use(remarkParse).use(remarkGfm).use(remarkMath);

type MdastNode = Content | Root | PhrasingContent;

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

    case "html": {
      const n = node as { type: "html"; value: string };
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

      // Check if it's a task list
      const isTaskList = n.children.some(
        (item: any) => item.type === "listItem" && item.checked !== null && item.checked !== undefined
      );

      if (isTaskList) {
        const items = n.children.map((item: any) => {
          const checked = item.checked === true;
          const blocks = convertBlocks(item.children as MdastNode[], schema);
          if (blocks.length === 0) blocks.push(schema.nodes.paragraph.create());
          return schema.nodes.task_list_item.create({ checked }, blocks);
        });
        // Wrap in bullet_list for task lists
        return schema.nodes.bullet_list.create(null, items);
      }

      const items = n.children.map((item: any) => {
        const blocks = convertBlocks(item.children as MdastNode[], schema);
        if (blocks.length === 0) blocks.push(schema.nodes.paragraph.create());
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

    case "table": {
      const n = node as { type: "table"; children: TableRow[] };
      const rows = n.children.map((row: TableRow, rowIndex: number) => {
        const cells = row.children.map((cell: any) => {
          const inlineNodes = convertInlineChildren(cell.children || [], schema);
          const para = schema.nodes.paragraph.create(null, inlineNodes.length ? inlineNodes : []);
          if (rowIndex === 0) {
            return schema.nodes.table_header.create(null, [para]);
          }
          return schema.nodes.table_cell.create(null, [para]);
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

  let blocks = convertBlocks(tree.children as MdastNode[], schema);

  if (blocks.length === 0) {
    blocks = [schema.nodes.paragraph.create()];
  }

  return schema.nodes.doc.create(null, blocks);
}
