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
  const [activeTabId, setActiveTabId] = useState<string>(() => makeTabId());

  // Tab bar metadata (derived from stored tabs + active tab)
  const [tabs, setTabs] = useState<TabData[]>(() => [
    { id: `tab-${nextTabId - 1}`, filePath: null, dirty: false },
  ]);

  // Active tab live state
  const [filePath, setFilePath] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [wordCount, setWordCount] = useState(0);
  const [charCount, setCharCount] = useState(0);
  const [content, setContent] = useState("");

  const [searchVisible, setSearchVisible] = useState(false);
  const [recovery, setRecovery] = useState<RecoveryData | null>(null);
  const [isDragging, setIsDragging] = useState(false);

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

      // Check for autosave on the initial untitled tab
      loadAutosave("__untitled__")
        .then((saved) => {
          if (saved) {
            setRecovery({
              key: "__untitled__",
              content: saved,
              filePath: null,
              tabId: activeTabId,
            });
          }
        })
        .catch(console.error);
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
      syncTabMeta(activeTabId, { filePath: path, dirty: false });
      const stats = getDocStats(newState.doc);
      setWordCount(stats.words);
      setCharCount(stats.chars);
    },
    [activeTabId, syncTabMeta]
  );

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
    "md","markdown","txt","json","yaml","yml","toml","csv","xml",
    "html","css","js","ts","py","rs","go","java","c","cpp","h","sh","log",
  ]);

  const openFileByPath = useCallback(
    async (path: string) => {
      try {
        const existingTab = tabs.find((t) => t.filePath === path);
        if (existingTab) {
          handleSelectTab(existingTab.id);
          return;
        }
        const fileContent = await invoke<string>("read_file", { path });
        addRecentFile(path);
        const isCleanUntitled = !filePath && !dirty;
        if (isCleanUntitled) {
          loadDocContent(fileContent, path);
          syncTabMeta(activeTabId, { filePath: path, dirty: false });
        } else {
          stashActiveTab();
          const id = makeTabId();
          setTabs((prev) => [...prev, { id, filePath: path, dirty: false }]);
          setActiveTabId(id);
          const view = viewRef.current;
          if (view) {
            const state = makeEditorStateFromMarkdown(fileContent, view.state.plugins);
            view.updateState(state);
          }
          setFilePath(path);
          setContent(fileContent);
          setDirty(false);
          const stats = getDocStats(markdownToDoc(fileContent, schema));
          setWordCount(stats.words);
          setCharCount(stats.chars);
        }
      } catch (e) {
        console.error("Failed to open dropped file:", e);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tabs, filePath, dirty, activeTabId, addRecentFile, loadDocContent, syncTabMeta, stashActiveTab]
  );

  useEffect(() => {
    const TEXT_EXT = TEXT_EXTENSIONS;
    const unlistenEnter = listen("tauri://drag-enter", () => setIsDragging(true));
    const unlistenOver  = listen("tauri://drag-over",  () => setIsDragging(true));
    const unlistenLeave = listen("tauri://drag-leave", () => setIsDragging(false));
    const unlistenDrop  = listen<{ paths: string[] }>("tauri://drag-drop", (event) => {
      setIsDragging(false);
      const paths = event.payload?.paths ?? [];
      paths
        .filter((p) => TEXT_EXT.has(p.split(".").pop()?.toLowerCase() ?? ""))
        .forEach((p) => openFileByPath(p));
    });
    return () => {
      unlistenEnter.then((f) => f());
      unlistenOver.then((f) => f());
      unlistenLeave.then((f) => f());
      unlistenDrop.then((f) => f());
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openFileByPath]);

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
    (id: string) => {
      const tabMeta = tabs.find((t) => t.id === id);
      const stored = storedTabsRef.current.get(id);
      const isDirty = id === activeTabId ? dirty : stored?.dirty ?? false;

      if (isDirty) {
        const label = tabMeta?.filePath
          ? tabMeta.filePath.split("/").pop()
          : "Untitled";
        if (!confirm(`"${label}" has unsaved changes. Close anyway?`)) return;
      }

      storedTabsRef.current.delete(id);

      setTabs((prev) => {
        const remaining = prev.filter((t) => t.id !== id);
        if (remaining.length === 0) {
          // Always keep at least one tab
          const newId = makeTabId();
          const newTab: TabData = { id: newId, filePath: null, dirty: false };
          setTimeout(() => {
            setActiveTabId(newId);
            const view = viewRef.current;
            if (view) {
              view.updateState(makeEmptyEditorState(view.state.plugins));
            }
            setFilePath(null);
            setContent("");
            setDirty(false);
            setWordCount(0);
            setCharCount(0);
          }, 0);
          return [newTab];
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

      // Open in current tab if it's a clean untitled tab, else new tab
      const isCleanUntitled = !filePath && !dirty;
      if (isCleanUntitled) {
        loadDocContent(fileContent, path);
        syncTabMeta(activeTabId, { filePath: path, dirty: false });
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
      await invoke("write_file", { path: savePath, content: markdown });
      setFilePath(savePath);
      setDirty(false);
      setContent(markdown);
      syncTabMeta(activeTabId, { filePath: savePath, dirty: false });
      addRecentFile(savePath);
      await deleteAutosave(savePath).catch(() => {});
      await deleteAutosave("__untitled__").catch(() => {});
    } catch (e) {
      console.error("Failed to save:", e);
    }
  }, [filePath, activeTabId, addRecentFile, syncTabMeta]);

  // ---- Save As ----
  const handleSaveAs = useCallback(async () => {
    const view = viewRef.current;
    if (!view) return;

    const markdown = docToMarkdown(view.state.doc);
    const path = await invoke<string | null>("show_save_dialog");
    if (!path) return;

    try {
      await invoke("write_file", { path, content: markdown });
      setFilePath(path);
      setDirty(false);
      setContent(markdown);
      syncTabMeta(activeTabId, { filePath: path, dirty: false });
      addRecentFile(path);
    } catch (e) {
      console.error("Failed to save:", e);
    }
  }, [activeTabId, addRecentFile, syncTabMeta]);

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
      } else if (mod && e.key === "n") {
        e.preventDefault();
        handleNew();
      } else if (mod && e.key === "w") {
        e.preventDefault();
        handleCloseTab(activeTabId);
      } else if (mod && e.key === "f") {
        e.preventDefault();
        setSearchVisible(true);
      } else if (e.key === "Escape" && searchVisible) {
        setSearchVisible(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleSave, handleOpen, handleNew, handleCloseTab, activeTabId, searchVisible]);

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
        onSelect={handleSelectTab}
        onClose={handleCloseTab}
        onNew={handleNew}
      />

      {searchVisible && (
        <SearchBar
          view={viewRef.current}
          onClose={() => setSearchVisible(false)}
        />
      )}

      <EditorSurface
        onMount={handleMount}
        onChange={handleChange}
        onSave={handleSave}
        onSearch={handleToggleSearch}
      />

      <StatusBar
        filePath={filePath}
        dirty={dirty}
        wordCount={wordCount}
        charCount={charCount}
      />

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
