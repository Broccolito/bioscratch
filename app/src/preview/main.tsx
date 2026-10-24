// Bioscratch Quick Look preview entry.
//
// This renders a Markdown file read-only using the same schema,
// serialization, rendered widgets and CSS as the main editor. Referenced local
// images depend on the native host's sandbox access; unavailable assets show
// a prompt to open the note in Bioscratch.
//
// The host (the Quick Look extension) injects the file contents as
// `window.__QL_MARKDOWN__` and the file path as `window.__QL_FILEPATH__` before
// this script runs. A `window.__renderPreview()` hook is also exposed so the
// host can (re)render after injecting content asynchronously.

import type { EditorView } from "prosemirror-view";
import { createPreviewView } from "./render";
import { applyTheme, builtinThemeConfigs } from "../lib/themeLoader";

import "../styles/editor.css";
import "../styles/markdown.css";
import "../styles/syntax.css";
import "katex/dist/katex.min.css";

interface QLWindow extends Window {
  __QL_MARKDOWN__?: string;
  __QL_FILEPATH__?: string;
  __QL_IMAGES__?: Record<string, string>;
  __renderPreview?: () => void;
}

let currentView: EditorView | null = null;

function render(): void {
  const w = window as QLWindow;
  const markdown = w.__QL_MARKDOWN__ ?? "";
  const filePath = w.__QL_FILEPATH__ ?? "";

  const root = document.getElementById("preview-root");
  if (!root) return;

  // Match the system appearance so the preview looks native in Quick Look.
  const prefersDark =
    window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  const themeId = prefersDark ? "dark" : "light";
  applyTheme(themeId, builtinThemeConfigs[themeId]);

  // Tear down any previous view (host may re-render).
  if (currentView) {
    currentView.destroy();
    currentView = null;
  }
  root.innerHTML = "";

  currentView = createPreviewView(root, markdown, filePath, w.__QL_IMAGES__);
}

(window as QLWindow).__renderPreview = render;
render();
