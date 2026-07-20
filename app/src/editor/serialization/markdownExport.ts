import { Node as ProseMirrorNode, Mark } from "prosemirror-model";

// Escape characters that would otherwise be re-parsed as Markdown syntax on the
// next import, so that literal text like "*not italic*" or "[x]" round-trips.
// Applied to plain text only — never inside inline code (backticks already make
// the content literal) or to text that is itself a code span.
function escapeMarkdownText(text: string): string {
  return text
    // Inline emphasis / code / strike delimiters, anywhere. Brackets are NOT
    // escaped: images are stored as literal "![alt](src)" text and escaping the
    // brackets would break them, while literal "[text]" stays literal text on
    // re-import anyway (only "[text](url)" becomes a link).
    .replace(/([\\`*_~])/g, "\\$1")
    // "<" only when it could begin an HTML tag or autolink.
    .replace(/<(?=[a-zA-Z/!?])/g, "\\<")
    // "#", ">" and list markers are only special at the start of a line.
    .replace(/^(\s*)([#>])/gm, "$1\\$2")
    .replace(/^(\s*)([-+])(\s)/gm, "$1\\$2$3")
    .replace(/^(\s*\d+)([.)])(\s)/gm, "$1\\$2$3");
}

// Opening delimiter for a mark.
function markOpen(mark: Mark): string {
  switch (mark.type.name) {
    case "bold": return "**";
    case "italic": return "*";
    case "strikethrough": return "~~";
    case "link": return "[";
    default: return "";
  }
}

// Closing delimiter for a mark (links carry their target on close).
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

// CommonMark code spans use a backtick fence longer than any run inside the
// content. Padding is required when the content starts/ends with a backtick or
// has meaningful spaces at both edges, because parsers otherwise consume one
// leading and trailing space during normalization.
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

// Serialize a single non-text inline atom (image / math / hard break).
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

// Serialize a sequence of inline nodes, opening/closing marks across adjacent
// nodes so a shared mark isn't repeatedly closed and reopened. This keeps e.g.
// bold around inline code as **`code`** instead of the **`code`****…** doubling
// that escalates on every round-trip.
function serializeInlineSeq(parent: ProseMirrorNode, hardBreak: string): string {
  let result = "";
  const active: Mark[] = [];
  const closeFrom = (i: number) => {
    for (let k = active.length - 1; k >= i; k--) result += markClose(active[k]);
    active.length = i;
  };
  parent.forEach((child) => {
    const childMarks = child.type.name === "text" ? child.marks : Mark.none;
    const hasCode = childMarks.some((mark) => mark.type.name === "code");
    // A code span is an atomic Markdown construct. Other ProseMirror marks stay
    // open around it so adjacent bold/link text remains one stable sequence.
    const marks = hasCode
      ? childMarks.filter((mark) => mark.type.name !== "code")
      : childMarks;
    // Keep the longest prefix of marks that is already open, in order.
    let keep = 0;
    while (keep < active.length && keep < marks.length && active[keep].eq(marks[keep])) keep++;
    closeFrom(keep);
    for (let k = keep; k < marks.length; k++) {
      result += markOpen(marks[k]);
      active.push(marks[k]);
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
      // Trim the trailing block spacing, then prefix every line with "> "
      // (empty lines become a bare ">"). Emitting exactly one blank line after
      // keeps the output idempotent across repeated round-trips.
      const lines = inner.replace(/\n+$/, "").split("\n");
      const quoted = lines
        .map((line) => (line.trim() === "" ? ">" : `> ${line}`))
        .join("\n");
      return quoted + "\n\n";
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

    case "frontmatter": {
      // Emit the raw YAML back between --- fences. textContent is the inner
      // YAML exactly as the user edited it (no escaping — it is verbatim text).
      const yaml = node.textContent.replace(/\n+$/, "");
      return `---\n${yaml}\n---\n\n`;
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
  // Escape pipes so cell content can't break the table column structure.
  return parts.filter(Boolean).join("<br>").replace(/\|/g, "\\|");
}

function serializeTable(node: ProseMirrorNode): string {
  const rows: string[][] = [];
  const align: (string | null)[] = [];

  node.forEach((row, _o, rowIndex) => {
    const cells: string[] = [];
    row.forEach((cell, _co, colIndex) => {
      cells.push(serializeCellContent(cell));
      // Take column alignment from the first row that declares it.
      if (rowIndex === 0 || align[colIndex] == null) {
        align[colIndex] = cell.attrs.align ?? align[colIndex] ?? null;
      }
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

  // GFM alignment separators: ":--" left, ":-:" center, "--:" right.
  const sepCell = (w: number, a: string | null): string => {
    const width = Math.max(w, a === "center" ? 5 : 3);
    if (a === "center") return ":" + "-".repeat(width - 2) + ":";
    if (a === "left") return ":" + "-".repeat(width - 1);
    if (a === "right") return "-".repeat(width - 1) + ":";
    return "-".repeat(width);
  };
  const separator =
    "| " +
    widths.map((w, i) => sepCell(w, align[i] ?? null)).join(" | ") +
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
