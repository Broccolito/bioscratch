import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

const MAX_RECENT = 10;

export function useRecentFiles() {
  const [recentFiles, setRecentFiles] = useState<string[]>([]);

  useEffect(() => {
    invoke<string[]>("read_recent_files")
      .then(setRecentFiles)
      .catch(() => setRecentFiles([]));
  }, []);

  const addRecentFile = useCallback(async (path: string) => {
    setRecentFiles((prev) => {
      const filtered = prev.filter((p) => p !== path);
      const updated = [path, ...filtered].slice(0, MAX_RECENT);
      invoke("save_recent_files", { files: updated }).catch(console.error);
      return updated;
    });
  }, []);

  const removeRecentFile = useCallback(async (path: string) => {
    setRecentFiles((prev) => {
      const updated = prev.filter((p) => p !== path);
      invoke("save_recent_files", { files: updated }).catch(console.error);
      return updated;
    });
  }, []);

  return { recentFiles, addRecentFile, removeRecentFile };
}
