import { Plugin, EditorState, Transaction, TextSelection } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { Node as PmNode } from "prosemirror-model";
import {
  addRowBefore,
  addRowAfter,
  addColumnBefore,
  addColumnAfter,
  deleteRow,
  deleteColumn,
  addColumn,
  removeColumn,
  TableMap,
} from "prosemirror-tables";

type PmCmd = (state: EditorState, dispatch?: (tr: Transaction) => void) => boolean;

function execInCell(view: EditorView, cell: HTMLElement, cmd: PmCmd): void {
  try {
    let cellDocPos = -1;
    let tableDocPos = -1;
    let tableNode: PmNode | null = null;

    view.state.doc.descendants((node, pos) => {
      if (cellDocPos !== -1) return false;
      const role = node.type.spec.tableRole as string | undefined;
      if (role === "table") {
        const dom = view.nodeDOM(pos);
        if (dom instanceof HTMLElement && dom.contains(cell)) {
          tableDocPos = pos;
          tableNode = node;
        } else {
          return false; // skip unrelated tables
        }
      } else if (role === "cell" || role === "header_cell") {
        if (view.nodeDOM(pos) === cell) { cellDocPos = pos; return false; }
      }
    });

    if (cellDocPos === -1) return;

    // Column operations: compute the column index directly from the TableMap
    // instead of relying on cursor placement, which can drift in empty cells
    // causing addColumnBefore/addColumnAfter to target the wrong column.
    if (tableNode !== null && tableDocPos !== -1 &&
        (cmd === addColumnBefore || cmd === addColumnAfter || cmd === deleteColumn)) {
      const tNode = tableNode as PmNode;
      const tableContentStart = tableDocPos + 1;
      const map = TableMap.get(tNode);
      const cellOffset = cellDocPos - tableContentStart;
      const rect = map.findCell(cellOffset);

      const tableRect = { ...rect, map, tableStart: tableContentStart, table: tNode };
      if (cmd === addColumnBefore) {
        view.dispatch(addColumn(view.state.tr, tableRect, rect.left));
      } else if (cmd === addColumnAfter) {
        view.dispatch(addColumn(view.state.tr, tableRect, rect.right));
      } else {
        const tr = view.state.tr;
        removeColumn(tr, tableRect, rect.left);
        view.dispatch(tr);
      }
      view.focus();
      return;
    }

    // Row operations use the selection-based approach; row detection is robust
    // to minor cursor drift since all cells in a row share the same rect.top.
    view.dispatch(view.state.tr.setSelection(
      TextSelection.create(view.state.doc, cellDocPos + 2)
    ));
    cmd(view.state, (tr) => view.dispatch(tr));
    view.focus();
  } catch (e) {
    console.error("[execInCell]", e);
  }
}

// ── Hover +/− controls ───────────────────────────────────────────────────────

class TableControlsView {
  private view: EditorView;
  private btn: HTMLElement;
  private hideTimer: ReturnType<typeof setTimeout> | null = null;
  private action: (() => void) | null = null;

