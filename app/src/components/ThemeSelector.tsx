import React, { useEffect, useRef } from "react";
import {
  ThemeName,
  builtinThemeConfigs,
  getThemeDisplayName,
  getThemeSwatches,
  isDarkTheme,
  BUILTIN_THEME_RAWS,
} from "../lib/themeLoader";

export interface UserThemeMap {
  [filename: string]: Record<string, string>;
}

interface ThemeSelectorProps {
  currentTheme: ThemeName;
  userThemeVars: UserThemeMap;
  onSelect: (theme: ThemeName) => void;
  onClose: () => void;
  onImport: () => void;
  onDeleteUserTheme: (filename: string) => void;
}

// Built-in theme ids in display order
const BUILTIN_IDS = BUILTIN_THEME_RAWS.map(([id]) => id);

const ThemeSelector: React.FC<ThemeSelectorProps> = ({
  currentTheme,
  userThemeVars,
  onSelect,
  onClose,
  onImport,
  onDeleteUserTheme,
}) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  const userThemeIds = Object.keys(userThemeVars);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  // Focus dialog on open
  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  return (
    <div
      className="theme-selector-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="theme-selector-dialog"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Select Theme"
        tabIndex={-1}
      >
        {/* Header */}
        <div className="theme-selector-header">
          <span className="theme-selector-title">Select Theme</span>
          <button
            className="theme-selector-close"
            onClick={onClose}
            aria-label="Close"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="15" height="15">
              <path d="M18 6 6 18"/><path d="m6 6 12 12"/>
            </svg>
          </button>
        </div>

        {/* Scrollable card grid */}
        <div className="theme-selector-scroll">
          {/* Built-in themes */}
          <div className="theme-selector-section-label">Built-in</div>
          <div className="theme-selector-cards">
            {BUILTIN_IDS.map((id) => {
              const vars = builtinThemeConfigs[id];
              const displayName = getThemeDisplayName(vars, id);
              const swatches = getThemeSwatches(vars);
              const isActive = id === currentTheme;
              return (
                <ThemeCard
                  key={id}
                  id={id}
                  displayName={displayName}
                  swatches={swatches}
                  isActive={isActive}
                  isDark={isDarkTheme(id)}
                  onSelect={() => onSelect(id)}
                />
              );
            })}
          </div>

          {/* User themes */}
          {userThemeIds.length > 0 && (
            <>
              <div className="theme-selector-section-label">My Themes</div>
              <div className="theme-selector-cards">
                {userThemeIds.map((filename) => {
                  const vars = userThemeVars[filename];
                  const id = `user:${filename}`;
                  const displayName = getThemeDisplayName(vars, filename.replace(/\.yaml$/, ""));
                  const swatches = getThemeSwatches(vars);
                  const isActive = currentTheme === id;
                  return (
                    <ThemeCard
                      key={filename}
                      id={id}
                      displayName={displayName}
                      swatches={swatches}
                      isActive={isActive}
                      isDark={isDarkTheme(filename.replace(/\.yaml$/, ""))}
                      onSelect={() => onSelect(id)}
                      onDelete={() => onDeleteUserTheme(filename)}
                    />
                  );
                })}
              </div>
            </>
          )}
        </div>

        {/* Footer with import button */}
        <div className="theme-selector-footer">
          <button className="theme-import-btn" onClick={onImport}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
              <path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/>
            </svg>
            Import Theme
          </button>
        </div>
      </div>
    </div>
  );
};

interface ThemeCardProps {
  id: string;
  displayName: string;
  swatches: string[];
  isActive: boolean;
  isDark: boolean;
  onSelect: () => void;
  onDelete?: () => void;
}

const ThemeCard: React.FC<ThemeCardProps> = ({
  displayName,
  swatches,
  isActive,
  isDark,
  onSelect,
  onDelete,
}) => (
  <div className={`theme-card${isActive ? " theme-card--active" : ""}`}>
    {/* Delete button for user themes */}
    {onDelete && (
      <button
        className="theme-card-delete"
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        aria-label="Remove theme"
        title="Remove theme"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" width="11" height="11">
          <path d="M18 6 6 18"/><path d="m6 6 12 12"/>
        </svg>
      </button>
    )}

    <button
      className="theme-card-inner"
      onClick={onSelect}
      aria-pressed={isActive}
    >
      {/* Color preview */}
      <div className="theme-card-preview">
        <ThemePreview swatches={swatches} isDark={isDark} />
      </div>

      {/* Label */}
      <div className="theme-card-footer">
        <div className="theme-card-name">{displayName}</div>
      </div>

      {/* Active checkmark */}
      {isActive && (
        <div className="theme-card-check" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" width="13" height="13">
            <path d="M20 6 9 17l-5-5"/>
          </svg>
        </div>
      )}
    </button>
  </div>
);

/** Mini editor-surface preview using actual theme swatch colors. */
const ThemePreview: React.FC<{ swatches: string[]; isDark: boolean }> = ({
  swatches,
  isDark,
}) => {
  const [editorBg, toolbarBg, accent, textPrimary] = swatches;
  const textMuted = isDark ? "rgba(255,255,255,0.25)" : "rgba(0,0,0,0.18)";
  const borderColor = isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.10)";

  return (
    <div
      className="theme-preview-frame"
      style={{ background: toolbarBg, borderColor }}
    >
      {/* Fake toolbar strip */}
      <div
        className="theme-preview-toolbar"
        style={{ background: toolbarBg, borderBottomColor: borderColor }}
      >
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="theme-preview-pill"
            style={{ background: i === 2 ? accent : textMuted, opacity: i === 2 ? 0.6 : 1 }}
          />
        ))}
      </div>
      {/* Fake editor body */}
      <div className="theme-preview-body" style={{ background: editorBg }}>
        <div className="theme-preview-line theme-preview-line--heading" style={{ background: textPrimary, opacity: 0.75 }} />
        <div className="theme-preview-line" style={{ background: textPrimary, opacity: 0.25, width: "82%" }} />
        <div className="theme-preview-line" style={{ background: textPrimary, opacity: 0.25, width: "68%" }} />
        <div className="theme-preview-line" style={{ background: accent, opacity: 0.55, width: "48%" }} />
        <div className="theme-preview-line" style={{ background: textPrimary, opacity: 0.18, width: "58%" }} />
      </div>
    </div>
  );
};

export default ThemeSelector;
