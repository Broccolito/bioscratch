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
  // Track whether the drag ended on a valid in-bar drop target
  const droppedInBarRef = useRef(false);
  // Track whether the drag actually left the tab bar area
  const leftBarRef = useRef(false);
  const tabBarRef = useRef<HTMLDivElement>(null);

  return (
    <div
      ref={tabBarRef}
      className="tab-bar"
      onDragOver={(e) => {
        // Allow drop on the bar's empty space (after last tab) for reordering
        if (dragSourceId.current) e.preventDefault();
      }}
      onDrop={(e) => {
        // Dropping on empty space in the bar counts as an in-bar drop (no detach)
        if (dragSourceId.current) {
          e.preventDefault();
          droppedInBarRef.current = true;
        }
      }}
      onDragEnter={() => {
        // Drag came back into the bar — cancel any pending detach
        if (dragSourceId.current) leftBarRef.current = false;
      }}
      onDragLeave={(e) => {
        // Only mark as left if the drag moved to something outside the bar
        if (
          dragSourceId.current &&
          !tabBarRef.current?.contains(e.relatedTarget as Node)
        ) {
          leftBarRef.current = true;
        }
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
              const wasDroppedInBar = droppedInBarRef.current;
              const didLeaveBar = leftBarRef.current;

              dragSourceId.current = null;
              droppedInBarRef.current = false;
              leftBarRef.current = false;
              setDropTargetId(null);
              onDragTabEnd();
              // Only detach if the drag actually left the tab bar
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
