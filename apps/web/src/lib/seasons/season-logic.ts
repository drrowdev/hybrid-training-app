/**
 * Pure Season-roadmap logic (ADR 0051 Phase 0). No I/O — the server actions
 * orchestrate auth + DB; this module owns the in-memory sequencing invariants so
 * they can be unit-tested without a Supabase double.
 */
import { SEASON_EMPHASES, type SeasonEmphasis } from "@hta/db";

export type SeasonBlockLite = {
  id: string;
  position: number;
  status: "planned" | "active" | "done" | "skipped";
};

/** Valid emphasis tags (re-exported from the DB enum so callers don't reach in). */
export const SEASON_EMPHASIS_VALUES: ReadonlyArray<SeasonEmphasis> = SEASON_EMPHASES;

export function isSeasonEmphasis(v: unknown): v is SeasonEmphasis {
  return typeof v === "string" && (SEASON_EMPHASES as readonly string[]).includes(v);
}

/** Phase 0 caps the look-ahead at a modest sequence (ADR 0051: "2–3 block look-ahead"). */
export const MAX_SEASON_BLOCKS = 8;
export const MIN_SEASON_BLOCKS = 1;

/**
 * Renumber blocks to contiguous 0-based positions in their current order,
 * preserving everything else. Used after a remove so there are no gaps and the
 * unique(season_id, position) constraint stays satisfiable.
 */
export function renumber<T extends { position: number }>(blocks: T[]): T[] {
  return [...blocks]
    .sort((a, b) => a.position - b.position)
    .map((b, i) => ({ ...b, position: i }));
}

/**
 * Given the current block ids and a desired full ordering, return the
 * `id → newPosition` map. Throws if `orderedIds` isn't a permutation of the
 * current ids (defends the unique-position invariant before any DB write).
 */
export function applyReorder(currentIds: string[], orderedIds: string[]): Map<string, number> {
  if (orderedIds.length !== currentIds.length) {
    throw new RangeError("reorder: ordered ids must cover every block exactly once");
  }
  const cur = new Set(currentIds);
  const seen = new Set<string>();
  for (const id of orderedIds) {
    if (!cur.has(id)) throw new RangeError(`reorder: unknown block id ${id}`);
    if (seen.has(id)) throw new RangeError(`reorder: duplicate block id ${id}`);
    seen.add(id);
  }
  const map = new Map<string, number>();
  orderedIds.forEach((id, i) => map.set(id, i));
  return map;
}

/**
 * The next block the user would activate: the first `planned` block by position.
 * `null` when nothing is left to start. Used by the Season-aware nudge + the
 * "start next block" advance.
 */
export function nextPlannedBlock<T extends SeasonBlockLite>(blocks: T[]): T | null {
  const planned = blocks
    .filter((b) => b.status === "planned")
    .sort((a, b) => a.position - b.position);
  return planned[0] ?? null;
}

/** Done / total / active-index summary for the roadmap header (active excluded from done). */
export function seasonProgress(blocks: SeasonBlockLite[]): {
  done: number;
  total: number;
  activeIndex: number;
} {
  const sorted = [...blocks].sort((a, b) => a.position - b.position);
  return {
    done: sorted.filter((b) => b.status === "done").length,
    total: sorted.length,
    activeIndex: sorted.findIndex((b) => b.status === "active"),
  };
}
