import React, { useRef, useState, useEffect, useCallback } from "react";
import { EditorView } from "prosemirror-view";
import { EditorState, TextSelection } from "prosemirror-state";
import { schema } from "./editor/schema";
import { markdownToDoc } from "./editor/serialization/markdownImport";
import { docToMarkdown } from "./editor/serialization/markdownExport";
import { getDocStats } from "./lib/stats";
import { exportToHtml, exportToPdf } from "./lib/export";
import { getFileMode, getCodeLanguage, FileMode } from "./lib/fileMode";
import { useTheme } from "./hooks/useTheme";
import {
  fetchUserThemes,
  saveUserTheme,
  deleteUserTheme,
  parseUserThemeYaml,
} from "./lib/themeLoader";
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
import LargeFileDialog from "./components/LargeFileDialog";
import ThemeSelector from "./components/ThemeSelector";
import UpdateDialog from "./components/UpdateDialog";

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
  fileMode: FileMode;
  codeLanguage: string;
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

/** Create an EditorState appropriate for the given file mode.
 *  For non-markdown files the entire content is placed in a single code_block,
 *  with the cursor placed at position 1 (inside the block). */
function makeEditorStateForContent(
  content: string,
  mode: FileMode,
  language: string,
  plugins: EditorState["plugins"]
): EditorState {
  if (mode === "markdown") {
    return makeEditorStateFromMarkdown(content, plugins);
  }
  const textContent = content ? [schema.text(content)] : [];
  const doc = schema.node("doc", null, [
    schema.node("code_block", { language }, textContent),
  ]);
  // Position 1 is the first valid cursor position inside the code_block.
  // The default (position 0) would place the cursor before the block opening tag.
  const selection = TextSelection.create(doc, 1);
  return EditorState.create({ doc, plugins, selection });
}

