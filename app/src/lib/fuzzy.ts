// Fuzzy matching for the quick switcher. A candidate matches when every query
// character appears in order (case-insensitive). Scoring favors consecutive
// runs, matches at word boundaries, and matches in the file name over the
// folder path, so "labnt" ranks "Lab/notes.md" well and "notes" prefers
// ".../notes.md" over ".../no/tes/x.md".

export interface FuzzyMatch {
  score: number;
  /** Indices into the candidate string that matched, for highlighting. */
  indices: number[];
}

const BOUNDARY = new Set(["/", "_", "-", ".", " "]);

function isBoundary(text: string, index: number): boolean {
  if (index === 0) return true;
  const prev = text[index - 1];
  if (BOUNDARY.has(prev)) return true;
  // camelCase boundary
  return prev === prev.toLowerCase() && text[index] !== text[index].toLowerCase();
}

/** Score one candidate, or null when the query is not a subsequence. */
export function fuzzyMatch(query: string, candidate: string): FuzzyMatch | null {
  const q = query.replace(/\s+/g, "").toLowerCase();
  if (!q) return { score: 0, indices: [] };
  const lower = candidate.toLowerCase();
  const nameStart = candidate.lastIndexOf("/") + 1;

  // Greedy pass from the right: each query char takes its latest position
  // before its successor, which keeps matches in the file name when possible
  // and packs them next to each other.
  const indices: number[] = [];
  let ci = lower.length - 1;
  for (let qi = q.length - 1; qi >= 0; qi--) {
    while (ci >= 0 && lower[ci] !== q[qi]) ci--;
    if (ci < 0) return null;
    indices.unshift(ci);
    ci--;
  }

  let score = 0;
  for (let i = 0; i < indices.length; i++) {
    const idx = indices[i];
    score += 1;
    if (i > 0 && indices[i - 1] === idx - 1) score += 5;
    if (isBoundary(candidate, idx)) score += 3;
    if (idx >= nameStart) score += 2;
  }
  // Prefer shorter candidates and earlier first matches within the name.
  score -= candidate.length * 0.01;
  if (indices[0] === nameStart) score += 4;
  return { score, indices };
}

export interface RankedCandidate<T> {
  item: T;
  match: FuzzyMatch;
}

/** Filter and sort `items` by fuzzy score against `key(item)`. */
export function fuzzyRank<T>(
  query: string,
  items: T[],
  key: (item: T) => string,
  limit = 50
): RankedCandidate<T>[] {
  const ranked: RankedCandidate<T>[] = [];
  for (const item of items) {
    const match = fuzzyMatch(query, key(item));
    if (match) ranked.push({ item, match });
  }
  ranked.sort((a, b) => b.match.score - a.match.score);
  return ranked.slice(0, limit);
}