  constructor(view: EditorView) {
    this.view = view;

    this.btn = document.createElement("div");
    this.btn.className = "table-ctrl-btn";
    this.btn.style.display = "none";
    document.body.appendChild(this.btn);

    this.btn.addEventListener("mouseenter", () => {
      if (this.hideTimer) { clearTimeout(this.hideTimer); this.hideTimer = null; }
    });
    this.btn.addEventListener("mouseleave", () => this.scheduleHide(150));
    this.btn.addEventListener("mousedown", (e) => { e.preventDefault(); e.stopPropagation(); });
    this.btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.action?.();
      this.hide();
    });

    // Listen on document so we can track the cursor in the left/top panel zones
    // which lie outside view.dom (the table fills view.dom edge-to-edge).
    document.addEventListener("mousemove", this.onMove);
  }

  private scheduleHide(ms = 150) {
    if (this.btn.style.display === "none") return;
    if (this.hideTimer) clearTimeout(this.hideTimer);
    this.hideTimer = setTimeout(() => this.hide(), ms);
  }

  private hide() {
    this.btn.style.display = "none";
    this.action = null;
    this.view.dom.style.cursor = "";
    if (this.hideTimer) { clearTimeout(this.hideTimer); this.hideTimer = null; }
  }

  private show(type: "plus" | "minus", left: number, top: number, action: () => void) {
    this.btn.textContent = type === "plus" ? "+" : "−";
    this.btn.className = `table-ctrl-btn table-ctrl-${type}`;
    this.btn.style.left = `${Math.round(left)}px`;
    this.btn.style.top = `${Math.round(top)}px`;
    this.btn.style.display = "flex";
    this.action = action;
    if (this.hideTimer) { clearTimeout(this.hideTimer); this.hideTimer = null; }
  }

  private tableAt(x: number, y: number): HTMLTableElement | null {
    const LP = 32, TP = 32;
    for (const t of Array.from(this.view.dom.querySelectorAll("table")) as HTMLTableElement[]) {
      const r = t.getBoundingClientRect();
      if (x >= r.left - LP && x <= r.right + LP && y >= r.top - TP && y <= r.bottom + TP) {
        return t;
      }
    }
    return null;
  }

  private onMove = (e: MouseEvent) => {
    const { clientX: x, clientY: y } = e;

    const table = this.tableAt(x, y);
    if (!table) { this.scheduleHide(); return; }
    if (this.hideTimer) { clearTimeout(this.hideTimer); this.hideTimer = null; }

    const tr   = table.getBoundingClientRect();
    const rows = Array.from(table.querySelectorAll("tr")) as HTMLTableRowElement[];
    const cols = rows[0]
      ? Array.from(rows[0].querySelectorAll("td,th")) as HTMLTableCellElement[]
      : [];

    const D  = 7;   // px from an inner boundary to trigger
    const LP = 32;  // left/right-zone half-width
    const TP = 28;  // top/bottom-panel zone height
    const B  = 9;   // centering offset (half button diameter)

    const inLeftZone    = x >= tr.left - LP   && x <= tr.left + LP   && y >= tr.top           && y <= tr.bottom;
    const inRightZone   = x >  tr.right - LP  && x <= tr.right + LP  && y >= tr.top           && y <= tr.bottom;
    const inTopPanel    = y >= tr.top - TP    && y <  tr.top         && x >= tr.left           && x <= tr.right;
    const inBottomPanel = y >  tr.bottom - TP && y <= tr.bottom + TP && x >= tr.left           && x <= tr.right;
    const insideTable   = x >= tr.left && x <= tr.right && y >= tr.top && y <= tr.bottom;

    // ── LEFT ZONE (row controls) ─────────────────────────────────────────────
    if (inLeftZone) {
      for (let i = 0; i < rows.length - 1; i++) {
        const by = rows[i].getBoundingClientRect().bottom;
        if (Math.abs(y - by) < D) {
          const cell = rows[i].querySelector("td,th") as HTMLElement | null;
          if (cell) {
            this.show("plus", tr.left - B, by - B,
              () => execInCell(this.view, cell, addRowAfter));
            return;
          }
        }
      }
      for (const row of rows) {
        const rr = row.getBoundingClientRect();
        if (y >= rr.top && y <= rr.bottom) {
          const cell = row.querySelector("td,th") as HTMLElement | null;
          if (cell) {
            this.show("minus", tr.left - B, (rr.top + rr.bottom) / 2 - B,
              () => execInCell(this.view, cell, deleteRow));
            return;
          }
        }
      }
      this.scheduleHide();
      return;
    }

    // ── RIGHT ZONE (add column at far right) ─────────────────────────────────
    if (inRightZone) {
      if (cols.length > 0) {
        const lastCol = cols[cols.length - 1];
        this.show("plus", tr.right - B, (tr.top + tr.bottom) / 2 - B,
          () => execInCell(this.view, lastCol, addColumnAfter));
        return;
      }
      this.scheduleHide();
      return;
    }

    // ── TOP PANEL (column controls) ──────────────────────────────────────────
    if (inTopPanel) {
      for (let i = 0; i < cols.length - 1; i++) {
        const bx = cols[i].getBoundingClientRect().right;
        if (Math.abs(x - bx) < D) {
          this.show("plus", bx - B, tr.top - B,
            () => execInCell(this.view, cols[i], addColumnAfter));
          return;
        }
      }
      for (const col of cols) {
        const cr = col.getBoundingClientRect();
        if (x >= cr.left && x <= cr.right) {
          this.show("minus", (cr.left + cr.right) / 2 - B, tr.top - B,
            () => execInCell(this.view, col, deleteColumn));
          return;
        }
      }
      this.scheduleHide();
      return;
    }

    // ── BOTTOM PANEL (add row at very bottom) ────────────────────────────────
    if (inBottomPanel) {
      if (rows.length > 0) {
        const lastRow = rows[rows.length - 1];
        const cell = lastRow.querySelector("td,th") as HTMLElement | null;
        if (cell) {
          this.show("plus", (tr.left + tr.right) / 2 - B, tr.bottom - B,
            () => execInCell(this.view, cell, addRowAfter));
          return;
        }
      }
      this.scheduleHide();
      return;
    }

    // ── INSIDE TABLE ─────────────────────────────────────────────────────────
    if (insideTable) {
      for (let i = 0; i < rows.length - 1; i++) {
        const by = rows[i].getBoundingClientRect().bottom;
        if (Math.abs(y - by) < D) {
          const cell = rows[i].querySelector("td,th") as HTMLElement | null;
          if (cell) {
            this.view.dom.style.cursor = "pointer";
            this.show("plus", (tr.left + tr.right) / 2 - B, by - B,
              () => execInCell(this.view, cell, addRowAfter));
            return;
          }
        }
      }
      for (let i = 0; i < cols.length - 1; i++) {
        const bx = cols[i].getBoundingClientRect().right;
        if (Math.abs(x - bx) < D) {
          this.view.dom.style.cursor = "pointer";
          this.show("plus", bx - B, (tr.top + tr.bottom) / 2 - B,
            () => execInCell(this.view, cols[i], addColumnAfter));
          return;
        }
      }
      this.view.dom.style.cursor = "";
      this.scheduleHide();
      return;
    }

    this.scheduleHide();
  };

  destroy() {
    this.btn.remove();
    document.removeEventListener("mousemove", this.onMove);
    if (this.hideTimer) clearTimeout(this.hideTimer);
  }
}

