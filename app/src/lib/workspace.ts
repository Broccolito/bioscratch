// Typed wrappers around the Rust workspace commands (src-tauri/src/workspace.rs)
// plus path helpers for the sidebar, breadcrumbs and quick switcher.

import { invoke } from "@tauri-apps/api/core";

export interface DirEntry {
  name: string;
  path: string;
  is_dir: boolean;
}

export interface FileList {
  files: string[];
  truncated: boolean;
}

export interface SearchHit {
  line: number;
  preview: string;
}

export interface FileHits {
  path: string;
  hits: SearchHit[];
}

export interface SearchResults {
  files: FileHits[];
  truncated: boolean;
  cancelled: boolean;
}

export interface NoteMetadata {
  path: string;
  /** Raw front-matter YAML, if the note has a leading `---` block. */
  frontmatter: string | null;
}

export interface MetadataIndex {
  notes: NoteMetadata[];
  truncated: boolean;
}

export const listDir = (path: string, showHidden = false) =>
  invoke<DirEntry[]>("list_dir", { path, showHidden });

export const listWorkspaceFiles = (root: string) =>
  invoke<FileList>("list_workspace_files", { root });

/** Full-text search under `root`; `paths` limits it to those files. */
export const searchWorkspace = (root: string, query: string, paths?: string[]) =>
  invoke<SearchResults>("search_workspace", { root, query, paths: paths ?? null });

export const readWorkspaceMetadata = (root: string) =>
  invoke<MetadataIndex>("read_workspace_metadata", { root });

export const revealInFinder = (path: string) =>
  invoke<void>("reveal_in_finder", { path });

export const openWithDefaultApp = (path: string) =>
  invoke<void>("open_with_default_app", { path });

/** Create `Untitled.md` or an `Untitled` folder (numbered if taken) in `dir`. */
export const createUntitled = (dir: string, kind: "file" | "folder") =>
  invoke<string>("create_untitled", { dir, kind });

/** Rename a file or folder within its folder; resolves to the new path. */
export const renamePath = (path: string, newName: string) =>
  invoke<string>("rename_path", { path, newName });

/** Move a file or folder to the macOS Trash. */
export const moveToTrash = (path: string) => invoke<void>("move_to_trash", { path });

/** `path` after `from` was renamed to `to` (also for paths inside a renamed folder). */
export function remapPath(path: string, from: string, to: string): string {
  if (path === from) return to;
  return path.startsWith(`${from}/`) ? to + path.slice(from.length) : path;
}

/**
 * How much of a name to pre-select for renaming: a file's name without its
 * extension ("Untitled" of "Untitled.md"), or all of a folder's or dotfile's name.
 */
export function nameSelectionEnd(name: string, isDir: boolean): number {
  if (isDir) return name.length;
  const dot = name.lastIndexOf(".");
  return dot > 0 ? dot : name.length;
}

export function basename(path: string): string {
  return path.split("/").filter(Boolean).pop() || path;
}

export function dirname(path: string): string {
  const parts = path.split("/");
  parts.pop();
  return parts.join("/") || "/";
}

/** True when `path` is `root` itself or inside it. */
export function isUnder(path: string, root: string): boolean {
  const base = root.endsWith("/") ? root : `${root}/`;
  return path === root || path.startsWith(base);
}

/** `path` relative to `root`, or the absolute path if it is outside. */
export function relativeTo(path: string, root: string): string {
  if (!isUnder(path, root) || path === root) return path;
  return path.slice(root.replace(/\/$/, "").length + 1);
}

/** The innermost workspace folder containing `path`, if any. */
export function containingRoot(path: string, roots: string[]): string | null {
  let best: string | null = null;
  for (const root of roots) {
    if (isUnder(path, root) && (!best || root.length > best.length)) best = root;
  }
  return best;
}

export interface Crumb {
  name: string;
  path: string;
}

/**
 * Breadcrumb segments for `path`. Inside a workspace folder the crumbs start
 * at that folder; outside, they show the full absolute path.
 */
export function breadcrumbs(path: string, root: string | null): Crumb[] {
  const start = root && isUnder(path, root) ? root.replace(/\/$/, "") : "";
  const rest = path.slice(start.length).split("/").filter(Boolean);
  const crumbs: Crumb[] = [];
  let current = start;
  if (start) crumbs.push({ name: basename(start), path: start });
  for (const part of rest) {
    current = `${current}/${part}`;
    crumbs.push({ name: part, path: current });
  }
  return crumbs;
}

/** Every ancestor directory of `path` that lies within `root` (root first). */
export function ancestorsWithin(path: string, root: string): string[] {
  if (!isUnder(path, root)) return [];
  const crumbs = breadcrumbs(path, root);
  return crumbs.slice(0, -1).map((c) => c.path);
}

/**
 * Index of the first case-insensitive match of `query` on 1-based `line`,
 * counted across the whole text. Used to land the editor's search highlight
 * on the hit the user clicked in folder search.
 */
export function occurrenceIndexAtLine(text: string, query: string, line: number): number {
  const q = query.toLowerCase();
  if (!q) return 0;
  const lines = text.split(/\r?\n/);
  let count = 0;
  for (let i = 0; i < Math.min(line - 1, lines.length); i++) {
    const lower = lines[i].toLowerCase();
    let idx = lower.indexOf(q);
    while (idx !== -1) {
      count++;
      idx = lower.indexOf(q, idx + q.length);
    }
  }
  return count;
}
