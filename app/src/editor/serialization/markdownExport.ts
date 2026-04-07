import { Node as ProseMirrorNode, Mark } from "prosemirror-model";

function serializeInline(node: ProseMirrorNode): string {
  if (node.type.name === "text") {
    let text = node.text || "";

    // Apply marks from outermost to innermost
    const marks = [...node.marks];

    // Sort marks for consistent output
    let result = text;

    // We'll apply marks by wrapping
    for (let i = marks.length - 1; i >= 0; i--) {
      const mark = marks[i];
      result = applyMark(mark, result, text);
    }

    return result;
  }

  if (node.type.name === "hard_break") {
    return "  \n";
  }

  if (node.type.name === "image") {
    const { src, alt, title } = node.attrs;
    const titlePart = title ? ` "${title}"` : "";
    return `![${alt || ""}](${src}${titlePart})`;
  }

  if (node.type.name === "math_inline") {
    return `$${node.attrs.math}$`;
  }

  return "";
}

function applyMark(mark: Mark, content: string, _rawText: string): string {
  switch (mark.type.name) {
    case "bold":
      return `**${content}**`;
    case "italic":
      return `*${content}*`;
    case "code":
      return `\`${content}\``;
    case "link": {
      const { href, title } = mark.attrs;
      const titlePart = title ? ` "${title}"` : "";
      return `[${content}](${href}${titlePart})`;
    }
    case "strikethrough":
      return `~~${content}~~`;
    default:
      return content;
  }
}

function serializeInlineContent(node: ProseMirrorNode): string {
  let result = "";
  node.forEach((child) => {
    result += serializeInline(child);
  });
  return result;
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
          result += serializeTaskItem(item, "- ");
        } else {
          result += serializeListItem(item, "- ");
        }
      });
      return result + "\n";
    }

    case "ordered_list": {
      let result = "";
      let order = node.attrs.order || 1;
      node.forEach((item) => {
        result += serializeListItem(item, `${order}. `);
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
      const blockStr = serializeBlock(child, indent);
      result += blockStr;
    }
  });

  return result;
}

function serializeTable(node: ProseMirrorNode): string {
  const rows: string[][] = [];
  let isFirstRow = true;

  node.forEach((row) => {
    const cells: string[] = [];
    row.forEach((cell) => {
      let cellContent = "";
      cell.forEach((block) => {
        cellContent += serializeInlineContent(block);
      });
      cells.push(cellContent.trim());
    });
    rows.push(cells);
    if (isFirstRow) {
      isFirstRow = false;
    }
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
