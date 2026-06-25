import React, { useCallback, useEffect, useRef, useState } from "react";
import { EditorView } from "prosemirror-view";
import { EditorState } from "prosemirror-state";
import { schema } from "./editor/schema";
import { markdownToDoc } from "./editor/serialization/markdownImport";
import { docToMarkdown } from "./editor/serialization/markdownExport";
import { getDocStats } from "./lib/stats";
import { exportToHtml } from "./lib/export";
import {
  ThemeName,
  applyTheme,
  builtinThemeConfigs,
  parseUserThemeYaml,
  deleteUserTheme,
} from "./lib/themeLoader";
import { applyVscodeTheme } from "./lib/vscodeTheme";

import EditorSurface from "./components/EditorSurface";
import StatusBar from "./components/StatusBar";
import SearchBar from "./components/SearchBar";
import ThemeSelector from "./components/ThemeSelector";

import {
  InitPayload,
  postEdit,
  openLink,
  resolveImageSrc,
  importUserThemeHost,
  onInit,
  onUpdate,
  onUserThemes,
  onVscodeTheme,
  onCommand,
  onConfig,
  signalReady,
  setWebviewState,
  getWebviewState,
  setThemeHost,
  setMatchVscodeHost,
  undoHost,
  redoHost,
} from "./bridge";

import "./styles/app.css";

interface PersistedState {
  theme: ThemeName;
  matchVscode: boolean;
}

