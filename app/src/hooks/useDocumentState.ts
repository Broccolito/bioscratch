import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { EditorView } from "prosemirror-view";
import { EditorState } from "prosemirror-state";
import { schema } from "../editor/schema";
import { markdownToDoc } from "../editor/serialization/markdownImport";
import { docToMarkdown } from "../editor/serialization/markdownExport";

export interface DocumentState {
  filePath: string | null;
  dirty: boolean;
  content: string;
}

export function useDocumentState(viewRef: React.MutableRefObject<EditorView | null>) {
  const [filePath, setFilePath] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [content, setContent] = useState("");

  const markDirty = useCallback(() => setDirty(true), []);
  const markClean = useCallback(() => setDirty(false), []);

  const loadContent = useCallback((markdown: string, path: string | null) => {
    const view = viewRef.current;
    if (!view) return;

    const doc = markdownToDoc(markdown, schema);
    const state = EditorState.create({
      doc,
      plugins: view.state.plugins,
    });
    view.updateState(state);
    setContent(markdown);
    setFilePath(path);
    setDirty(false);
  }, [viewRef]);

  const openFile = useCallback(async () => {
    try {
      const path = await invoke<string | null>("show_open_dialog");
      if (!path) return;

      const fileContent = await invoke<string>("read_file", { path });
      loadContent(fileContent, path);
      return path;
    } catch (e) {
      console.error("Failed to open file:", e);
      alert(`Failed to open file: ${e}`);
    }
  }, [loadContent]);

  const saveFile = useCallback(async () => {
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
      setContent(markdown);
      setDirty(false);
      return savePath;
    } catch (e) {
      console.error("Failed to save file:", e);
      alert(`Failed to save file: ${e}`);
    }
  }, [filePath, viewRef]);

  const saveFileAs = useCallback(async () => {
    const view = viewRef.current;
    if (!view) return;

    const markdown = docToMarkdown(view.state.doc);
    const path = await invoke<string | null>("show_save_dialog");
    if (!path) return;

    try {
      await invoke("write_file", { path, content: markdown });
      setFilePath(path);
      setContent(markdown);
      setDirty(false);
      return path;
    } catch (e) {
      console.error("Failed to save file:", e);
      alert(`Failed to save file: ${e}`);
    }
  }, [viewRef]);

  const newDocument = useCallback(() => {
    loadContent("", null);
  }, [loadContent]);

  return {
    filePath,
    dirty,
    content,
    markDirty,
    markClean,
    loadContent,
    openFile,
    saveFile,
    saveFileAs,
    newDocument,
  };
}