const App: React.FC = () => {
  const viewRef = useRef<EditorView | null>(null);
  // User theme state: filename → parsed vars
  const [userThemeVars, setUserThemeVars] = useState<Record<string, Record<string, string>>>({});
  const { theme, setTheme } = useTheme(userThemeVars);
  const [themePickerOpen, setThemePickerOpen] = useState(false);
  const [updateDialogOpen, setUpdateDialogOpen] = useState(false);
  const { addRecentFile } = useRecentFiles();

  // Load user themes on mount
  useEffect(() => {
    fetchUserThemes().then((entries) => {
      const map: Record<string, Record<string, string>> = {};
      for (const { filename, content } of entries) {
        map[filename] = parseUserThemeYaml(content);
      }
      setUserThemeVars(map);
    });
  }, []);

  // Import a YAML theme file from disk
  const handleImportTheme = useCallback(async () => {
    const path = await invoke<string | null>("show_open_dialog");
    if (!path) return;
    const content = await invoke<string>("read_file", { path });
    const filename = path.split(/[\\/]/).pop() ?? "custom.yaml";
    await saveUserTheme(filename, content);
    const vars = parseUserThemeYaml(content);
    setUserThemeVars((prev) => ({ ...prev, [filename]: vars }));
  }, []);

  // Delete a user theme by filename
  const handleDeleteUserTheme = useCallback(async (filename: string) => {
    await deleteUserTheme(filename);
    setUserThemeVars((prev) => {
      const next = { ...prev };
      delete next[filename];
      return next;
    });
    // If the deleted theme is active, fall back to "light"
    if (theme === `user:${filename}`) setTheme("light");
  }, [theme, setTheme]);

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

  // Active tab file mode
  const [fileMode, setFileMode] = useState<FileMode>("markdown");
  const [codeLanguage, setCodeLanguage] = useState("");

  // Pending large-file confirmation
  const [pendingLargeFile, setPendingLargeFile] = useState<{
    path: string; content: string; mode: FileMode; language: string;
  } | null>(null);

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

  // Autosave current tab — only for markdown files
  useAutosave(content, filePath, dirty && fileMode === "markdown");

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
            const mode = getFileMode(initialFile);
            const lang = getCodeLanguage(initialFile);
            const state = makeEditorStateForContent(fileContent, mode, lang, view.state.plugins);
            view.updateState(state);
            setFilePath(initialFile);
            setFileMode(mode);
            setCodeLanguage(lang);
            setContent(fileContent);
            setDirty(false);
            lastDiskContentRef.current = fileContent;
            const stats = getDocStats(state.doc);
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
      if (fileModeRef.current === "markdown") {
        setContent(docToMarkdown(view.state.doc));
      } else {
        // For code/plaintext: extract raw text from the single code_block node
        setContent(view.state.doc.childCount > 0 ? view.state.doc.child(0).textContent : "");
      }
    }
  }, [activeTabId, syncTabMeta]);

  // ---- Load content into the active editor ----
  // mode/language default to the current tab's values (for external reload via polling).
  const loadDocContent = useCallback(
    (rawContent: string, path: string | null, mode?: FileMode, language?: string) => {
      const view = viewRef.current;
      if (!view) return;
      const actualMode = mode ?? fileModeRef.current;
      const actualLang = language ?? codeLanguageRef.current;
      const newState = makeEditorStateForContent(rawContent, actualMode, actualLang, view.state.plugins);
      view.updateState(newState);
      setFilePath(path);
      setFileMode(actualMode);
      setCodeLanguage(actualLang);
      setContent(rawContent);
      setDirty(false);
      lastDiskContentRef.current = rawContent;
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
  // Refs for menu-action event handler (avoids stale closures across re-renders)
  const handleNewRef = useRef<() => void>(() => {});
  const handleOpenRef = useRef<() => void>(() => {});
  const handleSaveAsRef = useRef<() => void>(() => {});
  const handleExportHtmlRef = useRef<() => void>(() => {});
  const handleExportPdfRef = useRef<() => void>(() => {});
  const handleNewWindowRef = useRef<() => void>(() => {});

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
  const fileModeRef = useRef<FileMode>(fileMode);
  useEffect(() => { fileModeRef.current = fileMode; }, [fileMode]);
  const codeLanguageRef = useRef(codeLanguage);
  useEffect(() => { codeLanguageRef.current = codeLanguage; }, [codeLanguage]);

  // ---- Save current tab's EditorState into storage ----
  const stashActiveTab = useCallback(() => {
    const view = viewRef.current;
    storedTabsRef.current.set(activeTabId, {
      id: activeTabId,
      filePath,
      dirty,
      content,
      editorState: view ? view.state : null,
      fileMode,
      codeLanguage,
    });
  }, [activeTabId, filePath, dirty, content, fileMode, codeLanguage]);

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

  // ---- Open multiple files atomically (drag-drop) ----
  // All file reads happen in parallel first; then ALL tab state is applied in a
  // single synchronous pass with no React re-renders in between.  This eliminates
  // every stale-closure / stale-ref timing issue for 2, 3, 4, N files.
  const openDroppedFiles = useCallback(
    (files: { path: string; content: string }[]) => {
      if (files.length === 0) return;

      // Skip files already open in a tab (check current tabsRef snapshot)
      const newFiles = files.filter(
        ({ path }) => !tabsRef.current.some((t) => t.filePath === path)
      );
      if (newFiles.length === 0) return;

      const view = viewRef.current;
      const plugins = view?.state.plugins ?? [];

      // Stash the currently active tab before adding any new ones
      const curId = activeTabIdRef.current;
      if (curId) {
        storedTabsRef.current.set(curId, {
          id: curId,
          filePath: filePathRef.current,
          dirty: dirtyRef.current,
          content: contentRef.current,
          editorState: view ? view.state : null,
          fileMode: fileModeRef.current,
          codeLanguage: codeLanguageRef.current,
        });
      }

      const newTabMeta: TabData[] = [];

      // All files except the last are stored directly — they never need to be the
      // active tab, so we build their EditorState now and put them in storedTabsRef.
      for (let i = 0; i < newFiles.length - 1; i++) {
        const { path, content } = newFiles[i];
        const mode = getFileMode(path);
        const lang = getCodeLanguage(path);
        const id = makeTabId();
        newTabMeta.push({ id, filePath: path, dirty: false });
        storedTabsRef.current.set(id, {
          id,
          filePath: path,
          dirty: false,
          content,
          editorState: makeEditorStateForContent(content, mode, lang, plugins),
          fileMode: mode,
          codeLanguage: lang,
        });
      }

      // The last file becomes the active tab
      const { path: activePath, content: activeContent } = newFiles[newFiles.length - 1];
      const activeMode = getFileMode(activePath);
      const activeLang = getCodeLanguage(activePath);
      const activeId = makeTabId();
      newTabMeta.push({ id: activeId, filePath: activePath, dirty: false });

      // Update imperative refs so polling / save handlers see the right active tab
      activeTabIdRef.current = activeId;
      filePathRef.current = activePath;
      dirtyRef.current = false;
      contentRef.current = activeContent;
      fileModeRef.current = activeMode;
      codeLanguageRef.current = activeLang;

      // Single React state batch — one render covers all new tabs
      setTabs((prev) => [...prev, ...newTabMeta]);
      setActiveTabId(activeId);
      setFilePath(activePath);
      setFileMode(activeMode);
      setCodeLanguage(activeLang);
      setContent(activeContent);
      setDirty(false);

      const activeState = makeEditorStateForContent(activeContent, activeMode, activeLang, plugins);
      if (view) {
        view.updateState(activeState);
      }
      const stats = getDocStats(activeState.doc);
      setWordCount(stats.words);
      setCharCount(stats.chars);
    },
    [] // only uses refs + stable setters
  );
  const openDroppedFilesRef = useRef(openDroppedFiles);
  useEffect(() => { openDroppedFilesRef.current = openDroppedFiles; }, [openDroppedFiles]);

  useEffect(() => {
    const TEXT_EXT = TEXT_EXTENSIONS;
    const unlistenEnter = listen("tauri://drag-enter", () => { if (!draggingTabIdRef.current) setIsDragging(true); });
    const unlistenOver  = listen("tauri://drag-over",  () => { if (!draggingTabIdRef.current) setIsDragging(true); });
    const unlistenLeave = listen("tauri://drag-leave", () => setIsDragging(false));
    const unlistenDrop  = listen<{ paths: string[] }>("tauri://drag-drop", async (event) => {
      setIsDragging(false);

      // Deduplicate paths within this batch, then read all in parallel
      const uniquePaths = [...new Set(
        (event.payload?.paths ?? [])
          .filter((p) => TEXT_EXT.has(p.split(".").pop()?.toLowerCase() ?? ""))
      )];
      if (uniquePaths.length === 0) return;

      const results = await Promise.allSettled(
        uniquePaths.map(async (p) => ({
          path: p,
          content: await invoke<string>("read_file", { path: p }),
        }))
      );
      const files = results
        .filter((r): r is PromiseFulfilledResult<{ path: string; content: string }> =>
          r.status === "fulfilled"
        )
        .map((r) => r.value);

      files.forEach(({ path }) => addRecentFile(path));
      // Apply all tabs atomically in one synchronous pass
      openDroppedFilesRef.current(files);
    });
    return () => {
      unlistenEnter.then((f) => f());
      unlistenOver.then((f) => f());
      unlistenLeave.then((f) => f());
      unlistenDrop.then((f) => f());
    };
  }, []); // registered once — callbacks forwarded via refs

  // ---- Switch to a stored tab ----
  const restoreTab = useCallback(
    (tabId: string) => {
      const view = viewRef.current;
      if (!view) return;

      const stored = storedTabsRef.current.get(tabId);
      if (stored) {
        const mode = stored.fileMode ?? "markdown";
        const lang = stored.codeLanguage ?? "";
        const state =
          stored.editorState ??
          makeEditorStateForContent(stored.content, mode, lang, view.state.plugins);
        view.updateState(state);
        setFilePath(stored.filePath);
        setContent(stored.content);
        setDirty(stored.dirty);
        setFileMode(mode);
        setCodeLanguage(lang);
        const stats = getDocStats(state.doc);
        setWordCount(stats.words);
        setCharCount(stats.chars);
      } else {
        // Brand new tab — empty markdown document
        const emptyState = makeEmptyEditorState(view.state.plugins);
        view.updateState(emptyState);
        setFilePath(null);
        setContent("");
        setDirty(false);
        setFileMode("markdown");
        setCodeLanguage("");
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
    setFileMode("markdown");
    setCodeLanguage("");
    setContent("");
    setDirty(false);
    setWordCount(0);
    setCharCount(0);
  }, [stashActiveTab]);
  useEffect(() => { handleNewRef.current = handleNew; }, [handleNew]);

  // ---- Close tab ----
  const handleCloseTab = useCallback(
    (id: string, skipDirtyCheck = false) => {
      const tabMeta = tabs.find((t) => t.id === id);
      const stored = storedTabsRef.current.get(id);
      const isDirty = id === activeTabId ? dirty : stored?.dirty ?? false;

      if (isDirty && !skipDirtyCheck) {
        const label = tabMeta?.filePath
          ? tabMeta.filePath.split("/").pop()
          : "Blank";
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
            setFileMode("markdown");
            setCodeLanguage("");
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

  // ---- Helper: load file content into a new tab (stashes the current tab) ----
  const doOpenFile = useCallback(
    (path: string, fileContent: string, mode: FileMode, language: string): string => {
      stashActiveTab();
      const id = makeTabId();
      const view = viewRef.current;
      const plugins = view?.state.plugins ?? [];
      const newState = makeEditorStateForContent(fileContent, mode, language, plugins);
      setTabs((prev) => [...prev, { id, filePath: path, dirty: false }]);
      setActiveTabId(id);
      if (view) view.updateState(newState);
      setFilePath(path);
      setFileMode(mode);
      setCodeLanguage(language);
      setContent(fileContent);
      setDirty(false);
      lastDiskContentRef.current = fileContent;
      const stats = getDocStats(newState.doc);
      setWordCount(stats.words);
      setCharCount(stats.chars);
      return id;
    },
    [stashActiveTab]
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

      const mode = getFileMode(path);
      const language = getCodeLanguage(path);

      // Warn before loading files over 1 MB
      if (fileContent.length > 1_000_000) {
        setPendingLargeFile({ path, content: fileContent, mode, language });
        return;
      }

      const newTabId = doOpenFile(path, fileContent, mode, language);

      // Check autosave (markdown only)
      if (mode === "markdown") {
        const saved = await loadAutosave(path).catch(() => null);
        if (saved && saved !== fileContent) {
          setRecovery({ key: path, content: saved, filePath: path, tabId: newTabId });
        }
      }
    } catch (e) {
      console.error("Failed to open file:", e);
    }
  }, [tabs, activeTabId, addRecentFile, stashActiveTab, handleSelectTab, doOpenFile]);

  // ---- Save ----
  const handleSave = useCallback(async () => {
    const view = viewRef.current;
    if (!view) return;

    // For markdown, serialize from ProseMirror doc; for code/plaintext use raw content
    const saveContent = fileModeRef.current === "markdown"
      ? docToMarkdown(view.state.doc)
      : (view.state.doc.childCount > 0 ? view.state.doc.child(0).textContent : "");
    let savePath = filePath;

    if (!savePath) {
      const path = await invoke<string | null>("show_save_dialog");
      if (!path) return;
      savePath = path;
    }

    try {
      suppressWatchUntilRef.current = Date.now() + 2000;
      await invoke("write_file", { path: savePath, content: saveContent });
      lastDiskContentRef.current = saveContent;
      setFilePath(savePath);
      setDirty(false);
      setContent(saveContent);
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
  useEffect(() => { handleOpenRef.current = handleOpen; }, [handleOpen]);

  // ---- Save As ----
  const handleSaveAs = useCallback(async () => {
    const view = viewRef.current;
    if (!view) return;

    const saveContent = fileModeRef.current === "markdown"
      ? docToMarkdown(view.state.doc)
      : (view.state.doc.childCount > 0 ? view.state.doc.child(0).textContent : "");
    const path = await invoke<string | null>("show_save_dialog");
    if (!path) return;

    try {
      suppressWatchUntilRef.current = Date.now() + 2000;
      await invoke("write_file", { path, content: saveContent });
      lastDiskContentRef.current = saveContent;
      setFilePath(path);
      setDirty(false);
      setContent(saveContent);
      setDeletedPaths((prev) => { const n = new Set(prev); n.delete(path); return n; });
      setExternalChange(null);
      syncTabMeta(activeTabId, { filePath: path, dirty: false });
      addRecentFile(path);
    } catch (e) {
      console.error("Failed to save:", e);
    }
  }, [activeTabId, addRecentFile, syncTabMeta]);
  useEffect(() => { handleSaveAsRef.current = handleSaveAs; }, [handleSaveAs]);

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
    const tabMode = tabId === activeTabId ? fileModeRef.current : (stored?.fileMode ?? "markdown");
    const tabContent = tabId === activeTabId
      ? (viewRef.current
          ? (tabMode === "markdown"
              ? docToMarkdown(viewRef.current.state.doc)
              : (viewRef.current.state.doc.childCount > 0
                  ? viewRef.current.state.doc.child(0).textContent : ""))
          : content)
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
  useEffect(() => { handleNewWindowRef.current = handleNewWindow; }, [handleNewWindow]);

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

  // ---- Native menu event listener ----
  useEffect(() => {
    const promise = listen<string>("menu-action", (event) => {
      switch (event.payload) {
        case "new":         handleNewRef.current(); break;
        case "open":        handleOpenRef.current(); break;
        case "save":        handleSaveRef.current(); break;
        case "save-as":     handleSaveAsRef.current(); break;
        case "export-html": handleExportHtmlRef.current(); break;
        case "export-pdf":  handleExportPdfRef.current(); break;
        case "theme":       setThemePickerOpen(true); break;
        case "check-updates": setUpdateDialogOpen(true); break;
        case "new-window":  handleNewWindowRef.current(); break;
      }
    });
    return () => { promise.then((fn) => fn()); };
  }, []);

  // ---- Export ----
  const handleExportHtml = useCallback(async () => {
    const view = viewRef.current;
    if (!view) return;
    await exportToHtml(
      view.state.doc,
      filePath?.split("/").pop() || "Bioscratch Document"
    );
  }, [filePath]);

  const handleExportPdf = useCallback(async () => {
    const view = viewRef.current;
    if (!view) return;
    const markdown = docToMarkdown(view.state.doc);
    const filename = filePath?.split("/").pop() || "document.md";
    try {
      await exportToPdf(markdown, filename, filePath ?? null);
    } catch (err) {
      alert(String(err));
    }
  }, [filePath]);
  useEffect(() => { handleExportHtmlRef.current = handleExportHtml; }, [handleExportHtml]);
  useEffect(() => { handleExportPdfRef.current = handleExportPdf; }, [handleExportPdf]);

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
        onExportPdf={handleExportPdf}
        onToggleSearch={handleToggleSearch}
        onOpenThemeSelector={() => setThemePickerOpen(true)}
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
            <img src="/logo.png" className="welcome-logo" alt="Bioscratch" />
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
          filePath={filePath}
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

      {pendingLargeFile && (
        <LargeFileDialog
          path={pendingLargeFile.path}
          byteSize={pendingLargeFile.content.length}
          onConfirm={async () => {
            const { path, content: fileContent, mode, language } = pendingLargeFile;
            setPendingLargeFile(null);
            doOpenFile(path, fileContent, mode, language);
          }}
          onCancel={() => setPendingLargeFile(null)}
        />
      )}

      {themePickerOpen && (
        <ThemeSelector
          currentTheme={theme}
          userThemeVars={userThemeVars}
          onSelect={(t) => { setTheme(t); setThemePickerOpen(false); }}
          onClose={() => setThemePickerOpen(false)}
          onImport={handleImportTheme}
          onDeleteUserTheme={handleDeleteUserTheme}
        />
      )}

      {updateDialogOpen && (
        <UpdateDialog onClose={() => setUpdateDialogOpen(false)} />
      )}
    </div>
  );
};

export default App;
