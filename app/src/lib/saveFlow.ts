export interface SaveDocumentSnapshot {
  tabId: string;
  filePath: string | null;
  content: string;
}

/** Apply a completed write to its owning document. Navigation, closure and
 * renames can invalidate that owner while a native dialog/write is pending. */
export function planSavedDocument(
  snapshot: SaveDocumentSnapshot,
  outputPath: string,
  current: SaveDocumentSnapshot | null
) {
  if (!current || current.tabId !== snapshot.tabId) return null;
  if (current.filePath !== snapshot.filePath && current.filePath !== outputPath) return null;
  return {
    tabId: snapshot.tabId,
    filePath: outputPath,
    content: current.content,
    dirty: current.content !== snapshot.content,
  };
}
