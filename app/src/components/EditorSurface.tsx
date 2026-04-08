import React, { useEffect, useRef } from "react";
import { EditorState, Transaction } from "prosemirror-state";
import { EditorView, NodeView } from "prosemirror-view";
import { Node as ProseMirrorNode } from "prosemirror-model";
import { schema } from "../editor/schema";
import { buildKeymap } from "../editor/plugins/keymap";
import { buildInputRules } from "../editor/plugins/inputRules";
import { buildHistory } from "../editor/plugins/history";
import { undo } from "prosemirror-history";
import { buildDropImagePlugin } from "../editor/plugins/dropImage";
import { buildSearchPlugin } from "../editor/plugins/search";
import { buildHighlightPlugin } from "../editor/plugins/highlight";
import { baseKeymap } from "prosemirror-commands";
import { keymap } from "prosemirror-keymap";
import { dropCursor } from "prosemirror-dropcursor";
import { gapCursor } from "prosemirror-gapcursor";
import { tableEditing, columnResizing } from "prosemirror-tables";
import { renderMathInline, renderMathBlock } from "../lib/math";
import "../styles/editor.css";
import "../styles/markdown.css";

// Import highlight.js theme
import "highlight.js/styles/github.css";

// Import KaTeX styles
import "katex/dist/katex.min.css";

// ---- Math Inline NodeView ----
class MathInlineView implements NodeView {
  dom: HTMLElement;
  private span: HTMLElement;
  private input: HTMLInputElement | null = null;
  private isEditing = false;
  private node: ProseMirrorNode;
  private view: EditorView;
  private getPos: () => number | undefined;

  constructor(node: ProseMirrorNode, view: EditorView, getPos: () => number | undefined) {
    this.node = node;
    this.view = view;
    this.getPos = getPos;

    this.dom = document.createElement("span");
    this.dom.className = "math-inline-view";

    this.span = document.createElement("span");
    this.dom.appendChild(this.span);

    this.renderMath();

    this.dom.addEventListener("click", (e) => {
      e.stopPropagation();
      this.startEditing();
    });
  }

  renderMath() {
    this.span.innerHTML = renderMathInline(this.node.attrs.math || "");
  }

  startEditing() {
    if (this.isEditing) return;
    this.isEditing = true;
    this.dom.classList.add("editing");

    this.span.style.display = "none";
    this.input = document.createElement("input");
    this.input.type = "text";
    this.input.className = "math-inline-input";
    this.input.value = this.node.attrs.math || "";
    this.input.style.width = Math.max(4, (this.node.attrs.math || "").length + 1) + "ch";

    this.input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === "Escape") {
        e.preventDefault();
        this.commitEdit();
      }
      e.stopPropagation();
    });

    this.input.addEventListener("input", () => {
      if (this.input) {
        this.input.style.width = Math.max(4, this.input.value.length + 1) + "ch";
      }
    });

    this.input.addEventListener("blur", () => {
      this.commitEdit();
    });

    this.dom.appendChild(this.input);
    this.input.focus();
    this.input.select();
  }

  commitEdit() {
    if (!this.isEditing || !this.input) return;
    const newMath = this.input.value;
    this.isEditing = false;
    this.dom.classList.remove("editing");

    const pos = this.getPos();
    if (pos !== undefined) {
      const tr = this.view.state.tr.setNodeMarkup(pos, undefined, { math: newMath });
      this.view.dispatch(tr);
    }

    this.dom.removeChild(this.input);
    this.input = null;
    this.span.style.display = "";
  }

  update(node: ProseMirrorNode) {
    if (node.type !== this.node.type) return false;
    this.node = node;
    if (!this.isEditing) {
      this.renderMath();
    }
    return true;
  }

  stopEvent(event: Event) {
    return this.isEditing && (event.type === "keydown" || event.type === "keyup" || event.type === "keypress" || event.type === "input");
  }

  ignoreMutation() {
    return true;
  }

  destroy() {
    // cleanup
  }
}

