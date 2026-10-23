// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildHtmlBody as appBody,
  buildHtmlDocument as appDocument,
  buildPrintDocument,
} from "../src/lib/export";
import {
  buildHtmlBody as extensionBody,
  buildHtmlDocument as extensionDocument,
} from "../../extension/src/webview/lib/export";

vi.mock("../../extension/src/webview/bridge", () => ({ saveHtml: vi.fn() }));

afterEach(() => {
  document.body.replaceChildren();
  document.documentElement.removeAttribute("style");
  document.documentElement.removeAttribute("data-color-scheme");
});

const targets = [
  { name: "desktop HTML", body: appBody, document: appDocument },
  { name: "desktop PDF", body: appBody, document: buildPrintDocument },
  { name: "extension HTML", body: extensionBody, document: extensionDocument },
];

describe.each(targets)("$name export", (target) => {
  it("embeds installed math styles and fonts without external CSS or scripts", () => {
    const html = target.document("Math", "<p>Equation</p>");
    const parsed = new DOMParser().parseFromString(html, "text/html");
    expect(parsed.querySelector("link, script")).toBeNull();
    expect(html).toContain(".katex");
    const fonts = [...html.matchAll(/url\((data:font\/woff2;base64,[A-Za-z0-9+/=]+)\)/g)];
    expect(fonts.length).toBeGreaterThan(10);
    expect(atob(fonts[0][1].split(",")[1]).slice(0, 4)).toBe("wOF2");
    expect(html).not.toMatch(/url\(["']?(?:https?:|fonts\/|\/assets\/)/);
    expect(html).not.toContain("cdn.jsdelivr.net");
  });

  it("exports rendered diagrams, banners, current math and task state without editor controls", () => {
    document.body.innerHTML = `<div class="ProseMirror" contenteditable="true">
      <div class="frontmatter-view"><div class="frontmatter-source-section">secret: raw-yaml</div><div class="fm-banner">Note title</div></div>
      <span class="math-inline-view editing"><span style="display:none">old math</span><input class="math-inline-input" value="x^2"></span>
      <div class="mermaid-block-view"><button>Edit source</button><code class="language-mermaid">graph TD; A--&gt;B</code><div class="mermaid-preview"><svg xmlns="http://www.w3.org/2000/svg"><text>Diagram label</text><foreignObject><div xmlns="http://www.w3.org/1999/xhtml">HTML diagram label<img src="x" onerror="alert(1)"><script>alert(1)</script></div></foreignObject></svg></div></div>
      <p class="image-source-hidden">![image](asset.png)</p><div class="image-view-wrapper"><img src="data:image/png;base64,AA==" alt="image"></div>
      <input type="checkbox" checked><button class="table-ctrl-btn">Add row</button>
    </div>`;
    const body = target.body();
    const parsed = new DOMParser().parseFromString(body, "text/html");
    expect(parsed.querySelector(".fm-banner")?.textContent).toBe("Note title");
    expect(parsed.querySelector(".katex")).not.toBeNull();
    expect(parsed.querySelector(".mermaid-print svg text")?.textContent).toBe("Diagram label");
    expect(parsed.querySelector(".mermaid-print svg foreignObject")?.textContent).toBe("HTML diagram label");
    expect(parsed.querySelector("button, textarea, input:not([type=checkbox]), [contenteditable]")).toBeNull();
    expect(parsed.querySelector<HTMLInputElement>("input[type=checkbox]")?.disabled).toBe(true);
    expect(parsed.querySelector<HTMLInputElement>("input[type=checkbox]")?.checked).toBe(true);
    expect(body).not.toContain("raw-yaml");
    expect(body).not.toContain("old math");
    expect(body).not.toContain("graph TD");
    expect(body).not.toContain("asset.png");
    expect(body).not.toContain("onerror");
    expect(parsed.querySelector("script")).toBeNull();
    // Capturing an export must leave the editor and its current edits intact.
    expect(document.querySelector(".math-inline-input")).not.toBeNull();
    expect(document.querySelector(".frontmatter-source-section")).not.toBeNull();
  });

  it("escapes document titles", () => {
    const title = '</title><script>alert("title")</script>';
    const parsed = new DOMParser().parseFromString(target.document(title, ""), "text/html");
    expect(parsed.title).toBe(title);
    expect(parsed.querySelector("script")).toBeNull();
  });

  it.each([
    { scheme: "light", background: "#fafafa", foreground: "#2b2620" },
    { scheme: "dark", background: "#201d19", foreground: "#e6dfd4" },
  ])("preserves matching $scheme page and text colors", ({ scheme, background, foreground }) => {
    document.documentElement.setAttribute("data-color-scheme", scheme);
    document.documentElement.style.setProperty("--bg-editor", background);
    document.documentElement.style.setProperty("--text-primary", foreground);
    const parsed = new DOMParser().parseFromString(target.document("Theme", "<p>Readable</p>"), "text/html");
    expect(parsed.documentElement.getAttribute("data-color-scheme")).toBe(scheme);
    const style = [...parsed.querySelectorAll("style")].map((node) => node.textContent).join("\n");
    expect(style).toContain(`--bg-editor: ${background}`);
    expect(style).toContain(`--text-primary: ${foreground}`);
    expect(style).toMatch(/(?:html, body|body)\s*\{[^}]*background:\s*var\(--bg-editor,\s*#fafafa\)/);
    expect(style).toMatch(/color:\s*var\(--text-primary,/);
  });
});

it("prevents theme values from closing the exported stylesheet", () => {
  document.documentElement.style.setProperty("--custom", '"</style><script>alert(1)</script>"');
  const parsed = new DOMParser().parseFromString(buildPrintDocument("Theme", ""), "text/html");
  expect(parsed.querySelector("script")).toBeNull();
});
