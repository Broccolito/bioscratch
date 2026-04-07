import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";

const AUTOSAVE_INTERVAL = 30_000; // 30 seconds

export function useAutosave(
  content: string,
  filePath: string | null,
  dirty: boolean
) {
  const contentRef = useRef(content);
  const dirtyRef = useRef(dirty);

  useEffect(() => {
    contentRef.current = content;
  }, [content]);

  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);

  useEffect(() => {
    const key = filePath || "__untitled__";

    const timer = setInterval(async () => {
      if (!dirtyRef.current) return;
      try {
        await invoke("save_autosave", { key, content: contentRef.current });
      } catch (e) {
        console.error("Autosave failed:", e);
      }
    }, AUTOSAVE_INTERVAL);

    return () => clearInterval(timer);
  }, [filePath]);
}

export async function saveAutosave(key: string, content: string): Promise<void> {
  await invoke("save_autosave", { key, content });
}

export async function loadAutosave(key: string): Promise<string | null> {
  return invoke<string | null>("load_autosave", { key });
}

export async function deleteAutosave(key: string): Promise<void> {
  await invoke("delete_autosave", { key });
}
