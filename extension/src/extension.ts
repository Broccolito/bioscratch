import * as vscode from "vscode";
import { BioscratchEditorProvider } from "./editorProvider";

const DEFAULT_EDITOR_APPLIED_KEY = "bioscratch.defaultEditorApplied";

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  context.subscriptions.push(BioscratchEditorProvider.register(context));
  await applyDefaultEditorAssociation(context);
}

export function deactivate(): void {
  /* nothing to clean up — disposables are tracked in context.subscriptions */
}

/**
 * The first time the extension runs, make Bioscratch the default editor for
 * Markdown files by writing `workbench.editorAssociations`, unless the user has
 * turned `bioscratch.setAsDefaultEditor` off or already chose an editor for
 * those patterns. This runs once (guarded by a global flag) so that a user who
 * later opts out is never overridden again.
 */
async function applyDefaultEditorAssociation(context: vscode.ExtensionContext): Promise<void> {
  if (context.globalState.get<boolean>(DEFAULT_EDITOR_APPLIED_KEY)) return;

  const bioscratchCfg = vscode.workspace.getConfiguration("bioscratch");
  if (!bioscratchCfg.get<boolean>("setAsDefaultEditor", true)) {
    // Respect the opt-out, but still mark as applied so toggling it back on
    // later does not silently rewrite the user's settings.
    await context.globalState.update(DEFAULT_EDITOR_APPLIED_KEY, true);
    return;
  }

  const workbenchCfg = vscode.workspace.getConfiguration("workbench");
  const current = workbenchCfg.get<Record<string, string>>("editorAssociations") ?? {};
  const next = { ...current };

  let changed = false;
  for (const pattern of ["*.md", "*.markdown"]) {
    if (next[pattern] === undefined) {
      next[pattern] = BioscratchEditorProvider.viewType;
      changed = true;
    }
  }

  if (changed) {
    await workbenchCfg.update(
      "editorAssociations",
      next,
      vscode.ConfigurationTarget.Global
    );
  }
  await context.globalState.update(DEFAULT_EDITOR_APPLIED_KEY, true);
}
