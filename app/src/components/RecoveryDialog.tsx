import React from "react";

interface RecoveryDialogProps {
  filePath: string | null;
  onRestore: () => void;
  onDiscard: () => void;
}

const RecoveryDialog: React.FC<RecoveryDialogProps> = ({
  filePath,
  onRestore,
  onDiscard,
}) => {
  const fileName = filePath
    ? filePath.split("/").pop() || filePath
    : "Untitled document";

  return (
    <div className="modal-overlay">
      <div className="modal-dialog">
        <h2>Recover unsaved changes?</h2>
        <p>
          An autosaved version of <strong>{fileName}</strong> was found. Would
          you like to restore it, or start fresh?
        </p>
        <div className="modal-actions">
          <button className="modal-btn secondary" onClick={onDiscard}>
            Discard
          </button>
          <button className="modal-btn primary" onClick={onRestore}>
            Restore
          </button>
        </div>
      </div>
    </div>
  );
};

export default RecoveryDialog;
