// @vitest-environment jsdom

import React, { act, useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";

const backend = vi.hoisted(() => {
  const listeners = new Set<(event: { payload: string[] }) => void>();
  let files: string[] = [];
  return {
    listeners,
    reset() {
      files = [];
      listeners.clear();
    },
    invoke: vi.fn(async (command: string, args?: { path?: string }) => {
      if (command === "read_recent_files") return [...files];
      if (command === "add_recent_file") {
        const path = args?.path ?? "";
        files = [path, ...files.filter((file) => file !== path)].slice(0, 10);
      } else if (command === "remove_recent_file") {
        files = files.filter((file) => file !== args?.path);
      } else {
        throw new Error(`Unexpected command: ${command}`);
      }
      const payload = [...files];
      listeners.forEach((listener) => listener({ payload }));
      return payload;
    }),
    listen: vi.fn(async (_event: string, listener: (event: { payload: string[] }) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }),
  };
});

vi.mock("@tauri-apps/api/core", () => ({ invoke: backend.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: backend.listen }));

import { useRecentFiles } from "../src/hooks/useRecentFiles";

type RecentApi = ReturnType<typeof useRecentFiles>;
const apis: Record<string, RecentApi> = {};
let root: Root | null = null;

function Probe({ id }: { id: string }) {
  const api = useRecentFiles();
  useEffect(() => { apis[id] = api; }, [id, api]);
  return <output data-window={id}>{JSON.stringify(api.recentFiles)}</output>;
}

function windowFiles(id: string): string[] {
  const output = document.querySelector<HTMLOutputElement>(`[data-window="${id}"]`);
  if (!output) throw new Error(`Missing ${id} output`);
  return JSON.parse(output.textContent || "[]") as string[];
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  backend.reset();
  backend.invoke.mockClear();
  backend.listen.mockClear();
  delete apis.first;
  delete apis.second;
});

afterEach(() => {
  if (root) {
    act(() => root?.unmount());
    root = null;
  }
  document.body.replaceChildren();
});

describe("recent-file synchronization", () => {
  it("broadcasts authoritative add, reorder, and remove results to every window", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root?.render(<><Probe id="first" /><Probe id="second" /></>);
    });

    await act(async () => { await apis.first.addRecentFile("/tmp/a.md"); });
    expect(windowFiles("first")).toEqual(["/tmp/a.md"]);
    expect(windowFiles("second")).toEqual(["/tmp/a.md"]);

    await act(async () => { await apis.second.addRecentFile("/tmp/b.md"); });
    expect(windowFiles("first")).toEqual(["/tmp/b.md", "/tmp/a.md"]);
    expect(windowFiles("second")).toEqual(["/tmp/b.md", "/tmp/a.md"]);

    await act(async () => { await apis.first.addRecentFile("/tmp/a.md"); });
    expect(windowFiles("first")).toEqual(["/tmp/a.md", "/tmp/b.md"]);
    expect(windowFiles("second")).toEqual(["/tmp/a.md", "/tmp/b.md"]);

    await act(async () => { await apis.second.removeRecentFile("/tmp/a.md"); });
    expect(windowFiles("first")).toEqual(["/tmp/b.md"]);
    expect(windowFiles("second")).toEqual(["/tmp/b.md"]);
    expect(backend.invoke).not.toHaveBeenCalledWith("save_recent_files", expect.anything());
  });

  it("refreshes from the shared backend before Open Recent is displayed", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => { root?.render(<Probe id="first" />); });

    await act(async () => { await backend.invoke("add_recent_file", { path: "/tmp/new.md" }); });
    await act(async () => { await apis.first.refreshRecentFiles(); });
    expect(windowFiles("first")).toEqual(["/tmp/new.md"]);
    expect(backend.invoke).toHaveBeenCalledWith("read_recent_files");
  });
});
