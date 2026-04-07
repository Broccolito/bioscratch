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
import {
  loadAutosave,
  deleteAutosave,
} from "./hooks/useAutosave";
import { invoke } from "@tauri-apps/api/core";

import Toolbar from "./components/Toolbar";
import EditorSurface from "./components/EditorSurface";
import StatusBar from "./components/StatusBar";
import SearchBar from "./components/SearchBar";
import RecoveryDialog from "./components/RecoveryDialog";

import "./styles/app.css";

interface RecoveryData {
  key: string;
  content: string;
  filePath: string | null;
}

const UNTITLED_KEY = "__untitled__";

const App: React.FC = () => {
  const viewRef = useRef<EditorView | null>(null);
  const { theme, toggleTheme } = useTheme();
  const { addRecentFile } = useRecentFiles();

  const [filePath, setFilePath] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [wordCount, setWordCount] = useState(0);
  const [charCount, setCharCount] = useState(0);
  const [content, setContent] = useState("");

  const [searchVisible, setSearchVisible] = useState(false);
  const [recovery, setRecovery] = useState<RecoveryData | null>(null);

  // Force re-render when view changes
  const [, forceUpdate] = useState(0);

  // Autosave hook
  useAutosave(content, filePath, dirty);

  // ---- Editor mount ----
  const handleMount = useCallback((view: EditorView) => {
    viewRef.current = view;
    forceUpdate(n => n + 1);
    updateStats(view);

    // Check for autosave recovery on startup
    const key = UNTITLED_KEY;
    loadAutosave(key).then((saved) => {
      if (saved) {
        setRecovery({ key, content: saved, filePath: null });
      }
    }).catch(console.error);
  }, []);

  // ---- Change handler ----
  const handleChange = useCallback(() => {
    setDirty(true);
    const view = viewRef.current;
    if (view) {
      updateStats(view);
      const md = docToMarkdown(view.state.doc);
      setContent(md);
    }
  }, []);

  function updateStats(view: EditorView) {
    const stats = getDocStats(view.state.doc);
    setWordCount(stats.words);
    setCharCount(stats.chars);
  }

  // ---- File operations ----
  const loadDocContent = useCallback((markdown: string, path: string | null) => {
    const view = viewRef.current;
    if (!view) return;

    const doc = markdownToDoc(markdown, schema);
    const newState = EditorState.create({
      doc,
      plugins: view.state.plugins,
    });
    view.updateState(newState);
    setFilePath(path);
    setContent(markdown);
    setDirty(false);
    updateStats(view);
  }, []);

  const handleNew = useCallback(() => {
    if (dirty) {
      if (!confirm("You have unsaved changes. Create new document?")) return;
    }
    loadDocContent("", null);
  }, [dirty, loadDocContent]);

  const handleOpen = useCallback(async () => {
    if (dirty) {
      if (!confirm("You have unsaved changes. Open another file?")) return;
    }
    try {
      const path = await invoke<string | null>("show_open_dialog");
      if (!path) return;

      const fileContent = await invoke<string>("read_file", { path });

      // Check for autosave recovery
      const saved = await loadAutosave(path).catch(() => null);
      if (saved && saved !== fileContent) {
        loadDocContent(fileContent, path);
        setRecovery({ key: path, content: saved, filePath: path });
      } else {
        loadDocContent(fileContent, path);
      }

      setFilePath(path);
      addRecentFile(path);
    } catch (e) {
      console.error("Failed to open file:", e);
    }
  }, [dirty, loadDocContent, addRecentFile]);

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
      addRecentFile(savePath);
      // Clear autosave after successful save
      await deleteAutosave(savePath).catch(() => {});
      await deleteAutosave(UNTITLED_KEY).catch(() => {});
    } catch (e) {
      console.error("Failed to save:", e);
    }
  }, [filePath, addRecentFile]);

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
      addRecentFile(path);
    } catch (e) {
      console.error("Failed to save:", e);
    }
  }, [addRecentFile]);

  const handleExportHtml = useCallback(async () => {
    const view = viewRef.current;
    if (!view) return;
    await exportToHtml(view.state.doc, filePath?.split("/").pop() || "Jottingdown Document");
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
      } else if (mod && e.key === "f") {
        e.preventDefault();
        setSearchVisible(true);
      } else if (e.key === "Escape" && searchVisible) {
        setSearchVisible(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleSave, handleOpen, handleNew, searchVisible]);

  return (
    <div className="app-container">
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
