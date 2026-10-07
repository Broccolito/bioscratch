// Per-tab back/forward history, browser style: navigating to a new file pushes
// the current one onto `back` and clears `forward`.

export interface NavHistory {
  back: string[];
  forward: string[];
}

const MAX_ENTRIES = 100;

export const emptyHistory = (): NavHistory => ({ back: [], forward: [] });

/** Record navigating from `from` to `to` within the same tab. */
export function visit(history: NavHistory, from: string | null, to: string): NavHistory {
  if (!from || from === to) return history;
  return { back: [...history.back, from].slice(-MAX_ENTRIES), forward: [] };
}

/** Step back from `current`; null when there is nowhere to go. */
export function goBack(
  history: NavHistory,
  current: string | null
): { history: NavHistory; target: string } | null {
  if (history.back.length === 0) return null;
  const target = history.back[history.back.length - 1];
  return {
    target,
    history: {
      back: history.back.slice(0, -1),
      forward: current ? [current, ...history.forward] : history.forward,
    },
  };
}

/** Step forward from `current`; null when there is nowhere to go. */
export function goForward(
  history: NavHistory,
  current: string | null
): { history: NavHistory; target: string } | null {
  if (history.forward.length === 0) return null;
  const [target, ...rest] = history.forward;
  return {
    target,
    history: {
      back: current ? [...history.back, current].slice(-MAX_ENTRIES) : history.back,
      forward: rest,
    },
  };
}

/** Drop entries for a path that no longer exists (e.g. after a failed open). */
export function forget(history: NavHistory, path: string): NavHistory {
  return {
    back: history.back.filter((p) => p !== path),
    forward: history.forward.filter((p) => p !== path),
  };
}
