import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  SearchResults,
  searchWorkspace,
  basename,
  dirname,
  isUnder,
  relativeTo,
} from "../lib/workspace";
import { flattenTagTree, tagTree, type TagIndex, type TagNode } from "../lib/tagIndex";
import TagPicker from "./TagPicker";
import { mergeLiveResults } from "../lib/liveSearch";
import type { OpenOptions } from "./FileTree";

interface SearchPanelProps {
  /** Workspace folder (for relative paths). */
  root: string;
  /** Folder being searched: the one shown in the Files tree. */
  scope: string;
  /** Bumped to focus the input (e.g. ⇧⌘F). */
  focusSeq: number;
  tagIndex: TagIndex;
  tagIndexLoading: boolean;
  selectedTags: string[];
  /** Notes in `scope` carrying every selected tag (or a subtag of it). */
  tagMatches: string[];
  filterTree: boolean;
  activePath: string | null;
  /** Open notes with unsaved changes → their current text (searched instead of disk). */
  openDocs: Map<string, string>;
  onSelectedTagsChange: (tags: string[]) => void;
  onFilterTreeChange: (on: boolean) => void;
  onRefreshTags: () => void;
  onOpenMatch: (path: string, query: string, line: number, options?: OpenOptions) => void;
  onOpenFile: (path: string, options?: OpenOptions) => void;
}

const DEBOUNCE_MS = 250;

/** Split `text` around case-insensitive occurrences of `query` for highlighting. */
export function highlightParts(text: string, query: string): Array<{ text: string; match: boolean }> {
  const q = query.trim().toLowerCase();
  if (!q) return [{ text, match: false }];
  const lower = text.toLowerCase();
  const parts: Array<{ text: string; match: boolean }> = [];
  let i = 0;
  while (i < text.length) {
    const found = lower.indexOf(q, i);
    if (found === -1) {
      parts.push({ text: text.slice(i), match: false });
      break;
    }
    if (found > i) parts.push({ text: text.slice(i, found), match: false });
    parts.push({ text: text.slice(found, found + q.length), match: true });
    i = found + q.length;
  }
  return parts;
}

const Highlighted: React.FC<{ text: string; query: string }> = ({ text, query }) => (
  <>
    {highlightParts(text, query).map((part, i) =>
      part.match ? <mark key={i}>{part.text}</mark> : <React.Fragment key={i}>{part.text}</React.Fragment>
    )}
  </>
);

