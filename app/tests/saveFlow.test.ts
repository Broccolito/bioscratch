import { describe, expect, it } from "vitest";
import { planSavedDocument, type SaveDocumentSnapshot } from "../src/lib/saveFlow";

const source: SaveDocumentSnapshot = { tabId: "a", filePath: "/a.md", content: "Snapshot" };

describe("asynchronous save ownership", () => {
  it("updates the saved background owner without touching the newly active tab", async () => {
    const tabs = new Map([
      ["a", { ...source, dirty: true }],
      ["b", { tabId: "b", filePath: "/b.md", content: "Other unsaved work", dirty: true }],
    ]);
    let active = "a";
    let finishWrite!: () => void;
    const write = new Promise<void>((resolve) => { finishWrite = resolve; });
    const save = write.then(() => {
      const plan = planSavedDocument(source, "/a.md", tabs.get(source.tabId) ?? null);
      if (plan) tabs.set(plan.tabId, plan);
    });
    active = "b";
    finishWrite();
    await save;
    expect(tabs.get(active)).toEqual({ tabId: "b", filePath: "/b.md", content: "Other unsaved work", dirty: true });
    expect(tabs.get("a")?.dirty).toBe(false);
  });

  it("keeps edits made during a write dirty and preserves their latest text", () => {
    expect(planSavedDocument(source, "/a.md", { ...source, content: "Newer work" }))
      .toEqual({ ...source, content: "Newer work", dirty: true });
  });

  it("applies Save As to the source tab and keeps newer edits dirty", () => {
    const untitled = { ...source, filePath: null };
    expect(planSavedDocument(untitled, "/new.md", { ...untitled, content: "Newer work" }))
      .toEqual({ ...source, filePath: "/new.md", content: "Newer work", dirty: true });
  });

  it("does not rebind closed, navigated, renamed or unrelated tabs", () => {
    expect(planSavedDocument(source, "/a.md", null)).toBeNull();
    expect(planSavedDocument(source, "/a.md", { ...source, filePath: "/other.md" })).toBeNull();
    expect(planSavedDocument(source, "/copy.md", { ...source, filePath: "/renamed.md" })).toBeNull();
    expect(planSavedDocument(source, "/a.md", { ...source, tabId: "b" })).toBeNull();
  });

  it("does not mark newer text clean when an older concurrent write finishes last", () => {
    const latest = { ...source, content: "Latest saved text" };
    expect(planSavedDocument(latest, "/a.md", latest)?.dirty).toBe(false);
    expect(planSavedDocument(source, "/a.md", latest)?.dirty).toBe(true);
  });
});
