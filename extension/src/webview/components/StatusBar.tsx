import React from "react";

interface StatusBarProps {
  filePath: string | null;
  dirty: boolean;
  wordCount: number;
  charCount: number;
}

const StatusBar: React.FC<StatusBarProps> = ({
  filePath,
  dirty,
  wordCount,
  charCount,
}) => {
  const displayPath = filePath
    ? filePath.split("/").slice(-2).join("/")
    : "Blank";

  return (
    <div className="status-bar">
      <span className="filepath" title={filePath || "Blank"}>
        {displayPath}
      </span>
      {dirty && <span className="dirty-indicator">•</span>}
      <span>{wordCount.toLocaleString()} words</span>
      <span>{charCount.toLocaleString()} chars</span>
    </div>
  );
};

export default StatusBar;
