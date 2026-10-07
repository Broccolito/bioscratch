import { EditorState, Transaction } from "prosemirror-state";
import { Node as ProseMirrorNode } from "prosemirror-model";
import { schema } from "./schema";
import { canWriteFrontmatterTags, frontmatterTags, writeFrontmatterTags } from "../lib/tags";

/** The document's raw front-matter YAML, or null when it has none. */
export function docFrontmatter(doc: ProseMirrorNode): string | null {
  const first = doc.firstChild;
  return first?.type === schema.nodes.frontmatter ? first.textContent : null;
}

/** The note's front-matter tags (canonical). */
export function docTags(doc: ProseMirrorNode): string[] {
  return frontmatterTags(docFrontmatter(doc));
}

/** Whether the tag bar may rewrite this note's front matter. */
export function canEditDocTags(doc: ProseMirrorNode): boolean {
  return canWriteFrontmatterTags(docFrontmatter(doc) ?? "");
}

/**
 * Set the note's front-matter tags as one undoable edit: rewrites the
 * existing front matter, creates a block when the note has none, and removes
 * the block when nothing but the tags was in it. Returns false (and changes
 * nothing) when the YAML can't be edited safely.
 */
export function setDocTags(
  state: EditorState,
  dispatch: (tr: Transaction) => void,
  tags: string[]
): boolean {
  const { doc } = state;
  const first = doc.firstChild;
  const node = first?.type === schema.nodes.frontmatter ? first : null;
  const next = writeFrontmatterTags(node ? node.textContent : "", tags);
  if (next === null) return false;

  const tr = state.tr;
  if (node) {
    if (next === "") tr.delete(0, node.nodeSize);
    else tr.replaceWith(1, node.nodeSize - 1, schema.text(next));
  } else if (next !== "") {
    tr.insert(0, schema.nodes.frontmatter.create(null, schema.text(next)));
  } else {
    return true;
  }
  dispatch(tr);
  return true;
}
