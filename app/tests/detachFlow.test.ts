import { describe, expect, it, vi } from "vitest";
import { detachDocument, type DetachDocument } from "../src/lib/detachFlow";

const document: DetachDocument = { filePath: "/notes/a.md", content: "Unsaved work", mode: "markdown", language: "" };

describe("detaching a saved document", () => {
  it("keeps the source tab if writing to disk fails", async () => {
    const open = vi.fn();
    const close = vi.fn();
    await expect(detachDocument(document, {
      current: () => document,
      save: async () => { throw new Error("Disk is full"); },
      open,
      close,
    })).rejects.toThrow("Disk is full");
    expect(open).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
  });

  it("preserves edits made during the write and does not open a stale copy", async () => {
    let current = document;
    const open = vi.fn();
    const close = vi.fn();
    await expect(detachDocument(document, {
      current: () => current,
      save: async () => { current = { ...document, content: "Newer work" }; },
      open,
      close,
    })).resolves.toBe(false);
    expect(open).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
  });

  it("keeps a renamed source after creating the destination window", async () => {
    let current = document;
    const close = vi.fn();
    await expect(detachDocument(document, {
      current: () => current,
      open: async () => { current = { ...document, filePath: "/notes/renamed.md" }; },
      close,
    })).resolves.toBe(false);
    expect(close).not.toHaveBeenCalled();
  });

  it("closes the source only after successful write and window creation", async () => {
    const operations: string[] = [];
    await expect(detachDocument(document, {
      current: () => document,
      save: async () => { operations.push("save"); },
      open: async () => { operations.push("open"); },
      close: () => { operations.push("close"); },
    })).resolves.toBe(true);
    expect(operations).toEqual(["save", "open", "close"]);
  });
});