// ---- Math Block NodeView ----
class MathBlockView implements NodeView {
  dom: HTMLElement;
  private rendered: HTMLElement;
  private textarea: HTMLTextAreaElement | null = null;
  private isEditing = false;
  private node: ProseMirrorNode;
  private view: EditorView;
  private getPos: () => number | undefined;

  constructor(node: ProseMirrorNode, view: EditorView, getPos: () => number | undefined) {
    this.node = node;
    this.view = view;
    this.getPos = getPos;

    this.dom = document.createElement("div");
    this.dom.className = "math-block-view";

    this.rendered = document.createElement("div");
    this.dom.appendChild(this.rendered);

    this.renderMath();

    this.dom.addEventListener("click", (e) => {
      e.stopPropagation();
      this.startEditing();
    });
  }

  renderMath() {
    this.rendered.innerHTML = renderMathBlock(this.node.attrs.math || "");
  }

  startEditing() {
    if (this.isEditing) return;
    this.isEditing = true;

    this.rendered.style.display = "none";
    this.textarea = document.createElement("textarea");
    this.textarea.className = "math-block-input";
    this.textarea.value = this.node.attrs.math || "";

    this.textarea.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        this.commitEdit();
      }
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        this.commitEdit();
      }
      e.stopPropagation();
    });

    this.textarea.addEventListener("blur", () => {
      this.commitEdit();
    });

    this.dom.appendChild(this.textarea);
    this.textarea.focus();
    this.textarea.select();
  }

  commitEdit() {
    if (!this.isEditing || !this.textarea) return;
    const newMath = this.textarea.value;
    this.isEditing = false;

    const pos = this.getPos();
    if (pos !== undefined) {
      const tr = this.view.state.tr.setNodeMarkup(pos, undefined, { math: newMath });
      this.view.dispatch(tr);
    }

    this.dom.removeChild(this.textarea);
    this.textarea = null;
    this.rendered.style.display = "";
  }

  update(node: ProseMirrorNode) {
    if (node.type !== this.node.type) return false;
    this.node = node;
    if (!this.isEditing) {
      this.renderMath();
    }
    return true;
  }

  stopEvent(event: Event) {
    return this.isEditing && (event.type === "keydown" || event.type === "keyup" || event.type === "keypress" || event.type === "input");
  }

  ignoreMutation() {
    return true;
  }

  destroy() {}
}

// ---- Code Block NodeView ----
class CodeBlockView implements NodeView {
  dom: HTMLElement;
  contentDOM: HTMLElement;
  private langLabel: HTMLElement;
  private node: ProseMirrorNode;

  constructor(node: ProseMirrorNode) {
    this.node = node;
    this.dom = document.createElement("div");
    this.dom.className = "code-block-view";

    this.langLabel = document.createElement("span");
    this.langLabel.className = "code-block-lang-label";
    this.langLabel.textContent = node.attrs.language || "";

    const pre = document.createElement("pre");
    const code = document.createElement("code");
    if (node.attrs.language) {
      code.className = `language-${node.attrs.language}`;
    }
    pre.appendChild(code);

    this.dom.appendChild(this.langLabel);
    this.dom.appendChild(pre);

    this.contentDOM = code;
  }

  update(node: ProseMirrorNode) {
    if (node.type !== this.node.type) return false;
    this.node = node;

    const lang = node.attrs.language || "";
    this.langLabel.textContent = lang;
    if (lang) {
      this.contentDOM.className = `language-${lang}`;
    } else {
      this.contentDOM.className = "";
    }

    // NOTE: do NOT call hljs.highlightElement on contentDOM — it replaces
    // innerHTML which corrupts ProseMirror's view tracking (causes reversed text).
    // Syntax coloring is achieved purely via the language-* CSS class.

    return true;
  }

  destroy() {}
}

// ---- Image NodeView ----
class ImageView implements NodeView {
  dom: HTMLElement;
  private node: ProseMirrorNode;

  constructor(node: ProseMirrorNode) {
    this.node = node;
    this.dom = document.createElement("span");
    this.dom.className = "image-view-wrapper";
    this.renderImage();
  }

