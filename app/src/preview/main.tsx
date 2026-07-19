// Bioscratch Quick Look preview entry.
//
// This renders a Markdown file read-only using the EXACT same schema,
// serialization, NodeViews, decoration plugins and CSS as the main editor, so
// the macOS Quick Look (spacebar) preview is visually identical to opening the
// file in Bioscratch — just non-editable.
//
// The host (the Quick Look extension) injects the file contents as
// `window.__QL_MARKDOWN__` and the file path as `window.__QL_FILEPATH__` before
// this script runs. A `window.__renderPreview()` hook is also exposed so the
// host can (re)render after injecting content asynchronously.

import { EditorState } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { schema } from "../editor/schema";
import { markdownToDoc } from "../editor/serialization/markdownImport";
import { buildImageRenderPlugin } from "../editor/plugins/imageRender";
import { buildMermaidPlugin, isMermaidLanguage } from "../editor/plugins/mermaidPlugin";
import { buildFrontmatterPlugin } from "../editor/plugins/frontmatterPlugin";
import { buildHighlightPlugin } from "../editor/plugins/highlight";
import {
  MathInlineView,
  MathBlockView,
  MermaidBlockView,
  FrontmatterView,
  CodeBlockView,
  TaskListItemView,
} from "../components/EditorSurface";
import { applyTheme, builtinThemeConfigs } from "../lib/themeLoader";

import "../styles/editor.css";
import "../styles/markdown.css";
import "highlight.js/styles/github.css";
import "katex/dist/katex.min.css";

interface QLWindow extends Window {
  __QL_MARKDOWN__?: string;
  __QL_FILEPATH__?: string;
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

  // imageRender resolves relative images through Tauri, which is unavailable in
  // the Quick Look sandbox; a ref with the file path lets absolute/remote
  // images still resolve where possible.
  const filePathRef = { current: filePath || null };

  const doc = markdownToDoc(markdown, schema);
  const state = EditorState.create({
    doc,
    plugins: [
      buildImageRenderPlugin(filePathRef),
      buildMermaidPlugin(),
      buildFrontmatterPlugin(),
      buildHighlightPlugin(),
    ],
  });

  currentView = new EditorView(root, {
    state,
    editable: () => false,
    nodeViews: {
      math_inline: (node, view, getPos) => new MathInlineView(node, view, getPos),
      math_block: (node, view, getPos) => new MathBlockView(node, view, getPos),
      code_block: (node, view, getPos) =>
        isMermaidLanguage(node.attrs.language)
          ? new MermaidBlockView(node, view, getPos)
          : new CodeBlockView(node),
      frontmatter: (node, view, getPos) => new FrontmatterView(node, view, getPos),
      task_list_item: (node, view, getPos) => new TaskListItemView(node, view, getPos),
    },
  });
}

(window as QLWindow).__renderPreview = render;
render();
