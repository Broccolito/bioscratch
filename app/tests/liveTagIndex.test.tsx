// @vitest-environment jsdom

import React, { act, useEffect } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { useTagIndex } from "../src/hooks/useTagIndex";
import { readWorkspaceMetadata } from "../src/lib/workspace";

vi.mock("../src/lib/workspace", async (original) => ({
  ...await original<typeof import("../src/lib/workspace")>(),
  readWorkspaceMetadata: vi.fn(),
}));

let root: Root | null = null;
let index: ReturnType<typeof useTagIndex> | null = null;

function Harness({ openDocs }: { openDocs: Map<string, string> }) {
  const current = useTagIndex("/notes");
  index = current;
  useEffect(() => current.setDirtyNotes(openDocs), [openDocs, current.setDirtyNotes]);
  return null;
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  index = null;
  document.body.replaceChildren();
  vi.clearAllMocks();
});

it("refreshes clean paths while preserving every background dirty note", async () => {
  vi.mocked(readWorkspaceMetadata).mockResolvedValue({ truncated: false, notes: [
    { path: "/notes/a.md", frontmatter: "tags: [saved]" },
    { path: "/notes/b.md", frontmatter: "tags: [removed]" },
    { path: "/notes/c.md", frontmatter: "tags: [old]" },
  ] });
  await act(async () => root?.render(<Harness openDocs={new Map([
    ["/notes/a.md", "---\ntags: [unsaved]\n---\n"],
    ["/notes/b.md", "# All tags removed without saving\n"],
  ])} />));
  expect(index!.index.notes.get("/notes/a.md")).toEqual(["unsaved"]);
  expect(index!.index.notes.has("/notes/b.md")).toBe(false);

  // a.md becomes clean and is left through in-tab navigation; b.md stays dirty
  // in a background tab. External edits must now replace a.md and c.md tags.
  vi.mocked(readWorkspaceMetadata).mockResolvedValue({ truncated: false, notes: [
    { path: "/notes/a.md", frontmatter: "tags: [external]" },
    { path: "/notes/b.md", frontmatter: "tags: [removed]" },
    { path: "/notes/c.md", frontmatter: "tags: [new]" },
  ] });
  await act(async () => {
    root?.render(<Harness openDocs={new Map([["/notes/b.md", "# Still dirty\n"]])} />);
  });
  await act(async () => { await index!.refresh(); });
  expect(index!.index.notes.get("/notes/a.md")).toEqual(["external"]);
  expect(index!.index.notes.get("/notes/c.md")).toEqual(["new"]);
  expect(index!.index.notes.has("/notes/b.md")).toBe(false);
});

it("does not add YAML-looking code and text files to the note tag index", async () => {
  vi.mocked(readWorkspaceMetadata).mockResolvedValue({ truncated: false, notes: [] });
  await act(async () => root?.render(<Harness openDocs={new Map([
    ["/notes/config.txt", "---\ntags: [not-a-note]\n---\n"],
    ["/notes/script.py", "---\ntags: [not-a-note]\n---\n"],
  ])} />));
  expect([...index!.index.notes]).toEqual([]);
});
