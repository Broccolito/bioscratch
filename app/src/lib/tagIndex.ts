// Tag index for a workspace folder, built from each note's front-matter
// `tags:` (see lib/tags.ts). Tags nest with `/`: `lab/assays` is a subtag of
// `lab`, and filtering by `lab` includes notes tagged with any of its subtags.

import { frontmatterTags } from "./tags";
import { isUnder, type NoteMetadata } from "./workspace";

export interface TagIndex {
  /** Note path → its tags (canonical). Untagged notes are absent. */
  notes: Map<string, string[]>;
}

/** A tag in the hierarchy with the number of notes carrying it or a subtag. */
export interface TagNode {
  tag: string;
  /** Last path segment, e.g. "assays" for "lab/assays". */
  name: string;
  count: number;
  children: TagNode[];
}

/** Metadata for a note from its full text, matching what Rust extracts. */
export function metadataFromContent(path: string, content: string): NoteMetadata {
  const lines = content.replace(/^\uFEFF/, "").split(/\r?\n/);
  let frontmatter: string | null = null;
  if (lines[0]?.trimEnd() === "---") {
    const end = lines.findIndex((line, i) => i > 0 && (line.trimEnd() === "---" || line.trimEnd() === "..."));
    if (end > 0) frontmatter = lines.slice(1, end).join("\n");
  }
  return { path, frontmatter };
}

export function buildTagIndex(metadata: NoteMetadata[]): TagIndex {
  const notes = new Map<string, string[]>();
  for (const meta of metadata) {
    const tags = frontmatterTags(meta.frontmatter);
    if (tags.length > 0) notes.set(meta.path, tags);
  }
  return { notes };
}

/**
 * `index` with the tags of open (possibly unsaved) notes laid over what is on
 * disk, so a tag added a moment ago is offered right away. Notes outside
 * `root` are ignored.
 */
export function withLiveTags(index: TagIndex, live: Map<string, string[]>, root: string | null): TagIndex {
  if (live.size === 0) return index;
  const notes = new Map(index.notes);
  for (const [path, tags] of live) {
    if (root && !isUnder(path, root)) continue;
    if (tags.length > 0) notes.set(path, tags);
    else notes.delete(path);
  }
  return { notes };
}

/** `tag` and every parent of it: "a/b/c" → ["a", "a/b", "a/b/c"]. */
export function tagLineage(tag: string): string[] {
  const parts = tag.split("/");
  return parts.map((_, i) => parts.slice(0, i + 1).join("/"));
}

/** True when `tags` contain `wanted` itself or any subtag of it. */
export function hasTag(tags: string[], wanted: string): boolean {
  return tags.some((t) => t === wanted || t.startsWith(`${wanted}/`));
}

/** Tagged notes under `scope` that carry every tag in `wanted` (or a subtag). */
export function notesWithTags(index: TagIndex, wanted: string[], scope: string | null): string[] {
  const matches: string[] = [];
  for (const [path, tags] of index.notes) {
    if (scope && !isUnder(path, scope)) continue;
    if (wanted.every((w) => hasTag(tags, w))) matches.push(path);
  }
  return matches.sort();
}

/**
 * The tag hierarchy across `paths` (default: every tagged note), counting
 * each note once per tag and once per ancestor of its tags. Most used first.
 */
export function tagTree(index: TagIndex, paths?: Iterable<string>): TagNode[] {
  const counts = new Map<string, number>();
  for (const path of paths ?? index.notes.keys()) {
    const implied = new Set<string>();
    for (const tag of index.notes.get(path) ?? []) for (const t of tagLineage(tag)) implied.add(t);
    for (const t of implied) counts.set(t, (counts.get(t) ?? 0) + 1);
  }

  const nodes = new Map<string, TagNode>();
  for (const [tag, count] of counts) {
    nodes.set(tag, { tag, name: tag.slice(tag.lastIndexOf("/") + 1), count, children: [] });
  }
  const roots: TagNode[] = [];
  for (const node of nodes.values()) {
    const slash = node.tag.lastIndexOf("/");
    const parent = slash === -1 ? null : nodes.get(node.tag.slice(0, slash));
    (parent ? parent.children : roots).push(node);
  }
  const sort = (list: TagNode[]) => {
    list.sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
    list.forEach((n) => sort(n.children));
  };
  sort(roots);
  return roots;
}

/** Depth-first list of a tag tree, for flat menus. */
export function flattenTagTree(nodes: TagNode[]): TagNode[] {
  return nodes.flatMap((n) => [n, ...flattenTagTree(n.children)]);
}
