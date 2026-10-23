import React, { useCallback, useEffect, useRef, useState } from "react";
import FileTree, { CreateRequest, OpenOptions, RevealRequest, TreeFilter } from "./FileTree";
import SearchPanel from "./SearchPanel";
import type { TagIndex } from "../lib/tagIndex";
import { basename, breadcrumbs, dirname } from "../lib/workspace";

interface SidebarProps {
  folders: string[];
  workspaceReady: boolean;
  activeRoot: string | null;
  activePath: string | null;
  reveal: RevealRequest | null;
  searchFocusSeq: number;
  width: number;
  onWidthChange: (width: number) => void;
  onSelectRoot: (root: string) => void;
  onAddFolder: () => void;
  onRemoveFolder: (root: string) => void;
  onOpenFile: (path: string, options?: OpenOptions) => void;
  onOpenMatch: (path: string, query: string, line: number, options?: OpenOptions) => void;
  /** Folder shown at the top of the Files tree; also the search scope. */
  viewDir: string | null;
  onViewDirChange: (folder: string) => void;
  tagIndex: TagIndex;
  tagIndexLoading: boolean;
  selectedTags: string[];
  tagMatches: string[];
  filterTree: boolean;
  /** Non-null when the tag filter is applied to the Files tree. */
  treeFilter: TreeFilter | null;
  onSelectedTagsChange: (tags: string[]) => void;
  onFilterTreeChange: (on: boolean) => void;
  onRefreshTags: () => void;
  /** A file or folder was renamed from the Files tree. */
  onRenamed: (from: string, to: string, isDir: boolean) => void;
  /** A file or folder was moved to the Trash from the Files tree. */
  onDeleted: (path: string) => void;
  /** Open notes with unsaved changes → current text, for live search. */
  openDocs: Map<string, string>;
}

export const SIDEBAR_MIN_WIDTH = 180;
export const SIDEBAR_MAX_WIDTH = 520;

const SHOW_HIDDEN_KEY = "bioscratch-show-hidden";

