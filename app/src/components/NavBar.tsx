import React from "react";
import { breadcrumbs } from "../lib/workspace";

interface NavBarProps {
  filePath: string | null;
  /** Workspace folder containing `filePath`, if any. */
  root: string | null;
  canGoBack: boolean;
  canGoForward: boolean;
  /** Why navigation is disabled, shown as the buttons' tooltip. */
  blockedReason: string | null;
  onBack: () => void;
  onForward: () => void;
  onRevealFolder: (path: string) => void;
}

const MAX_CRUMBS = 5;

const NavBar: React.FC<NavBarProps> = ({
  filePath,
  root,
  canGoBack,
  canGoForward,
  blockedReason,
  onBack,
  onForward,
  onRevealFolder,
}) => {
  const all = filePath ? breadcrumbs(filePath, root) : [];
  // Long paths keep their head and tail: "Users › … › Lab › notes › a.md".
  const elided = all.length > MAX_CRUMBS;
  const crumbs = elided ? [all[0], ...all.slice(-(MAX_CRUMBS - 1))] : all;
  return (
    <div className="nav-bar">
      <button
        className="nav-bar-btn"
        onClick={onBack}
        disabled={!canGoBack}
        title={blockedReason ?? "Back (⌘[)"}
        aria-label="Back"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m15 18-6-6 6-6"/>
        </svg>
      </button>
      <button
        className="nav-bar-btn"
        onClick={onForward}
        disabled={!canGoForward}
        title={blockedReason ?? "Forward (⌘])"}
        aria-label="Forward"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m9 18 6-6-6-6"/>
        </svg>
      </button>
      <nav className="nav-bar-crumbs" aria-label="File path">
        {crumbs.length === 0 && <span className="nav-bar-crumb current">Untitled</span>}
        {crumbs.map((crumb, i) => {
          const last = i === crumbs.length - 1;
          // Folders inside a workspace can be revealed in the sidebar.
          const revealable = !last && root !== null && crumb.path.startsWith(root);
          return (
            <React.Fragment key={crumb.path}>
              {i > 0 && <span className="nav-bar-sep">›</span>}
              {elided && i === 1 && <><span className="nav-bar-crumb" title={filePath ?? ""}>…</span><span className="nav-bar-sep">›</span></>}
              {revealable ? (
                <button className="nav-bar-crumb" onClick={() => onRevealFolder(crumb.path)} title={`Show ${crumb.path} in sidebar`}>
                  {crumb.name}
                </button>
              ) : (
                <span className={`nav-bar-crumb${last ? " current" : ""}`} title={crumb.path}>{crumb.name}</span>
              )}
            </React.Fragment>
          );
        })}
      </nav>
    </div>
  );
};

export default NavBar;
