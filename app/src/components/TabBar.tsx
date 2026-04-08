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
  if (!tab.filePath) return "Blank";
  const parts = tab.filePath.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1];
}

const DETACH_THRESHOLD = 24; // px below bar bottom to trigger detach

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
  const [dropTarget, setDropTarget] = useState<{ id: string; before: boolean } | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragGhost, setDragGhost] = useState<{
    x: number;
    y: number;
    label: string;
    detachReady: boolean;
  } | null>(null);

  const tabBarRef = useRef<HTMLDivElement>(null);
  // Ref mirror of dropTarget so handleUp reads the latest indicator state
  const dropTargetRef = useRef<{ id: string; before: boolean } | null>(null as { id: string; before: boolean } | null);

  const startTabDrag = (e: React.MouseEvent, tabId: string) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest(".tab-close")) return;
    e.preventDefault();

    const startX = e.clientX;
    const startY = e.clientY;
    let isDragging = false;

    const tab = tabs.find((t) => t.id === tabId);
    const label = tab ? tabLabel(tab) : tabId;

    const handleMove = (ev: MouseEvent) => {
      if (!isDragging) {
        const dist = Math.hypot(ev.clientX - startX, ev.clientY - startY);
        if (dist < 6) return;
        isDragging = true;
        setDraggingId(tabId);
        onDragTabStart(tabId);
      }

      const bar = tabBarRef.current;
      const barRect = bar?.getBoundingClientRect();

      // Ghost feedback when cursor leaves the bar
      if (barRect && ev.clientY > barRect.bottom + 4) {
        const detachReady = ev.clientY > barRect.bottom + DETACH_THRESHOLD;
        setDragGhost({ x: ev.clientX, y: ev.clientY, label, detachReady });
        dropTargetRef.current = null;
        setDropTarget(null);
        return;
      }
      setDragGhost(null);

      // Update insert indicator while within the bar
      if (!bar) return;
      const tabEls = Array.from(bar.querySelectorAll<HTMLElement>("[data-tab-id]"));
      let found: { id: string; before: boolean } | null = null;
      for (const el of tabEls) {
        if (el.dataset.tabId === tabId) continue;
        const rect = el.getBoundingClientRect();
        if (ev.clientX >= rect.left && ev.clientX <= rect.right) {
          found = {
            id: el.dataset.tabId!,
            before: ev.clientX < rect.left + rect.width / 2,
          };
          break;
        }
      }
      dropTargetRef.current = found;
      setDropTarget(found);
    };

    const handleUp = (ev: MouseEvent) => {
      document.removeEventListener("mousemove", handleMove);
      document.removeEventListener("mouseup", handleUp);

      // Capture before clearing
      const target = dropTargetRef.current;

      setDropTarget(null);
      setDraggingId(null);
      setDragGhost(null);
      dropTargetRef.current = null;

      if (!isDragging) {
        onSelect(tabId);
        return;
      }

      onDragTabEnd();

      const bar = tabBarRef.current;
      const barRect = bar?.getBoundingClientRect();

      // Detach if released past the threshold below the bar
      if (barRect && ev.clientY > barRect.bottom + DETACH_THRESHOLD) {
        if (tabs.length > 1) onDetach(tabId);
        return;
      }

      // Reorder using the last indicator position from mousemove
      if (target) {
        onReorder(tabId, target.id, target.before);
      }
    };

    document.addEventListener("mousemove", handleMove);
    document.addEventListener("mouseup", handleUp);
  };

  return (
    <>
      <div ref={tabBarRef} className="tab-bar">
        {tabs.map((tab) => {
          const isActive = tab.id === activeId;
          const isDeleted = !!(tab.filePath && deletedPaths?.has(tab.filePath));
          const isDragging = draggingId === tab.id;
          const isInsertBefore = dropTarget?.id === tab.id && dropTarget.before;
          const isInsertAfter = dropTarget?.id === tab.id && !dropTarget.before;

          return (
            <div
              key={tab.id}
              data-tab-id={tab.id}
              className={[
                "tab",
                isActive ? "tab-active" : "",
                isDragging ? "tab-dragging" : "",
                isInsertBefore ? "tab-insert-before" : "",
                isInsertAfter ? "tab-insert-after" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              onMouseDown={(e) => startTabDrag(e, tab.id)}
              title={tab.filePath || "Blank"}
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

      {dragGhost && (
        <div
          className={`tab-drag-ghost${dragGhost.detachReady ? " tab-drag-ghost-ready" : ""}`}
          style={{ left: dragGhost.x + 14, top: dragGhost.y + 14 }}
        >
          {dragGhost.detachReady ? `Open in new window` : dragGhost.label}
        </div>
      )}
    </>
  );
};

export default TabBar;
