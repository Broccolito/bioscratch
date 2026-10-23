// @vitest-environment jsdom

import React, { act } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import FileTree from "../src/components/FileTree";
import Sidebar from "../src/components/Sidebar";
import { listDir } from "../src/lib/workspace";

vi.mock("../src/lib/workspace", async (original) => ({
  ...await original<typeof import("../src/lib/workspace")>(),
  listDir: vi.fn(),
}));
vi.mock("../src/components/SearchPanel", () => ({ default: () => null }));

let root: Root | null = null;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: vi.fn() });
  const host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

async function renderTree() {
  await act(async () => {
    root?.render(<FileTree
      root="/notes" activePath={null} reveal={null} showHidden={false} active
      visible={null} createRequest={null} onOpenFile={vi.fn()} onOpenFolder={vi.fn()}
      onRenamed={vi.fn()} onDeleted={vi.fn()}
    />);
  });
}

it("reports a failed refresh alongside cached files, then clears both after a successful empty listing", async () => {
  vi.mocked(listDir).mockResolvedValue([{ name: "Renamed.md", path: "/notes/Renamed.md", is_dir: false }]);
  await renderTree();
  expect(document.querySelector('[data-path="/notes/Renamed.md"]')).not.toBeNull();

  vi.mocked(listDir).mockRejectedValue(new Error("Folder access was not authorized"));
  await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
  expect(document.querySelector('[data-path="/notes/Renamed.md"]')).not.toBeNull();
  expect(document.querySelector('[role="alert"]')?.textContent).toContain("last loaded contents");
  expect(document.querySelector('[role="alert"]')?.getAttribute("title")).toContain("not authorized");

  vi.mocked(listDir).mockResolvedValue([]);
  await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
  expect(document.querySelector('[data-path="/notes/Renamed.md"]')).toBeNull();
  expect(document.querySelector('[role="alert"]')).toBeNull();
  expect(document.body.textContent).toContain("Empty");
});

it("reports initial directory errors instead of an endless loading state", async () => {
  vi.mocked(listDir).mockRejectedValue(new Error("Permission denied"));
  await renderTree();
  expect(document.querySelector('[role="alert"]')?.textContent).toBe("Can't read folder");
  expect(document.querySelector('[role="alert"]')?.getAttribute("title")).toContain("Permission denied");
  expect(document.body.textContent).not.toContain("Loading");
});

it("waits for persisted workspace grants before mounting the file browser", async () => {
  vi.mocked(listDir).mockResolvedValue([]);
  const renderSidebar = async (workspaceReady: boolean) => {
    await act(async () => {
      root?.render(<Sidebar
        folders={["/notes"]} activeRoot="/notes" workspaceReady={workspaceReady}
        activePath={null} reveal={null} searchFocusSeq={0} width={250}
        onWidthChange={vi.fn()} onSelectRoot={vi.fn()} onAddFolder={vi.fn()} onRemoveFolder={vi.fn()}
        onOpenFile={vi.fn()} onOpenMatch={vi.fn()} viewDir="/notes" onViewDirChange={vi.fn()}
        tagIndex={{ notes: new Map() }} tagIndexLoading={false} selectedTags={[]} tagMatches={[]}
        filterTree={false} treeFilter={null} onSelectedTagsChange={vi.fn()} onFilterTreeChange={vi.fn()}
        onRefreshTags={vi.fn()} onRenamed={vi.fn()} onDeleted={vi.fn()} openDocs={new Map()}
      />);
    });
  };
  await renderSidebar(false);
  await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
  expect(listDir).not.toHaveBeenCalled();
  expect(document.body.textContent).toContain("Opening folder…");
  expect(document.querySelector('[role="alert"]')).toBeNull();

  await renderSidebar(true);
  expect(listDir).toHaveBeenCalledWith("/notes", false);
  expect(document.body.textContent).toContain("Empty");
  expect(document.body.textContent).not.toContain("Opening folder…");
});
