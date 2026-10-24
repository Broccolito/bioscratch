// @vitest-environment jsdom

import React, { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";

import TrashConfirmDialog from "../src/components/TrashConfirmDialog";

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

function renderDialog(isDir = false) {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  const host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root?.render(<TrashConfirmDialog name="notes.md" isDir={isDir} onConfirm={onConfirm} onCancel={onCancel} />);
  });
  const button = (label: string) =>
    Array.from(document.querySelectorAll("button")).find((b) => b.textContent === label)!;
  return { onConfirm, onCancel, button };
}

describe("TrashConfirmDialog", () => {
  it("focuses Cancel so a stray Enter never trashes anything", () => {
    const { button } = renderDialog();
    expect(document.activeElement).toBe(button("Cancel"));
    expect(document.body.textContent).toContain("Move “notes.md” to the Trash?");
  });

  it("cancels with Esc or the Cancel button, and confirms only via the Move button", () => {
    const { onConfirm, onCancel, button } = renderDialog();
    act(() => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); });
    act(() => { button("Cancel").click(); });
    expect(onCancel).toHaveBeenCalledTimes(2);
    expect(onConfirm).not.toHaveBeenCalled();
    act(() => { button("Move to Trash").click(); });
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("warns that a folder's contents go too", () => {
    renderDialog(true);
    expect(document.body.textContent).toContain("everything in it");
  });
});