const Chevron: React.FC<{ open: boolean }> = ({ open }) => (
  <svg className={`file-tree-chevron${open ? " open" : ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="m9 18 6-6-6-6"/>
  </svg>
);

const SearchPanel: React.FC<SearchPanelProps> = ({
  root,
  scope,
  focusSeq,
  tagIndex,
  tagIndexLoading,
  selectedTags,
  tagMatches,
  filterTree,
  activePath,
  openDocs,
  onSelectedTagsChange,
  onFilterTreeChange,
  onRefreshTags,
  onOpenMatch,
  onOpenFile,
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  // Disk results from Rust; open unsaved notes are merged in below.
  const [diskResults, setDiskResults] = useState<SearchResults | null>(null);
  const [resultsQuery, setResultsQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [picking, setPicking] = useState(false);
  const [openTags, setOpenTags] = useState<Set<string>>(new Set());
  const requestRef = useRef(0);

  useEffect(() => {
    if (focusSeq === 0) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [focusSeq]);

  const hasTags = selectedTags.length > 0;
  const q = query.trim();
  const matchesKey = tagMatches.join("\n");

  useEffect(() => {
    const request = ++requestRef.current;
    if (!q) {
      setDiskResults(null);
      setSearching(false);
      setError(null);
      return;
    }
    if (hasTags && tagMatches.length === 0) {
      setDiskResults({ files: [], truncated: false, cancelled: false });
      setResultsQuery(q);
      setSearching(false);
      return;
    }
    setSearching(true);
    const timer = setTimeout(() => {
      searchWorkspace(scope, q, hasTags ? tagMatches : undefined)
        .then((res) => {
          // A newer keystroke, scope or tag change owns the panel now.
          if (request !== requestRef.current) return;
          if (res.cancelled) {
            setSearching(false);
            return;
          }
          setDiskResults(res);
          setResultsQuery(q);
          setCollapsed(new Set());
          setError(null);
          setSearching(false);
        })
        .catch((err) => {
          if (request !== requestRef.current) return;
          setError(String(err));
          setSearching(false);
        });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // tagMatches is tracked through matchesKey.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, scope, hasTags, matchesKey]);

  // Tags among the notes still in play: everything in the folder, or only the
  // notes matching the current tags, so each choice narrows the results.
  const candidateTree = useMemo(() => {
    const inScope = [...tagIndex.notes.keys()].filter((p) => isUnder(p, scope));
    return tagTree(tagIndex, hasTags ? tagMatches : inScope);
  }, [tagIndex, scope, hasTags, tagMatches]);
  const selected = useMemo(() => new Set(selectedTags), [selectedTags]);
  const scopeName = basename(scope);

  const addTag = (tag: string) => {
    if (!selected.has(tag)) onSelectedTagsChange([...selectedTags, tag]);
  };

  const results = useMemo(() => {
    if (!diskResults || !resultsQuery) return diskResults;
    const allowed = hasTags ? new Set(tagMatches) : null;
    return { ...diskResults, files: mergeLiveResults(diskResults.files, openDocs, resultsQuery, scope, allowed) };
  }, [diskResults, resultsQuery, openDocs, scope, hasTags, tagMatches]);

  const hitCount = results?.files.reduce((n, f) => n + f.hits.length, 0) ?? 0;

  const toggleFile = (path: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  const toggleTagOpen = (tag: string) =>
    setOpenTags((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });

  const renderTagNodes = (nodes: TagNode[], depth: number): React.ReactNode =>
    nodes.map((node) => {
      const isSelected = selected.has(node.tag);
      const open = openTags.has(node.tag);
      return (
        <React.Fragment key={node.tag}>
          <div className="tag-tree-row" style={{ paddingLeft: 4 + depth * 14 }}>
            <button
              className="tag-tree-twisty"
              onClick={() => toggleTagOpen(node.tag)}
              disabled={node.children.length === 0}
              aria-label={open ? `Collapse ${node.tag}` : `Expand ${node.tag}`}
            >
              {node.children.length > 0 && <Chevron open={open} />}
            </button>
            <button
              className={`tag-tree-label${isSelected ? " selected" : ""}`}
              onClick={() =>
                isSelected
                  ? onSelectedTagsChange(selectedTags.filter((t) => t !== node.tag))
                  : addTag(node.tag)
              }
              title={node.children.length > 0 ? `#${node.tag} and its subtags` : `#${node.tag}`}
            >
              #{node.name}
            </button>
            <span className="properties-count">{node.count}</span>
          </div>
          {open && renderTagNodes(node.children, depth + 1)}
        </React.Fragment>
      );
    });

  const status = error
    ? "Search failed"
    : searching
      ? "Searching…"
      : q && results
        ? hitCount === 0
          ? "No results"
          : `${hitCount.toLocaleString()} result${hitCount === 1 ? "" : "s"} in ${results.files.length.toLocaleString()} file${results.files.length === 1 ? "" : "s"}${results.truncated ? " (limit reached)" : ""}`
        : !q && hasTags
          ? tagMatches.length === 0
            ? "No notes have all these tags"
            : `${tagMatches.length} note${tagMatches.length === 1 ? "" : "s"} with ${selectedTags.length === 1 ? "this tag" : "all these tags"}`
          : "";

  return (
    <div className={`sidebar-panel search-panel${q || hasTags ? " searching" : ""}`}>
      <div className="sidebar-input-row">
        <input
          ref={inputRef}
          className="sidebar-input"
          type="text"
          placeholder={`Search in ${scopeName}…`}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setQuery("");
          }}
          spellCheck={false}
        />
      </div>

      <div className="search-tags">
        {selectedTags.map((tag) => (
          <span key={tag} className="tag-chip">
            <span className="tag-chip-label static">#{tag}</span>
            <button
              className="tag-chip-remove"
              onClick={() => onSelectedTagsChange(selectedTags.filter((t) => t !== tag))}
              aria-label={`Stop filtering by ${tag}`}
            >
              ×
            </button>
          </span>
        ))}
        {picking ? (
          <TagPicker
            options={flattenTagTree(candidateTree)}
            exclude={selected}
            folderName={scopeName}
            allowCreate={false}
            placeholder="Filter by tag…"
            onPick={addTag}
            onClose={() => setPicking(false)}
            onBackspaceEmpty={() => {
              if (hasTags) onSelectedTagsChange(selectedTags.slice(0, -1));
            }}
          />
        ) : (
          <button className="tag-bar-add-btn" onClick={() => setPicking(true)} title="Only show notes with this tag">
            + Tag filter
          </button>
        )}
        {hasTags && (
          <button className="sidebar-link-btn search-tags-clear" onClick={() => onSelectedTagsChange([])}>
            Clear
          </button>
        )}
      </div>

      {hasTags && (
        <label className="tag-filter-tree search-tree-toggle">
          <input type="checkbox" checked={filterTree} onChange={(e) => onFilterTreeChange(e.target.checked)} />
          Show only these notes in Files
        </label>
      )}

      <div className="search-panel-status">{status}</div>

      <div className="sidebar-scroll">
        {q && results?.files.map((file) => {
          const isCollapsed = collapsed.has(file.path);
          const rel = relativeTo(dirname(file.path), root);
          return (
            <div className="search-file" key={file.path}>
              <button className="search-file-header" onClick={() => toggleFile(file.path)} title={file.path}>
                <Chevron open={!isCollapsed} />
                <span className="search-file-name">{basename(file.path)}</span>
                <span className="search-file-dir">{rel === root ? "" : rel}</span>
                <span className="search-file-count">{file.hits.length}</span>
              </button>
              {!isCollapsed && file.hits.map((hit) => (
                <button
                  key={hit.line}
                  className="search-hit"
                  onClick={(e) =>
                    onOpenMatch(file.path, resultsQuery, hit.line, { newTab: e.metaKey || e.ctrlKey })
                  }
                  title={`Line ${hit.line}`}
                >
                  <span className="search-hit-line">{hit.line}</span>
                  <span className="search-hit-text"><Highlighted text={hit.preview} query={resultsQuery} /></span>
                </button>
              ))}
            </div>
          );
        })}

        {!q && hasTags && tagMatches.map((path) => {
          const dir = relativeTo(dirname(path), root);
          return (
            <button
              key={path}
              className={`properties-note${path === activePath ? " active" : ""}`}
              onClick={(e) => onOpenFile(path, { newTab: e.metaKey || e.ctrlKey })}
              title={path}
            >
              <span className="properties-note-name">{basename(path)}</span>
              <span className="properties-note-dir">{dir === root ? "" : dir}</span>
            </button>
          );
        })}

        {!q && (
          <div className="properties-section">
            <div className="properties-section-title tag-tree-title">
              <span>{hasTags ? "Narrow further" : `Tags in ${scopeName}`}</span>
              <button
                className="sidebar-icon-btn"
                onClick={onRefreshTags}
                title="Re-scan tags (picks up edits made outside Bioscratch)"
                aria-label="Re-scan tags"
                disabled={tagIndexLoading}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/>
                </svg>
              </button>
            </div>
            {candidateTree.length > 0 ? (
              renderTagNodes(candidateTree, 0)
            ) : (
              <div className="sidebar-empty">
                {tagIndexLoading
                  ? "Scanning tags…"
                  : hasTags
                    ? "No other tags on these notes."
                    : "No tags here yet. Add some with the tag bar above the editor; use / for subtags."}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default SearchPanel;