const Sidebar: React.FC<SidebarProps> = ({
  folders,
  workspaceReady,
  activeRoot,
  activePath,
  reveal,
  searchFocusSeq,
  width,
  onWidthChange,
  onSelectRoot,
  onAddFolder,
  onRemoveFolder,
  onOpenFile,
  onOpenMatch,
  viewDir,
  onViewDirChange,
  tagIndex,
  tagIndexLoading,
  selectedTags,
  tagMatches,
  filterTree,
  treeFilter,
  onSelectedTagsChange,
  onFilterTreeChange,
  onRefreshTags,
  onRenamed,
  onDeleted,
  openDocs,
}) => {
  const [createRequest, setCreateRequest] = useState<CreateRequest | null>(null);
  const requestCreate = (kind: CreateRequest["kind"]) =>
    setCreateRequest((prev) => ({ kind, seq: (prev?.seq ?? 0) + 1 }));
  // Focus requests for the search box: ⇧⌘F (from the app) or the tree-filter banner.
  const [localSearchFocus, setLocalSearchFocus] = useState(0);
  const [showHidden, setShowHidden] = useState(() => {
    try {
      return localStorage.getItem(SHOW_HIDDEN_KEY) === "1";
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(SHOW_HIDDEN_KEY, showHidden ? "1" : "0");
    } catch {}
  }, [showHidden]);

  // Drag the right edge to resize.
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragRef.current = { startX: e.clientX, startWidth: width };
    const zoom = parseFloat(document.documentElement.style.zoom || "1") || 1;
    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      const delta = (ev.clientX - dragRef.current.startX) / zoom;
      const next = Math.round(dragRef.current.startWidth + delta);
      onWidthChange(Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, next)));
    };
    const onUp = () => {
      dragRef.current = null;
      document.body.classList.remove("sidebar-resizing");
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    document.body.classList.add("sidebar-resizing");
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [width, onWidthChange]);

  const dir = viewDir ?? activeRoot ?? "";

  return (
    <aside className="sidebar" style={{ width }}>
      {activeRoot ? (
        <>
          <div className="sidebar-root-row">
            <select
              className="sidebar-root-select"
              value={activeRoot}
              onChange={(e) => onSelectRoot(e.target.value)}
              title={activeRoot}
            >
              {folders.map((folder) => (
                <option key={folder} value={folder}>{basename(folder)}</option>
              ))}
            </select>
            <button className="sidebar-icon-btn" onClick={onAddFolder} title="Open another folder… (⇧⌘O)" aria-label="Open folder">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2"/>
              </svg>
            </button>
            <button
              className={`sidebar-icon-btn${showHidden ? " active" : ""}`}
              onClick={() => setShowHidden((v) => !v)}
              title={showHidden ? "Hide hidden files" : "Show hidden files"}
              aria-label="Toggle hidden files"
              aria-pressed={showHidden}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>
                {!showHidden && <path d="m3 3 18 18"/>}
              </svg>
            </button>
            <button
              className="sidebar-icon-btn"
              onClick={() => onRemoveFolder(activeRoot)}
              title={`Remove ${basename(activeRoot)} from the sidebar (files are not touched)`}
              aria-label="Remove folder from sidebar"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M18 6 6 18"/><path d="m6 6 12 12"/>
              </svg>
            </button>
          </div>

          {/* One panel: folder navigation and tree on top, search and its results below. */}
          <div className="sidebar-body">
            <div className="folder-nav">
                <button
                  className="sidebar-icon-btn"
                  onClick={() => onViewDirChange(dirname(dir))}
                  disabled={dir === activeRoot}
                  title="Up one folder"
                  aria-label="Up one folder"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="m18 15-6-6-6 6"/>
                  </svg>
                </button>
                <nav className="folder-nav-crumbs" aria-label="Folder">
                  {breadcrumbs(dir, activeRoot).map((crumb, i, all) => (
                    <React.Fragment key={crumb.path}>
                      {i > 0 && <span className="nav-bar-sep">›</span>}
                      {i === all.length - 1 ? (
                        <span className="folder-nav-crumb current" title={crumb.path}>{crumb.name}</span>
                      ) : (
                        <button className="folder-nav-crumb" onClick={() => onViewDirChange(crumb.path)} title={crumb.path}>
                          {crumb.name}
                        </button>
                      )}
                    </React.Fragment>
                  ))}
                </nav>
                <button
                  className="sidebar-icon-btn"
                  onClick={() => requestCreate("file")}
                  title={`New note in ${basename(dir)}`}
                  aria-label="New file"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                    <polyline points="14 2 14 8 20 8"/>
                    <path d="M12 12v6"/><path d="M9 15h6"/>
                  </svg>
                </button>
                <button
                  className="sidebar-icon-btn"
                  onClick={() => requestCreate("folder")}
                  title={`New folder in ${basename(dir)}`}
                  aria-label="New folder"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/>
                    <path d="M12 10v6"/><path d="M9 13h6"/>
                  </svg>
                </button>
            </div>
            {treeFilter && (
              <div className="tree-filter-banner">
                <button
                  className="tree-filter-summary"
                  onClick={() => setLocalSearchFocus((n) => n + 1)}
                  title="Edit the tag filter"
                >
                  Only {selectedTags.map((t) => `#${t}`).join(" + ")}
                </button>
                <button className="sidebar-link-btn" onClick={() => onFilterTreeChange(false)}>
                  Show all
                </button>
              </div>
            )}
            <div className="sidebar-scroll sidebar-tree-area">
              {workspaceReady ? (
              <FileTree
                root={dir}
                activePath={activePath}
                reveal={reveal}
                showHidden={showHidden}
                active
                visible={treeFilter}
                onOpenFile={onOpenFile}
                onOpenFolder={onViewDirChange}
                createRequest={createRequest}
                onRenamed={onRenamed}
                onDeleted={onDeleted}
              />
              ) : (
                <div className="file-tree-note">Opening folder…</div>
              )}
            </div>
            <div className="sidebar-search-area">
            <SearchPanel
              root={activeRoot}
              scope={dir}
              focusSeq={searchFocusSeq + localSearchFocus}
              tagIndex={tagIndex}
              tagIndexLoading={tagIndexLoading}
              selectedTags={selectedTags}
              tagMatches={tagMatches}
              filterTree={filterTree}
              activePath={activePath}
              openDocs={openDocs}
              onSelectedTagsChange={onSelectedTagsChange}
              onFilterTreeChange={onFilterTreeChange}
              onRefreshTags={onRefreshTags}
              onOpenMatch={onOpenMatch}
              onOpenFile={onOpenFile}
            />
            </div>
          </div>
        </>
      ) : (
        <div className="sidebar-welcome">
          <p>Browse, search and tag the notes in any folder on your Mac.</p>
          <button className="sidebar-primary-btn" onClick={onAddFolder}>Open Folder…</button>
          <span className="sidebar-hint"><kbd>⇧⌘O</kbd></span>
        </div>
      )}

      <div className="sidebar-resize-handle" onMouseDown={handleResizeStart} aria-hidden="true" />
    </aside>
  );
};

export default Sidebar;
