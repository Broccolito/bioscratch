/**
 * Save a dirty document and run the close action only after a confirmed,
 * successful write. Cancelling a Save dialog or a failed write returns false
 * and leaves the document open.
 */
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
