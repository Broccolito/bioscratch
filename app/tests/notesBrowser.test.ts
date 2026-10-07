import { describe, expect, it } from "vitest";

import { fuzzyMatch, fuzzyRank } from "../src/lib/fuzzy";
import { emptyHistory, forget, goBack, goForward, visit } from "../src/lib/navHistory";
import { normalizeTags } from "../src/lib/tags";
import {
  ancestorsWithin,
  breadcrumbs,
  containingRoot,
  isUnder,
  occurrenceIndexAtLine,
  relativeTo,
} from "../src/lib/workspace";
import { isOpenableTextFile } from "../src/lib/fileMode";
import { highlightParts } from "../src/components/SearchPanel";

describe("fuzzy matching", () => {
  it("requires every query character in order", () => {
    expect(fuzzyMatch("nts", "notes.md")).not.toBeNull();
    expect(fuzzyMatch("stn", "notes.md")).toBeNull();
    expect(fuzzyMatch("NOTES", "lab/notes.md")).not.toBeNull();
  });

  it("ranks file-name matches above scattered folder matches", () => {
    const ranked = fuzzyRank("notes", ["no/tes/x.md", "lab/notes.md", "n/o/t/e/s.md"], (s) => s);
    expect(ranked[0].item).toBe("lab/notes.md");
  });

  it("prefers a match at the start of the file name", () => {
    const ranked = fuzzyRank("plan", ["lab/explanation.md", "lab/plan.md"], (s) => s);
    expect(ranked[0].item).toBe("lab/plan.md");
  });

  it("reports matched indices for highlighting", () => {
    const match = fuzzyMatch("ab", "xaxb");
    expect(match?.indices).toEqual([1, 3]);
  });
});

describe("per-tab navigation history", () => {
  it("pushes the previous file and clears forward on visit", () => {
    let h = visit(emptyHistory(), "/a.md", "/b.md");
    h = { ...h, forward: ["/z.md"] };
    h = visit(h, "/b.md", "/c.md");
    expect(h).toEqual({ back: ["/a.md", "/b.md"], forward: [] });
  });

  it("ignores visits from untitled tabs and to the same file", () => {
    expect(visit(emptyHistory(), null, "/a.md")).toEqual(emptyHistory());
    expect(visit(emptyHistory(), "/a.md", "/a.md")).toEqual(emptyHistory());
  });

  it("walks back and forward symmetrically", () => {
    const h = { back: ["/a.md", "/b.md"], forward: [] };
    const back = goBack(h, "/c.md")!;
    expect(back.target).toBe("/b.md");
    expect(back.history).toEqual({ back: ["/a.md"], forward: ["/c.md"] });
    const fwd = goForward(back.history, "/b.md")!;
    expect(fwd.target).toBe("/c.md");
    expect(fwd.history).toEqual({ back: ["/a.md", "/b.md"], forward: [] });
    expect(goBack(emptyHistory(), "/a.md")).toBeNull();
    expect(goForward(emptyHistory(), "/a.md")).toBeNull();
  });

  it("forgets a path everywhere", () => {
    expect(forget({ back: ["/a", "/b", "/a"], forward: ["/a", "/c"] }, "/a")).toEqual({
      back: ["/b"],
      forward: ["/c"],
    });
  });
});

describe("workspace paths", () => {
  it("checks containment on path boundaries", () => {
    expect(isUnder("/notes/lab/a.md", "/notes")).toBe(true);
    expect(isUnder("/notes", "/notes")).toBe(true);
    expect(isUnder("/notes-old/a.md", "/notes")).toBe(false);
  });

  it("finds the innermost containing folder", () => {
    expect(containingRoot("/n/lab/a.md", ["/n", "/n/lab"])).toBe("/n/lab");
    expect(containingRoot("/other/a.md", ["/n"])).toBeNull();
  });

  it("builds breadcrumbs from the workspace folder, or the full path outside it", () => {
    expect(breadcrumbs("/u/notes/lab/a.md", "/u/notes")).toEqual([
      { name: "notes", path: "/u/notes" },
      { name: "lab", path: "/u/notes/lab" },
      { name: "a.md", path: "/u/notes/lab/a.md" },
    ]);
    expect(breadcrumbs("/tmp/a.md", null).map((c) => c.path)).toEqual(["/tmp", "/tmp/a.md"]);
  });

  it("lists ancestors within the root and relative paths", () => {
    expect(ancestorsWithin("/r/a/b/c.md", "/r")).toEqual(["/r", "/r/a", "/r/a/b"]);
    expect(ancestorsWithin("/x/c.md", "/r")).toEqual([]);
    expect(relativeTo("/r/a/b.md", "/r")).toBe("a/b.md");
    expect(relativeTo("/x/b.md", "/r")).toBe("/x/b.md");
  });

  it("counts earlier matches to find the clicked hit's occurrence", () => {
    const text = "Alpha beta\nbeta BETA\nno\nfind beta here";
    expect(occurrenceIndexAtLine(text, "beta", 1)).toBe(0);
    expect(occurrenceIndexAtLine(text, "beta", 2)).toBe(1);
    expect(occurrenceIndexAtLine(text, "beta", 4)).toBe(3);
  });

  it("recognizes openable files, including extensionless names", () => {
    expect(isOpenableTextFile("/a/notes.md")).toBe(true);
    expect(isOpenableTextFile("/a/Makefile")).toBe(true);
    expect(isOpenableTextFile("/a/figure.png")).toBe(false);
  });
});

describe("front-matter tags", () => {
  it("normalizes list and string tags", () => {
    expect(normalizeTags(["Lab", "#ms"])).toEqual(["lab", "ms"]);
    expect(normalizeTags("lab, ms #todo")).toEqual(["lab", "ms", "todo"]);
    expect(normalizeTags(null)).toEqual([]);
  });
});

describe("search highlighting", () => {
  it("splits text around case-insensitive matches", () => {
    expect(highlightParts("Beta and beta", "beta")).toEqual([
      { text: "Beta", match: true },
      { text: " and ", match: false },
      { text: "beta", match: true },
    ]);
  });
});

describe("create and rename helpers", () => {
  it("remaps a renamed path and everything inside a renamed folder", async () => {
    const { remapPath } = await import("../src/lib/workspace");
    expect(remapPath("/n/a.md", "/n/a.md", "/n/b.md")).toBe("/n/b.md");
    expect(remapPath("/n/lab/x.md", "/n/lab", "/n/assays")).toBe("/n/assays/x.md");
    expect(remapPath("/n/lab2/x.md", "/n/lab", "/n/assays")).toBe("/n/lab2/x.md");
    expect(remapPath("/n/other.md", "/n/lab", "/n/assays")).toBe("/n/other.md");
  });

  it("pre-selects the name without its extension", async () => {
    const { nameSelectionEnd } = await import("../src/lib/workspace");
    expect(nameSelectionEnd("Untitled.md", false)).toBe(8);
    expect(nameSelectionEnd("archive.tar.gz", false)).toBe(11);
    expect(nameSelectionEnd(".env", false)).toBe(4);
    expect(nameSelectionEnd("Makefile", false)).toBe(8);
    expect(nameSelectionEnd("my.folder", true)).toBe(9);
  });
});
