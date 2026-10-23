export interface DetachDocument {
  filePath: string;
  content: string;
  mode: string;
  language: string;
}

function unchanged(expected: DetachDocument, current: DetachDocument | null): boolean {
  return !!current && expected.filePath === current.filePath && expected.content === current.content
    && expected.mode === current.mode && expected.language === current.language;
}

/** Preserve the source tab if writing fails or if the user edits, renames or
 * closes it while the native write/window creation is in progress. */
export async function detachDocument(
  snapshot: DetachDocument,
  actions: {
    current: () => DetachDocument | null;
    save?: () => Promise<unknown>;
    open: () => Promise<unknown>;
    close: () => void;
  }
): Promise<boolean> {
  if (!unchanged(snapshot, actions.current())) return false;
  if (actions.save) await actions.save();
  if (!unchanged(snapshot, actions.current())) return false;
  await actions.open();
  if (!unchanged(snapshot, actions.current())) return false;
  actions.close();
  return true;
}
