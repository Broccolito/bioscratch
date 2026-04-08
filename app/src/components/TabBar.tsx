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
  const dragSourceId = useRef<string | null>(null);
  const droppedInBarRef = useRef(false);
  // Whether the drag went far enough outside the bar to warrant detaching
  const leftBarRef = useRef(false);
  const tabBarRef = useRef<HTMLDivElement>(null);
  // document-level dragover listener attached during a tab drag
  const docDragOverRef = useRef<((e: DragEvent) => void) | null>(null);

  return (
    <div
      ref={tabBarRef}
      className="tab-bar"
      onDragOver={(e) => {
        if (dragSourceId.current) e.preventDefault();
      }}
    >
      {tabs.map((tab) => {
        const isActive = tab.id === activeId;
        const isDeleted = !!(tab.filePath && deletedPaths?.has(tab.filePath));
        const isDropTarget = dropTargetId === tab.id;

        return (
          <div
            key={tab.id}
            className={[
              "tab",
              isActive ? "tab-active" : "",
              isDropTarget && dropBefore ? "tab-insert-before" : "",
              isDropTarget && !dropBefore ? "tab-insert-after" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            draggable
            onDragStart={(e) => {
              dragSourceId.current = tab.id;
              droppedInBarRef.current = false;
              leftBarRef.current = false;
              e.dataTransfer.setData("tab-id", tab.id);
              e.dataTransfer.effectAllowed = "move";
              setTimeout(() => onDragTabStart(tab.id), 0);

              // Track position during drag via document dragover (has correct coords)
              const listener = (ev: DragEvent) => {
                const bar = tabBarRef.current;
                if (!bar) return;
                const rect = bar.getBoundingClientRect();
                if (
                  ev.clientY < rect.top - 30 ||
                  ev.clientY > rect.bottom + 30
                ) {
                  leftBarRef.current = true;
                }
              };
              docDragOverRef.current = listener;
              document.addEventListener("dragover", listener);
            }}
            onDragOver={(e) => {
              if (dragSourceId.current === tab.id) return;
              e.preventDefault();
              e.stopPropagation();
              e.dataTransfer.dropEffect = "move";
              const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
              setDropTargetId(tab.id);
              setDropBefore(e.clientX < rect.left + rect.width / 2);
            }}
            onDragLeave={() => {
              setDropTargetId(null);
            }}
            onDrop={(e) => {
              e.preventDefault();
              e.stopPropagation();
              droppedInBarRef.current = true;
              const draggedId = e.dataTransfer.getData("tab-id");
              if (draggedId && draggedId !== tab.id) {
                const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                onReorder(draggedId, tab.id, e.clientX < rect.left + rect.width / 2);
              }
              setDropTargetId(null);
            }}
            onDragEnd={() => {
              // Tear down position tracker
              if (docDragOverRef.current) {
                document.removeEventListener("dragover", docDragOverRef.current);
                docDragOverRef.current = null;
              }

              const wasDroppedInBar = droppedInBarRef.current;
              const didLeaveBar = leftBarRef.current;

              dragSourceId.current = null;
              droppedInBarRef.current = false;
              leftBarRef.current = false;
              setDropTargetId(null);
              onDragTabEnd();
              // Detach only if the drag clearly left the bar area
              if (!wasDroppedInBar && didLeaveBar && tabs.length > 1) {
                onDetach(tab.id);
              }
            }}
            onClick={() => onSelect(tab.id)}
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
