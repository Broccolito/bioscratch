// Note tags, stored the way Obsidian, Hugo, Jekyll and most other Markdown
// tools store them: a `tags:` key in the YAML front matter.
//
//   ---
//   tags:
//     - lab
//     - lab/assays      ← `/` nests tags (Obsidian convention)
//   ---
//
// A list is the default; an existing Jekyll-style string (`tags: a b`) or flow
// list (`tags: [a, b]`) keeps its style when edited, and `tag:` is accepted as
// an alias. Matching is case-insensitive via `normalizeTag`.

import { isMap, isScalar, isSeq, parseDocument, visit } from "yaml";
import { parseFrontmatter, TAG_KEYS } from "./frontmatter";

const MAX_TAG_LENGTH = 64;

/**
 * Canonical form of a tag for matching and display: lower-case, no leading
 * `#`, whitespace collapsed to `-`, only letters, digits, `-`, `_` and `/`.
 * Returns null when nothing usable is left.
 */
export function normalizeTag(raw: string): string | null {
  const tag = raw
    .trim()
    .replace(/^#+/, "")
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^\p{L}\p{N}_\-/]/gu, "")
    .replace(/-{2,}/g, "-")
    .replace(/\/{2,}/g, "/")
    .replace(/^[-/]+|[-/]+$/g, "")
    .slice(0, MAX_TAG_LENGTH);
  return tag || null;
}

/** Parse a comma- or space-separated tag string into unique canonical tags. */
export function parseTagList(text: string): string[] {
  const tags: string[] = [];
  for (const part of text.split(/[,\s]+/)) {
    const tag = normalizeTag(part);
    if (tag && !tags.includes(tag)) tags.push(tag);
  }
  return tags;
}

/** A front-matter tags value: a list (one tag per item) or a "a, b" / "a b" string. */
export function normalizeTags(value: unknown): string[] {
  const tags: string[] = [];
  const items = Array.isArray(value) ? value : [value];
  for (const item of items) {
    if (item === null || item === undefined || typeof item === "object") continue;
    const parts = Array.isArray(value) ? [normalizeTag(String(item))] : parseTagList(String(item));
    for (const tag of parts) if (tag && !tags.includes(tag)) tags.push(tag);
  }
  return tags;
}

/** Canonical tags declared in front matter (`tags:` or `tag:`). */
export function frontmatterTags(yaml: string | null): string[] {
  if (!yaml) return [];
  const tags: string[] = [];
  for (const [key, value] of parseFrontmatter(yaml).entries) {
    if (!TAG_KEYS.includes(key.trim().toLowerCase())) continue;
    for (const tag of normalizeTags(value)) if (!tags.includes(tag)) tags.push(tag);
  }
  return tags;
}

/** Whether `writeFrontmatterTags` can edit this YAML: it parses cleanly and
 *  is empty or a key/value map. */
export function canWriteFrontmatterTags(yaml: string): boolean {
  const doc = parseDocument(yaml);
  if (doc.errors.length > 0 || (doc.contents !== null && !isMap(doc.contents))) return false;
  // Replacing/removing a tag node can invalidate aliases elsewhere in the
  // metadata. Keep shared YAML graphs read-only instead of risking data loss.
  let hasAliases = false;
  visit(doc, {
    Alias() {
      hasAliases = true;
      return visit.BREAK;
    },
  });
  return !hasAliases;
}

/**
 * Return `yaml` with its tags replaced by `tags` (canonical), leaving every
 * other key, comment and the existing tag style intact. Tags that were
 * already present keep their original spelling (e.g. `Coding`). Returns ""
 * when nothing is left, and null when the YAML can't be edited safely
 * (syntax errors, or front matter that isn't a key/value map).
 */
export function writeFrontmatterTags(yaml: string, tags: string[]): string | null {
  if (!canWriteFrontmatterTags(yaml)) return null;
  const doc = parseDocument(yaml);

  // Reading accepts case-insensitive `tag` / `tags` aliases, so editing must
  // replace every spelling too. Keep the first key and its formatting rather
  // than adding a second, lowercase key whose values would merge on reading.
  const tagPairs = isMap(doc.contents)
    ? doc.contents.items.filter((pair) =>
        isScalar(pair.key) && typeof pair.key.value === "string"
          && TAG_KEYS.includes(pair.key.value.trim().toLowerCase())
      )
    : [];
  const primary = tagPairs[0];
  const existing = primary?.value;

  // Reuse the original spelling of tags the note already had.
  const original = new Map<string, string>();
  for (const pair of tagPairs) {
    const value = pair.value;
    const rawItems: unknown[] = isSeq(value)
      ? value.items.map((item) => (isScalar(item) ? item.value : item))
      : isScalar(value) ? String(value.value ?? "").split(/[,\s]+/) : [];
    for (const raw of rawItems) {
      if (typeof raw !== "string" && typeof raw !== "number") continue;
      const tag = normalizeTag(String(raw));
      if (tag && !original.has(tag)) original.set(tag, String(raw).trim());
    }
  }
  const spelled = tags.map((t) => original.get(t) ?? t);

  if (spelled.length === 0) {
    if (tagPairs.length === 0) return yaml;
    if (isMap(doc.contents)) {
      doc.contents.items = doc.contents.items.filter((pair) => !tagPairs.includes(pair));
    }
  } else if (isScalar(existing) && typeof existing.value === "string" && /[,\s]/.test(existing.value.trim())) {
    // A multi-tag string (Jekyll's `tags: a b`, or `a, b`) keeps its style;
    // a single value becomes a standard list.
    existing.value = spelled.join(existing.value.includes(",") ? ", " : " ");
  } else {
    const node = doc.createNode(spelled);
    if (isSeq(existing)) node.flow = existing.flow ?? false;
    if (primary) doc.set(primary.key, node);
    else doc.set("tags", node);
  }
  if (spelled.length > 0 && isMap(doc.contents)) {
    doc.contents.items = doc.contents.items.filter((pair) => pair === primary || !tagPairs.includes(pair));
  }

  if (isMap(doc.contents) && doc.contents.items.length === 0 && !doc.commentBefore && !doc.comment) {
    return "";
  }
  return doc.toString({ flowCollectionPadding: false }).replace(/\n+$/, "");
}
