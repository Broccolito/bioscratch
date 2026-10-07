import React, { useEffect, useRef } from "react";

interface TrashConfirmDialogProps {
  name: string;
  isDir: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** "Move to Trash?" confirmation. Cancel has focus, so Enter/Esc never trash. */
const TrashConfirmDialog: React.FC<TrashConfirmDialogProps> = ({ name, isDir, onConfirm, onCancel }) => {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    cancelRef.current?.focus();
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onCancel]);

  return (
    <div
      className="modal-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div
        className="modal-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="trash-confirm-title"
        aria-describedby="trash-confirm-description"
      >
        <h2 id="trash-confirm-title">Move “{name}” to the Trash?</h2>
        <p id="trash-confirm-description">
          {isDir ? "This folder and everything in it will be moved to the Trash. " : ""}
          You can restore it from the Trash in Finder.
        </p>
        <div className="modal-actions">
          <button ref={cancelRef} className="modal-btn secondary" onClick={onCancel}>
            Cancel
          </button>
          <button className="modal-btn primary trash-confirm-btn" onClick={onConfirm}>
            Move to Trash
          </button>
        </div>
      </div>
    </div>
  );
};

export default TrashConfirmDialog;
