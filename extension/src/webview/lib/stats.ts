import { Node as ProseMirrorNode } from "prosemirror-model";

export function getWordCount(doc: ProseMirrorNode): number {
  const text = doc.textContent;
  const words = text.trim().split(/\s+/).filter((w) => w.length > 0);
  return words.length;
}

export function getCharCount(doc: ProseMirrorNode): number {
  return doc.textContent.length;
}

export interface DocStats {
  words: number;
  chars: number;
}

export function getDocStats(doc: ProseMirrorNode): DocStats {
  return {
    words: getWordCount(doc),
    chars: getCharCount(doc),
  };
}