const App: React.FC = () => {
  const viewRef = useRef<EditorView | null>(null);

  // The text we believe the underlying TextDocument currently holds. Used to
  // suppress the echo of our own edits and to detect genuine external changes.
  const lastSyncedTextRef = useRef<string>("");

  const [theme, setThemeState] = useState<ThemeName>("github_light");
  const [matchVscode, setMatchVscode] = useState<boolean>(false);
  const [vscodeKind, setVscodeKind] = useState<"light" | "dark" | "high-contrast">("dark");
  const [userThemeVars, setUserThemeVars] = useState<Record<string, Record<string, string>>>({});
  const [themePickerOpen, setThemePickerOpen] = useState(false);

  const [searchVisible, setSearchVisible] = useState(false);
  const [wordCount, setWordCount] = useState(0);
  const [charCount, setCharCount] = useState(0);
  const [docName, setDocName] = useState<string>("");

  // Refs mirrored for the message handlers registered once on mount.
  const themeRef = useRef(theme);
  const matchVscodeRef = useRef(matchVscode);
  const vscodeKindRef = useRef(vscodeKind);
  const userThemeVarsRef = useRef(userThemeVars);
  useEffect(() => { themeRef.current = theme; }, [theme]);
  useEffect(() => { matchVscodeRef.current = matchVscode; }, [matchVscode]);
  useEffect(() => { vscodeKindRef.current = vscodeKind; }, [vscodeKind]);
  useEffect(() => { userThemeVarsRef.current = userThemeVars; }, [userThemeVars]);

  // ---- Theme application -------------------------------------------------
  const applyCurrentTheme = useCallback(() => {
    if (matchVscodeRef.current) {
      applyVscodeTheme(vscodeKindRef.current);
      return;
    }
    const name = themeRef.current;
    const vars =
      builtinThemeConfigs[name] ??
      userThemeVarsRef.current[name.replace(/^user:/, "")] ??
      builtinThemeConfigs["light"];
    applyTheme(name, vars);
  }, []);

  useEffect(() => { applyCurrentTheme(); }, [theme, matchVscode, vscodeKind, userThemeVars, applyCurrentTheme]);

  const persist = useCallback((next: Partial<PersistedState>) => {
    const prev = (getWebviewState<PersistedState>() ?? { theme, matchVscode });
    setWebviewState({ ...prev, ...next });
  }, [theme, matchVscode]);

  // ---- Editor sync -------------------------------------------------------
  const hydrate = useCallback((markdown: string) => {
    const view = viewRef.current;
    if (!view) return;
    const doc = markdownToDoc(markdown, schema);
    const newState = EditorState.create({ doc, plugins: view.state.plugins });
    view.updateState(newState);
    const stats = getDocStats(newState.doc);
    setWordCount(stats.words);
    setCharCount(stats.chars);
  }, []);

  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const debounceMsRef = useRef(200);
  // Texts we have posted to the host but not yet seen echoed back via `update`.
  // Lets us recognize an echo even if the user kept typing in the meantime,
  // preventing a spurious re-hydration (and cursor jump) on our own edits.
  const inFlightRef = useRef<Set<string>>(new Set());

  const handleChange = useCallback(() => {
    const view = viewRef.current;
    if (!view) return;
    const stats = getDocStats(view.state.doc);
    setWordCount(stats.words);
    setCharCount(stats.chars);
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      const v = viewRef.current;
      if (!v) return;
      // Serialize at fire time so the posted text matches the current document.
      const latest = docToMarkdown(v.state.doc);
      lastSyncedTextRef.current = latest;
      inFlightRef.current.add(latest);
      postEdit(latest);
    }, debounceMsRef.current);
  }, []);

  const handleMount = useCallback((view: EditorView) => {
    viewRef.current = view;
    // Restore persisted theme choice if present (covers webview revival).
    const persisted = getWebviewState<PersistedState>();
    if (persisted) {
      setThemeState(persisted.theme);
      setMatchVscode(persisted.matchVscode);
    }
    signalReady();
  }, []);

  // ---- Host → webview message handlers (registered once) -----------------
  useEffect(() => {
    onInit((payload: InitPayload) => {
      lastSyncedTextRef.current = payload.text;
      debounceMsRef.current = payload.editDebounceMs ?? 200;
      setDocName(payload.docName);
      setVscodeKind(payload.vscodeKind);
      setMatchVscode(payload.matchVscodeTheme);
      setThemeState(payload.theme);
      const map: Record<string, Record<string, string>> = {};
      for (const { filename, content } of payload.userThemes) {
        map[filename] = parseUserThemeYaml(content);
      }
      setUserThemeVars(map);
      hydrate(payload.text);
    });

    onUpdate((text: string) => {
      // Echo of an edit we posted (possibly while the user kept typing) — ignore.
      if (inFlightRef.current.has(text)) {
        inFlightRef.current.delete(text);
        lastSyncedTextRef.current = text;
        return;
      }
      // Echo of the last text we synced — ignore.
      if (text === lastSyncedTextRef.current) return;
      const view = viewRef.current;
      // Doc already matches incoming text (e.g. selection-only change) — record.
      if (view && docToMarkdown(view.state.doc) === text) {
        lastSyncedTextRef.current = text;
        return;
      }
      // Genuine external change (undo/redo, Git checkout, external editor).
      lastSyncedTextRef.current = text;
      hydrate(text);
    });

    onUserThemes((themes) => {
      const map: Record<string, Record<string, string>> = {};
      for (const { filename, content } of themes) {
        map[filename] = parseUserThemeYaml(content);
      }
      setUserThemeVars(map);
    });

    onVscodeTheme((kind) => {
      setVscodeKind(kind);
    });

    // Settings changed in VS Code (Settings UI or settings.json) — apply live.
    onConfig((cfg) => {
      debounceMsRef.current = cfg.editDebounceMs ?? 200;
      setMatchVscode(cfg.matchVscodeTheme);
      setThemeState(cfg.theme);
    });

    onCommand((command) => {
      switch (command) {
        case "find":        setSearchVisible(true); break;
        case "exportHtml":  exportToHtml(docNameRef.current || "Bioscratch Document"); break;
        case "selectTheme": setThemePickerOpen(true); break;
        case "toggleMatchVscode": {
          const next = !matchVscodeRef.current;
          setMatchVscode(next);
          setMatchVscodeHost(next);
          persist({ matchVscode: next });
          break;
        }
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const docNameRef = useRef(docName);
  useEffect(() => { docNameRef.current = docName; }, [docName]);

  // ---- Theme picker callbacks --------------------------------------------
  const handleSelectTheme = useCallback((t: ThemeName) => {
    setMatchVscode(false);
    setMatchVscodeHost(false);
    setThemeState(t);
    setThemeHost(t);
    persist({ theme: t, matchVscode: false });
    setThemePickerOpen(false);
  }, [persist]);

  const handleDeleteUserTheme = useCallback((filename: string) => {
    deleteUserTheme(filename);
    setUserThemeVars((prev) => {
      const next = { ...prev };
      delete next[filename];
      return next;
    });
    if (theme === `user:${filename}`) handleSelectTheme("light");
  }, [theme, handleSelectTheme]);

  // ---- Render ------------------------------------------------------------
  return (
    <div className="app-container">
      {searchVisible && (
        <SearchBar
          view={viewRef.current}
          onClose={() => setSearchVisible(false)}
        />
      )}

      <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
        <EditorSurface
          onMount={handleMount}
          onChange={handleChange}
          onSave={() => { /* VS Code owns save (Ctrl+S on the document) */ }}
          onSearch={() => setSearchVisible((v) => !v)}
          onUndo={undoHost}
          onRedo={redoHost}
          onOpenLink={openLink}
          resolveSrc={resolveImageSrc}
          fileMode="markdown"
        />
      </div>

      <StatusBar
        filePath={docName || null}
        dirty={false}
        wordCount={wordCount}
        charCount={charCount}
      />

      {themePickerOpen && (
        <ThemeSelector
          currentTheme={matchVscode ? "vscode" : theme}
          userThemeVars={userThemeVars}
          onSelect={handleSelectTheme}
          onClose={() => setThemePickerOpen(false)}
          onImport={importUserThemeHost}
          onDeleteUserTheme={handleDeleteUserTheme}
        />
      )}
    </div>
  );
};

export default App;
