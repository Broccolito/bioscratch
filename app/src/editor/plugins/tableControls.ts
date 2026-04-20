import { Plugin, EditorState, Transaction, TextSelection } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import {
  addRowAfter,
  addColumnAfter,
  deleteRow,
  deleteColumn,
} from "prosemirror-tables";

type PmCmd = (state: EditorState, dispatch?: (tr: Transaction) => void) => boolean;

function execInCell(view: EditorView, cell: HTMLElement, cmd: PmCmd): void {
  const rect = cell.getBoundingClientRect();
  const coords = view.posAtCoords({
    left: (rect.left + rect.right) / 2,
    top: (rect.top + rect.bottom) / 2,
  });
  if (!coords) return;
  try {
    const $pos = view.state.doc.resolve(coords.pos);
    view.dispatch(view.state.tr.setSelection(TextSelection.near($pos, 1)));
    cmd(view.state, (tr) => view.dispatch(tr));
    view.focus();
  } catch {
    // ignore resolve errors
  }
}

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
      if (x >= r.left - LP && x <= r.right && y >= r.top - TP && y <= r.bottom) {
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

    const D  = 7;   // px from a boundary to trigger
    const LP = 32;  // left-zone half-width (covers outside + inside the left edge)
    const TP = 28;  // top-panel zone height (above the table)
    const B  = 9;   // centering offset (half button diameter)

    // Left zone: a band LP px wide centred on the table's left edge.
    // Covers both the area just outside the table (where mousemove only fires
    // because we listen on document) and the first LP px inside it.
    const inLeftZone  = x >= tr.left - LP && x <= tr.left + LP && y >= tr.top && y <= tr.bottom;
    const inTopPanel  = y >= tr.top - TP  && y < tr.top        && x >= tr.left && x <= tr.right;
    const insideTable = x >= tr.left && x <= tr.right && y >= tr.top && y <= tr.bottom;

    // ── LEFT ZONE (row controls) ─────────────────────────────────────────────
    if (inLeftZone) {
      // Row boundary → plus (insert row after)
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
      // Row center → minus (delete row)
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

    // ── TOP PANEL (column controls) ──────────────────────────────────────────
    if (inTopPanel) {
      // Column boundary → plus (insert column after)
      for (let i = 0; i < cols.length - 1; i++) {
        const bx = cols[i].getBoundingClientRect().right;
        if (Math.abs(x - bx) < D) {
          this.show("plus", bx - B, tr.top - B,
            () => execInCell(this.view, cols[i], addColumnAfter));
          return;
        }
      }
      // Column center → minus (delete column)
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

    // ── INSIDE TABLE (beyond left zone) ──────────────────────────────────────
    if (insideTable) {
      // Row boundaries: plus tracks cursor X along the horizontal divider
      for (let i = 0; i < rows.length - 1; i++) {
        const by = rows[i].getBoundingClientRect().bottom;
        if (Math.abs(y - by) < D) {
          const cell = rows[i].querySelector("td,th") as HTMLElement | null;
          if (cell) {
            this.view.dom.style.cursor = "pointer";
            this.show("plus", x - B, by - B,
              () => execInCell(this.view, cell, addRowAfter));
            return;
          }
        }
      }
      // Column boundaries: plus tracks cursor Y along the vertical divider
      for (let i = 0; i < cols.length - 1; i++) {
        const bx = cols[i].getBoundingClientRect().right;
        if (Math.abs(x - bx) < D) {
          this.view.dom.style.cursor = "pointer";
          this.show("plus", bx - B, y - B,
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

export function buildTableControlsPlugin(): Plugin {
  return new Plugin({
    view(editorView) {
      return new TableControlsView(editorView);
    },
  });
}
