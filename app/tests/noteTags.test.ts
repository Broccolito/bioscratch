import { describe, expect, it } from "vitest";
import { EditorState } from "prosemirror-state";

import { schema } from "../src/editor/schema";
import { markdownToDoc } from "../src/editor/serialization/markdownImport";
import { docToMarkdown } from "../src/editor/serialization/markdownExport";
import { canEditDocTags, docTags, setDocTags } from "../src/editor/frontmatterTags";
import { isTagsOnly } from "../src/lib/frontmatter";
import {
  frontmatterTags,
  normalizeTag,
  parseTagList,
  writeFrontmatterTags,
} from "../src/lib/tags";
import {
  buildTagIndex,
  flattenTagTree,
  hasTag,
  metadataFromContent,
  notesWithTags,
  tagTree,
  withLiveTags,
} from "../src/lib/tagIndex";

describe("tag normalization", () => {
  it("canonicalizes tags for matching", () => {
    expect(normalizeTag("  #Remyelination ")).toBe("remyelination");
    expect(normalizeTag("gut microbiome")).toBe("gut-microbiome");
    expect(normalizeTag("Project/MS")).toBe("project/ms");
    expect(normalizeTag("###")).toBeNull();
    expect(parseTagList("lab, ms  lab #todo")).toEqual(["lab", "ms", "todo"]);
  });

  it("reads every front-matter tag style other tools use", () => {
    expect(frontmatterTags("tags:\n  - film\n  - scifi")).toEqual(["film", "scifi"]); // Obsidian/Hugo
    expect(frontmatterTags("tags: [a, b]")).toEqual(["a", "b"]);
    expect(frontmatterTags("tags: markdown static-sites")).toEqual(["markdown", "static-sites"]); // Jekyll
    expect(frontmatterTags("tag: solo")).toEqual(["solo"]);
    expect(frontmatterTags("keywords: [yaml, pandoc]")).toEqual([]); // paper keywords, not tags
    expect(frontmatterTags(null)).toEqual([]);
  });
});

describe("writing tags into front matter", () => {
  it("creates a standard tags list when there is none", () => {
    expect(writeFrontmatterTags("", ["lab", "ms"])).toBe("tags:\n  - lab\n  - ms");
    expect(writeFrontmatterTags("title: X", ["lab"])).toBe("title: X\ntags:\n  - lab");
  });

  it("keeps other keys, comments and the original spelling", () => {
    const yaml = "title: X # keep me\ntags:\n  - Coding\n  - YAML\nyear: 1977";
    expect(writeFrontmatterTags(yaml, ["coding", "yaml", "lab"])).toBe(
      "title: X # keep me\ntags:\n  - Coding\n  - YAML\n  - lab\nyear: 1977"
    );
    expect(writeFrontmatterTags(yaml, ["yaml"])).toBe("title: X # keep me\ntags:\n  - YAML\nyear: 1977");
  });

  it("keeps flow-list and Jekyll string styles", () => {
    expect(writeFrontmatterTags("tags: [a, b]", ["a", "b", "c"])).toBe("tags: [a, b, c]");
    expect(writeFrontmatterTags("tags: markdown static-sites", ["markdown", "static-sites", "lab"])).toBe(
      "tags: markdown static-sites lab"
    );
    expect(writeFrontmatterTags("tag: one", ["one", "two"])).toBe("tag:\n  - one\n  - two");
  });

  it("removes the key, and reports empty when nothing else is left", () => {
    expect(writeFrontmatterTags("title: X\ntags: [a]", [])).toBe("title: X");
    expect(writeFrontmatterTags("tags: [a]", [])).toBe("");
  });

  it("handles notes with no front matter and no tags", () => {
    // Regression: rendering the tag bar for a new/blank note crashed the app.
    expect(writeFrontmatterTags("", [])).toBe("");
    expect(writeFrontmatterTags("title: X", [])).toBe("title: X");
    expect(canEditDocTags(stateFor("").doc)).toBe(true);
    expect(canEditDocTags(stateFor("# Plain note\n").doc)).toBe(true);
  });

  it("refuses to rewrite YAML it cannot parse safely", () => {
    expect(writeFrontmatterTags("tags: [unclosed, list\ntitle: x", ["a"])).toBeNull();
    expect(writeFrontmatterTags("- just\n- a list", ["a"])).toBeNull();
  });
});

function stateFor(md: string): EditorState {
  return EditorState.create({ doc: markdownToDoc(md, schema) });
}

function setTags(state: EditorState, tags: string[]): EditorState {
  let next = state;
  setDocTags(state, (tr) => { next = state.apply(tr); }, tags);
  return next;
}

