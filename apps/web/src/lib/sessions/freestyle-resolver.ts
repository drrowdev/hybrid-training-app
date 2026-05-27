/**
 * Freestyle ("+ Add off-plan movement") movement-list resolution.
 *
 * Source of truth is the UNION of:
 *   1. `session_movements` rows (the user explicitly added them — they
 *      may or may not have logged a set yet)
 *   2. `set_logs.movement_id` distinct, restricted to movements that
 *      aren't part of the prescription
 *
 * Ordering rule:
 *   - Rows that have a `session_movements` entry use `sort_order`
 *     (ascending). This is the user's intentional add order.
 *   - Rows that exist only via `set_logs` (legacy adds, or sets
 *     attributed to a movement before this column existed) are
 *     appended after the persisted block, ordered by the earliest
 *     `created_at` of the set rows for that movement.
 *
 * Pure function — no Supabase dependency — so the page can call it
 * after fetching both shapes and the unit test can drive it directly.
 */

export type FreestyleMovementInput = {
  id: string;
  slug: string;
  display_name: string;
  primary_region: string;
};

export type PersistedFreestyle = {
  movement: FreestyleMovementInput;
  sortOrder: number;
  addedAt: string;
};

export type SetLogSlim = {
  movement: FreestyleMovementInput;
  created_at: string | null;
};

export type ResolvedFreestyleMovement = {
  movement: FreestyleMovementInput;
  /** Truthy when the row is backed by a `session_movements` entry. */
  persisted: boolean;
  /** Defined only when `persisted` is true. */
  sortOrder: number | null;
  /** ISO timestamp: `added_at` for persisted rows, earliest set
   *  `created_at` for set-only rows. */
  addedAt: string | null;
  loggedSetCount: number;
};

export function resolveFreestyleMovements({
  persisted,
  sets,
  prescribedMovementIds,
}: {
  persisted: ReadonlyArray<PersistedFreestyle>;
  sets: ReadonlyArray<SetLogSlim>;
  prescribedMovementIds: ReadonlySet<string>;
}): ResolvedFreestyleMovement[] {
  // Bucket sets by movement id and remember the earliest created_at
  // so we can order set-only movements by first-log time.
  const setsByMovement = new Map<
    string,
    { movement: FreestyleMovementInput; count: number; firstAt: string | null }
  >();
  for (const s of sets) {
    if (!s.movement.id) continue;
    const cur = setsByMovement.get(s.movement.id);
    if (cur) {
      cur.count += 1;
      if (s.created_at && (!cur.firstAt || s.created_at < cur.firstAt)) {
        cur.firstAt = s.created_at;
      }
    } else {
      setsByMovement.set(s.movement.id, {
        movement: s.movement,
        count: 1,
        firstAt: s.created_at,
      });
    }
  }

  const out: ResolvedFreestyleMovement[] = [];
  const claimed = new Set<string>();

  // Persisted block first, in sort_order.
  const persistedSorted = [...persisted].sort(
    (a, b) => a.sortOrder - b.sortOrder,
  );
  for (const p of persistedSorted) {
    if (prescribedMovementIds.has(p.movement.id)) continue;
    claimed.add(p.movement.id);
    const setBucket = setsByMovement.get(p.movement.id);
    out.push({
      movement: p.movement,
      persisted: true,
      sortOrder: p.sortOrder,
      addedAt: p.addedAt,
      loggedSetCount: setBucket?.count ?? 0,
    });
  }

  // Set-only block, ordered by earliest set created_at then by
  // display_name as a stable tiebreaker.
  const setOnly: ResolvedFreestyleMovement[] = [];
  for (const [id, bucket] of setsByMovement) {
    if (claimed.has(id)) continue;
    if (prescribedMovementIds.has(id)) continue;
    setOnly.push({
      movement: bucket.movement,
      persisted: false,
      sortOrder: null,
      addedAt: bucket.firstAt,
      loggedSetCount: bucket.count,
    });
  }
  setOnly.sort((a, b) => {
    const av = a.addedAt ?? "";
    const bv = b.addedAt ?? "";
    if (av < bv) return -1;
    if (av > bv) return 1;
    return a.movement.display_name.localeCompare(b.movement.display_name);
  });

  return [...out, ...setOnly];
}
