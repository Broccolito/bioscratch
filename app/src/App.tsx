import React, { useRef, useState, useEffect, useCallback } from "react";
import { EditorView } from "prosemirror-view";
import { EditorState } from "prosemirror-state";
import { schema } from "./editor/schema";
import { markdownToDoc } from "./editor/serialization/markdownImport";
import { docToMarkdown } from "./editor/serialization/markdownExport";
import { getDocStats } from "./lib/stats";
import { exportToHtml } from "./lib/export";
import { useTheme } from "./hooks/useTheme";
import { useRecentFiles } from "./hooks/useRecentFiles";
import { useAutosave } from "./hooks/useAutosave";
import { loadAutosave, deleteAutosave } from "./hooks/useAutosave";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import Toolbar from "./components/Toolbar";
import TabBar, { TabData } from "./components/TabBar";
import EditorSurface from "./components/EditorSurface";
import StatusBar from "./components/StatusBar";
import SearchBar from "./components/SearchBar";
import RecoveryDialog from "./components/RecoveryDialog";

import "./styles/app.css";

interface RecoveryData {
  key: string;
  content: string;
  filePath: string | null;
  tabId: string;
}

// Stored per-tab data when a tab is not active
interface StoredTab {
  id: string;
  filePath: string | null;
  dirty: boolean;
  content: string;
  editorState: EditorState | null;
}

let nextTabId = 1;
function makeTabId() {
  return `tab-${nextTabId++}`;
}

function makeEmptyEditorState(plugins: EditorState["plugins"]): EditorState {
  const doc = markdownToDoc("", schema);
  return EditorState.create({ doc, plugins });
}

function makeEditorStateFromMarkdown(
  markdown: string,
  plugins: EditorState["plugins"]
): EditorState {
  const doc = markdownToDoc(markdown, schema);
  return EditorState.create({ doc, plugins });
}