describe("editing tags in a note", () => {
  it("adds front matter to an untagged note and removes it again", () => {
    let state = stateFor("# Note\n\nBody\n");
    state = setTags(state, ["lab", "lab/assays"]);
    expect(docToMarkdown(state.doc)).toBe("---\ntags:\n  - lab\n  - lab/assays\n---\n\n# Note\n\nBody\n");
    expect(docTags(state.doc)).toEqual(["lab", "lab/assays"]);
    state = setTags(state, []);
    expect(docToMarkdown(state.doc)).toBe("# Note\n\nBody\n");
  });

  it("edits tags inside existing front matter without touching the rest", () => {
    let state = stateFor("---\ntitle: A New Hope\ntags:\n  - film\n---\n\nBody\n");
    state = setTags(state, ["film", "scifi"]);
    expect(docToMarkdown(state.doc)).toBe("---\ntitle: A New Hope\ntags:\n  - film\n  - scifi\n---\n\nBody\n");
  });

  it("leaves malformed front matter alone", () => {
    const state = stateFor("---\ntags: [unclosed, list\n---\n\nBody\n");
    expect(canEditDocTags(state.doc)).toBe(false);
    expect(setDocTags(state, () => { throw new Error("must not dispatch"); }, ["x"])).toBe(false);
  });

  it("flags tags-only front matter so the banner can hide", () => {
    expect(isTagsOnly("tags:\n  - lab")).toBe(true);
    expect(isTagsOnly("title: X\ntags: [lab]")).toBe(false);
    expect(isTagsOnly("")).toBe(false);
  });
});

describe("filtering notes by tags", () => {
  const index = buildTagIndex([
    metadataFromContent("/n/lab/a.md", "---\ntags: [lab/assays, ms]\n---\n# A\n"),
    metadataFromContent("/n/lab/b.md", "---\ntags: [lab]\nkeywords: [ignored]\n---\n\n# B\n"),
    metadataFromContent("/n/papers/c.md", "---\ntags:\n  - ms\n  - review\n---\n# C\n"),
    metadataFromContent("/n/d.md", "# D, untagged\n"),
  ]);

  it("indexes tagged notes only", () => {
    expect(index.notes.get("/n/lab/b.md")).toEqual(["lab"]);
    expect(index.notes.has("/n/d.md")).toBe(false);
  });

  it("requires every selected tag", () => {
    expect(notesWithTags(index, ["ms"], null)).toEqual(["/n/lab/a.md", "/n/papers/c.md"]);
    expect(notesWithTags(index, ["ms", "review"], null)).toEqual(["/n/papers/c.md"]);
    expect(notesWithTags(index, ["lab", "review"], null)).toEqual([]);
  });

  it("includes subtags when filtering by a parent tag", () => {
    expect(hasTag(["lab/assays"], "lab")).toBe(true);
    expect(hasTag(["laboratory"], "lab")).toBe(false);
    expect(notesWithTags(index, ["lab"], null)).toEqual(["/n/lab/a.md", "/n/lab/b.md"]);
    expect(notesWithTags(index, ["lab/assays"], null)).toEqual(["/n/lab/a.md"]);
  });

  it("limits matches to a folder", () => {
    expect(notesWithTags(index, ["ms"], "/n/papers")).toEqual(["/n/papers/c.md"]);
  });

  it("builds a tag hierarchy whose counts include subtags", () => {
    const tree = tagTree(index);
    const lab = tree.find((n) => n.tag === "lab")!;
    expect(lab.count).toBe(2);
    expect(lab.children.map((c) => [c.tag, c.name, c.count])).toEqual([["lab/assays", "assays", 1]]);
    expect(flattenTagTree(tree).map((n) => n.tag)).toEqual(["lab", "lab/assays", "ms", "review"]);
    expect(tagTree(index, ["/n/papers/c.md"]).map((n) => [n.tag, n.count])).toEqual([
      ["ms", 1],
      ["review", 1],
    ]);
  });

  it("extracts the same front matter the Rust indexer returns", () => {
    expect(metadataFromContent("/x.md", "---\na: 1\n---\nBody\n")).toEqual({ path: "/x.md", frontmatter: "a: 1" });
    expect(metadataFromContent("/y.md", "No front matter\n")).toEqual({ path: "/y.md", frontmatter: null });
  });
});

describe("unsaved tags in open notes", () => {
  const disk = buildTagIndex([
    metadataFromContent("/n/a.md", "---\ntags: [lab]\n---\n"),
    metadataFromContent("/n/b.md", "---\ntags: [ms]\n---\n"),
  ]);

  it("offers a tag added to an open note before it is saved", () => {
    // Regression: the next new note didn't see tags until the first was saved.
    const live = new Map([["/n/new.md", ["draft"]]]);
    const merged = withLiveTags(disk, live, "/n");
    expect(flattenTagTree(tagTree(merged)).map((n) => n.tag)).toEqual(["draft", "lab", "ms"]);
  });

  it("lets open notes override or clear what is on disk", () => {
    const live = new Map([["/n/a.md", ["lab", "assays"]], ["/n/b.md", []]]);
    const merged = withLiveTags(disk, live, "/n");
    expect(merged.notes.get("/n/a.md")).toEqual(["lab", "assays"]);
    expect(merged.notes.has("/n/b.md")).toBe(false);
    // The disk index itself is untouched (closing without saving reverts).
    expect(disk.notes.get("/n/b.md")).toEqual(["ms"]);
  });

  it("ignores open notes outside the folder", () => {
    const merged = withLiveTags(disk, new Map([["/elsewhere/x.md", ["other"]]]), "/n");
    expect(merged.notes.has("/elsewhere/x.md")).toBe(false);
  });
});
