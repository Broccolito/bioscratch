import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

const ACTIVE_ROOT_KEY = "bioscratch-active-root";

function readStoredRoot(): string | null {
  try {
    return localStorage.getItem(ACTIVE_ROOT_KEY);
  } catch {
    return null;
  }
}

function storeRoot(root: string | null) {
  try {
    if (root) localStorage.setItem(ACTIVE_ROOT_KEY, root);
    else localStorage.removeItem(ACTIVE_ROOT_KEY);
  } catch {}
}

/**
 * Pinned workspace folders (shared by every window via a Rust broadcast) and
 * the folder this window's sidebar is showing.
 */
export function useWorkspace() {
  const [folders, setFolders] = useState<string[]>([]);
  const [activeRoot, setActiveRootState] = useState<string | null>(readStoredRoot);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;
    void (async () => {
      unlisten = await listen<string[]>("workspace-folders-updated", (event) => {
        if (!disposed) setFolders(event.payload);
      });
      if (disposed) {
        unlisten();
        return;
      }
      try {
        // Also re-grants access to each persisted folder for this session.
        const persisted = await invoke<string[]>("read_workspace_folders");
        if (!disposed) setFolders(persisted);
      } catch (error) {
        console.error("Failed to read workspace folders:", error);
      } finally {
        if (!disposed) setLoaded(true);
      }
    })();
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  // Keep the active root valid as folders are added or removed.
  useEffect(() => {
    if (!loaded) return;
    if (activeRoot && folders.includes(activeRoot)) return;
    const next = folders[0] ?? null;
    setActiveRootState(next);
    storeRoot(next);
  }, [folders, activeRoot, loaded]);

  const setActiveRoot = useCallback((root: string) => {
    setActiveRootState(root);
    storeRoot(root);
  }, []);

  /** Pick a folder with the native dialog, pin it, and show it. */
  const addFolder = useCallback(async (): Promise<string | null> => {
    try {
      const root = await invoke<string | null>("show_folder_dialog");
      if (!root) return null;
      setFolders((prev) => (prev.includes(root) ? prev : [...prev, root]));
      setActiveRoot(root);
      return root;
    } catch (error) {
      console.error("Failed to open folder:", error);
      return null;
    }
  }, [setActiveRoot]);

  const removeFolder = useCallback(async (root: string) => {
    try {
      const next = await invoke<string[]>("remove_workspace_folder", { path: root });
      setFolders(next);
    } catch (error) {
      console.error("Failed to remove folder:", error);
    }
  }, []);

  return { folders, activeRoot, loaded, setActiveRoot, addFolder, removeFolder };
}
