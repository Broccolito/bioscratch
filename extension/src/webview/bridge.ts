// bridge.ts — the single boundary between the webview (browser) and the VS Code
// extension host. Replaces the Tauri `invoke()` IPC of the desktop app.
//
// All host communication is funneled through `acquireVsCodeApi()` message passing.

export interface InitPayload {
  text: string;
  theme: string;
  matchVscodeTheme: boolean;
  vscodeKind: "light" | "dark" | "high-contrast";
  docName: string;
  userThemes: { filename: string; content: string }[];
  editDebounceMs: number;
}

interface VsCodeApi {
  postMessage(msg: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

export const vscode: VsCodeApi = acquireVsCodeApi();

// ---- Webview → Host -------------------------------------------------------

/** Send the serialized Markdown back to the host to apply as a WorkspaceEdit. */
export function postEdit(text: string): void {
  vscode.postMessage({ type: "edit", text });
}

/** Ask the host to open an external link in the system browser. */
export function openLink(href: string): void {
  vscode.postMessage({ type: "openLink", href });
}

/** Ask the host to save exported HTML via a native save dialog. */
export function saveHtml(filename: string, html: string): void {
  vscode.postMessage({ type: "saveHtml", filename, html });
}

/** Persist a user theme (YAML) in the extension's global storage. */
export function saveUserThemeHost(filename: string, content: string): void {
  vscode.postMessage({ type: "saveUserTheme", filename, content });
}

/** Delete a user theme from global storage. */
export function deleteUserThemeHost(filename: string): void {
  vscode.postMessage({ type: "deleteUserTheme", filename });
}

/** Ask the host to open a file picker and return YAML theme content. */
export function importUserThemeHost(): void {
  vscode.postMessage({ type: "importUserTheme" });
}

/** Persist the chosen Bioscratch theme name in extension global storage. */
export function setThemeHost(theme: string): void {
  vscode.postMessage({ type: "setTheme", theme });
}

/** Persist the "match VS Code theme" toggle in extension global storage. */
export function setMatchVscodeHost(value: boolean): void {
  vscode.postMessage({ type: "setMatchVscode", value });
}

/** Run VS Code's undo command against the underlying document. */
export function undoHost(): void {
  vscode.postMessage({ type: "undo" });
}

/** Run VS Code's redo command against the underlying document. */
export function redoHost(): void {
  vscode.postMessage({ type: "redo" });
}

// ---- Image resolution (request/response) ----------------------------------

const pendingImages = new Map<number, (uri: string) => void>();
let nextImageReq = 0;

/**
 * Resolve an image `src` to a URL loadable inside the webview.
 * Remote/data URLs pass through; local paths are converted by the host via
 * `webview.asWebviewUri` (resolved relative to the document's directory).
 */
export function resolveImageSrc(src: string): Promise<string> {
  if (!src) return Promise.resolve(src);
  if (
    src.startsWith("data:") ||
    src.startsWith("http://") ||
    src.startsWith("https://")
  ) {
    return Promise.resolve(src);
  }
  return new Promise((resolve) => {
    const id = ++nextImageReq;
    pendingImages.set(id, resolve);
    vscode.postMessage({ type: "resolveImage", requestId: id, src });
  });
}

// ---- Host → Webview -------------------------------------------------------

export interface ConfigPayload {
  theme: string;
  matchVscodeTheme: boolean;
  editDebounceMs: number;
}

type UpdateHandler = (text: string) => void;
type InitHandler = (payload: InitPayload) => void;
type ThemeHandler = (kind: "light" | "dark" | "high-contrast") => void;
type UserThemesHandler = (themes: { filename: string; content: string }[]) => void;
type ConfigHandler = (payload: ConfigPayload) => void;
export type WebviewCommand =
  | "find"
  | "exportHtml"
  | "selectTheme"
  | "toggleMatchVscode";
type CommandHandler = (command: WebviewCommand) => void;

let updateHandler: UpdateHandler | null = null;
let initHandler: InitHandler | null = null;
let themeHandler: ThemeHandler | null = null;
let userThemesHandler: UserThemesHandler | null = null;
let commandHandler: CommandHandler | null = null;
let configHandler: ConfigHandler | null = null;

export function onUpdate(cb: UpdateHandler): void { updateHandler = cb; }
export function onInit(cb: InitHandler): void { initHandler = cb; }
export function onVscodeTheme(cb: ThemeHandler): void { themeHandler = cb; }
export function onUserThemes(cb: UserThemesHandler): void { userThemesHandler = cb; }
export function onCommand(cb: CommandHandler): void { commandHandler = cb; }
export function onConfig(cb: ConfigHandler): void { configHandler = cb; }

window.addEventListener("message", (event) => {
  const msg = event.data;
  if (!msg || typeof msg !== "object") return;
  switch (msg.type) {
    case "init":
      initHandler?.(msg.payload as InitPayload);
      break;
    case "update":
      updateHandler?.(msg.text as string);
      break;
    case "resolveImageResult": {
      const resolve = pendingImages.get(msg.requestId);
      if (resolve) {
        pendingImages.delete(msg.requestId);
        resolve(msg.uri as string);
      }
      break;
    }
    case "vscodeTheme":
      themeHandler?.(msg.kind);
      break;
    case "userThemes":
      userThemesHandler?.(msg.themes as { filename: string; content: string }[]);
      break;
    case "command":
      commandHandler?.(msg.command as WebviewCommand);
      break;
    case "config":
      configHandler?.({
        theme: msg.theme as string,
        matchVscodeTheme: msg.matchVscodeTheme as boolean,
        editDebounceMs: msg.editDebounceMs as number,
      });
      break;
  }
});

/** Tell the host the webview has mounted and is ready for the initial document. */
export function signalReady(): void {
  vscode.postMessage({ type: "ready" });
}

// ---- Persisted webview state (scroll / theme cache) ------------------------

export function getWebviewState<T>(): T | undefined {
  return vscode.getState() as T | undefined;
}

export function setWebviewState(state: unknown): void {
  vscode.setState(state);
}
