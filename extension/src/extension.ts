import * as vscode from "vscode";
import { BioscratchEditorProvider } from "./editorProvider";

const MARKDOWN_ASSOCIATIONS = ["*.md", "*.markdown"] as const;
const routingInProgress = new Set<string>();

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  context.subscriptions.push(BioscratchEditorProvider.register(context));
  await syncDefaultEditorAssociations();

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      void routeMarkdownTextEditor(editor);
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (
        !event.affectsConfiguration("bioscratch.setAsDefaultEditor") &&
        !event.affectsConfiguration("workbench.editorAssociations")
      ) {
        return;
      }

      void syncDefaultEditorAssociations().then(() =>
        routeMarkdownTextEditor(vscode.window.activeTextEditor)
      );
    })
  );

  await routeMarkdownTextEditor(vscode.window.activeTextEditor);
}

export function deactivate(): void {
  /* nothing to clean up — disposables are tracked in context.subscriptions */
}

async function syncDefaultEditorAssociations(): Promise<void> {
  const bioscratchCfg = vscode.workspace.getConfiguration("bioscratch");
  const enabled = bioscratchCfg.get<boolean>("setAsDefaultEditor", true);
  const workbenchCfg = vscode.workspace.getConfiguration("workbench");
  const inspected = workbenchCfg.inspect<Record<string, string>>("editorAssociations");
  const effective = workbenchCfg.get<Record<string, string>>("editorAssociations") ?? {};
  const global = inspected?.globalValue ?? {};
  const nextGlobal = { ...global };

  let changed = false;
  for (const pattern of MARKDOWN_ASSOCIATIONS) {
    if (enabled && effective[pattern] === undefined) {
      nextGlobal[pattern] = BioscratchEditorProvider.viewType;
      changed = true;
    } else if (!enabled && nextGlobal[pattern] === BioscratchEditorProvider.viewType) {
      delete nextGlobal[pattern];
      changed = true;
    }
  }

  if (changed) {
    await workbenchCfg.update(
      "editorAssociations",
      nextGlobal,
      vscode.ConfigurationTarget.Global
    );
  }
}

function markdownAssociationFor(uri: vscode.Uri): string | undefined {
  const lowerPath = uri.path.toLowerCase();
  const pattern = MARKDOWN_ASSOCIATIONS.find((candidate) =>
    lowerPath.endsWith(candidate.slice(1))
  );
  if (!pattern) return undefined;

  return vscode.workspace
    .getConfiguration("workbench", uri)
    .get<Record<string, string>>("editorAssociations")?.[pattern];
}

async function routeMarkdownTextEditor(editor: vscode.TextEditor | undefined): Promise<void> {
  if (!editor || editor.document.uri.scheme === "vscode-notebook-cell") return;

  const enabled = vscode.workspace
    .getConfiguration("bioscratch", editor.document.uri)
    .get<boolean>("setAsDefaultEditor", true);
  if (!enabled || markdownAssociationFor(editor.document.uri) !== BioscratchEditorProvider.viewType) {
    return;
  }

  const key = editor.document.uri.toString();
  if (routingInProgress.has(key)) return;
  routingInProgress.add(key);

  try {
    await vscode.commands.executeCommand(
      "vscode.openWith",
      editor.document.uri,
      BioscratchEditorProvider.viewType,
      editor.viewColumn
    );
  } catch (error) {
    console.error(`Bioscratch could not route ${key} to its Markdown editor`, error);
  } finally {
    routingInProgress.delete(key);
  }
}
