export type CloseFlow = { kind: "window"; generation: null } | { kind: "quit"; generation: number };

/** A save may outlive cancellation in another window. A window close may be
 * promoted into the current quit, but an old quit must never close a document
 * after that attempt was cancelled or replaced. */
export function canCompleteSaveClose(started: CloseFlow | null, current: CloseFlow | null): boolean {
  if (!started) return true;
  if (!current) return false;
  return started.kind === "window"
    || (current.kind === "quit" && started.generation === current.generation);
}

/** Save a dirty document and close it only after a confirmed, successful write.
 * Cancelling a Save dialog or a failed write leaves the document open. */
export async function saveBeforeClose(
  save: () => Promise<boolean>,
  close: () => void
): Promise<boolean> {
  let saved = false;
  try {
    saved = await save();
  } catch {
    // A rejected save is equivalent to a failed write for close purposes: the
    // document must remain open so the user can retry or explicitly delete it.
    return false;
  }
  if (saved) close();
  return saved;
}

export function autosaveKeyForDiscard(filePath: string | null): string {
  return filePath ?? "__untitled__";
}
