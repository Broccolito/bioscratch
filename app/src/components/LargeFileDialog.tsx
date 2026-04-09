import React from "react";

interface LargeFileDialogProps {
  path: string;
  byteSize: number;
  onConfirm: () => void;
  onCancel: () => void;
}

const LargeFileDialog: React.FC<LargeFileDialogProps> = ({ path, byteSize, onConfirm, onCancel }) => {
  const filename = path.split(/[\\/]/).pop() ?? path;
  const mb = (byteSize / 1_000_000).toFixed(1);
  return (
    <div className="modal-overlay">
      <div className="modal-dialog">
        <h2>Large File</h2>
        <p>
          <strong>{filename}</strong> is {mb} MB. Loading large files may be
          slow or cause the editor to become unresponsive.
        </p>
        <div className="modal-actions">
          <button className="modal-btn secondary" onClick={onCancel}>
            Cancel
          </button>
          <button className="modal-btn primary" onClick={onConfirm}>
            Open Anyway
          </button>
        </div>
      </div>
    </div>
  );
};

export default LargeFileDialog;
