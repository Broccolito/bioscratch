// @vitest-environment jsdom
import React, { act } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { EditorState } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import { readFile } from "@tauri-apps/plugin-fs";
import EditorSurface from "../src/components/EditorSurface";
import { markdownToDoc } from "../src/editor/serialization/markdownImport";
import { schema } from "../src/editor/schema";

vi.mock("@tauri-apps/plugin-fs", () => ({ readFile: vi.fn() }));
vi.mock("mermaid", () => ({ default: { initialize: vi.fn(), render: vi.fn() } }));

let root: Root | null = null;
let view: EditorView | null = null;
const filePathRef: { current: string | null } = { current: null };

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  filePathRef.current = null;
  vi.mocked(readFile).mockImplementation(async (path) => new Uint8Array([String(path).includes("/two/") ? 2 : 1]));
  const host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(<EditorSurface
    onMount={(editor) => { view = editor; }} onChange={vi.fn()} onSave={vi.fn()} onSearch={vi.fn()}
    filePathRef={filePathRef} fileMode="markdown"
  />));
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  view = null;
  document.body.replaceChildren();
  vi.clearAllMocks();
});

async function open(path: string, markdown: string) {
  filePathRef.current = path;
  const state = EditorState.create({ doc: markdownToDoc(markdown, schema), plugins: view!.state.plugins });
  await act(async () => { view!.updateState(state); });
}

it("resolves images from the synchronously opened document even before React rerenders", async () => {
  await open("/image-open/note.md", "Intro\n\n![photo](photo.png)");
  expect(readFile).toHaveBeenCalledWith("/image-open/photo.png");
  expect(document.querySelector(".image-view-wrapper img")?.getAttribute("src")).toBe("data:image/png;base64,AQ==");

  // Closing every tab and opening a document again must not use the blank
  // editor's base URL for a relative local image.
  filePathRef.current = null;
  view!.updateState(EditorState.create({ schema, plugins: view!.state.plugins }));
  await open("/image-reopen/note.md", "Intro\n\n![photo](photo.png)");
  expect(readFile).toHaveBeenCalledWith("/image-reopen/photo.png");
});

it("recreates identical block and inline image widgets when their document directory changes", async () => {
  const markdown = "Intro\n\n![photo](photo.png)\n\nInline ![other](inline.png) text";
  await open("/image-switch/one/note.md", markdown);
  expect(readFile).toHaveBeenCalledWith("/image-switch/one/photo.png");
  expect(readFile).toHaveBeenCalledWith("/image-switch/one/inline.png");

  // Save As/rename can change only the document path, retaining the exact
  // EditorState and identical decoration positions, alt text and sources.
  filePathRef.current = "/image-switch/two/note.md";
  await act(async () => { view!.updateState(view!.state); });
  expect(readFile).toHaveBeenCalledWith("/image-switch/two/photo.png");
  expect(readFile).toHaveBeenCalledWith("/image-switch/two/inline.png");
  expect([...document.querySelectorAll(".image-view-wrapper img, .image-inline-widget img")].map((image) => image.getAttribute("src")))
    .toEqual(["data:image/png;base64,Ag==", "data:image/png;base64,Ag=="]);
});
