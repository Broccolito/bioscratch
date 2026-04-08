import React, { useRef, useState } from "react";

export interface TabData {
  id: string;
  filePath: string | null;
  dirty: boolean;
}

interface TabBarProps {
  tabs: TabData[];
  activeId: string;
  deletedPaths?: Set<string>;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onNew: () => void;
  onReorder: (draggedId: string, targetId: string, before: boolean) => void;
  onDetach: (tabId: string) => void;
  onDragTabStart: (tabId: string) => void;
  onDragTabEnd: () => void;
}

function tabLabel(tab: TabData): string {
  if (!tab.filePath) return "blank.md";
  const parts = tab.filePath.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1];
}

const TabBar: React.FC<TabBarProps> = ({
  tabs,
  activeId,
  deletedPaths,
  onSelect,
  onClose,
  onNew,
  onReorder,
  onDetach,
  onDragTabStart,
  onDragTabEnd,
}) => {
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const [dropBefore, setDropBefore] = useState(true);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const tabBarRef = useRef<HTMLDivElement>(null);

  const startTabDrag = (e: React.MouseEvent, tabId: string) => {
    if (e.button !== 0) return;
    // Don't start drag when clicking the close button
    if ((e.target as HTMLElement).closest(".tab-close")) return;
    e.preventDefault();

    const startX = e.clientX;
    const startY = e.clientY;
    let isDragging = false;

    const handleMove = (ev: MouseEvent) => {
      if (!isDragging) {
        const dist = Math.hypot(ev.clientX - startX, ev.clientY - startY);
        if (dist < 6) return;
        isDragging = true;
        setDraggingId(tabId);
        onDragTabStart(tabId);
      }

      // Update drop-target indicator
      const bar = tabBarRef.current;
      if (!bar) return;
      const tabEls = Array.from(bar.querySelectorAll<HTMLElement>("[data-tab-id]"));
      let found = false;
      for (const el of tabEls) {
        if (el.dataset.tabId === tabId) continue;
        const rect = el.getBoundingClientRect();
        if (ev.clientX >= rect.left && ev.clientX <= rect.right) {
          setDropTargetId(el.dataset.tabId!);
          setDropBefore(ev.clientX < rect.left + rect.width / 2);
          found = true;
          break;
        }
      }
      if (!found) setDropTargetId(null);
    };

    const handleUp = (ev: MouseEvent) => {
      document.removeEventListener("mousemove", handleMove);
      document.removeEventListener("mouseup", handleUp);
      setDropTargetId(null);
      setDraggingId(null);

      if (!isDragging) {
        // Small movement — treat as a click
        onSelect(tabId);
        return;
      }

      onDragTabEnd();

      const bar = tabBarRef.current;
      const barRect = bar?.getBoundingClientRect();

      // Detach if dropped clearly below or above the tab bar
      if (barRect && (ev.clientY > barRect.bottom + 30 || ev.clientY < barRect.top - 30)) {
        if (tabs.length > 1) onDetach(tabId);
        return;
      }

      // Reorder if dropped on another tab
      if (bar) {
        const tabEls = Array.from(bar.querySelectorAll<HTMLElement>("[data-tab-id]"));
        for (const el of tabEls) {
          if (el.dataset.tabId === tabId) continue;
          const rect = el.getBoundingClientRect();
          if (
            ev.clientX >= rect.left &&
            ev.clientX <= rect.right &&
            ev.clientY >= rect.top - 10 &&
            ev.clientY <= rect.bottom + 10
          ) {
            onReorder(tabId, el.dataset.tabId!, ev.clientX < rect.left + rect.width / 2);
            return;
          }
        }
      }
    };

    document.addEventListener("mousemove", handleMove);
    document.addEventListener("mouseup", handleUp);
  };

  return (
    <div ref={tabBarRef} className="tab-bar">
      {tabs.map((tab) => {
        const isActive = tab.id === activeId;
        const isDeleted = !!(tab.filePath && deletedPaths?.has(tab.filePath));
        const isDropTarget = dropTargetId === tab.id;
        const isDragging = draggingId === tab.id;

        return (
          <div
            key={tab.id}
            data-tab-id={tab.id}
            className={[
              "tab",
              isActive ? "tab-active" : "",
              isDragging ? "tab-dragging" : "",
              isDropTarget && dropBefore ? "tab-insert-before" : "",
              isDropTarget && !dropBefore ? "tab-insert-after" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            onMouseDown={(e) => startTabDrag(e, tab.id)}
            title={tab.filePath || "Untitled"}
          >
            <span
              className={[
                "tab-label",
                tab.dirty ? "tab-dirty" : "",
                isDeleted ? "tab-deleted" : "",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              {tabLabel(tab)}
            </span>
            <button
              className="tab-close"
              onClick={(e) => {
                e.stopPropagation();
                onClose(tab.id);
              }}
              title="Close tab"
            >
              ×
            </button>
          </div>
        );
      })}
      <button className="tab-new" onClick={onNew} title="New tab (⌘T)">
        +
      </button>
    </div>
  );
};

export default TabBar;
