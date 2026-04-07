import React from "react";

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
}

function tabLabel(tab: TabData): string {
  if (!tab.filePath) return "blank.md";
  const parts = tab.filePath.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1];
}

const TabBar: React.FC<TabBarProps> = ({ tabs, activeId, deletedPaths, onSelect, onClose, onNew }) => {
  return (
    <div className="tab-bar">
      {tabs.map((tab) => {
        const isActive = tab.id === activeId;
        const isDeleted = !!(tab.filePath && deletedPaths?.has(tab.filePath));
        return (
          <div
            key={tab.id}
            className={`tab${isActive ? " tab-active" : ""}`}
            onClick={() => onSelect(tab.id)}
            title={tab.filePath || "Untitled"}
          >
            <span className={`tab-label${tab.dirty ? " tab-dirty" : ""}${isDeleted ? " tab-deleted" : ""}`}>
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
      <button className="tab-new" onClick={onNew} title="New tab (⌘N)">
        +
      </button>
    </div>
  );
};

export default TabBar;
