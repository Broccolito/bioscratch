import React, { useCallback, useEffect, useRef, useState } from "react";
import { EditorView } from "prosemirror-view";
import { toggleMark, setBlockType, wrapIn } from "prosemirror-commands";
import { wrapInList } from "prosemirror-schema-list";
import { schema } from "../editor/schema";
import type { FileMode } from "../lib/fileMode";
// prosemirror-tables imports used selectively


interface ToolbarProps {
  view: EditorView | null;
  hasDocument: boolean;
  fileMode: FileMode;
  onNew: () => void;
  onOpen: () => void;
  onSave: () => void;
  onSaveAs: () => void;
  onExportHtml: () => void;
  onExportPdf: () => void;
  onToggleSearch: () => void;
  onOpenThemeSelector: () => void;
}

const Toolbar: React.FC<ToolbarProps> = ({
  view,
  hasDocument,
  fileMode,
  onNew,
  onOpen,
  onSave,
  onSaveAs,
  onExportHtml,
  onExportPdf,
  onToggleSearch,
  onOpenThemeSelector,
}) => {
  // File ops (Save, Save As, Export) need an open document.
  // Formatting ops (Paragraph → HR) need an open markdown document.
  const fileOpsEnabled = hasDocument;
  const formattingEnabled = hasDocument && fileMode === "markdown";
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const exportMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!exportMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (!exportMenuRef.current?.contains(e.target as Node)) {
        setExportMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [exportMenuOpen]);

  const exec = useCallback(
    (command: (state: any, dispatch?: any) => boolean) => {
      if (!view) return;
      command(view.state, view.dispatch);
      view.focus();
    },
    [view]
  );

  const setHeading = useCallback(
    (level: number) => {
      if (!view) return;
      if (level === 0) {
        setBlockType(schema.nodes.paragraph)(view.state, view.dispatch);
      } else {
        setBlockType(schema.nodes.heading, { level })(view.state, view.dispatch);
      }
      view.focus();
    },
    [view]
  );

  const insertMathInline = useCallback(() => {
    if (!view) return;
    const node = schema.nodes.math_inline.create({ math: "x^2" });
    const tr = view.state.tr.replaceSelectionWith(node);
    view.dispatch(tr);
    view.focus();
  }, [view]);

  const insertMathBlock = useCallback(() => {
    if (!view) return;
    const node = schema.nodes.math_block.create({ math: "E = mc^2" });
    const tr = view.state.tr.replaceSelectionWith(node);
    view.dispatch(tr);
    view.focus();
  }, [view]);

  const insertCodeBlock = useCallback(() => {
    if (!view) return;
    exec(setBlockType(schema.nodes.code_block, { language: "" }));
  }, [view, exec]);

  const insertTableNode = useCallback(() => {
    if (!view) return;
    {
      // Manually create a simple 3x3 table
      const cell = () =>
        schema.nodes.table_cell.create(null, [schema.nodes.paragraph.create()]);
      const headerCell = () =>
        schema.nodes.table_header.create(null, [schema.nodes.paragraph.create()]);

      const headerRow = schema.nodes.table_row.create(null, [
        headerCell(),
        headerCell(),
        headerCell(),
      ]);
      const bodyRow = () =>
        schema.nodes.table_row.create(null, [cell(), cell(), cell()]);

      const table = schema.nodes.table.create(null, [
        headerRow,
        bodyRow(),
        bodyRow(),
      ]);

      const insertTr = view.state.tr.replaceSelectionWith(table);
      view.dispatch(insertTr);
    }
    view.focus();
  }, [view]);

  const insertHR = useCallback(() => {
    if (!view) return;
    const hr = schema.nodes.horizontal_rule.create();
    const tr = view.state.tr.replaceSelectionWith(hr);
    view.dispatch(tr);
    view.focus();
  }, [view]);

  const getHeadingLevel = (): string => {
    if (!view) return "0";
    const { selection } = view.state;
    const { $from } = selection;
    const node = $from.node($from.depth);
    if (node.type === schema.nodes.heading) {
      return String(node.attrs.level);
    }
    return "0";
  };

  return (
    <div className="toolbar">
      {/* File operations */}
      <button className="toolbar-btn" onClick={onNew} title="New Tab (⌘T)">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 3v4a1 1 0 0 0 1 1h4"/>
          <path d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2Z"/>
          <path d="M12 11v6"/><path d="M9 14h6"/>
        </svg>
        New
      </button>
      <button className="toolbar-btn" onClick={onOpen} title="Open (Ctrl+O)">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/>
        </svg>
        Open
      </button>
      <button className="toolbar-btn" onClick={onSave} disabled={!fileOpsEnabled} title="Save (Ctrl+S)">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/>
          <path d="M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7"/>
          <path d="M7 3v4a1 1 0 0 0 1 1h7"/>
        </svg>
        Save
      </button>
      <button className="toolbar-btn" onClick={onSaveAs} disabled={!fileOpsEnabled} title="Save As">
        Save As
      </button>
      <div className="export-menu-wrapper" ref={exportMenuRef}>
        <button
          className={`toolbar-btn${exportMenuOpen ? " active" : ""}`}
          onClick={() => setExportMenuOpen((v) => !v)}
          disabled={!fileOpsEnabled}
          title="Export document"
        >
          Export
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" width="9" height="9" style={{ marginLeft: 2 }}>
            <path d="m6 9 6 6 6-6"/>
          </svg>
        </button>
        {exportMenuOpen && (
          <div className="export-menu">
            <button
              className="export-menu-item"
              onClick={() => { onExportHtml(); setExportMenuOpen(false); }}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
                <path d="m16 18 6-6-6-6"/><path d="m8 6-6 6 6 6"/>
              </svg>
              Export as HTML
            </button>
            <button
              className="export-menu-item"
              onClick={() => { onExportPdf(); setExportMenuOpen(false); }}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
                <path d="M14 3v4a1 1 0 0 0 1 1h4"/>
                <path d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2Z"/>
                <path d="M9 13h6"/><path d="M9 17h6"/>
              </svg>
              Export as PDF
            </button>
          </div>
        )}
      </div>

      <div className="toolbar-separator" />

      {/* Heading selector */}
      <select
        className="toolbar-select"
        value={getHeadingLevel()}
        onChange={(e) => setHeading(parseInt(e.target.value))}
        disabled={!formattingEnabled}
        title="Heading level"
      >
        <option value="0">Paragraph</option>
        <option value="1">Heading 1</option>
        <option value="2">Heading 2</option>
        <option value="3">Heading 3</option>
        <option value="4">Heading 4</option>
        <option value="5">Heading 5</option>
        <option value="6">Heading 6</option>
      </select>

      <div className="toolbar-separator" />

      {/* Text formatting */}
      <button
        className="toolbar-btn icon-only"
        onClick={() => exec(toggleMark(schema.marks.bold))}
        disabled={!formattingEnabled}
        title="Bold (Ctrl+B)"
        style={{ fontWeight: "bold", fontSize: "15px" }}
      >
        B
      </button>
      <button
        className="toolbar-btn icon-only"
        onClick={() => exec(toggleMark(schema.marks.italic))}
        disabled={!formattingEnabled}
        title="Italic (Ctrl+I)"
        style={{ fontStyle: "italic", fontSize: "15px" }}
      >
        I
      </button>
      <button
        className="toolbar-btn icon-only"
        onClick={() => exec(toggleMark(schema.marks.code))}
        disabled={!formattingEnabled}
        title="Inline Code (Ctrl+`)"
        style={{ fontFamily: "monospace", fontSize: "14px" }}
      >
        `
      </button>
      <button
        className="toolbar-btn icon-only"
        onClick={() => exec(toggleMark(schema.marks.strikethrough))}
        disabled={!formattingEnabled}
        title="Strikethrough"
        style={{ textDecoration: "line-through", fontSize: "14px" }}
      >
        S
      </button>

      <div className="toolbar-separator" />

      {/* Lists */}
      <button
        className="toolbar-btn"
        onClick={() => exec(wrapInList(schema.nodes.bullet_list))}
        disabled={!formattingEnabled}
        title="Bullet List"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M8 6h13"/><path d="M8 12h13"/><path d="M8 18h13"/>
          <path d="M3 6h.01"/><path d="M3 12h.01"/><path d="M3 18h.01"/>
        </svg>
        List
      </button>
      <button
        className="toolbar-btn"
        onClick={() => exec(wrapInList(schema.nodes.ordered_list))}
        disabled={!formattingEnabled}
        title="Ordered List"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M10 6h11"/><path d="M10 12h11"/><path d="M10 18h11"/>
          <path d="M4 5h1v4"/><path d="M4 9h2"/>
          <path d="M6.5 16.5c0-.8-1.5-1-2-.5"/><path d="M4 19h2.5c0-1-2-1.2-2-2.5"/>
        </svg>
        1. List
      </button>
      <button
        className="toolbar-btn"
        onClick={() => exec(wrapIn(schema.nodes.blockquote))}
        disabled={!formattingEnabled}
        title="Blockquote"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M17 6H9"/><path d="M21 12H9"/><path d="M21 18H9"/><path d="M4 6v12"/>
        </svg>
        Quote
      </button>

      <div className="toolbar-separator" />

      {/* Blocks */}
      <button className="toolbar-btn" onClick={insertCodeBlock} disabled={!formattingEnabled} title="Code Block">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect width="18" height="18" x="3" y="3" rx="2"/>
          <path d="m10 9-2 3 2 3"/><path d="m14 9 2 3-2 3"/>
        </svg>
        Code
      </button>
      <button className="toolbar-btn" onClick={insertTableNode} disabled={!formattingEnabled} title="Insert Table">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect width="18" height="18" x="3" y="3" rx="2"/>
          <path d="M3 9h18"/><path d="M3 15h18"/><path d="M12 3v18"/>
        </svg>
        Table
      </button>
      <button className="toolbar-btn" onClick={insertMathInline} disabled={!formattingEnabled} title="Inline Math">
        $…$
      </button>
      <button className="toolbar-btn" onClick={insertMathBlock} disabled={!formattingEnabled} title="Math Block">
        $$…$$
      </button>
      <button className="toolbar-btn" onClick={insertHR} disabled={!formattingEnabled} title="Horizontal Rule">
        —
      </button>

      <div className="toolbar-separator" />

      {/* Search & Theme */}
      <button className="toolbar-btn icon-only" onClick={onToggleSearch} title="Search (Ctrl+F)">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>
        </svg>
      </button>
      <button className="toolbar-btn" onClick={onOpenThemeSelector} title="Select Theme">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/>
          <circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/>
          <circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/>
          <circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/>
          <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2Z"/>
        </svg>
        Theme
      </button>
    </div>
  );
};

export default Toolbar;
