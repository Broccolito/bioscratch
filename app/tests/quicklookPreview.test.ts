// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import type { EditorView } from "prosemirror-view";
import { TextSelection } from "prosemirror-state";
import { readFile } from "@tauri-apps/plugin-fs";
import { createPreviewView, previewImageResolver } from "../src/preview/render";

vi.mock("mermaid", () => ({ default: {
  initialize: vi.fn(),
  render: vi.fn(async () => ({ svg: '<svg xmlns="http://www.w3.org/2000/svg"><text>Rendered diagram</text></svg>' })),
} }));
vi.mock("@tauri-apps/plugin-fs", () => ({ readFile: vi.fn() }));

let view: EditorView | null = null;
afterEach(() => {
  view?.destroy();
  view = null;
  document.body.replaceChildren();
  vi.clearAllMocks();
});

function render(markdown: string, images: Record<string, string> = {}) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  view = createPreviewView(host, markdown, "/notes/note.md", images);
  return host;
}

it("shows inactive banners, math and diagrams without editing controls or editable task boxes", async () => {
  const host = render(`---\ntitle: Preview title\nauthor: Example\n---\n
Text with $x^2$.\n
$$\ny = x + 1\n$$\n
\`\`\`mermaid\ngraph TD; A-->B\n\`\`\`\n
- [x] completed task\n`);
  await Promise.resolve();
  expect(host.querySelector(".fm-banner")?.textContent).toContain("Preview title");
  expect(host.querySelector(".frontmatter-source-section")).toBeNull();
  expect(host.textContent).not.toContain("title: Preview title");
  expect(host.querySelectorAll(".katex").length).toBe(2);
  expect(host.querySelector(".mermaid-preview svg text")?.textContent).toBe("Rendered diagram");
  expect(host.querySelector<HTMLElement>(".mermaid-source-section")?.style.display).toBe("none");
  expect(host.querySelector(".mermaid-toolbar, button, textarea, input:not([type=checkbox])")).toBeNull();
  expect(host.querySelector<HTMLInputElement>("input[type=checkbox]")?.disabled).toBe(true);

  host.querySelector(".math-inline-view")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  host.querySelector(".math-block-view")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  host.querySelector(".mermaid-preview")?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
  expect(host.querySelector("textarea, input:not([type=checkbox]), .mermaid-active")).toBeNull();
  const original = view!.state.doc;
  view!.dispatch(view!.state.tr.insertText("attempted edit", original.content.size - 1));
  expect(view!.state.doc.eq(original)).toBe(true);
});

it("renders a first-line local image without Tauri, even with selection inside its source", async () => {
  const data = "data:image/png;base64,AA==";
  const host = render("![Local image](img/example.png)\n", { "img/example.png": data });
  await Promise.resolve();
  expect(host.querySelector(".image-view-wrapper img")?.getAttribute("src")).toBe(data);
  expect(host.querySelector(".image-source-hidden")).not.toBeNull();
  view!.dispatch(view!.state.tr.setSelection(TextSelection.create(view!.state.doc, 2)));
  expect(host.querySelector(".image-source-hidden")).not.toBeNull();
  expect(host.querySelector(".image-source-editing")).toBeNull();
  expect(readFile).not.toHaveBeenCalled();
});

it("uses only injected local images while preserving remote and data image URLs", async () => {
  const resolve = previewImageResolver({ "img/ok.png": "data:image/png;base64,AA==" });
  await expect(resolve("img/ok.png")).resolves.toBe("data:image/png;base64,AA==");
  await expect(resolve("https://example.com/image.png")).resolves.toBe("https://example.com/image.png");
  await expect(resolve("data:image/png;base64,BB==")).resolves.toBe("data:image/png;base64,BB==");
  await expect(resolve("../outside.png")).rejects.toThrow("unavailable");
  await expect(resolve("/etc/secret.png")).rejects.toThrow("unavailable");
  await expect(resolve("constructor")).rejects.toThrow("unavailable");
  expect(readFile).not.toHaveBeenCalled();
});

it("explains unavailable local assets without claiming the files do not exist", async () => {
  const host = render("![Sample](qa-shiba.jpg)\n\nInline ![Diagram](images/diagram.png).\n");
  await Promise.resolve();
  await Promise.resolve();
  const placeholders = Array.from(host.querySelectorAll(".image-placeholder"));
  expect(placeholders).toHaveLength(2);
  for (const placeholder of placeholders) {
    expect(placeholder.textContent).toContain("Local image unavailable in Quick Look");
    expect(placeholder.textContent).toContain("Open this note in Bioscratch to view it");
    expect(placeholder.textContent).not.toContain("not found");
  }
  expect(readFile).not.toHaveBeenCalled();
});

it("does not describe failed remote images as a local sandbox limitation", async () => {
  const host = render("![Remote](https://example.com/missing.png)\n");
  await Promise.resolve();
  host.querySelector("img")?.dispatchEvent(new Event("error"));
  expect(host.querySelector(".image-placeholder")?.textContent).toBe("Image unavailable: Remote");
});

it("shows an empty diagram without instructions to edit the source", () => {
  const host = render("```mermaid\n\n```\n");
  expect(host.textContent).toContain("Empty Mermaid diagram");
  expect(host.textContent).not.toContain("Edit source");
  expect(host.querySelector("button")).toBeNull();
});
