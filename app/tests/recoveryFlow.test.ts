import { describe, expect, it } from "vitest";
import { planRecovery } from "../src/lib/recoveryFlow";

const source = { tabId: "owner", filePath: "/notes/a.md", content: "recovered edits" };

describe("autosave recovery", () => {
  it("targets the owning document even when another edited tab is active", () => {
    const tabs = [
      { id: "unrelated", filePath: "/notes/b.md", dirty: true },
      { id: "owner", filePath: "/notes/a.md", dirty: false },
    ];
    const before = structuredClone(tabs);
    expect(planRecovery(source, tabs)).toEqual({
      tabId: "owner", filePath: "/notes/a.md", content: "recovered edits", dirty: true,
    });
    expect(tabs).toEqual(before);
  });

  it("preserves edits made to the owner after recovery was requested", () => {
    expect(planRecovery(source, [{ id: "owner", filePath: "/notes/a.md", dirty: true }])).toEqual({
      tabId: null, filePath: null, content: "recovered edits", dirty: true,
    });
  });

  it("creates a draft if in-tab navigation changed the owning document", () => {
    expect(planRecovery(source, [{ id: "owner", filePath: "/notes/b.md", dirty: false }]).filePath).toBeNull();
  });

  it("does not overwrite another tab that subsequently reopened the same path", () => {
    expect(planRecovery(source, [{ id: "new-owner", filePath: "/notes/a.md", dirty: false }]).tabId).toBeNull();
    expect(planRecovery(source, []).dirty).toBe(true);
  });
});
