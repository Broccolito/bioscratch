import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { readWorkspaceMetadata, isUnder, type NoteMetadata } from "../lib/workspace";
import { buildTagIndex, metadataFromContent, withLiveTags, type TagIndex } from "../lib/tagIndex";

/**
 * Tag index for the active workspace folder. Built by walking the folder
 * once and kept current by `updateNote` whenever the app saves a note. Open
 * notes report their current (maybe unsaved) tags with `setLiveTags`, which
 * take precedence until `dropLiveTags`. Edits made outside Bioscratch show up
 * after `refresh`.
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

  /** Report an open note's current tags. */
  const setLiveTags = useCallback((path: string, tags: string[]) => {
    setLive((prev) => {
      const current = prev.get(path);
      if (current && current.length === tags.length && current.every((t, i) => t === tags[i])) return prev;
      return new Map(prev).set(path, tags);
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

  return { index, truncated, loading, error, refresh, updateNote, setLiveTags, dropLiveTags };
}
