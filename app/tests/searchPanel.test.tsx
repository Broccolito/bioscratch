// @vitest-environment jsdom

import React, { act } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import SearchPanel from "../src/components/SearchPanel";
import { searchWorkspace } from "../src/lib/workspace";

vi.mock("../src/lib/workspace", async (original) => ({
  ...await original<typeof import("../src/lib/workspace")>(),
  searchWorkspace: vi.fn(),
}));

let root: Root | null = null;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.clearAllMocks();
});

it("stops the search spinner when the current native search is cancelled", async () => {
  vi.mocked(searchWorkspace).mockResolvedValue({ files: [], truncated: false, cancelled: true });
  const host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root?.render(<SearchPanel
      root="/notes" scope="/notes" focusSeq={0}
      tagIndex={{ notes: new Map() }} tagIndexLoading={false}
      selectedTags={[]} tagMatches={[]} filterTree={false} activePath={null} openDocs={new Map()}
      onSelectedTagsChange={vi.fn()} onFilterTreeChange={vi.fn()} onRefreshTags={vi.fn()}
      onOpenMatch={vi.fn()} onOpenFile={vi.fn()}
    />);
  });
  const input = document.querySelector("input")!;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "needle");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(document.body.textContent).toContain("Searching…");
  await act(async () => { await vi.advanceTimersByTimeAsync(250); });
  expect(searchWorkspace).toHaveBeenCalledWith("/notes", "needle", undefined);
  expect(document.body.textContent).not.toContain("Searching…");
});