// ── Right-click context menu ─────────────────────────────────────────────────

type MenuItem =
  | { label: string; action: () => void; danger?: boolean }
  | { separator: true };

class TableContextMenuView {
  private view: EditorView;
  private menu: HTMLElement;

  constructor(view: EditorView) {
    this.view = view;

    this.menu = document.createElement("div");
    this.menu.className = "table-ctx-menu";
    this.menu.style.display = "none";
    document.body.appendChild(this.menu);

    // contextmenu with capture fires before WKWebView acts on the gesture —
    // calling preventDefault + stopImmediatePropagation suppresses the native menu.
    document.addEventListener("contextmenu", this.onContextMenu, true);
    document.addEventListener("mousedown", this.onDocMouseDown, true);
    document.addEventListener("keydown", this.onKeyDown, true);
  }

  private cellFromTarget(target: EventTarget | null): HTMLElement | null {
    let el = target as HTMLElement | null;
    while (el && el !== document.body) {
      if ((el.tagName === "TD" || el.tagName === "TH") && this.view.dom.contains(el)) return el;
      el = el.parentElement;
    }
    return null;
  }

  private onContextMenu = (e: MouseEvent) => {
    const cell = this.cellFromTarget(e.target);
    if (!cell) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    this.buildMenu(cell);
    this.positionAndShow(e.clientX, e.clientY);
  };

  private onDocMouseDown = (e: MouseEvent) => {
    if (e.button === 2) return; // right-click is handled by onContextMenu
    if (this.menu.style.display !== "none" && !this.menu.contains(e.target as Node)) {
      this.hide();
    }
  };

  private buildMenu(cell: HTMLElement) {
    const items: MenuItem[] = [
      { label: "Insert row above",   action: () => execInCell(this.view, cell, addRowBefore) },
      { label: "Insert row below",   action: () => execInCell(this.view, cell, addRowAfter) },
      { separator: true },
      { label: "Insert column left",  action: () => execInCell(this.view, cell, addColumnBefore) },
      { label: "Insert column right", action: () => execInCell(this.view, cell, addColumnAfter) },
      { separator: true },
      { label: "Delete row",    action: () => execInCell(this.view, cell, deleteRow),    danger: true },
      { label: "Delete column", action: () => execInCell(this.view, cell, deleteColumn), danger: true },
    ];

    this.menu.innerHTML = "";
    for (const item of items) {
      if ("separator" in item) {
        const sep = document.createElement("div");
        sep.className = "table-ctx-sep";
        this.menu.appendChild(sep);
      } else {
        const btn = document.createElement("button");
        btn.className = "table-ctx-item" + (item.danger ? " table-ctx-danger" : "");
        btn.textContent = item.label;
        btn.addEventListener("mousedown", (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          item.action();
          this.hide();
        });
        this.menu.appendChild(btn);
      }
    }
  }

  private positionAndShow(x: number, y: number) {
    this.menu.style.left = "0px";
    this.menu.style.top = "-9999px";
    this.menu.style.display = "block";
    const w = this.menu.offsetWidth || 192;
    const h = this.menu.offsetHeight || 220;
    const left = x + w > window.innerWidth  ? x - w : x + 2;
    const top  = y + h > window.innerHeight ? y - h : y + 2;
    this.menu.style.left = `${Math.max(0, left)}px`;
    this.menu.style.top  = `${Math.max(0, top)}px`;
  }

  private hide() {
    this.menu.style.display = "none";
  }

  private onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") this.hide();
  };

  destroy() {
    this.menu.remove();
    document.removeEventListener("contextmenu", this.onContextMenu, true);
    document.removeEventListener("mousedown", this.onDocMouseDown, true);
    document.removeEventListener("keydown", this.onKeyDown, true);
  }
}

// ── Plugin ───────────────────────────────────────────────────────────────────

export function buildTableControlsPlugin(): Plugin {
  return new Plugin({
    view(editorView) {
      const controls    = new TableControlsView(editorView);
      const contextMenu = new TableContextMenuView(editorView);
      return {
        destroy() {
          controls.destroy();
          contextMenu.destroy();
        },
      };
    },
  });
}
