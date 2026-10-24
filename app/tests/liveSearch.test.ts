import { describe, expect, it } from "vitest";
import { mergeLiveResults, searchText } from "../src/lib/liveSearch";

describe("searching unsaved text", () => {
  it("matches like the Rust search: first hit per line, 1-based lines", () => {
    expect(searchText("alpha\nBeta gamma beta\nbeta again", "beta")).toEqual([
      { line: 2, preview: "Beta gamma beta" },
      { line: 3, preview: "beta again" },
    ]);
    const long = `${"x".repeat(400)}needle${"y".repeat(400)}`;
    const [hit] = searchText(long, "needle");
    expect(hit.preview.startsWith("…") && hit.preview.endsWith("…") && hit.preview.includes("needle")).toBe(true);
  });

  it("replaces disk results for open notes with their current text", () => {
    const disk = [
      { path: "/n/a.md", hits: [{ line: 1, preview: "old remyelination text" }] },
      { path: "/n/b.md", hits: [{ line: 4, preview: "remyelination on disk" }] },
    ];
    // a.md was edited (match moved); c.md is new and unsaved.
    const open = new Map([
      ["/n/a.md", "intro\nnew remyelination text"],
      ["/n/c.md", "# Draft\nremyelination idea"],
    ]);
    const merged = mergeLiveResults(disk, open, "remyelination", "/n", null);
    expect(merged).toEqual([
      { path: "/n/a.md", hits: [{ line: 2, preview: "new remyelination text" }] },
      { path: "/n/b.md", hits: [{ line: 4, preview: "remyelination on disk" }] },
      { path: "/n/c.md", hits: [{ line: 2, preview: "remyelination idea" }] },
    ]);
  });

  it("drops a disk hit the unsaved edit removed, and respects scope and tag filters", () => {
    const disk = [{ path: "/n/a.md", hits: [{ line: 1, preview: "remyelination" }] }];
    const open = new Map([["/n/a.md", "rewritten"], ["/other/x.md", "remyelination"], ["/n/z.md", "remyelination"]]);
    expect(mergeLiveResults(disk, open, "remyelination", "/n", new Set(["/n/a.md"]))).toEqual([]);
  });
});
