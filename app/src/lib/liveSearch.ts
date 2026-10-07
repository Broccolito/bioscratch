// Folder search over the in-memory text of open notes with unsaved changes,
// merged into the Rust results (which read files from disk), so text and tags
// you've just typed are searchable without saving first.

import { isUnder, type FileHits, type SearchHit } from "./workspace";

const PREVIEW_CHARS = 160;
const MAX_HITS_PER_FILE = 50;

/** Same output as Rust's `search_text`: first match per line, windowed preview. */
export function searchText(text: string, query: string): SearchHit[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const hits: SearchHit[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length && hits.length < MAX_HITS_PER_FILE; i++) {
    const line = lines[i];
    const at = line.toLowerCase().indexOf(q);
    if (at === -1) continue;
    let preview = line;
    if (line.length > PREVIEW_CHARS) {
      const start = Math.max(0, at - Math.floor(PREVIEW_CHARS / 3));
      const end = Math.min(line.length, start + PREVIEW_CHARS);
      preview = `${start > 0 ? "…" : ""}${line.slice(start, end)}${end < line.length ? "…" : ""}`;
    }
    hits.push({ line: i + 1, preview: preview.trim() });
  }
  return hits;
}

/**
 * Replace disk results for open, unsaved notes with hits from their current
 * text, and add unsaved notes that only match now. `allowed` (the notes
 * matching a tag filter) limits which open notes count; null means any.
 */
export function mergeLiveResults(
  diskFiles: FileHits[],
  openDocs: Map<string, string>,
  query: string,
  scope: string,
  allowed: Set<string> | null
): FileHits[] {
  const live = new Map<string, SearchHit[]>();
  for (const [path, text] of openDocs) {
    if (!isUnder(path, scope) || (allowed && !allowed.has(path))) continue;
    live.set(path, searchText(text, query));
  }
  const merged: FileHits[] = [];
  for (const file of diskFiles) {
    if (!openDocs.has(file.path)) merged.push(file);
    else if (live.get(file.path)?.length) merged.push({ path: file.path, hits: live.get(file.path)! });
  }
  const seen = new Set(diskFiles.map((f) => f.path));
  for (const [path, hits] of live) {
    if (!seen.has(path) && hits.length > 0) merged.push({ path, hits });
  }
  return merged;
}
