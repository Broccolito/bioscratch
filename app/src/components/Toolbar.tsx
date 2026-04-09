import React, { useCallback, useEffect, useRef, useState } from "react";
import { EditorView } from "prosemirror-view";
import { toggleMark, setBlockType, wrapIn } from "prosemirror-commands";
import { wrapInList } from "prosemirror-schema-list";
import { schema } from "../editor/schema";
// prosemirror-tables imports used selectively


interface ToolbarProps {
  view: EditorView | null;
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
  onNew,
  onOpen,
  onSave,
  onSaveAs,
  onExportHtml,
  onExportPdf,
  onToggleSearch,
  onOpenThemeSelector,
}) => {
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
        <svg viewBox="0 0 16 16" fill="currentColor">
          <path d="M9.5 1H3.5A1.5 1.5 0 0 0 2 2.5v11A1.5 1.5 0 0 0 3.5 15h9a1.5 1.5 0 0 0 1.5-1.5V5.5L9.5 1zm0 1.5 3 3H9.5V2.5zM8.75 9.75H9.5v.75A2 2 0 0 1 7.5 12.5h-.5v-.75h.5a1.25 1.25 0 0 0 1.25-1.25v-.75zm-2.5 0H7v.75A2 2 0 0 1 5 12.5h-.5v-.75H5a1.25 1.25 0 0 0 1.25-1.25v-.75z"/>
        </svg>
        New
      </button>
      <button className="toolbar-btn" onClick={onOpen} title="Open (Ctrl+O)">
        <svg viewBox="0 0 16 16" fill="currentColor">
          <path d="M1 3.5A1.5 1.5 0 0 1 2.5 2h2.764c.958 0 1.76.56 2.311 1.184C7.985 3.648 8.48 4 9 4h4.5A1.5 1.5 0 0 1 15 5.5v7a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 1 12.5v-9z"/>
        </svg>
        Open
      </button>
      <button className="toolbar-btn" onClick={onSave} title="Save (Ctrl+S)">
        <svg viewBox="0 0 16 16" fill="currentColor">
          <path d="M2 1a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V2a1 1 0 0 0-1-1H9.5a1 1 0 0 0-1 1v7.293l2.646-2.647a.5.5 0 0 1 .708.708l-3.5 3.5a.5.5 0 0 1-.708 0l-3.5-3.5a.5.5 0 1 1 .708-.708L7.5 9.293V2a2 2 0 0 1 2-2H14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2V2a2 2 0 0 1 2-2h2.5a.5.5 0 0 1 0 1H2z"/>
        </svg>
        Save
      </button>
      <button className="toolbar-btn" onClick={onSaveAs} title="Save As">
        Save As
      </button>
      <div className="export-menu-wrapper" ref={exportMenuRef}>
        <button
          className={`toolbar-btn${exportMenuOpen ? " active" : ""}`}
          onClick={() => setExportMenuOpen((v) => !v)}
          title="Export document"
        >
          Export
          <svg viewBox="0 0 16 16" fill="currentColor" width="9" height="9" style={{ marginLeft: 1 }}>
            <path d="M7.247 11.14 2.451 5.658C1.885 5.013 2.345 4 3.204 4h9.592a1 1 0 0 1 .753 1.659l-4.796 5.48a1 1 0 0 1-1.506 0z"/>
          </svg>
        </button>
        {exportMenuOpen && (
          <div className="export-menu">
            <button
              className="export-menu-item"
              onClick={() => { onExportHtml(); setExportMenuOpen(false); }}
            >
              <svg viewBox="0 0 16 16" fill="currentColor" width="13" height="13">
                <path d="M5.854 4.854a.5.5 0 1 0-.708-.708l-3.5 3.5a.5.5 0 0 0 0 .708l3.5 3.5a.5.5 0 0 0 .708-.708L2.707 8l3.147-3.146zm4.292 0a.5.5 0 0 1 .708-.708l3.5 3.5a.5.5 0 0 1 0 .708l-3.5 3.5a.5.5 0 0 1-.708-.708L13.293 8l-3.147-3.146z"/>
              </svg>
              Export as HTML
            </button>
            <button
              className="export-menu-item"
              onClick={() => { onExportPdf(); setExportMenuOpen(false); }}
            >
              <svg viewBox="0 0 16 16" fill="currentColor" width="13" height="13">
                <path d="M14 14V4.5L9.5 0H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2zM9.5 3A1.5 1.5 0 0 0 11 4.5h2V14a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1h5.5v2z"/>
                <path d="M4.603 14.087a.81.81 0 0 1-.438-.42c-.195-.388-.13-.776.08-1.102.198-.307.526-.568.897-.787a7.68 7.68 0 0 1 1.482-.645 19.697 19.697 0 0 0 1.062-2.227 7.269 7.269 0 0 1-.43-1.295c-.086-.4-.119-.796-.046-1.136.075-.354.274-.672.65-.823.192-.077.4-.12.602-.077a.7.7 0 0 1 .477.365c.088.164.12.356.127.538.007.188-.012.396-.047.614-.084.51-.27 1.134-.52 1.794a10.954 10.954 0 0 0 .98 1.686 5.753 5.753 0 0 1 1.334.05c.364.066.734.195.96.465.12.144.193.32.2.518.007.192-.047.382-.138.563a1.04 1.04 0 0 1-.354.416.856.856 0 0 1-.51.138c-.331-.014-.654-.196-.933-.417a5.712 5.712 0 0 1-.911-.95 11.651 11.651 0 0 0-1.997.406 11.307 11.307 0 0 1-1.02 1.51c-.292.35-.609.656-.927.787a.793.793 0 0 1-.58.029zm1.379-1.901c-.166.076-.32.156-.459.238-.328.194-.541.383-.647.547-.094.145-.096.25-.04.361.01.022.02.036.026.044a.266.266 0 0 0 .035-.012c.137-.056.355-.235.635-.572a8.18 8.18 0 0 0 .45-.606zm1.64-1.33a12.71 12.71 0 0 1 1.01-.193 11.744 11.744 0 0 1-.51-.858 20.801 20.801 0 0 1-.5 1.05zm2.446.45c.15.163.296.3.435.41.24.19.407.253.498.256a.107.107 0 0 0 .07-.015.307.307 0 0 0 .094-.125.436.436 0 0 0 .059-.2.095.095 0 0 0-.026-.063c-.052-.062-.2-.152-.518-.209a3.876 3.876 0 0 0-.612-.053zM8.078 7.8a6.7 6.7 0 0 0 .2-.828c.031-.188.043-.343.038-.465a.613.613 0 0 0-.032-.198.517.517 0 0 0-.145.04c-.087.035-.158.106-.196.283-.04.192-.03.469.046.822.024.111.054.227.09.346z"/>
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
        title="Bold (Ctrl+B)"
        style={{ fontWeight: "bold", fontSize: "15px" }}
      >
        B
      </button>
      <button
        className="toolbar-btn icon-only"
        onClick={() => exec(toggleMark(schema.marks.italic))}
        title="Italic (Ctrl+I)"
        style={{ fontStyle: "italic", fontSize: "15px" }}
      >
        I
      </button>
      <button
        className="toolbar-btn icon-only"
        onClick={() => exec(toggleMark(schema.marks.code))}
        title="Inline Code (Ctrl+`)"
        style={{ fontFamily: "monospace", fontSize: "14px" }}
      >
        `
      </button>
      <button
        className="toolbar-btn icon-only"
        onClick={() => exec(toggleMark(schema.marks.strikethrough))}
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
        title="Bullet List"
      >
        <svg viewBox="0 0 16 16" fill="currentColor">
          <path fillRule="evenodd" d="M2 4a1 1 0 1 0 0-2 1 1 0 0 0 0 2zm3.75-1.5a.75.75 0 0 0 0 1.5h8.5a.75.75 0 0 0 0-1.5h-8.5zm0 5a.75.75 0 0 0 0 1.5h8.5a.75.75 0 0 0 0-1.5h-8.5zm0 5a.75.75 0 0 0 0 1.5h8.5a.75.75 0 0 0 0-1.5h-8.5zM2 9a1 1 0 1 0 0-2 1 1 0 0 0 0 2zm0 5a1 1 0 1 0 0-2 1 1 0 0 0 0 2z"/>
        </svg>
        List
      </button>
      <button
        className="toolbar-btn"
        onClick={() => exec(wrapInList(schema.nodes.ordered_list))}
        title="Ordered List"
      >
        <svg viewBox="0 0 16 16" fill="currentColor">
          <path fillRule="evenodd" d="M5 11.5a.5.5 0 0 1 .5-.5h9a.5.5 0 0 1 0 1h-9a.5.5 0 0 1-.5-.5zm0-4a.5.5 0 0 1 .5-.5h9a.5.5 0 0 1 0 1h-9a.5.5 0 0 1-.5-.5zm0-4a.5.5 0 0 1 .5-.5h9a.5.5 0 0 1 0 1h-9a.5.5 0 0 1-.5-.5z"/>
          <path d="M1.713 11.865v-.474H2c.217 0 .363-.137.363-.317 0-.185-.158-.31-.361-.31-.223 0-.367.152-.373.31h-.59c.016-.467.373-.787.986-.787.588-.002.954.291.957.703a.595.595 0 0 1-.492.594v.033a.615.615 0 0 1 .569.631c.003.533-.502.8-1.051.8-.656 0-1-.37-1.008-.794h.582c.008.178.186.306.422.309.254 0 .424-.145.422-.35-.002-.195-.155-.348-.414-.348h-.3zm-.004-4.699h-.604v-.035c0-.408.295-.844.958-.844.583 0 .96.326.96.756 0 .389-.257.617-.476.848l-.537.572v.03h1.054V9H1.143v-.395l.957-.99c.138-.142.293-.304.293-.508 0-.18-.147-.32-.342-.32a.33.33 0 0 0-.342.338v.041zM2.564 5h-.635V2.924h-.031l-.598.42v-.567l.629-.443h.635V5z"/>
        </svg>
        1. List
      </button>
      <button
        className="toolbar-btn"
        onClick={() => exec(wrapIn(schema.nodes.blockquote))}
        title="Blockquote"
      >
        <svg viewBox="0 0 16 16" fill="currentColor">
          <path d="M12 12a1 1 0 0 0 1-1V8.558a1 1 0 0 0-1-1h-1.388c0-.351.021-.703.062-1.054.062-.372.166-.703.31-.992.145-.29.331-.517.559-.683.227-.186.516-.279.868-.279V3c-.579 0-1.085.124-1.52.372a3.322 3.322 0 0 0-1.085.992 4.92 4.92 0 0 0-.62 1.458A7.712 7.712 0 0 0 9 7.558V11a1 1 0 0 0 1 1h2Zm-6 0a1 1 0 0 0 1-1V8.558a1 1 0 0 0-1-1H4.612c0-.351.021-.703.062-1.054.062-.372.166-.703.31-.992.145-.29.331-.517.559-.683.227-.186.516-.279.868-.279V3c-.579 0-1.085.124-1.52.372a3.322 3.322 0 0 0-1.085.992 4.92 4.92 0 0 0-.62 1.458A7.712 7.712 0 0 0 3 7.558V11a1 1 0 0 0 1 1h2Z"/>
        </svg>
        Quote
      </button>

      <div className="toolbar-separator" />

      {/* Blocks */}
      <button className="toolbar-btn" onClick={insertCodeBlock} title="Code Block">
        <svg viewBox="0 0 16 16" fill="currentColor">
          <path d="M10.478 1.647a.5.5 0 1 0-.956-.294l-4 13a.5.5 0 0 0 .956.294l4-13zM4.854 4.146a.5.5 0 0 1 0 .708L1.707 8l3.147 3.146a.5.5 0 0 1-.708.708l-3.5-3.5a.5.5 0 0 1 0-.708l3.5-3.5a.5.5 0 0 1 .708 0zm6.292 0a.5.5 0 0 0 0 .708L14.293 8l-3.147 3.146a.5.5 0 0 0 .708.708l3.5-3.5a.5.5 0 0 0 0-.708l-3.5-3.5a.5.5 0 0 0-.708 0z"/>
        </svg>
        Code
      </button>
      <button className="toolbar-btn" onClick={insertTableNode} title="Insert Table">
        <svg viewBox="0 0 16 16" fill="currentColor">
          <path d="M0 2a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2V2zm15 2h-4v3h4V4zm0 4h-4v3h4V8zm0 4h-4v3h3a1 1 0 0 0 1-1v-2zm-5 3v-3H6v3h4zm-5 0v-3H1v2a1 1 0 0 0 1 1h3zm-4-4h4V8H1v3zm0-4h4V4H1v3zm5-3v3h4V4H6zm4 4H6v3h4V8z"/>
        </svg>
        Table
      </button>
      <button className="toolbar-btn" onClick={insertMathInline} title="Inline Math">
        $…$
      </button>
      <button className="toolbar-btn" onClick={insertMathBlock} title="Math Block">
        $$…$$
      </button>
      <button className="toolbar-btn" onClick={insertHR} title="Horizontal Rule">
        —
      </button>

      <div className="toolbar-separator" />

      {/* Search & Theme */}
      <button className="toolbar-btn icon-only" onClick={onToggleSearch} title="Search (Ctrl+F)">
        <svg viewBox="0 0 16 16" fill="currentColor">
          <path d="M11.742 10.344a6.5 6.5 0 1 0-1.397 1.398h-.001c.03.04.062.078.098.115l3.85 3.85a1 1 0 0 0 1.415-1.414l-3.85-3.85a1.007 1.007 0 0 0-.115-.099zm-5.44 1.406a5.5 5.5 0 1 1 0-11 5.5 5.5 0 0 1 0 11z"/>
        </svg>
      </button>
      <button className="toolbar-btn" onClick={onOpenThemeSelector} title="Select Theme">
        <svg viewBox="0 0 16 16" fill="currentColor">
          <path d="M8 5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zm4 3a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM5.5 7a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0zm.5 6a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z"/>
          <path d="M16 8c0 3.15-1.866 2.585-3.567 2.07C11.42 9.763 10.465 9.473 10 10c-.603.683-.475 1.819-.351 2.92C9.826 14.495 9.996 16 8 16a8 8 0 1 1 8-8zm-8 7c.611 0 .654-.171.655-.176.078-.146.124-.464.07-1.119-.014-.168-.037-.37-.061-.591-.052-.464-.112-1.005-.118-1.462-.01-.707.083-1.61.704-2.314.369-.42.842-.63 1.31-.766.357-.104.745-.194 1.107-.279C15.066 8.479 15 8.36 15 8a7 7 0 1 0-7 7z"/>
        </svg>
        Theme
      </button>
    </div>
  );
};

export default Toolbar;
