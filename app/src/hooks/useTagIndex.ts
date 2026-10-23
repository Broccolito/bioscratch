import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { readWorkspaceMetadata, isUnder, type NoteMetadata } from "../lib/workspace";
import { buildTagIndex, metadataFromContent, withLiveTags, type TagIndex } from "../lib/tagIndex";
import { frontmatterTags } from "../lib/tags";
import { getFileMode } from "../lib/fileMode";

/**
 * Tag index for the active workspace folder. Built by walking the folder
 * once and kept current by `updateNote` whenever the app saves a note. Open
 * dirty notes report their current text with `setDirtyNotes`. Only those
 * notes override disk metadata; clean/closed notes follow `refresh`.
 */
export function useTagIndex(root: string | null) {
  const [notes, setNotes] = useState<NoteMetadata[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState<Map<string, string[]>>(new Map());
  const requestRef = useRef(0);
  const rootRef = useRef(root);
  useEffect(() => { rootRef.current = root; }, [root]);

  const refresh = useCallback(async () => {
    const current = rootRef.current;
    const request = ++requestRef.current;
    if (!current) {
      setNotes([]);
      setTruncated(false);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const result = await readWorkspaceMetadata(current);
      if (request !== requestRef.current) return;
      setNotes(result.notes);
      setTruncated(result.truncated);
      setError(null);
    } catch (err) {
      if (request !== requestRef.current) return;
      setError(String(err));
    } finally {
      if (request === requestRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    setNotes([]);
    void refresh();
  }, [root, refresh]);

  /** Re-index one note from the text just written to disk. */
  const updateNote = useCallback((path: string, content: string) => {
    const current = rootRef.current;
    if (!current || !isUnder(path, current)) return;
    const meta = metadataFromContent(path, content);
    setNotes((prev) => [...prev.filter((n) => n.path !== path), meta]);
  }, []);

  /** Replace the overlay with every currently open dirty Markdown note. */
  const setDirtyNotes = useCallback((openDocs: Map<string, string>) => {
    const next = new Map<string, string[]>();
    for (const [path, content] of openDocs) {
      if (getFileMode(path) !== "markdown") continue;
      // Keep empty tags too: removing all tags must mask the saved metadata.
      next.set(path, frontmatterTags(metadataFromContent(path, content).frontmatter));
    }
    setLive((prev) => {
      const unchanged = prev.size === next.size && [...next].every(([path, tags]) => {
        const current = prev.get(path);
        return current && current.length === tags.length && current.every((tag, i) => tag === tags[i]);
      });
      return unchanged ? prev : next;
    });
  }, []);

  /** Forget open-note tags for paths matching `match` (closed, renamed, deleted). */
  const dropLiveTags = useCallback((match: (path: string) => boolean) => {
    setLive((prev) => {
      if (![...prev.keys()].some(match)) return prev;
      return new Map([...prev].filter(([path]) => !match(path)));
    });
  }, []);

  const diskIndex = useMemo(() => buildTagIndex(notes), [notes]);
  const index: TagIndex = useMemo(() => withLiveTags(diskIndex, live, root), [diskIndex, live, root]);

  return { index, truncated, loading, error, refresh, updateNote, setDirtyNotes, dropLiveTags };
}
