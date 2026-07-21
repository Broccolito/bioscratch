import React, { useEffect, useRef } from "react";

interface CloseDocumentDialogProps {
  label: string;
  hasSavedFile: boolean;
  saving: boolean;
  onDelete: () => void;
  onCancel: () => void;
  onSave: () => void;
}

const CloseDocumentDialog: React.FC<CloseDocumentDialogProps> = ({
  label,
  hasSavedFile,
  saving,
  onDelete,
  onCancel,
  onSave,
}) => {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saving) {
        event.preventDefault();
        onCancel();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    cancelRef.current?.focus();
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onCancel, saving]);

  return (
    <div
      className="modal-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !saving) onCancel();
      }}
    >
      <div
        className="modal-dialog close-document-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="close-document-title"
        aria-describedby="close-document-description"
      >
        <h2 id="close-document-title">Save changes to “{label}”?</h2>
        <p id="close-document-description">
          {hasSavedFile
            ? "Delete discards the unsaved changes and closes the tab. The saved file remains on disk."
            : "Delete discards this unsaved document and closes the tab."}
        </p>
        <div className="modal-actions close-document-actions">
          <button
            className="modal-btn secondary close-document-delete"
            onClick={onDelete}
            disabled={saving}
          >
            Delete
          </button>
          <button
            ref={cancelRef}
            className="modal-btn secondary"
            onClick={onCancel}
            disabled={saving}
          >
            Cancel
          </button>
          <button
            className="modal-btn primary"
            onClick={onSave}
            disabled={saving}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default CloseDocumentDialog;