const App: React.FC = () => {
  const viewRef = useRef<EditorView | null>(null);
  const { theme, toggleTheme } = useTheme();
  const { addRecentFile } = useRecentFiles();

  // Per-tab storage (inactive tabs)
  const storedTabsRef = useRef<Map<string, StoredTab>>(new Map());

  // Active tab id
  const [activeTabId, setActiveTabId] = useState<string>("");

  // Tab bar metadata (derived from stored tabs + active tab)
  const [tabs, setTabs] = useState<TabData[]>([]);

  // Active tab live state
  const [filePath, setFilePath] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [wordCount, setWordCount] = useState(0);
  const [charCount, setCharCount] = useState(0);
  const [content, setContent] = useState("");

  const [searchVisible, setSearchVisible] = useState(false);
  const [recovery, setRecovery] = useState<RecoveryData | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [draggingTabId, setDraggingTabId] = useState<string | null>(null);
  const draggingTabIdRef = useRef<string | null>(null);
  useEffect(() => { draggingTabIdRef.current = draggingTabId; }, [draggingTabId]);
  // External file watch states (keyed by file path so tab-switching preserves them)
  const [externalChange, setExternalChange] = useState<string | null>(null);
  const [deletedPaths, setDeletedPaths] = useState<Set<string>>(new Set());
  const fileDeleted = !!(filePath && deletedPaths.has(filePath));

  // Autosave current tab
  useAutosave(content, filePath, dirty);

  // Keep tab bar in sync with active tab metadata
  const syncTabMeta = useCallback(
    (id: string, updates: Partial<Pick<TabData, "filePath" | "dirty">>) => {
      setTabs((prev) =>
        prev.map((t) => (t.id === id ? { ...t, ...updates } : t))
      );
    },
    []
  );

  // ---- Editor mount ----
  const handleMount = useCallback(
    (view: EditorView) => {
      viewRef.current = view;

      // If this window was spawned from a detached tab, open the file from URL params
      const params = new URLSearchParams(window.location.search);
      const initialFile = params.get("file");
      if (initialFile) {
        // Create a tab immediately so the editor wrapper becomes visible
        const id = makeTabId();
        setTabs([{ id, filePath: initialFile, dirty: false }]);
        setActiveTabId(id);
        invoke<string>("read_file", { path: initialFile })
          .then((fileContent) => {
            const state = makeEditorStateFromMarkdown(fileContent, view.state.plugins);
            view.updateState(state);
            setFilePath(initialFile);
            setContent(fileContent);
            setDirty(false);
            lastDiskContentRef.current = fileContent;
            const stats = getDocStats(markdownToDoc(fileContent, schema));
            setWordCount(stats.words);
            setCharCount(stats.chars);
          })
          .catch(console.error);
        return; // skip autosave check for spawned windows
      }

      // No autosave recovery on startup — user must explicitly open or create a file
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  // ---- Change handler ----
  const handleChange = useCallback(() => {
    setDirty(true);
    syncTabMeta(activeTabId, { dirty: true });
    const view = viewRef.current;
    if (view) {
      const stats = getDocStats(view.state.doc);
      setWordCount(stats.words);
      setCharCount(stats.chars);
      setContent(docToMarkdown(view.state.doc));
    }
  }, [activeTabId, syncTabMeta]);

  // ---- Load content into the active editor ----
  const loadDocContent = useCallback(
    (markdown: string, path: string | null) => {
      const view = viewRef.current;
      if (!view) return;
      const newState = makeEditorStateFromMarkdown(markdown, view.state.plugins);
      view.updateState(newState);
      setFilePath(path);
      setContent(markdown);
      setDirty(false);
      lastDiskContentRef.current = markdown;
      syncTabMeta(activeTabId, { filePath: path, dirty: false });
      const stats = getDocStats(newState.doc);
      setWordCount(stats.words);
      setCharCount(stats.chars);
    },
    [activeTabId, syncTabMeta]
  );

  // Refs kept current so async poll callbacks never see stale closures
  const dirtyRef = useRef(dirty);
  useEffect(() => { dirtyRef.current = dirty; }, [dirty]);
  const loadDocContentRef = useRef(loadDocContent);
  useEffect(() => { loadDocContentRef.current = loadDocContent; }, [loadDocContent]);
  // Epoch ms: ignore poll results triggered by our own save until this time passes
  const suppressWatchUntilRef = useRef(0);
  // Last content we read from disk — used to detect external changes
  const lastDiskContentRef = useRef<string>("");
  // Forward ref so handleCloseTab can call handleSave before it's declared
  const handleSaveRef = useRef<() => Promise<void>>(() => Promise.resolve());

  // Stable refs so keyboard handler always gets latest callbacks
  const tabsRef = useRef(tabs);
  useEffect(() => { tabsRef.current = tabs; }, [tabs]);
  const handleSelectTabRef = useRef<(id: string) => void>(() => {});

  // Imperative refs for multi-file drop: updated synchronously so sequential
  // openFileByPath calls see the correct "current" values without waiting for React re-renders.
  const activeTabIdRef = useRef(activeTabId);
  useEffect(() => { activeTabIdRef.current = activeTabId; }, [activeTabId]);
  const filePathRef = useRef(filePath);
  useEffect(() => { filePathRef.current = filePath; }, [filePath]);
  const contentRef = useRef(content);
  useEffect(() => { contentRef.current = content; }, [content]);

  // ---- Save current tab's EditorState into storage ----
  const stashActiveTab = useCallback(() => {
    const view = viewRef.current;
    storedTabsRef.current.set(activeTabId, {
      id: activeTabId,
      filePath,
      dirty,
      content,
      editorState: view ? view.state : null,
    });
  }, [activeTabId, filePath, dirty, content]);

  // ---- Drag-and-drop file open ----
  const TEXT_EXTENSIONS = new Set([
    // Markdown / text / data
    "md","markdown","txt","text","csv","tsv","xml","json","json5","yaml","yml","toml","ini","env","cfg","conf","config",
    // Web
    "html","htm","css","scss","sass","less","js","jsx","ts","tsx","mjs","cjs","vue","svelte","astro",
    // Systems / compiled
    "c","h","cpp","cc","cxx","hpp","hxx","cs","java","kt","kts","scala","swift","m","mm","zig","v",
    // Scripting
    "py","pyw","rb","rbw","lua","pl","pm","php","sh","bash","zsh","fish","ps1","psm1","bat","cmd",
    // Scientific / data science
    "r","rmd","jl","ipynb","m","mat","f","f90","f95","for",
    // Systems / DevOps
    "rs","go","ex","exs","erl","hrl","hs","lhs","ml","mli","fs","fsx","fsi","clj","cljs","cljc","lisp","el","vim","lua",
    // Config / infra
    "dockerfile","makefile","cmake","gradle","properties","plist","tf","tfvars","hcl","nix","cabal",
    // Docs / markup
    "tex","rst","adoc","org","wiki",
    // Misc
    "sql","graphql","gql","proto","thrift","avsc","log","diff","patch",
  ]);

  const openFileByPath = useCallback(
    async (path: string) => {
      try {
        // Check tabsRef (always current even mid-sequence) for duplicates
        const existingTab = tabsRef.current.find((t) => t.filePath === path);
        if (existingTab) {
          handleSelectTabRef.current(existingTab.id);
          return;
        }
        const fileContent = await invoke<string>("read_file", { path });
        addRecentFile(path);

        // Stash the currently active tab using refs — correct even during sequential
        // multi-file drops before React has re-rendered with updated state.
        const view = viewRef.current;
        const curId = activeTabIdRef.current;
        if (curId) {
          storedTabsRef.current.set(curId, {
            id: curId,
            filePath: filePathRef.current,
            dirty: dirtyRef.current,
            content: contentRef.current,
            editorState: view ? view.state : null,
          });
        }

        const id = makeTabId();

        // Update imperative refs synchronously so the NEXT sequential call in the
        // same for-await loop sees the correct "current tab" immediately.
        activeTabIdRef.current = id;
        filePathRef.current = path;
        dirtyRef.current = false;
        contentRef.current = fileContent;

        // Schedule React state updates (will batch and re-render after the loop)
        setTabs((prev) => [...prev, { id, filePath: path, dirty: false }]);
        setActiveTabId(id);
        setFilePath(path);
        setContent(fileContent);
        setDirty(false);

        if (view) {
          const state = makeEditorStateFromMarkdown(fileContent, view.state.plugins);
          view.updateState(state);
        }
        const stats = getDocStats(markdownToDoc(fileContent, schema));
        setWordCount(stats.words);
        setCharCount(stats.chars);
      } catch (e) {
        console.error("Failed to open dropped file:", e);
      }
    },
    // All state is accessed via refs; only addRecentFile is a true dep here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [addRecentFile]
  );

  // Keep a ref so drag-drop listeners (registered once) always call the latest callback.
  const openFileByPathRef = useRef(openFileByPath);
  useEffect(() => { openFileByPathRef.current = openFileByPath; }, [openFileByPath]);

  useEffect(() => {
    const TEXT_EXT = TEXT_EXTENSIONS;
    const unlistenEnter = listen("tauri://drag-enter", () => { if (!draggingTabIdRef.current) setIsDragging(true); });
    const unlistenOver  = listen("tauri://drag-over",  () => { if (!draggingTabIdRef.current) setIsDragging(true); });
    const unlistenLeave = listen("tauri://drag-leave", () => setIsDragging(false));
    const unlistenDrop  = listen<{ paths: string[] }>("tauri://drag-drop", async (event) => {
      setIsDragging(false);
      const paths = (event.payload?.paths ?? [])
        .filter((p) => TEXT_EXT.has(p.split(".").pop()?.toLowerCase() ?? ""));
      // Deduplicate within this batch (same file dropped twice)
      const seen = new Set<string>();
      // Serialize: open each file only after the previous one finishes.
      // openFileByPath updates imperative refs synchronously so each iteration
      // stashes the correct preceding tab even before React re-renders.
      for (const p of paths) {
        if (seen.has(p)) continue;
        seen.add(p);
        await openFileByPathRef.current(p);
      }
    });
    return () => {
      unlistenEnter.then((f) => f());
      unlistenOver.then((f) => f());
      unlistenLeave.then((f) => f());
      unlistenDrop.then((f) => f());
    };
  }, []); // register once on mount — openFileByPath is forwarded via ref above

  // ---- Switch to a stored tab ----
  const restoreTab = useCallback(
    (tabId: string) => {
      const view = viewRef.current;
      if (!view) return;

      const stored = storedTabsRef.current.get(tabId);
      if (stored) {
        const state =
          stored.editorState ??
          makeEditorStateFromMarkdown(stored.content, view.state.plugins);
        view.updateState(state);
        setFilePath(stored.filePath);
        setContent(stored.content);
        setDirty(stored.dirty);
        const stats = getDocStats(state.doc);
        setWordCount(stats.words);
        setCharCount(stats.chars);
      } else {
        // Brand new tab — empty document
        const emptyState = makeEmptyEditorState(view.state.plugins);
        view.updateState(emptyState);
        setFilePath(null);
        setContent("");
        setDirty(false);
        setWordCount(0);
        setCharCount(0);
      }
    },
    []
  );

  // ---- Select tab ----
  const handleSelectTab = useCallback(
    (id: string) => {
      if (id === activeTabId) return;
      stashActiveTab();
      setActiveTabId(id);
      restoreTab(id);
    },
    [activeTabId, stashActiveTab, restoreTab]
  );
  useEffect(() => { handleSelectTabRef.current = handleSelectTab; }, [handleSelectTab]);

  // ---- New tab ----
  const handleNew = useCallback(() => {
    stashActiveTab();
    const id = makeTabId();
    const newTab: TabData = { id, filePath: null, dirty: false };
    setTabs((prev) => [...prev, newTab]);
    setActiveTabId(id);
    // restoreTab will find nothing for this id and create an empty doc
    const view = viewRef.current;
    if (view) {
      const emptyState = makeEmptyEditorState(view.state.plugins);
      view.updateState(emptyState);
    }
    setFilePath(null);
    setContent("");
    setDirty(false);
    setWordCount(0);
    setCharCount(0);
  }, [stashActiveTab]);

  // ---- Close tab ----
  const handleCloseTab = useCallback(
    (id: string, skipDirtyCheck = false) => {
      const tabMeta = tabs.find((t) => t.id === id);
      const stored = storedTabsRef.current.get(id);
      const isDirty = id === activeTabId ? dirty : stored?.dirty ?? false;

      if (isDirty && !skipDirtyCheck) {
        const label = tabMeta?.filePath
          ? tabMeta.filePath.split("/").pop()
          : "Untitled";
        if (id === activeTabId) {
          // Active tab: offer to save first
          const saveFirst = window.confirm(
            `"${label}" has unsaved changes.\n\nOK to save and close — Cancel to discard and close.`
          );
          if (saveFirst) {
            handleSaveRef.current().then(() => handleCloseTab(id, true));
            return;
          }
        } else {
          // Background tab: just confirm discard
          if (!window.confirm(`"${label}" has unsaved changes. Discard and close?`)) return;
        }
      }

      storedTabsRef.current.delete(id);

      setTabs((prev) => {
        const remaining = prev.filter((t) => t.id !== id);
        if (remaining.length === 0) {
          // Hide the window instead of keeping a blank tab
          setTimeout(async () => {
            setActiveTabId("");
            const view = viewRef.current;
            if (view) {
              view.updateState(makeEmptyEditorState(view.state.plugins));
            }
            setFilePath(null);
            setContent("");
            setDirty(false);
            setWordCount(0);
            setCharCount(0);
            try {
              const { Window } = await import("@tauri-apps/api/window");
              await Window.getCurrent().hide();
            } catch {}
          }, 0);
          return [];
        }

        if (id === activeTabId) {
          // Switch to adjacent tab
          const idx = prev.findIndex((t) => t.id === id);
          const nextTab = remaining[Math.min(idx, remaining.length - 1)];
          setTimeout(() => {
            setActiveTabId(nextTab.id);
            restoreTab(nextTab.id);
          }, 0);
        }

        return remaining;
      });
    },
    [tabs, activeTabId, dirty, restoreTab]
  );

  // ---- Open file ----
  const handleOpen = useCallback(async () => {
    try {
      const path = await invoke<string | null>("show_open_dialog");
      if (!path) return;

      // Check if already open in a tab
      const existingTab = tabs.find((t) => t.filePath === path);
      if (existingTab) {
        handleSelectTab(existingTab.id);
        return;
      }

      const fileContent = await invoke<string>("read_file", { path });
      addRecentFile(path);

      if (false) {
        // never reuse blank tab
      } else {
        stashActiveTab();
        const id = makeTabId();
        setTabs((prev) => [
          ...prev,
          { id, filePath: path, dirty: false },
        ]);
        setActiveTabId(id);
        // Load into view
        const view = viewRef.current;
        if (view) {
          const state = makeEditorStateFromMarkdown(
            fileContent,
            view.state.plugins
          );
          view.updateState(state);
        }
        setFilePath(path);
        setContent(fileContent);
        setDirty(false);
        const stats = getDocStats(
          markdownToDoc(fileContent, schema)
        );
        setWordCount(stats.words);
        setCharCount(stats.chars);
      }

      // Check autosave
      const saved = await loadAutosave(path).catch(() => null);
      if (saved && saved !== fileContent) {
        setRecovery({ key: path, content: saved, filePath: path, tabId: activeTabId });
      }
    } catch (e) {
      console.error("Failed to open file:", e);
    }
  }, [
    tabs,
    filePath,
    dirty,
    activeTabId,
    loadDocContent,
    addRecentFile,
    syncTabMeta,
    stashActiveTab,
    handleSelectTab,
  ]);

  // ---- Save ----
  const handleSave = useCallback(async () => {
    const view = viewRef.current;
    if (!view) return;

    const markdown = docToMarkdown(view.state.doc);
    let savePath = filePath;

    if (!savePath) {
      const path = await invoke<string | null>("show_save_dialog");
      if (!path) return;
      savePath = path;
    }

    try {
      suppressWatchUntilRef.current = Date.now() + 2000;
      await invoke("write_file", { path: savePath, content: markdown });
      lastDiskContentRef.current = markdown;
      setFilePath(savePath);
      setDirty(false);
      setContent(markdown);
      setDeletedPaths((prev) => { const n = new Set(prev); n.delete(savePath); return n; });
      setExternalChange(null);
      syncTabMeta(activeTabId, { filePath: savePath, dirty: false });
      addRecentFile(savePath);
      await deleteAutosave(savePath).catch(() => {});
      await deleteAutosave("__untitled__").catch(() => {});
    } catch (e) {
      console.error("Failed to save:", e);
    }
  }, [filePath, activeTabId, addRecentFile, syncTabMeta]);
  // Keep ref current so handleCloseTab (declared before handleSave) can call it
  useEffect(() => { handleSaveRef.current = handleSave; }, [handleSave]);

  // ---- Save As ----
  const handleSaveAs = useCallback(async () => {
    const view = viewRef.current;
    if (!view) return;

    const markdown = docToMarkdown(view.state.doc);
    const path = await invoke<string | null>("show_save_dialog");
    if (!path) return;

    try {
      suppressWatchUntilRef.current = Date.now() + 2000;
      await invoke("write_file", { path, content: markdown });
      lastDiskContentRef.current = markdown;
      setFilePath(path);
      setDirty(false);
      setContent(markdown);
      setDeletedPaths((prev) => { const n = new Set(prev); n.delete(path); return n; });
      setExternalChange(null);
      syncTabMeta(activeTabId, { filePath: path, dirty: false });
      addRecentFile(path);
    } catch (e) {
      console.error("Failed to save:", e);
    }
  }, [activeTabId, addRecentFile, syncTabMeta]);

  // ---- Tab reorder ----
  const handleReorderTabs = useCallback((draggedId: string, targetId: string, before: boolean) => {
    setTabs((prev) => {
      const result = [...prev];
      const fromIdx = result.findIndex((t) => t.id === draggedId);
      if (fromIdx === -1) return prev;
      const [moved] = result.splice(fromIdx, 1);
      const toIdx = result.findIndex((t) => t.id === targetId);
      if (toIdx === -1) return prev;
      result.splice(before ? toIdx : toIdx + 1, 0, moved);
      return result;
    });
  }, []);

  // ---- Detach tab into new window ----
  const handleDetachTab = useCallback(async (tabId: string) => {
    if (tabsRef.current.length <= 1) return; // never detach the only tab
    const tab = tabsRef.current.find((t) => t.id === tabId);
    if (!tab) return;

    const stored = storedTabsRef.current.get(tabId);
    const tabFilePath = tabId === activeTabId ? filePath : (stored?.filePath ?? null);
    const tabContent = tabId === activeTabId
      ? (viewRef.current ? docToMarkdown(viewRef.current.state.doc) : content)
      : (stored?.content ?? "");
    const tabDirty = tabId === activeTabId ? dirty : (stored?.dirty ?? false);

    // Save dirty content to disk so the new window can read it
    if (tabDirty && tabFilePath) {
      try {
        suppressWatchUntilRef.current = Date.now() + 2000;
        await invoke("write_file", { path: tabFilePath, content: tabContent });
        lastDiskContentRef.current = tabContent;
      } catch (e) {
        console.error("Failed to save before detach:", e);
      }
    }

    try {
      await invoke("open_new_window", { filePath: tabFilePath });
    } catch (e) {
      console.error("Failed to spawn window:", e);
      return;
    }

    setDraggingTabId(null);
    handleCloseTab(tabId, true);
  }, [activeTabId, filePath, content, dirty, handleCloseTab]);

  // ---- New window (Cmd+N) ----
  const handleNewWindow = useCallback(async () => {
    try {
      await invoke("open_new_window", { filePath: null });
    } catch (e) {
      console.error("Failed to open new window:", e);
    }
  }, []);

  // ---- File polling: detect external modifications and deletions ----
  // Polls every 1.5 s; guaranteed to work without any native watch permissions.
  useEffect(() => {
    if (!filePath) return;
    setExternalChange(null);
    setDeletedPaths((prev) => {
      if (!prev.has(filePath)) return prev;
      const next = new Set(prev);
      next.delete(filePath);
      return next;
    });

    const polledPath = filePath;
    let cancelled = false;

    const poll = async () => {
      if (cancelled || Date.now() < suppressWatchUntilRef.current) return;
      try {
        const diskContent = await invoke<string>("read_file", { path: polledPath });
        if (cancelled) return;
        if (diskContent !== lastDiskContentRef.current) {
          lastDiskContentRef.current = diskContent;
          if (dirtyRef.current) {
            setExternalChange(diskContent);
          } else {
            loadDocContentRef.current(diskContent, polledPath);
          }
        }
        // File exists — clear any deleted flag
        setDeletedPaths((prev) => {
          if (!prev.has(polledPath)) return prev;
          const next = new Set(prev);
          next.delete(polledPath);
          return next;
        });
      } catch {
        // Read failed → file deleted
        if (!cancelled) {
          setDeletedPaths((prev) => {
            if (prev.has(polledPath)) return prev;
            const next = new Set(prev);
            next.add(polledPath);
            return next;
          });
        }
      }
    };

    const intervalId = setInterval(poll, 1500);
    return () => {
      cancelled = true;
      clearInterval(intervalId);
      setExternalChange(null);
    };
  }, [filePath]);

  // ---- Export ----
  const handleExportHtml = useCallback(async () => {
    const view = viewRef.current;
    if (!view) return;
    await exportToHtml(
      view.state.doc,
      filePath?.split("/").pop() || "Bioscratch Document"
    );
  }, [filePath]);

  // ---- Recovery ----
  const handleRestore = useCallback(() => {
    if (!recovery) return;
    loadDocContent(recovery.content, recovery.filePath);
    setRecovery(null);
  }, [recovery, loadDocContent]);

  const handleDiscard = useCallback(async () => {
    if (!recovery) return;
    await deleteAutosave(recovery.key).catch(() => {});
    setRecovery(null);
  }, [recovery]);

  // ---- Search ----
  const handleToggleSearch = useCallback(() => {
    setSearchVisible((v) => !v);
  }, []);

  // ---- Keyboard shortcuts ----
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key === "s") {
        e.preventDefault();
        handleSave();
      } else if (mod && e.key === "o") {
        e.preventDefault();
        handleOpen();
      } else if (mod && e.key === "t") {
        e.preventDefault();
        handleNew();
      } else if (mod && e.key === "n") {
        e.preventDefault();
        handleNewWindow();
      } else if (mod && e.key === "w") {
        e.preventDefault();
        if (activeTabId) handleCloseTab(activeTabId);
      } else if (mod && e.key === "f") {
        e.preventDefault();
        setSearchVisible(true);
      } else if (e.key === "Tab" && e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        const currentTabs = tabsRef.current;
        if (currentTabs.length < 2) return;
        const idx = currentTabs.findIndex((t) => t.id === activeTabId);
        if (idx === -1) return;
        const nextIdx = e.shiftKey
          ? (idx - 1 + currentTabs.length) % currentTabs.length
          : (idx + 1) % currentTabs.length;
        handleSelectTabRef.current(currentTabs[nextIdx].id);
      } else if (e.key === "Escape" && searchVisible) {
        setSearchVisible(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleSave, handleOpen, handleNew, handleNewWindow, handleCloseTab, handleSelectTab, activeTabId, searchVisible]);

  return (
    <div className="app-container">
      {isDragging && (
        <div className="drop-overlay">
          <div className="drop-overlay-inner">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
              <polyline points="14 2 14 8 20 8"/>
            </svg>
            <span>Drop to open</span>
          </div>
        </div>
      )}
      <Toolbar
        view={viewRef.current}
        onNew={handleNew}
        onOpen={handleOpen}
        onSave={handleSave}
        onSaveAs={handleSaveAs}
        onExportHtml={handleExportHtml}
        onToggleSearch={handleToggleSearch}
        onToggleTheme={toggleTheme}
        theme={theme}
      />

      <TabBar
        tabs={tabs}
        activeId={activeTabId}
        deletedPaths={deletedPaths}
        onSelect={handleSelectTab}
        onClose={handleCloseTab}
        onNew={handleNew}
        onReorder={handleReorderTabs}
        onDetach={handleDetachTab}
        onDragTabStart={(id) => setDraggingTabId(id)}
        onDragTabEnd={() => setDraggingTabId(null)}
      />

      {tabs.length === 0 && (
        <div className="welcome-screen">
          <div className="welcome-inner">
            <div className="welcome-logo">Bioscratch</div>
            <div className="welcome-tagline">A minimal markdown editor</div>
            <div className="welcome-hints">
              <span><kbd>⌘T</kbd> New document</span>
              <span><kbd>⌘O</kbd> Open file</span>
              <span><kbd>⌘N</kbd> New window</span>
            </div>
          </div>
        </div>
      )}

      {fileDeleted && (
        <div className="file-watch-banner file-watch-deleted">
          <span>File deleted from disk</span>
          <div className="file-watch-actions">
            <button onClick={handleSave}>Save anyway</button>
            <button onClick={() => handleCloseTab(activeTabId)}>Close tab</button>
          </div>
        </div>
      )}
      {externalChange !== null && !fileDeleted && (
        <div className="file-watch-banner file-watch-changed">
          <span>File changed on disk — you have unsaved edits</span>
          <div className="file-watch-actions">
            <button onClick={() => { loadDocContent(externalChange, filePath!); setExternalChange(null); }}>Reload</button>
            <button onClick={() => setExternalChange(null)}>Dismiss</button>
          </div>
        </div>
      )}

      {searchVisible && (
        <SearchBar
          view={viewRef.current}
          onClose={() => setSearchVisible(false)}
        />
      )}

      <div style={tabs.length === 0 ? { display: "none" } : { flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
        <EditorSurface
          onMount={handleMount}
          onChange={handleChange}
          onSave={handleSave}
          onSearch={handleToggleSearch}
        />
      </div>

      {tabs.length > 0 && (
        <StatusBar
          filePath={filePath}
          dirty={dirty}
          wordCount={wordCount}
          charCount={charCount}
        />
      )}

      {recovery && (
        <RecoveryDialog
          filePath={recovery.filePath}
          onRestore={handleRestore}
          onDiscard={handleDiscard}
        />
      )}
    </div>
  );
};

export default App;
