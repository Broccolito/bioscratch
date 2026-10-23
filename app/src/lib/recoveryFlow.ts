export interface RecoverySource {
  tabId: string;
  filePath: string | null;
  content: string;
}

export interface RecoveryTab {
  id: string;
  filePath: string | null;
  dirty: boolean;
}

/** Restore into the original clean document, or preserve it as a new draft. */
export function planRecovery(source: RecoverySource, tabs: RecoveryTab[]) {
  const owner = tabs.find((tab) => tab.id === source.tabId);
  const target = owner?.filePath === source.filePath && !owner.dirty ? owner : null;
  return {
    tabId: target?.id ?? null,
    filePath: target?.filePath ?? null,
    content: source.content,
    dirty: true as const,
  };
}
