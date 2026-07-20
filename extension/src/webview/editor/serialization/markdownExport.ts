import { Node as ProseMirrorNode, Mark } from "prosemirror-model";

function escapeMarkdownText(text: string): string {
  return text
    .replace(/([\\`*_~])/g, "\\$1")
    .replace(/<(?=[a-zA-Z/!?])/g, "\\<")
    .replace(/^(\s*)([#>])/gm, "$1\\$2")
    .replace(/^(\s*)([-+])(\s)/gm, "$1\\$2$3")
    .replace(/^(\s*\d+)([.)])(\s)/gm, "$1\\$2$3");
}

function markOpen(mark: Mark): string {
  switch (mark.type.name) {
    case "bold": return "**";
    case "italic": return "*";
    case "strikethrough": return "~~";
    case "link": return "[";
    default: return "";
  }
}

function markClose(mark: Mark): string {
  switch (mark.type.name) {
    case "bold": return "**";
    case "italic": return "*";
    case "strikethrough": return "~~";
    case "link": {
      const { href, title } = mark.attrs;
      const titlePart = title ? ` "${title}"` : "";
      return `](${href}${titlePart})`;
    }
    default: return "";
  }
}

function serializeCodeSpan(text: string): string {
  let longestRun = 0;
  for (const match of text.matchAll(/`+/g)) {
    longestRun = Math.max(longestRun, match[0].length);
  }
  const fence = "`".repeat(Math.max(1, longestRun + 1));
  const hasSymmetricMeaningfulSpaces =
    text.startsWith(" ") && text.endsWith(" ") && /[^ ]/.test(text);
  const needsPadding =
    text.startsWith("`") || text.endsWith("`") || hasSymmetricMeaningfulSpaces;
  const content = needsPadding ? ` ${text} ` : text;
  return `${fence}${content}${fence}`;
}

function serializeAtomInline(node: ProseMirrorNode, hardBreak: string): string {
  if (node.type.name === "hard_break") return hardBreak;
  if (node.type.name === "image") {
    const { src, alt, title } = node.attrs;
    const titlePart = title ? ` "${title}"` : "";
    return `![${alt || ""}](${src}${titlePart})`;
  }
  if (node.type.name === "math_inline") return `$${node.attrs.math}$`;
  return "";
}

function serializeInlineSeq(parent: ProseMirrorNode, hardBreak: string): string {
  let result = "";
  const active: Mark[] = [];
  const closeFrom = (index: number) => {
    for (let i = active.length - 1; i >= index; i--) result += markClose(active[i]);
    active.length = index;
  };

  parent.forEach((child) => {
    const childMarks = child.type.name === "text" ? child.marks : Mark.none;
    const hasCode = childMarks.some((mark) => mark.type.name === "code");
    const marks = hasCode
      ? childMarks.filter((mark) => mark.type.name !== "code")
      : childMarks;
    let keep = 0;
    while (
      keep < active.length &&
      keep < marks.length &&
      active[keep].eq(marks[keep])
    ) {
      keep++;
    }
    closeFrom(keep);
    for (let i = keep; i < marks.length; i++) {
      result += markOpen(marks[i]);
      active.push(marks[i]);
    }

    if (child.type.name === "text") {
      result += hasCode
        ? serializeCodeSpan(child.text || "")
        : escapeMarkdownText(child.text || "");
    } else {
      result += serializeAtomInline(child, hardBreak);
    }
  });
  closeFrom(0);
  return result;
}

function serializeInlineContent(node: ProseMirrorNode): string {
  return serializeInlineSeq(node, "  \n");
}

