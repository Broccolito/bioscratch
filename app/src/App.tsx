import React, { useRef, useState, useEffect, useCallback, useMemo } from "react";
import { EditorView } from "prosemirror-view";
import { EditorState, TextSelection } from "prosemirror-state";
import { schema } from "./editor/schema";
import { markdownSearchTarget, markdownToDoc } from "./editor/serialization/markdownImport";
import { docToMarkdown } from "./editor/serialization/markdownExport";
import { getDocStats } from "./lib/stats";
import { exportToHtml, exportToPdf } from "./lib/export";
import { getFileMode, getCodeLanguage, FileMode, isOpenableTextFile } from "./lib/fileMode";
import { autosaveKeyForDiscard, canCompleteSaveClose, saveBeforeClose, type CloseFlow } from "./lib/closeFlow";
import { detachDocument, type DetachDocument } from "./lib/detachFlow";
import { planSavedDocument, type SaveDocumentSnapshot } from "./lib/saveFlow";
import { useTheme } from "./hooks/useTheme";
import { planRecovery } from "./lib/recoveryFlow";
import {
  fetchUserThemes,
  saveUserTheme,
  deleteUserTheme,
  parseUserThemeYaml,
} from "./lib/themeLoader";
import { useRecentFiles } from "./hooks/useRecentFiles";
import { useWorkspace } from "./hooks/useWorkspace";
import { useTagIndex } from "./hooks/useTagIndex";
import { flattenTagTree, notesWithTags, tagTree } from "./lib/tagIndex";
import { canEditDocTags, docTags, setDocTags } from "./editor/frontmatterTags";
import {
  ancestorsWithin,
  basename,
  containingRoot,
  dirname,
  isUnder,
  listWorkspaceFiles,
  occurrenceIndexAtLine,
  remapPath,
} from "./lib/workspace";
import {
  NavHistory,
  emptyHistory,
  visit,
  goBack,
  goForward,
  forget,
} from "./lib/navHistory";
import { setSearch, searchPluginKey } from "./editor/plugins/search";
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
import RecentFilesDialog from "./components/RecentFilesDialog";
import CloseDocumentDialog from "./components/CloseDocumentDialog";
import Sidebar, { SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH } from "./components/Sidebar";
import NavBar from "./components/NavBar";
import QuickSwitcher from "./components/QuickSwitcher";
import TagBar from "./components/TagBar";
import type { OpenOptions, RevealRequest, TreeFilter } from "./components/FileTree";

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
  scrollTop: number;
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
  if (doc.firstChild?.type === schema.nodes.frontmatter) {
    const bodyStart = Math.min(doc.firstChild.nodeSize + 1, doc.content.size);
    return EditorState.create({
      doc,
      plugins,
      selection: TextSelection.near(doc.resolve(bodyStart), 1),
    });
  }
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

function readStoredNumber(key: string, fallback: number, min: number, max: number): number {
  try {
    const saved = localStorage.getItem(key);
    const value = saved ? parseInt(saved, 10) : NaN;
    return Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
  } catch {
    return fallback;
  }
}

function readStoredFlag(key: string, fallback: boolean): boolean {
  try {
    const saved = localStorage.getItem(key);
    return saved === null ? fallback : saved === "1";
  } catch {
    return fallback;
  }
}

function storeValue(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {}
}

