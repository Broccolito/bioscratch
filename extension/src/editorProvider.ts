import * as vscode from "vscode";
import * as path from "path";

const USER_THEMES_KEY = "bioscratch.userThemes";

type UserThemes = Record<string, string>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizedThemeFilename(filename: string): string | null {
  const base = path.basename(filename).slice(0, 128);
  const safe = base.replace(/[^a-zA-Z0-9._-]/g, "_");
  if (!safe || safe === "." || safe === "..") return null;
  return /\.ya?ml$/i.test(safe) ? safe : `${safe}.yaml`;
}

function normalizedHtmlFilename(filename: string): string {
  const base = path.basename(filename).slice(0, 128) || "document.html";
  const safe = base.replace(/[^a-zA-Z0-9._ -]/g, "_");
  return /\.html?$/i.test(safe) ? safe : `${safe}.html`;
}

function config() {
  return vscode.workspace.getConfiguration("bioscratch");
}

function getNonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let text = "";
  for (let i = 0; i < 32; i++) text += chars.charAt(Math.floor(Math.random() * chars.length));
  return text;
}

function vscodeKind(): "light" | "dark" | "high-contrast" {
  switch (vscode.window.activeColorTheme.kind) {
    case vscode.ColorThemeKind.Light:
      return "light";
    case vscode.ColorThemeKind.HighContrast:
    case vscode.ColorThemeKind.HighContrastLight:
      return "high-contrast";
    default:
      return "dark";
  }
}

/**
 * Bioscratch WYSIWYG Markdown editor — a CustomTextEditorProvider that hosts the
 * ported ProseMirror app inside a webview bound to the underlying `.md`
 * TextDocument. VS Code owns the file, save, hot-exit, and undo/redo; the
 * webview owns the pretty editing surface. They sync over postMessage.
 */
export class BioscratchEditorProvider implements vscode.CustomTextEditorProvider {
  public static readonly viewType = "bioscratch.markdownEditor";

  /** The webview that most recently became active — target for menu commands. */
  private activePanel: vscode.WebviewPanel | null = null;

  public static register(context: vscode.ExtensionContext): vscode.Disposable {
    const provider = new BioscratchEditorProvider(context);
    const disposables: vscode.Disposable[] = [];

    disposables.push(
      vscode.window.registerCustomEditorProvider(
        BioscratchEditorProvider.viewType,
        provider,
        {
          webviewOptions: { retainContextWhenHidden: true },
          supportsMultipleEditorsPerDocument: false,
        }
      )
    );

    // Menu / palette commands forward an intent into the active webview.
    const forward = (command: string) =>
      vscode.commands.registerCommand(command, () => provider.postCommand(command));
    disposables.push(forward("bioscratch.find"));
    disposables.push(forward("bioscratch.exportHtml"));
    disposables.push(forward("bioscratch.selectTheme"));
    disposables.push(forward("bioscratch.toggleMatchVscode"));

    return vscode.Disposable.from(...disposables);
  }

  constructor(private readonly context: vscode.ExtensionContext) {}

  private postCommand(fullCommand: string): void {
    const map: Record<string, string> = {
      "bioscratch.find": "find",
      "bioscratch.exportHtml": "exportHtml",
      "bioscratch.selectTheme": "selectTheme",
      "bioscratch.toggleMatchVscode": "toggleMatchVscode",
    };
    const command = map[fullCommand];
    if (command && this.activePanel) {
      this.activePanel.webview.postMessage({ type: "command", command });
    }
  }

