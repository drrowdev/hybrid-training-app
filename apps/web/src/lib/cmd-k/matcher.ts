/**
 * Tiny in-memory fuzzy matcher for the quick-jump palette.
 *
 * No external dep — pure subsequence + substring matching with a
 * handful of score bumps tuned so the obvious cases (exact prefix,
 * "Today" first when typing "tod", pages before movements) feel right
 * without leaning on Fuse / kbar / cmdk.
 *
 * Scoring rules:
 *   - Exact prefix match in title       → +100
 *   - Substring match in title          → +50
 *   - Subsequence match in title        → +10
 *   - Substring match in subtitle       → +20
 *   - Kind boost: page > session > block > movement > event
 *   - Group cap (5/kind) applied by the caller, not here.
 */

import type { PaletteItem, PaletteKind } from "./types";

const KIND_BOOST: Record<PaletteKind, number> = {
  page: 40,
  session: 25,
  block: 15,
  movement: 10,
  event: 5,
};

/**
 * Order-preserving subsequence test ("hru" matches "How are you").
 * Cheap O(n) walk — enough for ≤100 items, lower latency than
 * Levenshtein and easier to reason about for ranking ties.
 */
function isSubsequence(needle: string, hay: string): boolean {
  if (needle.length === 0) return true;
  let i = 0;
  for (let j = 0; j < hay.length && i < needle.length; j++) {
    if (hay[j] === needle[i]) i++;
  }
  return i === needle.length;
}

export type MatchResult = {
  item: PaletteItem;
  score: number;
  /** Lowercased [start, end) ranges to highlight in the rendered title. */
  ranges: Array<[number, number]>;
};

/**
 * Find a single contiguous substring range in `title` for the query,
 * or fall back to per-character ranges from the subsequence walk so
 * the UI can still bold something. Returns ranges in the original
 * (mixed-case) string coordinates.
 */
function highlightRanges(
  title: string,
  q: string,
): Array<[number, number]> {
  if (!q) return [];
  const lower = title.toLowerCase();
  const sub = lower.indexOf(q);
  if (sub >= 0) return [[sub, sub + q.length]];
  const ranges: Array<[number, number]> = [];
  let i = 0;
  for (let j = 0; j < title.length && i < q.length; j++) {
    if (lower[j] === q[i]) {
      ranges.push([j, j + 1]);
      i++;
    }
  }
  return ranges;
}

/**
 * Score a single item against a normalised query string. Returns null
 * when the item doesn't match at all — callers filter these out.
 */
export function scoreItem(item: PaletteItem, q: string): MatchResult | null {
  if (!q) {
    // Empty query → no ranking signal; surface in declared order
    // with just the kind boost so "recent" / default views stay
    // stable.
    return { item, score: KIND_BOOST[item.kind], ranges: [] };
  }

  const title = item.title.toLowerCase();
  const subtitle = item.subtitle?.toLowerCase() ?? "";

  let score = 0;
  let matched = false;

  if (title.startsWith(q)) {
    score += 100;
    matched = true;
  } else if (title.includes(q)) {
    score += 50;
    matched = true;
  } else if (isSubsequence(q, title)) {
    score += 10;
    matched = true;
  }

  if (subtitle.includes(q)) {
    score += 20;
    matched = true;
  }

  if (!matched) return null;

  score += KIND_BOOST[item.kind];

  // Shorter titles win on ties — typing "log" should prefer the
  // top-level "Log" page over a movement called "Reverse Lunge".
  score += Math.max(0, 12 - title.length);

  return {
    item,
    score,
    ranges: highlightRanges(item.title, q),
  };
}

/**
 * Rank a flat item list against the query. Caller decides how to
 * group / cap — this just returns everything that matched, sorted
 * best-first.
 */
export function rankItems(
  items: PaletteItem[],
  query: string,
): MatchResult[] {
  const q = query.trim().toLowerCase();
  const out: MatchResult[] = [];
  for (const item of items) {
    const m = scoreItem(item, q);
    if (m) out.push(m);
  }
  out.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.item.title.localeCompare(b.item.title);
  });
  return out;
}
