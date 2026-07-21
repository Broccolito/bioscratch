// @vitest-environment jsdom

import React, { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";

import CloseDocumentDialog from "../src/components/CloseDocumentDialog";
import { autosaveKeyForDiscard, saveBeforeClose } from "../src/lib/closeFlow";

let root: Root | null = null;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  if (root) {
    act(() => root?.unmount());
    root = null;
  }
  document.body.replaceChildren();
});

function renderDialog(overrides: Partial<React.ComponentProps<typeof CloseDocumentDialog>> = {}) {
  const callbacks = {
    onDelete: vi.fn(),
    onCancel: vi.fn(),
    onSave: vi.fn(),
  };
  const host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root?.render(
      <CloseDocumentDialog
        label="blank.md"
        hasSavedFile={false}
        saving={false}
        {...callbacks}
        {...overrides}
      />
    );
  });
  return callbacks;
}

function clickButton(label: string): void {
  const button = Array.from(document.querySelectorAll("button"))
    .find((candidate) => candidate.textContent === label);
  if (!button) throw new Error(`Missing ${label} button`);
  act(() => button.dispatchEvent(new MouseEvent("click", { bubbles: true })));
}

describe("dirty-document close flow", () => {
  it("presents independent Delete, Cancel, and Save actions", () => {
    const callbacks = renderDialog();
    expect(Array.from(document.querySelectorAll("button")).map((button) => button.textContent))
      .toEqual(["Delete", "Cancel", "Save"]);

    clickButton("Cancel");
    expect(callbacks.onCancel).toHaveBeenCalledOnce();
    expect(callbacks.onDelete).not.toHaveBeenCalled();
    expect(callbacks.onSave).not.toHaveBeenCalled();
  });

  it("routes Delete and Save to different callbacks", () => {
    const callbacks = renderDialog();
    clickButton("Delete");
    clickButton("Save");
    expect(callbacks.onDelete).toHaveBeenCalledOnce();
    expect(callbacks.onSave).toHaveBeenCalledOnce();
    expect(callbacks.onCancel).not.toHaveBeenCalled();
  });

  it("treats Escape and backdrop dismissal as Cancel", () => {
    const callbacks = renderDialog();
    act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    const backdrop = document.querySelector<HTMLElement>(".modal-overlay");
    if (!backdrop) throw new Error("Missing dialog backdrop");
    act(() => backdrop.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })));
    expect(callbacks.onCancel).toHaveBeenCalledTimes(2);
  });

  it("locks all decisions while a save is in progress", () => {
    const callbacks = renderDialog({ saving: true });
    expect(document.body.textContent).toContain("Saving…");
    expect(Array.from(document.querySelectorAll("button")).every((button) => button.disabled))
      .toBe(true);
    act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(callbacks.onCancel).not.toHaveBeenCalled();
  });

  it("explains that discarding a file-backed edit does not delete the disk file", () => {
    renderDialog({ hasSavedFile: true });
    expect(document.body.textContent).toContain("The saved file remains on disk.");
  });

  it("closes only after a successful save", async () => {
    const close = vi.fn();
    await expect(saveBeforeClose(async () => false, close)).resolves.toBe(false);
    expect(close).not.toHaveBeenCalled();

    await expect(saveBeforeClose(async () => { throw new Error("write failed"); }, close))
      .resolves.toBe(false);
    expect(close).not.toHaveBeenCalled();

    await expect(saveBeforeClose(async () => true, close)).resolves.toBe(true);
    expect(close).toHaveBeenCalledOnce();
  });

  it("deletes the matching recovery copy when changes are discarded", () => {
    expect(autosaveKeyForDiscard(null)).toBe("__untitled__");
    expect(autosaveKeyForDiscard("/tmp/blank.md")).toBe("/tmp/blank.md");
  });
});
