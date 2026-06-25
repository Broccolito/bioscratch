// Maps Bioscratch's CSS custom properties onto VS Code's injected theme
// variables (`--vscode-*`). When "Match VS Code theme" is enabled the editor
// chrome tracks the active VS Code color theme instead of a Bioscratch theme.
//
// VS Code injects these variables into every webview and updates them live when
// the user switches color themes, so simply pointing our tokens at them is
// enough — no message round-trip needed for the colors themselves.

const VSCODE_VAR_MAP: Record<string, string> = {
  "bg-app": "--vscode-editor-background",
  "bg-toolbar": "--vscode-sideBar-background",
  "bg-editor": "--vscode-editor-background",
  "bg-statusbar": "--vscode-statusBar-background",

  "text-primary": "--vscode-editor-foreground",
  "text-secondary": "--vscode-descriptionForeground",
  "text-muted": "--vscode-disabledForeground",

  "border-color": "--vscode-panel-border",
  "border-subtle": "--vscode-widget-border",

  "accent": "--vscode-textLink-foreground",
  "accent-hover": "--vscode-textLink-activeForeground",
  "accent-bg": "--vscode-editor-selectionBackground",

  "code-bg": "--vscode-textCodeBlock-background",
  "code-inline-bg": "--vscode-textCodeBlock-background",
};

/** Point Bioscratch CSS vars at the live VS Code theme variables. */
export function applyVscodeTheme(kind: "light" | "dark" | "high-contrast"): void {
  const root = document.documentElement;
  root.setAttribute("data-theme", "vscode");
  root.setAttribute("data-color-scheme", kind === "light" ? "light" : "dark");
  for (const [token, vscodeVar] of Object.entries(VSCODE_VAR_MAP)) {
    root.style.setProperty(`--${token}`, `var(${vscodeVar})`);
  }
  // The editor font follows VS Code's configured editor font in this mode.
  root.style.setProperty("--editor-font", "var(--vscode-editor-font-family)");
}