  public async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken
  ): Promise<void> {
    const docDir = vscode.Uri.file(path.dirname(document.uri.fsPath));

    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        this.context.extensionUri,
        docDir,
      ],
    };
    webviewPanel.webview.html = this.getHtml(webviewPanel.webview);

    if (webviewPanel.active) this.activePanel = webviewPanel;
    webviewPanel.onDidChangeViewState((e) => {
      if (e.webviewPanel.active) this.activePanel = webviewPanel;
    });

    const post = (msg: unknown) => webviewPanel.webview.postMessage(msg);

    // Document → webview. Fires for external edits and our own WorkspaceEdits.
    const changeSub = vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.toString() === document.uri.toString()) {
        post({ type: "update", text: document.getText() });
      }
    });

    // Live theme tracking for "Match VS Code theme" mode.
    const themeSub = vscode.window.onDidChangeActiveColorTheme(() => {
      post({ type: "vscodeTheme", kind: vscodeKind() });
    });

    // Push Bioscratch settings changes (theme, match mode, debounce) to the webview.
    const configSub = vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("bioscratch")) {
        const cfg = config();
        post({
          type: "config",
          theme: cfg.get<string>("theme", "light"),
          matchVscodeTheme: cfg.get<boolean>("matchVscodeTheme", false),
          editDebounceMs: cfg.get<number>("editDebounceMs", 200),
        });
      }
    });

    webviewPanel.onDidDispose(() => {
      changeSub.dispose();
      themeSub.dispose();
      configSub.dispose();
      if (this.activePanel === webviewPanel) this.activePanel = null;
    });

    webviewPanel.webview.onDidReceiveMessage(async (rawMessage: unknown) => {
      if (!isRecord(rawMessage) || typeof rawMessage.type !== "string") return;
      const msg = rawMessage;
      switch (msg.type) {
        case "ready":
          post({ type: "init", payload: this.buildInitPayload(document) });
          break;

        case "edit":
          if (typeof msg.text === "string") {
            await this.applyEdit(document, msg.text);
          }
          break;

        case "resolveImage": {
          if (typeof msg.src !== "string" || typeof msg.requestId !== "number") break;
          const uri = this.resolveImage(webviewPanel.webview, docDir, msg.src);
          post({ type: "resolveImageResult", requestId: msg.requestId, uri });
          break;
        }

        case "openLink":
          if (typeof msg.href === "string") this.openLink(msg.href);
          break;

        case "saveHtml":
          if (typeof msg.filename === "string" && typeof msg.html === "string") {
            await this.saveHtml(msg.filename, msg.html, document);
          }
          break;

        case "undo":
          await vscode.commands.executeCommand("undo");
          break;

        case "redo":
          await vscode.commands.executeCommand("redo");
          break;

        case "setTheme":
          // Settings are the single source of truth; updating them fires
          // onDidChangeConfiguration, which echoes the change to every webview.
          if (typeof msg.theme === "string" && msg.theme.length <= 128) {
            await config().update("theme", msg.theme, vscode.ConfigurationTarget.Global);
            await config().update("matchVscodeTheme", false, vscode.ConfigurationTarget.Global);
          }
          break;

        case "setMatchVscode":
          if (typeof msg.value === "boolean") {
            await config().update("matchVscodeTheme", msg.value, vscode.ConfigurationTarget.Global);
          }
          break;

        case "saveUserTheme":
          if (typeof msg.filename === "string" && typeof msg.content === "string") {
            await this.saveUserTheme(msg.filename, msg.content);
            post({ type: "userThemes", themes: this.listUserThemes() });
          }
          break;

        case "deleteUserTheme":
          if (typeof msg.filename === "string") {
            await this.deleteUserTheme(msg.filename);
            post({ type: "userThemes", themes: this.listUserThemes() });
          }
          break;

        case "importUserTheme": {
          const imported = await this.importUserTheme();
          if (imported) post({ type: "userThemes", themes: this.listUserThemes() });
          break;
        }
      }
    });
  }

  // ---- Init payload ------------------------------------------------------
  private buildInitPayload(document: vscode.TextDocument) {
    const cfg = config();
    return {
      text: document.getText(),
      theme: cfg.get<string>("theme", "light"),
      matchVscodeTheme: cfg.get<boolean>("matchVscodeTheme", false),
      vscodeKind: vscodeKind(),
      docName: path.basename(document.uri.fsPath),
      userThemes: this.listUserThemes(),
      editDebounceMs: cfg.get<number>("editDebounceMs", 200),
    };
  }

  // ---- Document edits ----------------------------------------------------
  // Minimal-diff write-back: instead of replacing the whole document on every
  // edit, find the common prefix and suffix between the current text and the
  // new text and replace only the span that actually changed. This keeps the
  // WorkspaceEdit small, preserves the source view's cursor/scroll, and scales
  // to large files where a full replace would be expensive.
  private applyEdit(document: vscode.TextDocument, newText: string): Thenable<boolean> {
    const oldText = document.getText();
    if (oldText === newText) return Promise.resolve(true);

    const oldLen = oldText.length;
    const newLen = newText.length;
    const maxPrefix = Math.min(oldLen, newLen);

    let prefix = 0;
    while (prefix < maxPrefix && oldText.charCodeAt(prefix) === newText.charCodeAt(prefix)) {
      prefix++;
    }

    let suffix = 0;
    const maxSuffix = maxPrefix - prefix;
    while (
      suffix < maxSuffix &&
      oldText.charCodeAt(oldLen - 1 - suffix) === newText.charCodeAt(newLen - 1 - suffix)
    ) {
      suffix++;
    }

    const startOffset = prefix;
    const endOffset = oldLen - suffix;
    const replacement = newText.slice(prefix, newLen - suffix);

    const edit = new vscode.WorkspaceEdit();
    edit.replace(
      document.uri,
      new vscode.Range(document.positionAt(startOffset), document.positionAt(endOffset)),
      replacement
    );
    return vscode.workspace.applyEdit(edit);
  }

  // ---- Images ------------------------------------------------------------
  private resolveImage(webview: vscode.Webview, docDir: vscode.Uri, src: string): string {
    try {
      const target = path.isAbsolute(src)
        ? vscode.Uri.file(src)
        : vscode.Uri.joinPath(docDir, src);
      return webview.asWebviewUri(target).toString();
    } catch {
      return src;
    }
  }

  // ---- Links -------------------------------------------------------------
  private openLink(href: string): void {
    try {
      const uri = vscode.Uri.parse(href, true);
      if (!["https", "http", "mailto"].includes(uri.scheme.toLowerCase())) return;
      void vscode.env.openExternal(uri);
    } catch {
      /* ignore malformed URLs */
    }
  }

  // ---- HTML export -------------------------------------------------------
  private async saveHtml(filename: string, html: string, document: vscode.TextDocument): Promise<void> {
    const safeFilename = normalizedHtmlFilename(filename);
    const defaultUri = vscode.Uri.joinPath(
      vscode.Uri.file(path.dirname(document.uri.fsPath)),
      safeFilename
    );
    const target = await vscode.window.showSaveDialog({
      defaultUri,
      filters: { "HTML files": ["html"] },
    });
    if (!target) return;
    await vscode.workspace.fs.writeFile(target, Buffer.from(html, "utf8"));
    vscode.window.showInformationMessage(`Exported ${path.basename(target.fsPath)}`);
  }

  // ---- User themes (persisted in global state) ---------------------------
  private listUserThemes(): { filename: string; content: string }[] {
    const map = this.context.globalState.get<UserThemes>(USER_THEMES_KEY, {});
    return Object.entries(map).map(([filename, content]) => ({ filename, content }));
  }

  private async saveUserTheme(filename: string, content: string): Promise<void> {
    const safeFilename = normalizedThemeFilename(filename);
    if (!safeFilename) return;
    const map = { ...this.context.globalState.get<UserThemes>(USER_THEMES_KEY, {}) };
    map[safeFilename] = content;
    await this.context.globalState.update(USER_THEMES_KEY, map);
  }

  private async deleteUserTheme(filename: string): Promise<void> {
    const safeFilename = normalizedThemeFilename(filename);
    if (!safeFilename) return;
    const map = { ...this.context.globalState.get<UserThemes>(USER_THEMES_KEY, {}) };
    delete map[safeFilename];
    await this.context.globalState.update(USER_THEMES_KEY, map);
  }

  private async importUserTheme(): Promise<boolean> {
    const picks = await vscode.window.showOpenDialog({
      canSelectMany: false,
      filters: { "YAML themes": ["yaml", "yml"] },
      openLabel: "Import theme",
    });
    if (!picks || picks.length === 0) return false;
    const uri = picks[0];
    const bytes = await vscode.workspace.fs.readFile(uri);
    const content = Buffer.from(bytes).toString("utf8");
    await this.saveUserTheme(path.basename(uri.fsPath), content);
    return true;
  }

  // ---- Webview HTML ------------------------------------------------------
  private getHtml(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "dist", "webview.js")
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "dist", "webview.css")
    );
    const nonce = getNonce();
    const cspSource = webview.cspSource;

    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="
    default-src 'none';
    img-src ${cspSource} https: data:;
    style-src ${cspSource} 'unsafe-inline';
    font-src ${cspSource} data:;
    script-src 'nonce-${nonce}';" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link href="${styleUri}" rel="stylesheet" />
  <style>
    html, body, #root { height: 100%; margin: 0; padding: 0; }
    body { background: var(--bg-editor, var(--vscode-editor-background)); overflow: hidden; }
  </style>
  <title>Bioscratch</title>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}