  renderImage() {
    this.dom.innerHTML = "";
    const { src, alt, title, width, height } = this.node.attrs;

    const img = document.createElement("img");
    img.src = src;
    if (alt) img.alt = alt;
    if (title) img.title = title;
    if (width) img.width = parseInt(width);
    if (height) img.height = parseInt(height);

    img.onerror = () => {
      this.dom.innerHTML = "";
      const placeholder = document.createElement("span");
      placeholder.className = "image-placeholder";
      placeholder.textContent = `Image not found: ${alt || src}`;
      this.dom.appendChild(placeholder);
    };

    this.dom.appendChild(img);
  }

  update(node: ProseMirrorNode) {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this.renderImage();
    return true;
  }

  stopEvent() {
    return false;
  }

  ignoreMutation() {
    return true;
  }

  destroy() {}
}

// ---- Task List Item NodeView ----
// Renders a clickable checkbox that toggles the checked attribute.
class TaskListItemView implements NodeView {
  dom: HTMLElement;
  contentDOM: HTMLElement;
  private checkbox: HTMLInputElement;
  private node: ProseMirrorNode;
  private view: EditorView;
  private getPos: () => number | undefined;

  constructor(node: ProseMirrorNode, view: EditorView, getPos: () => number | undefined) {
    this.node = node;
    this.view = view;
    this.getPos = getPos;

    this.dom = document.createElement("li");
    this.dom.setAttribute("data-task", "");
    this.dom.className = "task-list-item";

    this.checkbox = document.createElement("input");
    this.checkbox.type = "checkbox";
    this.checkbox.className = "task-checkbox";
    this.checkbox.checked = node.attrs.checked;
    this.checkbox.contentEditable = "false";

    this.checkbox.addEventListener("mousedown", (e) => {
      e.preventDefault(); // prevent focus change
    });
    this.checkbox.addEventListener("change", () => {
      const pos = this.getPos();
      if (pos === undefined) return;
      this.view.dispatch(
        this.view.state.tr.setNodeMarkup(pos, undefined, {
          ...this.node.attrs,
          checked: this.checkbox.checked,
        })
      );
    });

    this.contentDOM = document.createElement("span");
    this.contentDOM.className = "task-list-content";

    this.dom.appendChild(this.checkbox);
    this.dom.appendChild(this.contentDOM);
    this.updateCheckedStyle();
  }

  updateCheckedStyle() {
    if (this.node.attrs.checked) {
      this.dom.classList.add("checked");
    } else {
      this.dom.classList.remove("checked");
    }
  }

  update(node: ProseMirrorNode) {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this.checkbox.checked = node.attrs.checked;
    this.updateCheckedStyle();
    return true;
  }
}

// ---- Main EditorSurface Component ----
interface EditorSurfaceProps {
  onMount: (view: EditorView) => void;
  onChange: () => void;
  onSave: () => void;
  onSearch: () => void;
}

