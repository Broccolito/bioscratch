import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DirEntry,
  listDir,
  ancestorsWithin,
  basename,
  createUntitled,
  dirname,
  moveToTrash,
  nameSelectionEnd,
  openWithDefaultApp,
  remapPath,
  renamePath,
  revealInFinder,
} from "../lib/workspace";
import { isOpenableTextFile } from "../lib/fileMode";
import TrashConfirmDialog from "./TrashConfirmDialog";

export interface OpenOptions {
  newTab?: boolean;
}

/** A request to create an untitled file or folder at the top of the tree. */
export interface CreateRequest {
  kind: "file" | "folder";
  seq: number;
}

/** A request to expand the tree to `path`. `seq` makes repeat requests fire. */
export interface RevealRequest {
  path: string;
  isDir: boolean;
  seq: number;
}

interface FileTreeProps {
  root: string;
  activePath: string | null;
  reveal: RevealRequest | null;
  showHidden: boolean;
  active: boolean;
  /** When set, only these files and the folders leading to them are shown. */
  visible: TreeFilter | null;
  onOpenFile: (path: string, options?: OpenOptions) => void;
  /** Make `folder` the top of the tree (double-click a folder). */
  onOpenFolder: (folder: string) => void;
  createRequest: CreateRequest | null;
  /** A file or folder was renamed on disk; the app updates tabs and history. */
  onRenamed: (from: string, to: string, isDir: boolean) => void;
  /** A file or folder was moved to the Trash. */
  onDeleted: (path: string) => void;
}

interface EditingState {
  path: string;
  isDir: boolean;
  /** Just created: a new note opens once it has been named. */
  isNew: boolean;
}

/** Inline name editor that pre-selects the name (not the extension). */
const NameInput: React.FC<{
  initial: string;
  isDir: boolean;
  error: string | null;
  onCommit: (name: string) => void;
  onCancel: () => void;
}> = ({ initial, isDir, error, onCommit, onCancel }) => {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const input = ref.current;
    if (!input) return;
    input.focus();
    input.setSelectionRange(0, nameSelectionEnd(initial, isDir));
  }, [initial, isDir]);
  return (
    <input
      ref={ref}
      className={`file-tree-rename${error ? " invalid" : ""}`}
      defaultValue={initial}
      title={error ?? "Enter to save, Esc to cancel"}
      spellCheck={false}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") {
          e.preventDefault();
          onCommit(e.currentTarget.value);
        } else if (e.key === "Escape") {
          e.preventDefault();
          onCancel();
        }
      }}
      onBlur={(e) => onCommit(e.currentTarget.value)}
      aria-label="Name"
      aria-invalid={!!error}
    />
  );
};

export interface TreeFilter {
  files: Set<string>;
  /** Every ancestor folder of a visible file; these are auto-expanded. */
  dirs: Set<string>;
}

interface ContextMenuState {
  x: number;
  y: number;
  entry: DirEntry;
}

const REFRESH_MS = 3000;

function expandedKey(root: string) {
  return `bioscratch-tree-expanded:${root}`;
}

