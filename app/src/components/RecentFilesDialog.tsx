import React, { useEffect, useRef } from "react";

interface RecentFilesDialogProps {
  files: string[];
  onOpen: (path: string) => void | Promise<void>;
  onRemove: (path: string) => void;
  onBrowse: () => void;
  onClose: () => void;
}

function fileName(path: string): string {
  return path.split("/").filter(Boolean).pop() || path;
}

function parentPath(path: string): string {
  const parts = path.split("/");
  parts.pop();
  return parts.join("/") || "/";
}

const RecentFilesDialog: React.FC<RecentFilesDialogProps> = ({
  files,
  onOpen,
  onRemove,
  onBrowse,
  onClose,
}) => {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    dialogRef.current?.focus();
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div
      className="recent-files-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="recent-files-dialog"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="recent-files-title"
        tabIndex={-1}
      >
        <div className="recent-files-header">
          <span id="recent-files-title" className="recent-files-title">Open Recent</span>
          <button className="recent-files-close" onClick={onClose} aria-label="Close">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="15" height="15" aria-hidden="true">
              <path d="M18 6 6 18"/><path d="m6 6 12 12"/>
            </svg>
          </button>
        </div>

        <div className="recent-files-list">
          {files.length === 0 ? (
            <div className="recent-files-empty">No recently opened files yet.</div>
          ) : files.map((path) => (
            <div className="recent-file-row" key={path}>
              <button className="recent-file-open" onClick={() => onOpen(path)} title={path}>
                <span className="recent-file-name">{fileName(path)}</span>
                <span className="recent-file-parent">{parentPath(path)}</span>
              </button>
              <button
                className="recent-file-remove"
                onClick={() => onRemove(path)}
                aria-label={`Remove ${fileName(path)} from recent files`}
                title="Remove from recent files"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="13" height="13" aria-hidden="true">
                  <path d="M18 6 6 18"/><path d="m6 6 12 12"/>
                </svg>
              </button>
            </div>
          ))}
        </div>

        <div className="recent-files-footer">
          <button
            className="recent-files-browse"
            onClick={() => {
              onClose();
              onBrowse();
            }}
          >
            Browse…
          </button>
        </div>
      </div>
    </div>
  );
};

export default RecentFilesDialog;