const EditorSurface: React.FC<EditorSurfaceProps> = ({
  onMount,
  onChange,
  onSave,
  onSearch,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);

  // Refs so the once-built ProseMirror view always calls the latest callbacks
  const onSaveRef = useRef(onSave);
  const onSearchRef = useRef(onSearch);
  const onChangeRef = useRef(onChange);
  useEffect(() => { onSaveRef.current = onSave; }, [onSave]);
  useEffect(() => { onSearchRef.current = onSearch; }, [onSearch]);
  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);

  useEffect(() => {
    if (!containerRef.current) return;

    const plugins = [
      buildHistory(),
      buildInputRules(),
      buildKeymap(() => onSaveRef.current(), () => onSearchRef.current()),
      keymap(baseKeymap),
      dropCursor(),
      gapCursor(),
      buildDropImagePlugin(),
      buildSearchPlugin(),
      columnResizing(),
      tableEditing(),
      buildHighlightPlugin(),
    ];

    const state = EditorState.create({
      schema,
      plugins,
    });

    const view = new EditorView(containerRef.current, {
      state,

      // Disable macOS text features that interfere with math notation:
      // - writingsuggestions: disables inline predictions (gray ghost text accepted
      //   with Tab, e.g. typing "exp(pi)=" shows "23.14" in gray)
      // - autocorrect: disables text substitution / math evaluation
      attributes: {
        autocorrect: "off",
        autocomplete: "off",
        spellcheck: "false",
        autocapitalize: "sentences",
        writingsuggestions: "false",
      },

      nodeViews: {
        math_inline: (node, view, getPos) =>
          new MathInlineView(node, view, getPos),
        math_block: (node, view, getPos) =>
          new MathBlockView(node, view, getPos),
        code_block: (node) => new CodeBlockView(node),
        image: (node) => new ImageView(node),
        task_list_item: (node, view, getPos) =>
          new TaskListItemView(node, view, getPos),
      },

      dispatchTransaction(tr: Transaction) {
        const newState = view.state.apply(tr);
        view.updateState(newState);
        if (tr.docChanged) {
          onChangeRef.current();
        }
      },
    });

    // Block macOS math auto-evaluation (e.g. "2pi=" → "2pi=6.28").
    // Two layers: beforeinput to cancel it pre-change, and input to undo it
    // post-change if macOS bypassed beforeinput (observed on macOS 15+/16).
    const blockReplacementText = (e: Event) => {
      if ((e as InputEvent).inputType === "insertReplacementText") {
        e.preventDefault();
      }
    };
    view.dom.addEventListener("beforeinput", blockReplacementText);

    // Fallback: macOS can inject the math result via insertText with multi-char
    // numeric data, bypassing beforeinput entirely. Detect and undo it.
    const undoMathAutofill = (e: Event) => {
      const ie = e as InputEvent;
      if (
        ie.inputType === "insertText" &&
        typeof ie.data === "string" &&
        ie.data.length > 1 &&
        /^-?[0-9][0-9.]*$/.test(ie.data)
      ) {
        // Wait one frame for ProseMirror to process the DOM mutation,
        // then undo it via history.
        requestAnimationFrame(() => {
          undo(view.state, view.dispatch);
        });
      }
    };
    view.dom.addEventListener("input", undoMathAutofill);

    viewRef.current = view;
    onMount(view);

    return () => {
      view.dom.removeEventListener("beforeinput", blockReplacementText);
      view.dom.removeEventListener("input", undoMathAutofill);
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Handle link clicks: show tooltip with URL, click URL to open
  const handleEditorClick = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    const anchor = target.closest("a[href]") as HTMLAnchorElement | null;
    if (!anchor) {
      // Remove any existing link tooltip
      const existing = document.querySelector(".link-tooltip");
      if (existing) existing.remove();
      return;
    }
    e.preventDefault();
    e.stopPropagation();

    // Remove any existing tooltip
    const existing = document.querySelector(".link-tooltip");
    if (existing) existing.remove();

    const href = anchor.getAttribute("href") || "";
    const tooltip = document.createElement("div");
    tooltip.className = "link-tooltip";

    const urlSpan = document.createElement("a");
    urlSpan.className = "link-tooltip-url";
    urlSpan.textContent = href;
    urlSpan.href = href;
    urlSpan.target = "_blank";
    urlSpan.rel = "noopener noreferrer";
    urlSpan.addEventListener("click", async (ev) => {
      ev.preventDefault();
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("open_url", { url: href });
      } catch {
        window.open(href, "_blank");
      }
      tooltip.remove();
    });

    tooltip.appendChild(urlSpan);

    const rect = anchor.getBoundingClientRect();
    tooltip.style.position = "fixed";
    tooltip.style.top = `${rect.bottom + 6}px`;
    tooltip.style.left = `${rect.left}px`;
    document.body.appendChild(tooltip);

    // Close on click outside
    const dismiss = (ev: MouseEvent) => {
      if (!tooltip.contains(ev.target as Node)) {
        tooltip.remove();
        document.removeEventListener("mousedown", dismiss);
      }
    };
    setTimeout(() => document.addEventListener("mousedown", dismiss), 0);
  };

  return (
    <div className="editor-scroll-area">
      <div className="editor-surface">
        <div
          ref={containerRef}
          onClick={handleEditorClick}
        />
      </div>
    </div>
  );
};

export default EditorSurface;
