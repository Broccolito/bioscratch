import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export function useRecentFiles() {
  const [recentFiles, setRecentFiles] = useState<string[]>([]);
  const operationQueueRef = useRef<Promise<void>>(Promise.resolve());
  const broadcastRevisionRef = useRef(0);

  useEffect(() => {
    let disposed = false;
    let receivedBroadcast = false;
    let unlisten: (() => void) | null = null;

    void (async () => {
      unlisten = await listen<string[]>("recent-files-updated", (event) => {
        receivedBroadcast = true;
        broadcastRevisionRef.current += 1;
        if (!disposed) setRecentFiles(event.payload);
      });
      if (disposed) {
        unlisten();
        return;
      }

      try {
        const files = await invoke<string[]>("read_recent_files");
        // An update can arrive while the initial read is in flight. In that
        // case the broadcast is authoritative and must not be overwritten by
        // an older response.
        if (!disposed && !receivedBroadcast) setRecentFiles(files);
      } catch {
        if (!disposed && !receivedBroadcast) setRecentFiles([]);
      }
    })();

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  const refreshRecentFiles = useCallback(async () => {
    const startingRevision = broadcastRevisionRef.current;
    try {
      const files = await invoke<string[]>("read_recent_files");
      // A mutation broadcast that arrives during this read is newer than the
      // response, so never let the refresh overwrite it.
      if (broadcastRevisionRef.current === startingRevision) setRecentFiles(files);
    } catch (error) {
      console.error("Failed to refresh recent files:", error);
    }
  }, []);

  const mutateRecentFiles = useCallback((command: string, path: string) => {
    // Serialize rapid operations from this window (notably multi-file drops).
    // Rust serializes all windows and broadcasts the authoritative result.
    operationQueueRef.current = operationQueueRef.current
      .catch(() => {})
      .then(async () => {
        // The Rust command broadcasts its authoritative result to every
        // window, including this one. Avoid applying the response a second
        // time because another window may have committed a newer mutation by
        // the time this Promise resolves.
        await invoke<string[]>(command, { path });
      })
      .catch((error) => {
        console.error(`Failed to update recent files with ${command}:`, error);
      });
    return operationQueueRef.current;
  }, []);

  const addRecentFile = useCallback(
    (path: string) => mutateRecentFiles("add_recent_file", path),
    [mutateRecentFiles]
  );

  const removeRecentFile = useCallback(
    (path: string) => mutateRecentFiles("remove_recent_file", path),
    [mutateRecentFiles]
  );

  return { recentFiles, addRecentFile, removeRecentFile, refreshRecentFiles };
}