const App: React.FC = () => {
  const viewRef = useRef<EditorView | null>(null);
  // User theme state: filename → parsed vars
  const [userThemeVars, setUserThemeVars] = useState<Record<string, Record<string, string>>>({});
  const { theme, setTheme } = useTheme(userThemeVars);
  const [themePickerOpen, setThemePickerOpen] = useState(false);
  const [recentPickerOpen, setRecentPickerOpen] = useState(false);
  const [updateDialogOpen, setUpdateDialogOpen] = useState(false);
  const [fontScale, setFontScale] = useState<number>(() => {
    const saved = localStorage.getItem("bioscratch-font-scale");
    return saved ? Math.max(60, Math.min(200, parseInt(saved, 10))) : 100;
  });
  const {
    recentFiles,
    addRecentFile,
    removeRecentFile,
    refreshRecentFiles,
  } = useRecentFiles();
  const { folders, activeRoot, loaded: workspaceLoaded, setActiveRoot, addFolder, removeFolder } = useWorkspace();
  // Wait until persisted folders are re-granted, or the first scan is refused.
  const tagIndex = useTagIndex(workspaceLoaded ? activeRoot : null);
  const updateTagIndex = tagIndex.updateNote;
  const { setDirtyNotes, dropLiveTags } = tagIndex;
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [filterTree, setFilterTree] = useState(false);
  // Folder at the top of the Files tree (double-click a folder to open it);
  // search and tag filtering cover this folder.
  const [viewDir, setViewDir] = useState<string | null>(null);
  useEffect(() => {
    setViewDir((dir) => (dir && activeRoot && isUnder(dir, activeRoot) ? dir : activeRoot));
  }, [activeRoot]);
  const scopeDir = viewDir ?? activeRoot;

  const tagMatches = useMemo(
    () => (selectedTags.length > 0 ? notesWithTags(tagIndex.index, selectedTags, scopeDir) : []),
    [tagIndex.index, selectedTags, scopeDir]
  );

  const treeFilter = useMemo<TreeFilter | null>(() => {
    if (!activeRoot || !filterTree || selectedTags.length === 0) return null;
    const dirs = new Set<string>();
    for (const path of tagMatches) for (const dir of ancestorsWithin(path, activeRoot)) dirs.add(dir);
    return { files: new Set(tagMatches), dirs };
  }, [activeRoot, filterTree, selectedTags, tagMatches]);

  // The tags offered when tagging a note: those used in the folder currently
  // shown in the Files tree (navigating into a subfolder narrows them).
  const folderTags = useMemo(() => {
    const inScope = [...tagIndex.index.notes.keys()].filter((p) => !scopeDir || isUnder(p, scopeDir));
    return flattenTagTree(tagTree(tagIndex.index, inScope));
  }, [tagIndex.index, scopeDir]);

  // ---- Sidebar / navigation UI state ----
  const [sidebarVisible, setSidebarVisible] = useState(() => readStoredFlag("bioscratch-sidebar-visible", true));
  const [sidebarWidth, setSidebarWidth] = useState(() =>
    readStoredNumber("bioscratch-sidebar-width", 260, SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH)
  );
  const [reveal, setReveal] = useState<RevealRequest | null>(null);
  const revealSeqRef = useRef(0);
  const [searchFocusSeq, setSearchFocusSeq] = useState(0);
  const [quickOpen, setQuickOpen] = useState(false);
  const quickOpenRef = useRef(false);
  useEffect(() => { quickOpenRef.current = quickOpen; }, [quickOpen]);
  const [workspaceFiles, setWorkspaceFiles] = useState<{ root: string; files: string[]; truncated: boolean } | null>(null);
  const [workspaceFilesLoading, setWorkspaceFilesLoading] = useState(false);
  // Query pre-filled into the in-document search bar after a folder-search jump.
  const [searchSeed, setSearchSeed] = useState({ query: "", key: 0 });
  // Per-tab back/forward history; navTick re-renders the nav buttons.
  const historyRef = useRef<Map<string, NavHistory>>(new Map());
  const [, setNavTick] = useState(0);
  const bumpNav = useCallback(() => setNavTick((t) => t + 1), []);

  useEffect(() => { storeValue("bioscratch-sidebar-visible", sidebarVisible ? "1" : "0"); }, [sidebarVisible]);
  useEffect(() => { storeValue("bioscratch-sidebar-width", String(sidebarWidth)); }, [sidebarWidth]);

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

  // Startup update check — runs once, 3s after mount so it never delays app load.
  // Silently ignores network errors so offline users see no disruption.
  useEffect(() => {
    const timer = setTimeout(() => {
      invoke<{ is_update_available: boolean }>("check_for_updates")
        .then(({ is_update_available }) => {
          if (is_update_available) setUpdateDialogOpen(true);
        })
        .catch(() => { /* network unavailable — skip silently */ });
    }, 3000);
    return () => clearTimeout(timer);
  }, []);

  // Apply font scale via CSS zoom on the html element
  useEffect(() => {
    document.documentElement.style.zoom = String(fontScale / 100);
    localStorage.setItem("bioscratch-font-scale", String(fontScale));
  }, [fontScale]);

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
  const [pendingClose, setPendingClose] = useState<{
    tabId: string;
    label: string;
    filePath: string | null;
  } | null>(null);
  const [pendingSaveCloseId, setPendingSaveCloseId] = useState<string | null>(null);
  const [closeSaving, setCloseSaving] = useState(false);
  const [closeFlow, setCloseFlow] = useState<CloseFlow | null>(null);
  const closeFlowRef = useRef<CloseFlow | null>(null);
  const cancelledQuitRef = useRef(0);
  const [quitReady, setQuitReady] = useState(false);
  // Keep acknowledged windows read-only until every other window has finished
  // reviewing or cancelled. Otherwise edits made after acknowledgement are lost.
  const closeBlocked = !!closeFlow || !!pendingClose || closeSaving;
  const closeBlockedRef = useRef(closeBlocked);
  closeBlockedRef.current = closeBlocked;
  const deferredFileOpensRef = useRef<string[]>([]);
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
            filePathRef.current = initialFile;
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
    dirtyRef.current = true;
    setDirty(true);
    syncTabMeta(activeTabId, { dirty: true });
    const view = viewRef.current;
    if (view) {
      const stats = getDocStats(view.state.doc);
      setWordCount(stats.words);
      setCharCount(stats.chars);
      if (fileModeRef.current === "markdown") {
        contentRef.current = docToMarkdown(view.state.doc);
        setContent(contentRef.current);
      } else {
        // For code/plaintext: extract raw text from the single code_block node
        contentRef.current = view.state.doc.childCount > 0 ? view.state.doc.child(0).textContent : "";
        setContent(contentRef.current);
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
      filePathRef.current = path;
      view.updateState(newState);
      fileModeRef.current = actualMode;
      codeLanguageRef.current = actualLang;
      contentRef.current = rawContent;
      dirtyRef.current = false;
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
  // Forward ref so the close flow can call handleSave before it's declared.
  // A false result means the save dialog was cancelled or the write failed.
  const handleSaveRef = useRef<() => Promise<boolean>>(async () => false);
  // Refs for menu-action event handler (avoids stale closures across re-renders)
  const handleNewRef = useRef<() => void>(() => {});
  const handleOpenRef = useRef<() => void>(() => {});
  const openFileByPathRef = useRef<(path: string) => Promise<boolean>>(async () => false);
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
    const scrollEl = document.querySelector(".editor-scroll-area") as HTMLElement | null;
    storedTabsRef.current.set(activeTabId, {
      id: activeTabId,
      filePath,
      dirty,
      content,
      editorState: view ? view.state : null,
      fileMode,
      codeLanguage,
      scrollTop: scrollEl?.scrollTop ?? 0,
    });
  }, [activeTabId, filePath, dirty, content, fileMode, codeLanguage]);


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
        const scrollEl = document.querySelector(".editor-scroll-area") as HTMLElement | null;
        storedTabsRef.current.set(curId, {
          id: curId,
          filePath: filePathRef.current,
          dirty: dirtyRef.current,
          content: contentRef.current,
          editorState: view ? view.state : null,
          fileMode: fileModeRef.current,
          codeLanguage: codeLanguageRef.current,
          scrollTop: scrollEl?.scrollTop ?? 0,
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
          scrollTop: 0,
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
        const scrollEl = document.querySelector(".editor-scroll-area") as HTMLElement | null;
        if (scrollEl) scrollEl.scrollTop = 0;
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
    const unlistenEnter = listen("tauri://drag-enter", () => { if (!draggingTabIdRef.current) setIsDragging(true); });
    const unlistenOver  = listen("tauri://drag-over",  () => { if (!draggingTabIdRef.current) setIsDragging(true); });
    const unlistenLeave = listen("tauri://drag-leave", () => setIsDragging(false));
    const unlistenDrop  = listen<{ paths: string[] }>("tauri://drag-drop", async (event) => {
      setIsDragging(false);
      if (closeBlockedRef.current) return;

      // Deduplicate paths within this batch, then read all in parallel
      const uniquePaths = [...new Set(
        (event.payload?.paths ?? [])
          .filter(isOpenableTextFile)
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
      if (!closeBlockedRef.current) openDroppedFilesRef.current(files);
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
      activeTabIdRef.current = tabId;
      const scrollEl = document.querySelector(".editor-scroll-area") as HTMLElement | null;

      const stored = storedTabsRef.current.get(tabId);
      if (stored) {
        const mode = stored.fileMode ?? "markdown";
        const lang = stored.codeLanguage ?? "";
        const state =
          stored.editorState ??
          makeEditorStateForContent(stored.content, mode, lang, view.state.plugins);
        filePathRef.current = stored.filePath;
        view.updateState(state);
        contentRef.current = stored.content;
        dirtyRef.current = stored.dirty;
        fileModeRef.current = mode;
        codeLanguageRef.current = lang;
        if (scrollEl) scrollEl.scrollTop = stored.scrollTop ?? 0;
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
        filePathRef.current = null;
        view.updateState(emptyState);
        contentRef.current = "";
        dirtyRef.current = false;
        fileModeRef.current = "markdown";
        codeLanguageRef.current = "";
        if (scrollEl) scrollEl.scrollTop = 0;
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
    activeTabIdRef.current = id;
    filePathRef.current = null;
    contentRef.current = "";
    dirtyRef.current = false;
    fileModeRef.current = "markdown";
    codeLanguageRef.current = "";
    setTabs((prev) => [...prev, newTab]);
    setActiveTabId(id);
    // restoreTab will find nothing for this id and create an empty doc
    const view = viewRef.current;
    if (view) {
      const emptyState = makeEmptyEditorState(view.state.plugins);
      view.updateState(emptyState);
    }
    const scrollEl = document.querySelector(".editor-scroll-area") as HTMLElement | null;
    if (scrollEl) scrollEl.scrollTop = 0;
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
  const closeTabImmediately = useCallback(
    (id: string) => {
      const closedPath = tabsRef.current.find((t) => t.id === id)?.filePath;
      if (closedPath) dropLiveTags((p) => p === closedPath);
      storedTabsRef.current.delete(id);
      historyRef.current.delete(id);

      setTabs((prev) => {
        const remaining = prev.filter((t) => t.id !== id);
        if (remaining.length === 0) {
          // Hide the window instead of keeping a blank tab
          setTimeout(async () => {
            setActiveTabId("");
            const view = viewRef.current;
            filePathRef.current = null;
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
              if (!closeFlowRef.current) await Window.getCurrent().hide();
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
    [activeTabId, restoreTab, dropLiveTags]
  );
  const closeTabImmediatelyRef = useRef(closeTabImmediately);
  useEffect(() => {
    closeTabImmediatelyRef.current = closeTabImmediately;
  }, [closeTabImmediately]);

  const handleCloseTab = useCallback(
    (id: string, skipDirtyCheck = false) => {
      const tabMeta = tabs.find((tab) => tab.id === id);
      if (!tabMeta) return;
      const stored = storedTabsRef.current.get(id);
      const isDirty = id === activeTabId ? dirty : stored?.dirty ?? tabMeta.dirty;

      if (isDirty && !skipDirtyCheck) {
        const targetPath = id === activeTabId
          ? filePath
          : stored?.filePath ?? tabMeta.filePath;
        const label = targetPath
          ? targetPath.replace(/\\/g, "/").split("/").pop() || targetPath
          : "Blank";
        setPendingClose({ tabId: id, label, filePath: targetPath });
        return;
      }

      closeTabImmediately(id);
    },
    [tabs, activeTabId, dirty, filePath, closeTabImmediately]
  );

  // ---- Helper: load file content into a new tab (stashes the current tab) ----
  const doOpenFile = useCallback(
    (path: string | null, fileContent: string, mode: FileMode, language: string): string => {
      stashActiveTab();
      const id = makeTabId();
      const view = viewRef.current;
      const plugins = view?.state.plugins ?? [];
      const newState = makeEditorStateForContent(fileContent, mode, language, plugins);
      activeTabIdRef.current = id;
      filePathRef.current = path;
      contentRef.current = fileContent;
      dirtyRef.current = false;
      fileModeRef.current = mode;
      codeLanguageRef.current = language;
      setTabs((prev) => [...prev, { id, filePath: path, dirty: false }]);
      setActiveTabId(id);
      if (view) view.updateState(newState);
      const scrollEl = document.querySelector(".editor-scroll-area") as HTMLElement | null;
      if (scrollEl) scrollEl.scrollTop = 0;
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
  const saveDocument = useCallback(async (saveAs: boolean): Promise<boolean> => {
    const view = viewRef.current;
    const tabId = activeTabIdRef.current;
    if (!view || !tabId) return false;
    const snapshotMode = fileModeRef.current;
    const snapshot: SaveDocumentSnapshot = {
      tabId,
      filePath: filePathRef.current,
      content: snapshotMode === "markdown"
        ? docToMarkdown(view.state.doc)
        : view.state.doc.firstChild?.textContent ?? "",
    };

    try {
      let savePath = saveAs ? null : snapshot.filePath;
      if (!savePath) {
        savePath = await invoke<string | null>("show_save_dialog");
        if (!savePath) return false;
      }

      suppressWatchUntilRef.current = Date.now() + 2000;
      await invoke("write_file", { path: savePath, content: snapshot.content });
      if (snapshotMode === "markdown") updateTagIndex(savePath, snapshot.content);
      addRecentFile(savePath);
      setDeletedPaths((prev) => { const next = new Set(prev); next.delete(savePath); return next; });

      // The shared editor may now belong to another tab. Read the source by
      // its captured id, and never overwrite edits made while the write ran.
      const active = activeTabIdRef.current === tabId;
      const stored = storedTabsRef.current.get(tabId);
      const currentView = active ? viewRef.current : null;
      const current: SaveDocumentSnapshot | null = active && currentView
        ? {
            tabId,
            filePath: filePathRef.current,
            content: fileModeRef.current === "markdown"
              ? docToMarkdown(currentView.state.doc)
              : currentView.state.doc.firstChild?.textContent ?? "",
          }
        : stored && tabsRef.current.some((tab) => tab.id === tabId)
          ? { tabId, filePath: stored.filePath, content: stored.content }
          : null;
      const plan = planSavedDocument(snapshot, savePath, current);
      if (!plan) return false;

      const metadata = { filePath: plan.filePath, dirty: plan.dirty };
      tabsRef.current = tabsRef.current.map((tab) => tab.id === tabId ? { ...tab, ...metadata } : tab);
      syncTabMeta(tabId, metadata);
      if (active) {
        lastDiskContentRef.current = snapshot.content;
        filePathRef.current = plan.filePath;
        currentView?.updateState(currentView.state);
        contentRef.current = plan.content;
        dirtyRef.current = plan.dirty;
        setFilePath(plan.filePath);
        setContent(plan.content);
        setDirty(plan.dirty);
        setExternalChange(null);
      } else if (stored) {
        storedTabsRef.current.set(tabId, { ...stored, ...metadata });
      }
      if (!plan.dirty) {
        await deleteAutosave(savePath).catch(() => {});
        if (!snapshot.filePath) await deleteAutosave("__untitled__").catch(() => {});
      }
      return !plan.dirty;
    } catch (error) {
      console.error("Failed to save:", error);
      return false;
    }
  }, [addRecentFile, syncTabMeta, updateTagIndex]);
  const handleSave = useCallback(() => saveDocument(false), [saveDocument]);
  // Keep ref current so handleCloseTab (declared before handleSave) can call it
  useEffect(() => { handleSaveRef.current = handleSave; }, [handleSave]);
  useEffect(() => { handleOpenRef.current = handleOpen; }, [handleOpen]);

  // Closing the window or quitting walks through each unsaved tab with the
  // same Save / Delete / Cancel dialog (see src-tauri/src/unsaved.rs).
  const handleCancelClose = useCallback(() => {
    if (closeSaving) return;
    setPendingClose(null);
    setPendingSaveCloseId(null);
    // Cancel on any document stops the whole window close / quit.
    const current = closeFlowRef.current;
    if (current?.kind === "quit") {
      cancelledQuitRef.current = Math.max(cancelledQuitRef.current, current.generation);
      void invoke("cancel_quit", { generation: current.generation });
    }
    closeFlowRef.current = null;
    setCloseFlow(null);
    setQuitReady(false);
  }, [closeSaving]);

  const handleDeleteClose = useCallback(() => {
    if (!pendingClose || closeSaving) return;
    const { tabId, filePath: targetPath } = pendingClose;
    setPendingClose(null);
    setPendingSaveCloseId(null);
    // Delete means discard the unsaved document/changes. Remove its recovery
    // copy as well so reopening cannot resurrect content the user discarded.
    void deleteAutosave(autosaveKeyForDiscard(targetPath)).catch(() => {});
    closeTabImmediately(tabId);
  }, [pendingClose, closeSaving, closeTabImmediately]);

  const handleSaveClose = useCallback(() => {
    if (!pendingClose || closeSaving) return;
    setCloseSaving(true);
    if (pendingClose.tabId !== activeTabId) {
      // The shared EditorView can only serialize the active tab. Selecting a
      // background target restores its exact stored state before the effect
      // below performs the save.
      handleSelectTab(pendingClose.tabId);
    }
    setPendingSaveCloseId(pendingClose.tabId);
  }, [pendingClose, closeSaving, activeTabId, handleSelectTab]);

  useEffect(() => {
    if (!pendingSaveCloseId || activeTabId !== pendingSaveCloseId) return;
    const savingFlow = closeFlowRef.current;
    void saveBeforeClose(handleSaveRef.current, () => {
      // Another window can cancel the quit while this one's native Save
      // dialog/write is pending. Finish saving, but keep its document open.
      if (!canCompleteSaveClose(savingFlow, closeFlowRef.current)) return;
      setPendingClose(null);
      closeTabImmediatelyRef.current(pendingSaveCloseId);
    }).then(() => {
      setCloseSaving(false);
      setPendingSaveCloseId(null);
    });
  }, [pendingSaveCloseId, activeTabId]);

  const handleCloseTabRef = useRef(handleCloseTab);
  useEffect(() => { handleCloseTabRef.current = handleCloseTab; }, [handleCloseTab]);

  useEffect(() => {
    const start = (request: CloseFlow) => {
      const current = closeFlowRef.current;
      if (request.kind === "quit" && (request.generation <= cancelledQuitRef.current
        || (current?.kind === "quit" && request.generation < current.generation))) return;
      if (current?.kind === "quit" && (request.kind === "window" || current.generation === request.generation)) return;
      closeFlowRef.current = request;
      closeBlockedRef.current = true;
      setCloseFlow(request);
      setQuitReady(false);
      setQuickOpen(false);
      setThemePickerOpen(false);
      setRecentPickerOpen(false);
      setUpdateDialogOpen(false);
    };
    const unlistenClose = listen("close-requested", () => start({ kind: "window", generation: null }));
    const unlistenQuit = listen<number>("quit-requested", ({ payload }) => start({ kind: "quit", generation: payload }));
    const unlistenCancel = listen<number>("quit-cancelled", ({ payload }) => {
      cancelledQuitRef.current = Math.max(cancelledQuitRef.current, payload);
      const current = closeFlowRef.current;
      if (current?.kind !== "quit" || current.generation !== payload) return;
      closeFlowRef.current = null;
      setCloseFlow(null);
      setQuitReady(false);
      setPendingClose(null);
      setPendingSaveCloseId(null);
    });
    let disposed = false;
    // Register first, then recover a quit requested before this webview was
    // ready. Generations make late responses/cancellations harmless.
    void Promise.all([unlistenClose, unlistenQuit, unlistenCancel]).then(async () => {
      const generation = await invoke<number | null>("get_quit_generation");
      if (!disposed && generation !== null) start({ kind: "quit", generation });
    }).catch(console.error);
    return () => {
      disposed = true;
      unlistenClose.then((f) => f());
      unlistenQuit.then((f) => f());
      unlistenCancel.then((f) => f());
    };
  }, []);

  // Ask about the next unsaved tab once the previous answer has been handled;
  // when none are left, let the window close or the app quit.
  useEffect(() => {
    if (!closeFlow || quitReady || pendingClose || closeSaving || pendingSaveCloseId) return;
    const nextDirty = tabs.find((t) =>
      t.id === activeTabId ? dirty : storedTabsRef.current.get(t.id)?.dirty ?? t.dirty
    );
    if (nextDirty) {
      // Show the document being asked about, like Word does.
      if (nextDirty.id !== activeTabId) handleSelectTabRef.current(nextDirty.id);
      handleCloseTabRef.current(nextDirty.id);
      return;
    }
    if (closeFlow.kind === "quit") {
      setQuitReady(true);
      void invoke("window_ready_to_quit", { generation: closeFlow.generation });
    } else {
      void invoke("close_window_confirmed").catch((error) => {
        console.error("Failed to close window:", error);
        closeFlowRef.current = null;
        setCloseFlow(null);
      });
    }
  }, [closeFlow, quitReady, pendingClose, closeSaving, pendingSaveCloseId, tabs, activeTabId, dirty]);

  useEffect(() => {
    if (!closeFlow || !pendingClose) return;
    void import("@tauri-apps/api/window").then(async ({ getCurrentWindow }) => {
      const window = getCurrentWindow();
      await window.unminimize();
      await window.show();
      await window.setFocus();
    }).catch(console.error);
  }, [closeFlow, pendingClose]);

  // ---- Open file by path (used by OS "Open With" and default-app handler) ----
  const openFileByPath = useCallback(async (path: string): Promise<boolean> => {
    const existingTab = tabs.find((t) => t.filePath === path);
    if (existingTab) {
      handleSelectTab(existingTab.id);
      return true;
    }
    try {
      const fileContent = await invoke<string>("read_file", { path });
      addRecentFile(path);
      const mode = getFileMode(path);
      const language = getCodeLanguage(path);
      if (fileContent.length > 1_000_000) {
        setPendingLargeFile({ path, content: fileContent, mode, language });
        return true;
      }
      const newTabId = doOpenFile(path, fileContent, mode, language);
      if (mode === "markdown") {
        const saved = await loadAutosave(path).catch(() => null);
        if (saved && saved !== fileContent) {
          setRecovery({ key: path, content: saved, filePath: path, tabId: newTabId });
        }
      }
      return true;
    } catch (e) {
      console.error("Failed to open file:", e);
      removeRecentFile(path);
      return false;
    }
  }, [tabs, handleSelectTab, addRecentFile, removeRecentFile, doOpenFile]);
  useEffect(() => { openFileByPathRef.current = openFileByPath; }, [openFileByPath]);
  const doOpenFileRef = useRef(doOpenFile);
  useEffect(() => { doOpenFileRef.current = doOpenFile; }, [doOpenFile]);

  // ---- In-tab navigation (sidebar, quick switcher, search, back/forward) ----
  // Like a browser: a clean tab navigates in place and keeps a back/forward
  // history; a dirty tab is never replaced, so the file opens in a new tab.
  const showFileInActiveTab = useCallback((path: string, fileContent: string) => {
    loadDocContentRef.current(fileContent, path, getFileMode(path), getCodeLanguage(path));
    const scrollEl = document.querySelector(".editor-scroll-area") as HTMLElement | null;
    if (scrollEl) scrollEl.scrollTop = 0;
  }, []);

  /** Open `path`, returning the file's text (for search jumps) or null. */
  const navigateTo = useCallback(async (path: string, options: OpenOptions = {}): Promise<string | null> => {
    const existing = tabsRef.current.find((t) => t.filePath === path);
    if (existing) {
      if (existing.id === activeTabIdRef.current) return contentRef.current;
      const storedContent = storedTabsRef.current.get(existing.id)?.content ?? null;
      handleSelectTabRef.current(existing.id);
      return storedContent;
    }

    let fileContent: string;
    try {
      fileContent = await invoke<string>("read_file", { path });
    } catch (e) {
      console.error("Failed to open file:", e);
      return null;
    }
    const mode = getFileMode(path);
    const language = getCodeLanguage(path);
    if (fileContent.length > 1_000_000) {
      setPendingLargeFile({ path, content: fileContent, mode, language });
      return null;
    }
    addRecentFile(path);

    const currentId = activeTabIdRef.current;
    let tabId: string;
    if (!options.newTab && currentId && !dirtyRef.current) {
      const from = filePathRef.current;
      showFileInActiveTab(path, fileContent);
      historyRef.current.set(currentId, visit(historyRef.current.get(currentId) ?? emptyHistory(), from, path));
      bumpNav();
      tabId = currentId;
    } else {
      tabId = doOpenFileRef.current(path, fileContent, mode, language);
    }

    if (mode === "markdown") {
      const saved = await loadAutosave(path).catch(() => null);
      if (saved && saved !== fileContent) {
        setRecovery({ key: path, content: saved, filePath: path, tabId });
      }
    }
    return fileContent;
  }, [addRecentFile, showFileInActiveTab, bumpNav]);
  const navigateToRef = useRef(navigateTo);
  useEffect(() => { navigateToRef.current = navigateTo; }, [navigateTo]);

  const openFromSidebar = useCallback((path: string, options?: OpenOptions) => {
    void navigateToRef.current(path, options);
  }, []);

  /** Open a folder-search hit and highlight the clicked match in the editor. */
  const openSearchMatch = useCallback(async (
    path: string,
    query: string,
    line: number,
    options?: OpenOptions
  ) => {
    const fileContent = await navigateToRef.current(path, options);
    if (fileContent === null) return;
    // Wait for React to commit (and show the editor) before scrolling to the
    // match. setTimeout rather than rAF: rAF never fires in a hidden window.
    setTimeout(() => {
      const view = viewRef.current;
      if (!view || filePathRef.current !== path) return;
      const found = setSearch(query, view.state, view.dispatch);
      const target = getFileMode(path) === "markdown"
        ? markdownSearchTarget(fileContent, query, line, schema)
        : { matchIndex: occurrenceIndexAtLine(fileContent, query, line), anchor: 1 };
      const index = target.matchIndex !== null && target.matchIndex < found.matches.length ? target.matchIndex : -1;
      const position = index >= 0 ? found.matches[index].from : target.anchor;
      view.dispatch(
        view.state.tr
          .setMeta(searchPluginKey, { ...found, currentIndex: index })
          .setSelection(TextSelection.near(view.state.doc.resolve(Math.min(position, view.state.doc.content.size))))
          .scrollIntoView()
      );
      if (index >= 0) {
        setTimeout(() => {
          view.dom.querySelector(".search-highlight-current")?.scrollIntoView({ block: "center" });
        }, 0);
      }
      setSearchSeed((prev) => ({ query, key: prev.key + 1 }));
      setSearchVisible(true);
    }, 0);
  }, []);

  const navigateHistory = useCallback(async (direction: -1 | 1) => {
    const id = activeTabIdRef.current;
    if (!id || dirtyRef.current) return;
    const history = historyRef.current.get(id) ?? emptyHistory();
    const step = direction < 0
      ? goBack(history, filePathRef.current)
      : goForward(history, filePathRef.current);
    if (!step) return;

    // Never show one file in two tabs: jump to the tab that already has it.
    const elsewhere = tabsRef.current.find((t) => t.filePath === step.target && t.id !== id);
    if (elsewhere) {
      historyRef.current.set(id, forget(history, step.target));
      bumpNav();
      handleSelectTabRef.current(elsewhere.id);
      return;
    }

    try {
      const fileContent = await invoke<string>("read_file", { path: step.target });
      // The user may have switched tabs or started typing while we read.
      if (activeTabIdRef.current !== id || dirtyRef.current) return;
      showFileInActiveTab(step.target, fileContent);
      historyRef.current.set(id, step.history);
      addRecentFile(step.target);
    } catch {
      historyRef.current.set(id, forget(history, step.target));
    }
    bumpNav();
  }, [addRecentFile, showFileInActiveTab, bumpNav]);

  // ---- Sidebar actions ----
  /** Show the sidebar, optionally putting the caret in its search box. */
  const showSidebar = useCallback((focusSearch = false) => {
    setSidebarVisible(true);
    if (focusSearch) setSearchFocusSeq((n) => n + 1);
  }, []);

  const revealInSidebar = useCallback((path: string, isDir: boolean) => {
    const owner = containingRoot(path, folders);
    if (!owner) return;
    if (owner !== activeRoot) setActiveRoot(owner);
    setSidebarVisible(true);
    // A folder opens as the top of the tree; a file is expanded to and shown.
    if (isDir) setViewDir(path);
    else setReveal({ path, isDir, seq: ++revealSeqRef.current });
  }, [folders, activeRoot, setActiveRoot]);

  const filterByTag = useCallback((tag: string) => {
    setSelectedTags([tag]);
    setViewDir(activeRoot);
    showSidebar(true);
  }, [activeRoot, showSidebar]);

  // Open notes with unsaved changes, searched as they are now rather than as
  // they are on disk. The active tab's text is `content`; background tabs keep
  // theirs in storedTabsRef (refreshed whenever a tab is stashed).
  const openDocs = useMemo(() => {
    const docs = new Map<string, string>();
    for (const tab of tabs) {
      if (!tab.filePath) continue;
      if (tab.id === activeTabId) {
        if (dirty) docs.set(tab.filePath, content);
      } else {
        const stored = storedTabsRef.current.get(tab.id);
        if (stored?.dirty) docs.set(tab.filePath, stored.content);
      }
    }
    return docs;
  }, [tabs, activeTabId, dirty, content]);

  // Unsaved notes override the disk index, including background dirty tabs.
  // Replace the whole overlay so clean/abandoned paths can refresh from disk.
  useEffect(() => {
    setDirtyNotes(openDocs);
  }, [openDocs, setDirtyNotes]);

  // Follow the active file in the tree.
  useEffect(() => {
    if (!filePath || !scopeDir || !isUnder(filePath, scopeDir)) return;
    setReveal({ path: filePath, isDir: false, seq: ++revealSeqRef.current });
  }, [filePath, scopeDir]);

  const openQuickSwitcher = useCallback(() => {
    setQuickOpen(true);
    if (!activeRoot) return;
    const root = activeRoot;
    setWorkspaceFilesLoading(true);
    listWorkspaceFiles(root)
      .then((result) => {
        setWorkspaceFiles({
          root,
          files: result.files.filter(isOpenableTextFile),
          truncated: result.truncated,
        });
      })
      .catch((e) => console.error("Failed to list folder files:", e))
      .finally(() => setWorkspaceFilesLoading(false));
  }, [activeRoot]);

  // A file or folder was renamed in the Files tree: point every open tab,
  // history entry and recent file at the new path, so the file poller sees a
  // path change instead of a deleted file.
  const refreshTagIndex = tagIndex.refresh;
  const handlePathRenamed = useCallback((from: string, to: string) => {
    const remap = (p: string) => remapPath(p, from, to);
    suppressWatchUntilRef.current = Date.now() + 2000;
    // Re-reported under the new path by the live-tags effect.
    dropLiveTags((p) => remap(p) !== p);

    const renamedTabPaths = tabsRef.current
      .map((t) => t.filePath)
      .filter((p): p is string => !!p && remap(p) !== p);
    setTabs((prev) => prev.map((t) => (t.filePath ? { ...t, filePath: remap(t.filePath) } : t)));
    for (const [id, stored] of storedTabsRef.current) {
      if (!stored.filePath || remap(stored.filePath) === stored.filePath) continue;
      const nextPath = remap(stored.filePath);
      const nextMode = getFileMode(nextPath);
      const nextLanguage = getCodeLanguage(nextPath);
      const changesMode = nextMode !== stored.fileMode || nextLanguage !== stored.codeLanguage;
      storedTabsRef.current.set(id, {
        ...stored,
        filePath: nextPath,
        fileMode: nextMode,
        codeLanguage: nextLanguage,
        editorState: changesMode && stored.editorState
          ? makeEditorStateForContent(stored.content, nextMode, nextLanguage, stored.editorState.plugins)
          : stored.editorState,
      });
    }
    const current = filePathRef.current;
    if (current && remap(current) !== current) {
      const nextPath = remap(current);
      const nextMode = getFileMode(nextPath);
      const nextLanguage = getCodeLanguage(nextPath);
      const view = viewRef.current;
      filePathRef.current = nextPath;
      if (view && (nextMode !== fileModeRef.current || nextLanguage !== codeLanguageRef.current)) {
        // Keep the exact current text and dirty flag when a new extension
        // changes its editor mode; loading from disk would lose unsaved edits.
        const currentContent = fileModeRef.current === "markdown"
          ? docToMarkdown(view.state.doc)
          : view.state.doc.firstChild?.textContent ?? "";
        view.updateState(makeEditorStateForContent(currentContent, nextMode, nextLanguage, view.state.plugins));
        contentRef.current = currentContent;
        setContent(currentContent);
        const stats = getDocStats(view.state.doc);
        setWordCount(stats.words);
        setCharCount(stats.chars);
      } else if (view) {
        view.updateState(view.state);
      }
      fileModeRef.current = nextMode;
      codeLanguageRef.current = nextLanguage;
      setFilePath(nextPath);
      setFileMode(nextMode);
      setCodeLanguage(nextLanguage);
    }
    for (const [id, h] of historyRef.current) {
      historyRef.current.set(id, { back: h.back.map(remap), forward: h.forward.map(remap) });
    }
    for (const path of recentFiles) {
      if (remap(path) === path) continue;
      void removeRecentFile(path);
      void addRecentFile(remap(path));
    }
    // Recovery copies are keyed by path; the next autosave writes the new key.
    renamedTabPaths.forEach((p) => void deleteAutosave(p).catch(() => {}));
    setViewDir((dir) => (dir ? remap(dir) : dir));
    void refreshTagIndex();
    bumpNav();
  }, [recentFiles, addRecentFile, removeRecentFile, refreshTagIndex, bumpNav, dropLiveTags]);

  // A file or folder went to the Trash: close its clean tabs (a tab with
  // unsaved edits stays, showing the "deleted from disk" banner), and drop it
  // from history and recent files.
  const handlePathDeleted = useCallback((deleted: string) => {
    const gone = (p: string) => p === deleted || p.startsWith(`${deleted}/`);
    const toClose = tabsRef.current.filter((t) => {
      if (!t.filePath || !gone(t.filePath)) return false;
      const isDirty = t.id === activeTabIdRef.current
        ? dirtyRef.current
        : storedTabsRef.current.get(t.id)?.dirty ?? t.dirty;
      return !isDirty;
    });
    // Closing the last tab hides the window; never do that as a side effect of
    // deleting a file. Keep the active tab, which shows the "deleted" banner.
    if (toClose.length === tabsRef.current.length) {
      const keep = toClose.findIndex((t) => t.id === activeTabIdRef.current);
      toClose.splice(keep === -1 ? 0 : keep, 1);
    }
    // Close background tabs first so the active tab's neighbor is still valid.
    toClose
      .sort((a, b) => Number(a.id === activeTabIdRef.current) - Number(b.id === activeTabIdRef.current))
      .forEach((t) => closeTabImmediatelyRef.current(t.id));
    for (const [id, h] of historyRef.current) {
      historyRef.current.set(id, { back: h.back.filter((p) => !gone(p)), forward: h.forward.filter((p) => !gone(p)) });
    }
    recentFiles.filter(gone).forEach((p) => void removeRecentFile(p));
    dropLiveTags(gone);
    setViewDir((dir) => (dir && gone(dir) ? dirname(deleted) : dir));
    void refreshTagIndex();
    bumpNav();
  }, [recentFiles, removeRecentFile, refreshTagIndex, bumpNav, dropLiveTags]);

  const handleAddFolder = useCallback(async () => {
    const root = await addFolder();
    if (root) showSidebar();
  }, [addFolder, showSidebar]);

  // Shortcut and menu actions, read through a ref so listeners registered once
  // always call the latest closures.
  const workspaceActionsRef = useRef<Record<string, () => void>>({});
  useEffect(() => {
    workspaceActionsRef.current = {
      "open-folder": () => void handleAddFolder(),
      "toggle-sidebar": () => setSidebarVisible((v) => !v),
      "go-back": () => void navigateHistory(-1),
      "go-forward": () => void navigateHistory(1),
      "quick-open": openQuickSwitcher,
      "search-folder": () => showSidebar(true),
    };
  });

  // ---- Save As ----
  const handleSaveAs = useCallback(async () => { await saveDocument(true); }, [saveDocument]);
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
  const detachingTabsRef = useRef(new Set<string>());
  const handleDetachTab = useCallback(async (tabId: string) => {
    if (tabsRef.current.length <= 1 || detachingTabsRef.current.has(tabId) || closeBlockedRef.current) return;
    const current = (): DetachDocument | null => {
      const tab = tabsRef.current.find((t) => t.id === tabId);
      if (!tab) return null;
      const stored = storedTabsRef.current.get(tabId);
      const active = tabId === activeTabIdRef.current;
      const path = active ? filePathRef.current : stored?.filePath ?? tab.filePath;
      if (!path) return null; // Untitled documents cannot be handed off by path.
      const mode = active ? fileModeRef.current : stored?.fileMode ?? getFileMode(path);
      const language = active ? codeLanguageRef.current : stored?.codeLanguage ?? getCodeLanguage(path);
      const view = active ? viewRef.current : null;
      const text = view
        ? (mode === "markdown" ? docToMarkdown(view.state.doc) : view.state.doc.firstChild?.textContent ?? "")
        : active ? contentRef.current : stored?.content ?? "";
      return { filePath: path, content: text, mode, language };
    };
    const snapshot = current();
    if (!snapshot) { setDraggingTabId(null); return; }
    const tabDirty = tabId === activeTabIdRef.current
      ? dirtyRef.current
      : storedTabsRef.current.get(tabId)?.dirty ?? tabsRef.current.find((t) => t.id === tabId)?.dirty;
    detachingTabsRef.current.add(tabId);
    try {
      await detachDocument(snapshot, {
        current: () => closeBlockedRef.current ? null : current(),
        save: tabDirty ? async () => {
          suppressWatchUntilRef.current = Date.now() + 2000;
          await invoke("write_file", { path: snapshot.filePath, content: snapshot.content });
          if (filePathRef.current === snapshot.filePath) lastDiskContentRef.current = snapshot.content;
          if (snapshot.mode === "markdown") updateTagIndex(snapshot.filePath, snapshot.content);
        } : undefined,
        open: () => invoke("open_new_window", { filePath: snapshot.filePath }),
        close: () => closeTabImmediatelyRef.current(tabId),
      });
    } catch (error) {
      console.error("Failed to detach tab; the source document remains open:", error);
    } finally {
      detachingTabsRef.current.delete(tabId);
      setDraggingTabId(null);
    }
  }, [updateTagIndex]);

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
      if (closeBlockedRef.current) return;
      switch (event.payload) {
        case "new":         handleNewRef.current(); break;
        case "open":        handleOpenRef.current(); break;
        case "open-recent":
          void refreshRecentFiles().finally(() => setRecentPickerOpen(true));
          break;
        case "save":        handleSaveRef.current(); break;
        case "save-as":     handleSaveAsRef.current(); break;
        case "export-html": handleExportHtmlRef.current(); break;
        case "export-pdf":  handleExportPdfRef.current(); break;
        case "theme":       setThemePickerOpen(true); break;
        case "check-updates": setUpdateDialogOpen(true); break;
        case "new-window":  handleNewWindowRef.current(); break;
        case "font-larger":  setFontScale(s => Math.min(200, s + 10)); break;
        case "font-smaller": setFontScale(s => Math.max(60, s - 10)); break;
        case "font-reset":   setFontScale(100); break;
        default:             workspaceActionsRef.current[event.payload]?.(); break;
      }
    });
    return () => { promise.then((fn) => fn()); };
  }, [refreshRecentFiles]);

  // ---- OS "Open With" / default-app file handler ----
  useEffect(() => {
    // Check for a file the OS asked us to open before the JS listener was ready
    // (covers the "app launched to open a file" case).
    invoke<string | null>("get_initial_file").then((path) => {
      if (path) openFileByPathRef.current(path);
    });
    // Also listen for files opened while the app is already running.
    const unlisten = listen<string>("open-file", (event) => {
      if (closeBlockedRef.current) deferredFileOpensRef.current.push(event.payload);
      else void openFileByPathRef.current(event.payload);
    });
    return () => { unlisten.then((fn) => fn()); };
  }, []);

  useEffect(() => {
    if (closeBlocked) return;
    const paths = deferredFileOpensRef.current.splice(0);
    void (async () => {
      for (const path of paths) await openFileByPathRef.current(path);
    })();
  }, [closeBlocked]);

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
    const filename = filePath?.split("/").pop() || "document.md";

    // PDF is produced by printing the live, rendered WebView to PDF natively —
    // no Pandoc, LaTeX, or other tooling required, and the output is faithful to
    // exactly what's on screen (including the YAML banner).
    try {
      await exportToPdf(filename);
    } catch (err) {
      alert(String(err));
    }
  }, [filePath]);
  useEffect(() => { handleExportHtmlRef.current = handleExportHtml; }, [handleExportHtml]);
  useEffect(() => { handleExportPdfRef.current = handleExportPdf; }, [handleExportPdf]);

  // ---- Recovery ----
  const handleRestore = useCallback(() => {
    if (!recovery) return;
    const plan = planRecovery(recovery, tabsRef.current.map((tab) => ({
      ...tab,
      dirty: tab.id === activeTabIdRef.current
        ? dirtyRef.current
        : storedTabsRef.current.get(tab.id)?.dirty ?? tab.dirty,
    })));
    const recoveryMode = plan.filePath ? getFileMode(plan.filePath) : "markdown";
    const recoveryLanguage = plan.filePath ? getCodeLanguage(plan.filePath) : "";
    if (plan.tabId === activeTabIdRef.current) {
      loadDocContent(plan.content, plan.filePath, recoveryMode, recoveryLanguage);
    } else if (plan.tabId) {
      const stored = storedTabsRef.current.get(plan.tabId);
      storedTabsRef.current.set(plan.tabId, {
        id: plan.tabId,
        filePath: plan.filePath,
        content: plan.content,
        dirty: true,
        fileMode: recoveryMode,
        codeLanguage: recoveryLanguage,
        scrollTop: stored?.scrollTop ?? 0,
        editorState: makeEditorStateForContent(plan.content, recoveryMode, recoveryLanguage, viewRef.current?.state.plugins ?? []),
      });
      // Stash the active document before displaying the recovered owner.
      handleSelectTabRef.current(plan.tabId);
    } else {
      // The owner was edited, closed, or navigated elsewhere while autosave
      // was loading. Keep both versions: restore this one as an unsaved draft.
      plan.tabId = doOpenFileRef.current(null, plan.content, recoveryMode, recoveryLanguage);
    }
    activeTabIdRef.current = plan.tabId;
    filePathRef.current = plan.filePath;
    contentRef.current = plan.content;
    dirtyRef.current = true;
    fileModeRef.current = recoveryMode;
    codeLanguageRef.current = recoveryLanguage;
    setDirty(true);
    syncTabMeta(plan.tabId, { filePath: plan.filePath, dirty: true });
    setRecovery(null);
  }, [recovery, loadDocContent, syncTabMeta]);

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
      if (closeBlockedRef.current || quickOpenRef.current) return;
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();
      const run = (action: string) => {
        e.preventDefault();
        workspaceActionsRef.current[action]?.();
      };
      if (mod && !e.shiftKey && !e.altKey && /^[1-9]$/.test(e.key)) {
        // Like browsers: ⌘1–⌘8 jump to that tab, ⌘9 to the last one.
        e.preventDefault();
        const currentTabs = tabsRef.current;
        const n = Number(e.key);
        const target = n === 9 ? currentTabs[currentTabs.length - 1] : currentTabs[n - 1];
        if (target) handleSelectTabRef.current(target.id);
      } else if (mod && e.shiftKey && key === "o") {
        run("open-folder");
      } else if (mod && e.shiftKey && key === "f") {
        run("search-folder");
      } else if (mod && !e.shiftKey && key === "p") {
        run("quick-open");
      } else if (mod && e.key === "\\") {
        run("toggle-sidebar");
      } else if (mod && e.key === "[") {
        run("go-back");
      } else if (mod && e.key === "]") {
        run("go-forward");
      } else if (mod && e.key === "s") {
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
      } else if (mod && (e.key === "=" || e.key === "+")) {
        e.preventDefault();
        setFontScale(s => Math.min(200, s + 10));
      } else if (mod && e.key === "-") {
        e.preventDefault();
        setFontScale(s => Math.max(60, s - 10));
      } else if (mod && e.key === "0") {
        e.preventDefault();
        setFontScale(100);
      } else if (e.key === "Escape" && searchVisible) {
        setSearchVisible(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleSave, handleOpen, handleNew, handleNewWindow, handleCloseTab, handleSelectTab, activeTabId, searchVisible, setFontScale, pendingClose]);

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
      <div inert={closeBlocked} style={{ display: "contents" }}>
      <Toolbar
        view={viewRef.current}
        hasDocument={tabs.length > 0}
        fileMode={fileMode}
        onNew={handleNew}
        onOpen={handleOpen}
        onSave={handleSave}
        onSaveAs={handleSaveAs}
        onExportHtml={handleExportHtml}
        onExportPdf={handleExportPdf}
        onToggleSearch={handleToggleSearch}
        onOpenThemeSelector={() => setThemePickerOpen(true)}
        sidebarVisible={sidebarVisible}
        onToggleSidebar={() => setSidebarVisible((v) => !v)}
      />

      <div className="app-body">
      {sidebarVisible && (
        <Sidebar
          folders={folders}
          workspaceReady={workspaceLoaded}
          activeRoot={activeRoot}
          activePath={filePath}
          reveal={reveal}
          searchFocusSeq={searchFocusSeq}
          width={sidebarWidth}
          onWidthChange={setSidebarWidth}
          onSelectRoot={setActiveRoot}
          onAddFolder={() => void handleAddFolder()}
          onRemoveFolder={(root) => void removeFolder(root)}
          onOpenFile={openFromSidebar}
          onOpenMatch={(path, query, line, options) => void openSearchMatch(path, query, line, options)}
          viewDir={scopeDir}
          onViewDirChange={setViewDir}
          tagIndex={tagIndex.index}
          tagIndexLoading={tagIndex.loading}
          selectedTags={selectedTags}
          tagMatches={tagMatches}
          filterTree={filterTree}
          treeFilter={treeFilter}
          onSelectedTagsChange={setSelectedTags}
          onFilterTreeChange={setFilterTree}
          onRenamed={handlePathRenamed}
          onDeleted={handlePathDeleted}
          openDocs={openDocs}
          onRefreshTags={() => void tagIndex.refresh()}
        />
      )}
      <div className="app-main">
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

      {tabs.length > 0 && (() => {
        const history = historyRef.current.get(activeTabId);
        const blockedReason = dirty ? "Save this file to navigate away" : null;
        return (
          <NavBar
            filePath={filePath}
            root={filePath ? containingRoot(filePath, folders) : null}
            canGoBack={!dirty && (history?.back.length ?? 0) > 0}
            canGoForward={!dirty && (history?.forward.length ?? 0) > 0}
            blockedReason={blockedReason}
            onBack={() => void navigateHistory(-1)}
            onForward={() => void navigateHistory(1)}
            onRevealFolder={(path) => revealInSidebar(path, true)}
          />
        );
      })()}

      {tabs.length > 0 && fileMode === "markdown" && viewRef.current && (() => {
        const doc = viewRef.current.state.doc;
        return (
          <TagBar
            tags={docTags(doc)}
            editable={canEditDocTags(doc)}
            folderTags={folderTags}
            folderName={scopeDir ? basename(scopeDir) : "this folder"}
            onChange={(next) => {
              const view = viewRef.current;
              if (view) setDocTags(view.state, view.dispatch, next);
            }}
            onSelectTag={filterByTag}
          />
        );
      })()}

      {tabs.length === 0 && (
        <div className="welcome-screen">
          <div className="welcome-inner">
            <img src="/logo.png" className="welcome-logo" alt="Bioscratch" />
            <div className="welcome-tagline">A minimal markdown editor</div>
            <div className="welcome-hints">
              <span><kbd>⌘T</kbd> New document</span>
              <span><kbd>⌘O</kbd> Open file</span>
              <span><kbd>⇧⌘O</kbd> Open folder</span>
              <span><kbd>⌘P</kbd> Quick open</span>
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
          key={searchSeed.key}
          view={viewRef.current}
          initialQuery={searchSeed.query}
          onClose={() => {
            setSearchVisible(false);
            setSearchSeed((prev) => ({ query: "", key: prev.key + 1 }));
          }}
        />
      )}

      <div style={tabs.length === 0 ? { display: "none" } : { flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
        <EditorSurface
          onMount={handleMount}
          onChange={handleChange}
          onSave={handleSave}
          onSearch={handleToggleSearch}
          filePathRef={filePathRef}
          fileMode={fileMode}
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
      </div>
      </div>

      {quickOpen && (
        <QuickSwitcher
          workspaceFiles={workspaceFiles && workspaceFiles.root === activeRoot ? workspaceFiles.files : []}
          workspaceRoot={activeRoot}
          folders={folders}
          recentPaths={[
            ...tabs.map((t) => t.filePath).filter((p): p is string => !!p && p !== filePath),
            ...recentFiles.filter((p) => p !== filePath),
          ]}
          loading={workspaceFilesLoading && !(workspaceFiles && workspaceFiles.root === activeRoot)}
          truncated={!!workspaceFiles && workspaceFiles.root === activeRoot && workspaceFiles.truncated}
          onOpen={openFromSidebar}
          onClose={() => setQuickOpen(false)}
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

      </div>

      {quitReady && (
        <div className="modal-overlay">
          <div className="modal-dialog" role="status" aria-live="polite">
            <h2>Waiting for other windows</h2>
            <p>Review the unsaved documents in the other Bioscratch windows to finish quitting.</p>
            <div className="modal-actions">
              <button className="modal-btn secondary" onClick={handleCancelClose}>Cancel Quit</button>
            </div>
          </div>
        </div>
      )}

      {pendingClose && (
        <CloseDocumentDialog
          label={pendingClose.label}
          hasSavedFile={pendingClose.filePath !== null}
          saving={closeSaving}
          onDelete={handleDeleteClose}
          onCancel={handleCancelClose}
          onSave={handleSaveClose}
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

      {recentPickerOpen && (
        <RecentFilesDialog
          files={recentFiles}
          onOpen={async (path) => {
            const opened = await openFileByPathRef.current(path);
            if (opened) setRecentPickerOpen(false);
          }}
          onRemove={removeRecentFile}
          onBrowse={() => handleOpenRef.current()}
          onClose={() => setRecentPickerOpen(false)}
        />
      )}

      {updateDialogOpen && (
        <UpdateDialog onClose={() => setUpdateDialogOpen(false)} />
      )}
    </div>
  );
};

export default App;
