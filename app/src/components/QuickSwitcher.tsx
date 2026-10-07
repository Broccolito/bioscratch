import React, { useEffect, useMemo, useRef, useState } from "react";
import { fuzzyRank } from "../lib/fuzzy";
import { basename, dirname, relativeTo, containingRoot } from "../lib/workspace";
import type { OpenOptions } from "./FileTree";

interface QuickSwitcherProps {
  /** Files under the active workspace folder (already filtered to openable). */
  workspaceFiles: string[];
  workspaceRoot: string | null;
  folders: string[];
  /** Open tabs and recent files, most relevant first; shown for an empty query. */
  recentPaths: string[];
  loading: boolean;
  truncated: boolean;
  onOpen: (path: string, options?: OpenOptions) => void;
  onClose: () => void;
}

interface Candidate {
  path: string;
  /** What the fuzzy matcher sees and the row displays. */
  label: string;
}

const MAX_ROWS = 50;

function labelFor(path: string, root: string | null, folders: string[]): string {
  const owner = root && path.startsWith(`${root}/`) ? root : containingRoot(path, folders);
  if (!owner) return path;
  return `${basename(owner)}/${relativeTo(path, owner)}`;
}

const Highlight: React.FC<{ text: string; indices: number[]; offset: number }> = ({ text, indices, offset }) => {
  const set = new Set(indices);
  return (
    <>
      {text.split("").map((ch, i) =>
        set.has(i + offset) ? <mark key={i}>{ch}</mark> : <React.Fragment key={i}>{ch}</React.Fragment>
      )}
    </>
  );
};

const QuickSwitcher: React.FC<QuickSwitcherProps> = ({
  workspaceFiles,
  workspaceRoot,
  folders,
  recentPaths,
  loading,
  truncated,
  onOpen,
  onClose,
}) => {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const candidates = useMemo<Candidate[]>(() => {
    const seen = new Set<string>();
    const out: Candidate[] = [];
    for (const path of [...recentPaths, ...workspaceFiles]) {
      if (seen.has(path)) continue;
      seen.add(path);
      out.push({ path, label: labelFor(path, workspaceRoot, folders) });
    }
    return out;
  }, [recentPaths, workspaceFiles, workspaceRoot, folders]);

  const rows = useMemo(() => {
    if (!query.trim()) {
      // Empty query: open tabs and recent files, else the folder's first files.
      const recent = new Set(recentPaths);
      const base = recent.size > 0 ? candidates.filter((c) => recent.has(c.path)) : candidates;
      return base
        .slice(0, MAX_ROWS)
        .map((item) => ({ item, match: { score: 0, indices: [] as number[] } }));
    }
    return fuzzyRank(query, candidates, (c) => c.label, MAX_ROWS);
  }, [query, candidates, recentPaths]);

  useEffect(() => { setSelected(0); }, [query]);

  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${selected}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  const choose = (index: number, newTab: boolean) => {
    const row = rows[index];
    if (!row) return;
    onClose();
    onOpen(row.item.path, { newTab });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "ArrowDown" || (e.ctrlKey && e.key === "n")) {
      e.preventDefault();
      setSelected((s) => Math.min(rows.length - 1, s + 1));
    } else if (e.key === "ArrowUp" || (e.ctrlKey && e.key === "p")) {
      e.preventDefault();
      setSelected((s) => Math.max(0, s - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(selected, e.metaKey || e.ctrlKey);
    }
  };

  const emptyMessage = loading
    ? "Loading files…"
    : !workspaceRoot && candidates.length === 0
      ? "Open a folder (⇧⌘O) to search its files here."
      : query.trim()
        ? "No matching files"
        : "Type to search files";

  return (
    <div
      className="quick-switcher-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="quick-switcher" role="dialog" aria-modal="true" aria-label="Quick Open">
        <input
          ref={inputRef}
          className="quick-switcher-input"
          type="text"
          placeholder={workspaceRoot ? `Go to file in ${basename(workspaceRoot)}…` : "Go to file…"}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          spellCheck={false}
        />
        <div className="quick-switcher-list" ref={listRef} role="listbox">
          {rows.length === 0 ? (
            <div className="quick-switcher-empty">{emptyMessage}</div>
          ) : rows.map(({ item, match }, i) => {
            const nameStart = item.label.lastIndexOf("/") + 1;
            const name = item.label.slice(nameStart);
            const dir = nameStart > 0 ? item.label.slice(0, nameStart - 1) : dirname(item.path);
            return (
              <div
                key={item.path}
                data-index={i}
                role="option"
                aria-selected={i === selected}
                className={`quick-switcher-row${i === selected ? " selected" : ""}`}
                onMouseMove={() => setSelected(i)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(i, e.metaKey || e.ctrlKey);
                }}
                title={item.path}
              >
                <span className="quick-switcher-name">
                  <Highlight text={name} indices={match.indices} offset={nameStart} />
                </span>
                <span className="quick-switcher-dir">
                  <Highlight text={dir} indices={match.indices} offset={0} />
                </span>
              </div>
            );
          })}
        </div>
        <div className="quick-switcher-footer">
          <span><kbd>↵</kbd> open</span>
          <span><kbd>⌘↵</kbd> new tab</span>
          <span><kbd>esc</kbd> close</span>
          {truncated && <span className="quick-switcher-warn">Large folder: first 50,000 files only</span>}
        </div>
      </div>
    </div>
  );
};

export default QuickSwitcher;