function serializeBlock(node: ProseMirrorNode, indent: string = ""): string {
  switch (node.type.name) {
    case "paragraph": {
      const content = serializeInlineContent(node);
      return `${indent}${content}\n\n`;
    }

    case "heading": {
      const level = node.attrs.level;
      const prefix = "#".repeat(level);
      const content = serializeInlineContent(node);
      return `${indent}${prefix} ${content}\n\n`;
    }

    case "blockquote": {
      let inner = "";
      node.forEach((child) => {
        inner += serializeBlock(child, "");
      });
      // Prefix each line with "> "
      const lines = inner.split("\n");
      return (
        lines
          .map((line) => (line.trim() === "" ? ">" : `> ${line}`))
          .join("\n")
          .replace(/>\s*\n\n$/, "\n") + "\n"
      );
    }

    case "bullet_list": {
      let result = "";
      node.forEach((item) => {
        if (item.type.name === "task_list_item") {
          result += serializeTaskItem(item, `${indent}- `);
        } else {
          result += serializeListItem(item, `${indent}- `);
        }
      });
      return result + "\n";
    }

    case "ordered_list": {
      let result = "";
      let order = node.attrs.order || 1;
      node.forEach((item) => {
        if (item.type.name === "task_list_item") {
          result += serializeTaskItem(item, `${indent}${order}. `);
        } else {
          result += serializeListItem(item, `${indent}${order}. `);
        }
        order++;
      });
      return result + "\n";
    }

    case "code_block": {
      const language = node.attrs.language || "";
      const code = node.textContent;
      return `\`\`\`${language}\n${code}\n\`\`\`\n\n`;
    }

    case "math_block": {
      return `$$\n${node.attrs.math}\n$$\n\n`;
    }

    case "table": {
      return serializeTable(node) + "\n";
    }

    case "horizontal_rule": {
      return "---\n\n";
    }

    case "image": {
      const { src, alt, title } = node.attrs;
      const titlePart = title ? ` "${title}"` : "";
      return `![${alt || ""}](${src}${titlePart})\n\n`;
    }

    default:
      return "";
  }
}

function serializeListItem(item: ProseMirrorNode, prefix: string): string {
  const indentLen = prefix.length;
  const indent = " ".repeat(indentLen);
  let result = "";
  let first = true;

  item.forEach((child) => {
    if (first) {
      const blockStr = serializeBlock(child, "");
      result += `${prefix}${blockStr.trimStart()}`;
      first = false;
    } else {
      if (
        (child.type.name === "bullet_list" || child.type.name === "ordered_list") &&
        result.endsWith("\n\n")
      ) {
        result = result.slice(0, -1);
      }
      const blockStr = serializeBlock(child, indent);
      result += blockStr;
    }
  });

  return result;
}

function serializeTaskItem(item: ProseMirrorNode, prefix: string): string {
  const checked = item.attrs.checked ? "x" : " ";
  const taskPrefix = `${prefix}[${checked}] `;
  const indentLen = taskPrefix.length;
  const indent = " ".repeat(indentLen);
  let result = "";
  let first = true;

  item.forEach((child) => {
    if (first) {
      const blockStr = serializeBlock(child, "");
      result += `${taskPrefix}${blockStr.trimStart()}`;
      first = false;
    } else {
      if (
        (child.type.name === "bullet_list" || child.type.name === "ordered_list") &&
        result.endsWith("\n\n")
      ) {
        result = result.slice(0, -1);
      }
      const blockStr = serializeBlock(child, indent);
      result += blockStr;
    }
  });

  return result;
}

// Serialize a single table cell's content. hard_break nodes become <br> so that
// multi-line cell content round-trips correctly through the GFM format.
function serializeCellContent(cell: ProseMirrorNode): string {
  const parts: string[] = [];
  cell.forEach((block) => {
    parts.push(serializeInlineSeq(block, "<br>").trim());
  });
  return parts.filter(Boolean).join("<br>");
}

function serializeTable(node: ProseMirrorNode): string {
  const rows: string[][] = [];

  node.forEach((row) => {
    const cells: string[] = [];
    row.forEach((cell) => {
      cells.push(serializeCellContent(cell));
    });
    rows.push(cells);
  });

  if (rows.length === 0) return "";

  const colCount = Math.max(...rows.map((r) => r.length));

  // Pad all rows to same column count
  const paddedRows = rows.map((row) => {
    while (row.length < colCount) row.push("");
    return row;
  });

  // Calculate column widths
  const widths = Array(colCount).fill(3);
  for (const row of paddedRows) {
    for (let i = 0; i < colCount; i++) {
      widths[i] = Math.max(widths[i], row[i].length);
    }
  }

  const formatRow = (cells: string[]) => {
    return (
      "| " +
      cells
        .map((cell, i) => cell.padEnd(widths[i]))
        .join(" | ") +
      " |"
    );
  };

  const separator =
    "| " +
    widths.map((w) => "-".repeat(w)).join(" | ") +
    " |";

  let result = formatRow(paddedRows[0]) + "\n";
  result += separator + "\n";
  for (let i = 1; i < paddedRows.length; i++) {
    result += formatRow(paddedRows[i]) + "\n";
  }

  return result;
}

export function docToMarkdown(doc: ProseMirrorNode): string {
  let result = "";
  doc.forEach((node) => {
    result += serializeBlock(node);
  });
  // Clean up trailing newlines but keep one
  return result.replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}
