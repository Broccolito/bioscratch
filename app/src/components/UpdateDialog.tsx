import React, { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

interface UpdateInfo {
  current_version: string;
  latest_version: string;
  is_update_available: boolean;
  download_url: string | null;
  release_url: string | null;
  release_notes: string | null;
}

type Status =
  | { kind: "checking" }
  | { kind: "error"; message: string }
  | { kind: "up-to-date"; version: string }
  | { kind: "available"; info: UpdateInfo }
  | { kind: "downloading" }
  | { kind: "done" };

interface UpdateDialogProps {
  onClose: () => void;
}

const UpdateDialog: React.FC<UpdateDialogProps> = ({ onClose }) => {
  const [status, setStatus] = useState<Status>({ kind: "checking" });

  useEffect(() => {
    invoke<UpdateInfo>("check_for_updates")
      .then((info) => {
        if (info.is_update_available) {
          setStatus({ kind: "available", info });
        } else {
          setStatus({ kind: "up-to-date", version: info.current_version });
        }
      })
      .catch((e) => setStatus({ kind: "error", message: String(e) }));
  }, []);

  const handleDownload = async (info: UpdateInfo) => {
    if (!info.download_url) {
      // No direct download — open release page
      await invoke("open_url", { url: info.release_url ?? "https://github.com/Broccolito/bioscratch/releases" });
      return;
    }
    setStatus({ kind: "downloading" });
    try {
      await invoke("download_and_install", { url: info.download_url });
      setStatus({ kind: "done" });
    } catch (e) {
      setStatus({ kind: "error", message: String(e) });
    }
  };

  const handleQuit = () => invoke("quit_app");

  const handleOpenGitHub = (url: string) =>
    invoke("open_url", { url });

  return (
    <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-dialog" style={{ maxWidth: 460 }}>
        <h2>Check for Updates</h2>

        {status.kind === "checking" && (
          <p style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <SpinnerIcon />
            Checking for updates…
          </p>
        )}

        {status.kind === "error" && (
          <>
            <p style={{ color: "var(--text-secondary)" }}>
              Could not check for updates. Please check your internet connection.
            </p>
            <p style={{ fontSize: 12, fontFamily: "monospace", color: "var(--text-secondary)", wordBreak: "break-all" }}>
              {status.message}
            </p>
            <div className="modal-actions">
              <button className="modal-btn secondary" onClick={onClose}>Close</button>
              <button
                className="modal-btn primary"
                onClick={() => {
                  setStatus({ kind: "checking" });
                  invoke<UpdateInfo>("check_for_updates")
                    .then((info) =>
                      info.is_update_available
                        ? setStatus({ kind: "available", info })
                        : setStatus({ kind: "up-to-date", version: info.current_version })
                    )
                    .catch((e) => setStatus({ kind: "error", message: String(e) }));
                }}
              >
                Try Again
              </button>
            </div>
          </>
        )}

        {status.kind === "up-to-date" && (
          <>
            <p>Bioscratch <strong>v{status.version}</strong> is up to date.</p>
            <div className="modal-actions">
              <button className="modal-btn primary" onClick={onClose}>OK</button>
            </div>
          </>
        )}

        {status.kind === "available" && (
          <>
            <p>
              A new version of Bioscratch is available:{" "}
              <strong>v{status.info.latest_version}</strong>{" "}
              <span style={{ color: "var(--text-secondary)", fontSize: 12 }}>
                (current: v{status.info.current_version})
              </span>
            </p>
            {status.info.release_notes && (
              <div style={{
                background: "var(--toolbar-btn-hover)",
                border: "1px solid var(--border-color)",
                borderRadius: 4,
                padding: "8px 10px",
                marginBottom: 16,
                fontSize: 12,
                color: "var(--text-secondary)",
                maxHeight: 120,
                overflowY: "auto",
                lineHeight: 1.5,
                whiteSpace: "pre-wrap",
              }}>
                {status.info.release_notes}
              </div>
            )}
            <div className="modal-actions" style={{ flexWrap: "wrap" }}>
              <button className="modal-btn secondary" onClick={onClose}>Not Now</button>
              {status.info.release_url && (
                <button
                  className="modal-btn secondary"
                  onClick={() => handleOpenGitHub(status.info.release_url!)}
                >
                  View on GitHub
                </button>
              )}
              <button
                className="modal-btn primary"
                onClick={() => handleDownload(status.info)}
              >
                {status.info.download_url ? "Download & Install" : "Open Release Page"}
              </button>
            </div>
          </>
        )}

        {status.kind === "downloading" && (
          <p style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <SpinnerIcon />
            Downloading update… this may take a moment.
          </p>
        )}

        {status.kind === "done" && (
          <>
            <p>
              The installer has been downloaded and opened. Drag <strong>Bioscratch</strong>{" "}
              from the installer to your Applications folder to complete the update.
            </p>
            <div className="modal-actions">
              <button className="modal-btn secondary" onClick={onClose}>Later</button>
              <button className="modal-btn primary" onClick={handleQuit}>
                Quit Bioscratch
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

const SpinnerIcon: React.FC = () => (
  <svg
    width="14" height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    strokeLinecap="round"
    style={{ animation: "spin 0.8s linear infinite", flexShrink: 0 }}
  >
    <circle cx="12" cy="12" r="10" strokeOpacity="0.25" />
    <path d="M12 2a10 10 0 0 1 10 10" />
  </svg>
);

export default UpdateDialog;