function loadExpanded(root: string): Set<string> {
  try {
    const raw = localStorage.getItem(expandedKey(root));
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

function sameEntries(a: DirEntry[] | undefined, b: DirEntry[]): boolean {
  if (!a || a.length !== b.length) return false;
  return a.every((e, i) => e.path === b[i].path && e.is_dir === b[i].is_dir);
}

const ChevronIcon: React.FC<{ open: boolean }> = ({ open }) => (
  <svg className={`file-tree-chevron${open ? " open" : ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="m9 18 6-6-6-6"/>
  </svg>
);

const FolderIcon: React.FC = () => (
  <svg className="file-tree-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/>
  </svg>
);

const FileIcon: React.FC = () => (
  <svg className="file-tree-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
    <polyline points="14 2 14 8 20 8"/>
  </svg>
);

const FileTree: React.FC<FileTreeProps> = ({
  root,
  activePath,
  reveal,
  showHidden,
  active,
  visible,
  onOpenFile,
  onOpenFolder,
  createRequest,
  onRenamed,
  onDeleted,
}) => {
  const [expanded, setExpanded] = useState<Set<string>>(() => loadExpanded(root));
  const [children, setChildren] = useState<Map<string, DirEntry[]>>(new Map());
  const [errors, setErrors] = useState<Map<string, string>>(new Map());
  const [menu, setMenu] = useState<ContextMenuState | null>(null);
  const [editing, setEditing] = useState<EditingState | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingTrash, setPendingTrash] = useState<DirEntry | null>(null);
  // Enter commits and then blur fires; only the first may act.
  const committingRef = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);
  // A tree filter opens every folder that leads to a match, without touching
  // the user's own expanded set.
  const [filterCollapsed, setFilterCollapsed] = useState<Set<string>>(new Set());
  useEffect(() => { setFilterCollapsed(new Set()); }, [visible]);
  const effectiveExpanded = useMemo(() => {
    if (!visible) return expanded;
    const open = new Set(expanded);
    for (const dir of visible.dirs) if (!filterCollapsed.has(dir)) open.add(dir);
    return open;
  }, [expanded, visible, filterCollapsed]);
  const expandedRef = useRef(effectiveExpanded);
  useEffect(() => { expandedRef.current = effectiveExpanded; }, [effectiveExpanded]);

  // Reset when the root changes.
  useEffect(() => {
    setExpanded(loadExpanded(root));
    setChildren(new Map());
    setErrors(new Map());
  }, [root]);

  useEffect(() => {
    try {
      localStorage.setItem(expandedKey(root), JSON.stringify([...expanded]));
    } catch {}
  }, [root, expanded]);

  const loadDir = useCallback(async (dir: string) => {
    try {
      const entries = await listDir(dir, showHidden);
      setChildren((prev) => {
        if (sameEntries(prev.get(dir), entries)) return prev;
        const next = new Map(prev);
        next.set(dir, entries);
        return next;
      });
      setErrors((prev) => {
        if (!prev.has(dir)) return prev;
        const next = new Map(prev);
        next.delete(dir);
        return next;
      });
    } catch (error) {
      setErrors((prev) => new Map(prev).set(dir, String(error)));
    }
  }, [showHidden]);

  // Load the root and every expanded folder; re-list them periodically so
  // files created or deleted outside the app show up.
  useEffect(() => {
    if (!active) return;
    const refresh = () => {
      void loadDir(root);
      for (const dir of expandedRef.current) void loadDir(dir);
    };
    refresh();
    const id = setInterval(refresh, REFRESH_MS);
    window.addEventListener("focus", refresh);
    return () => {
      clearInterval(id);
      window.removeEventListener("focus", refresh);
    };
  }, [root, active, loadDir]);

  /** Create an untitled file/folder in `dir` (opening it) and start naming it. */
  const createIn = useCallback(async (dir: string, kind: CreateRequest["kind"]) => {
    setActionError(null);
    try {
      const path = await createUntitled(dir, kind);
      if (dir !== root) setExpanded((prev) => (prev.has(dir) ? prev : new Set([...prev, dir])));
      await loadDir(dir);
      setEditError(null);
      setEditing({ path, isDir: kind === "folder", isNew: true });
    } catch (err) {
      setActionError(`Couldn't create: ${err}`);
    }
  }, [root, loadDir]);

  // The Files panel's New File / New Folder buttons create at the top of the tree.
  const handledCreateRef = useRef(createRequest?.seq ?? 0);
  useEffect(() => {
    if (!createRequest || createRequest.seq === handledCreateRef.current) return;
    handledCreateRef.current = createRequest.seq;
    void createIn(root, createRequest.kind);
  }, [createRequest, root, createIn]);

  const trash = useCallback(async (entry: DirEntry) => {
    setActionError(null);
    try {
      await moveToTrash(entry.path);
      if (entry.is_dir) {
        setExpanded((prev) => new Set([...prev].filter((p) => p !== entry.path && !p.startsWith(`${entry.path}/`))));
      }
      await loadDir(dirname(entry.path));
      onDeleted(entry.path);
    } catch (err) {
      setActionError(`Couldn't move "${entry.name}" to the Trash: ${err}`);
    }
  }, [loadDir, onDeleted]);

  const finishEditing = useCallback((path: string, wasNew: boolean, isDir: boolean) => {
    setEditing(null);
    setEditError(null);
    if (wasNew && !isDir && isOpenableTextFile(path)) onOpenFile(path);
  }, [onOpenFile]);

  const commitName = useCallback(async (value: string) => {
    if (!editing || committingRef.current) return;
    const { path, isDir, isNew } = editing;
    if (value.trim() === basename(path)) {
      finishEditing(path, isNew, isDir);
      return;
    }
    committingRef.current = true;
    try {
      const to = await renamePath(path, value);
      if (isDir) {
        // Keep the renamed folder (and anything open inside it) expanded.
        setExpanded((prev) => new Set([...prev].map((p) => remapPath(p, path, to))));
        setChildren((prev) => {
          const next = new Map<string, DirEntry[]>();
          for (const [dir, entries] of prev) if (dir !== path && !dir.startsWith(`${path}/`)) next.set(dir, entries);
          return next;
        });
      }
      await loadDir(dirname(to));
      onRenamed(path, to, isDir);
      finishEditing(to, isNew, isDir);
    } catch (err) {
      setEditError(String(err));
    } finally {
      committingRef.current = false;
    }
  }, [editing, finishEditing, loadDir, onRenamed]);

  // Load folders opened by a newly applied filter.
  useEffect(() => {
    if (!visible) return;
    for (const dir of visible.dirs) if (!children.has(dir)) void loadDir(dir);
    // children is read, not watched: loaded folders don't need reloading.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, loadDir]);

  // Expand to the revealed file and scroll it into view.
  useEffect(() => {
    if (!reveal) return;
    const ancestors = ancestorsWithin(reveal.path, root);
    if (reveal.isDir && reveal.path !== root) ancestors.push(reveal.path);
    if (ancestors.length === 0) return;
    setExpanded((prev) => {
      const missing = ancestors.filter((dir) => dir !== root && !prev.has(dir));
      if (missing.length === 0) return prev;
      missing.forEach((dir) => void loadDir(dir));
      return new Set([...prev, ...missing]);
    });
  }, [reveal, root, loadDir]);

  // Scroll once per request, as soon as the row exists (its folders may still
  // be loading on the first render after the request).
  const scrolledSeqRef = useRef(-1);
  useEffect(() => {
    if (!reveal || scrolledSeqRef.current === reveal.seq) return;
    const frame = requestAnimationFrame(() => {
      const row = containerRef.current?.querySelector<HTMLElement>(
        `[data-path="${CSS.escape(reveal.path)}"]`
      );
      if (!row) return;
      scrolledSeqRef.current = reveal.seq;
      row.scrollIntoView({ block: "nearest" });
    });
    return () => cancelAnimationFrame(frame);
  }, [reveal, children]);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener("mousedown", close);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("blur", close);
    };
  }, [menu]);

  const toggleDir = useCallback((dir: string) => {
    if (visible?.dirs.has(dir)) {
      // Folders opened by the filter collapse for as long as the filter lasts.
      setFilterCollapsed((prev) => {
        const next = new Set(prev);
        if (next.has(dir)) next.delete(dir);
        else next.add(dir);
        return next;
      });
      setExpanded((prev) => {
        if (!prev.has(dir)) return prev;
        const next = new Set(prev);
        next.delete(dir);
        return next;
      });
      return;
    }
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(dir)) {
        next.delete(dir);
      } else {
        next.add(dir);
        void loadDir(dir);
      }
      return next;
    });
  }, [loadDir, visible]);

  const activate = (entry: DirEntry, event: React.MouseEvent) => {
    if (entry.is_dir) {
      toggleDir(entry.path);
    } else if (isOpenableTextFile(entry.path)) {
      onOpenFile(entry.path, { newTab: event.metaKey || event.ctrlKey });
    }
  };

  const renderEntries = (dir: string, depth: number): React.ReactNode => {
    const entries = children.get(dir);
    const error = errors.get(dir);
    if (error && !entries) {
      return <div className="file-tree-error" role="alert" title={error} style={{ marginLeft: 6 + depth * 14 }}>Can't read folder</div>;
    }
    if (!entries) {
      return <div className="file-tree-note" style={{ paddingLeft: 12 + depth * 14 }}>Loading…</div>;
    }
    const shown = visible
      ? entries.filter((e) =>
          e.path === editing?.path || (e.is_dir ? visible.dirs.has(e.path) : visible.files.has(e.path))
        )
      : entries;
    const warning = error ? (
      <div className="file-tree-error" role="alert" title={error} style={{ marginLeft: 6 + depth * 14 }}>
        Can't refresh folder. Showing its last loaded contents.
      </div>
    ) : null;
    if (shown.length === 0) {
      return <>{warning}<div className="file-tree-note" style={{ paddingLeft: 12 + depth * 14 }}>{visible ? "No matching notes" : "Empty"}</div></>;
    }
    return <>{warning}{shown.map((entry) => {
      const isOpen = entry.is_dir && effectiveExpanded.has(entry.path);
      const openable = entry.is_dir || isOpenableTextFile(entry.path);
      const classes = [
        "file-tree-row",
        entry.path === activePath ? "active" : "",
        openable ? "" : "unsupported",
      ].filter(Boolean).join(" ");
      return (
        <React.Fragment key={entry.path}>
          <div
            className={classes}
            data-path={entry.path}
            style={{ paddingLeft: 6 + depth * 14 }}
            title={
              entry.is_dir
                ? `${entry.path}\nDouble-click to open this folder`
                : openable
                  ? entry.path
                  : `${entry.path}\nDouble-click to open in its default app`
            }
            onClick={(event) => activate(entry, event)}
            onDoubleClick={() => {
              if (entry.is_dir) onOpenFolder(entry.path);
              else if (!openable) void openWithDefaultApp(entry.path).catch(console.error);
            }}
            onContextMenu={(event) => {
              event.preventDefault();
              setMenu({ x: event.clientX, y: event.clientY, entry });
            }}
          >
            <span className="file-tree-twisty">{entry.is_dir && <ChevronIcon open={isOpen} />}</span>
            {entry.is_dir ? <FolderIcon /> : <FileIcon />}
            {editing?.path === entry.path ? (
              <NameInput
                initial={entry.name}
                isDir={entry.is_dir}
                error={editError}
                onCommit={(name) => void commitName(name)}
                onCancel={() => finishEditing(entry.path, editing.isNew, entry.is_dir)}
              />
            ) : (
              <span className="file-tree-name">{entry.name}</span>
            )}
          </div>
          {isOpen && renderEntries(entry.path, depth + 1)}
        </React.Fragment>
      );
    })}</>;
  };

  const menuItems: Array<{ label: string; run: () => void; danger?: boolean }> = menu
    ? [
        ...(!menu.entry.is_dir && isOpenableTextFile(menu.entry.path)
          ? [{ label: "Open in New Tab", run: () => onOpenFile(menu.entry.path, { newTab: true }) }]
          : []),
        ...(menu.entry.is_dir
          ? [
              { label: "Open Folder", run: () => onOpenFolder(menu.entry.path) },
              { label: "New File", run: () => void createIn(menu.entry.path, "file") },
              { label: "New Folder", run: () => void createIn(menu.entry.path, "folder") },
            ]
          : []),
        ...(!menu.entry.is_dir
          ? [{ label: "Open with Default App", run: () => void openWithDefaultApp(menu.entry.path).catch(console.error) }]
          : []),
        {
          label: "Rename",
          run: () => {
            setEditError(null);
            setEditing({ path: menu.entry.path, isDir: menu.entry.is_dir, isNew: false });
          },
        },
        { label: "Reveal in Finder", run: () => void revealInFinder(menu.entry.path).catch(console.error) },
        { label: "Copy Path", run: () => void navigator.clipboard?.writeText(menu.entry.path) },
        { label: "Move to Trash…", danger: true, run: () => setPendingTrash(menu.entry) },
      ]
    : [];

  return (
    <div className="file-tree" ref={containerRef} role="tree">
      {actionError && (
        <div className="file-tree-error" role="alert">
          {actionError}
          <button className="sidebar-link-btn" onClick={() => setActionError(null)}>Dismiss</button>
        </div>
      )}
      {renderEntries(root, 0)}
      {pendingTrash && (
        <TrashConfirmDialog
          name={pendingTrash.name}
          isDir={pendingTrash.is_dir}
          onCancel={() => setPendingTrash(null)}
          onConfirm={() => {
            const entry = pendingTrash;
            setPendingTrash(null);
            void trash(entry);
          }}
        />
      )}
      {menu && (
        <div
          className="file-tree-menu"
          style={{ left: menu.x, top: menu.y }}
          onMouseDown={(event) => event.stopPropagation()}
        >
          {menuItems.map((item) => (
            <button
              key={item.label}
              className={`file-tree-menu-item${item.danger ? " danger" : ""}`}
              onClick={() => {
                setMenu(null);
                item.run();
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default FileTree;
