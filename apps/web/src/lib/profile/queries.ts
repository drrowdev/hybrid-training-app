/**
 * Read queries for the /app/profile page.
 *
 * Pulled out of the page file so each surface area is independently
 * testable. All functions take an already-authed Supabase client +
 * userId so they don't re-read auth.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

// ────────────────────────────────────────────────────────────────────
// Bodyweight — 90-day sparkline + delta vs 30 days ago
// ────────────────────────────────────────────────────────────────────

export type BodyweightPoint = {
  /** YYYY-MM-DD */
  date: string;
  kg: number;
};

export type BodyweightSummary = {
  points: BodyweightPoint[];
  /** Most-recent entry, or null when the user has never logged. */
  current: BodyweightPoint | null;
  /** Bodyweight delta (kg) vs the entry closest to 30 days before `current`. */
  deltaKg30d: number | null;
};

export async function getBodyweight90d(
  supabase: SupabaseClient,
  userId: string,
  /** Override "now" for deterministic tests. */
  now: Date = new Date(),
): Promise<BodyweightSummary> {
  const ninetyDaysAgo = new Date(now.getTime() - 90 * 86_400_000)
    .toISOString()
    .slice(0, 10);

  const { data } = await supabase
    .from("wellness")
    .select("date, bodyweight_kg")
    .eq("user_id", userId)
    .not("bodyweight_kg", "is", null)
    .gte("date", ninetyDaysAgo)
    .order("date", { ascending: true });

  const points: BodyweightPoint[] = (data ?? [])
    .map((r) => ({
      date: String(r.date),
      kg: Number(r.bodyweight_kg),
    }))
    .filter((p) => Number.isFinite(p.kg) && p.kg > 0);

  const current = points.length > 0 ? points[points.length - 1]! : null;

  let deltaKg30d: number | null = null;
  if (current) {
    const target = new Date(current.date + "T00:00:00Z");
    target.setUTCDate(target.getUTCDate() - 30);
    const targetIso = target.toISOString().slice(0, 10);
    // Closest entry on-or-before `targetIso` — points are date-asc, so
    // walk backwards from the current.
    let baseline: BodyweightPoint | null = null;
    for (let i = points.length - 2; i >= 0; i--) {
      if (points[i]!.date <= targetIso) {
        baseline = points[i]!;
        break;
      }
    }
    if (baseline) {
      deltaKg30d = +(current.kg - baseline.kg).toFixed(1);
    }
  }

  return { points, current, deltaKg30d };
}

// ────────────────────────────────────────────────────────────────────
// Movement focus — top-N by frequency over a recent window
// ────────────────────────────────────────────────────────────────────

export type MovementFocusRow = {
  movementId: string;
  movementName: string;
  movementSlug: string;
  /** Number of distinct sessions this movement appeared in. */
  sessionCount: number;
  /** ISO timestamp of the most recent session that included it. */
  lastPerformedAt: string;
};

export type SetLogJoinRow = {
  movement_id: string;
  sessions: {
    id: string;
    performed_at: string;
    user_id?: string;
    deleted_at?: string | null;
  } | { id: string; performed_at: string }[] | null;
  movements: {
    id?: string;
    slug: string;
    display_name: string;
  } | { slug: string; display_name: string }[] | null;
};

/**
 * Pure helper — given a list of set_log rows joined to sessions +
 * movements, return the top-N movements ranked by distinct session
 * count, then by most-recent activity as the tiebreaker. Exported for
 * unit testing.
 */
export function rankTopMovements(
  rows: SetLogJoinRow[],
  limit: number,
): MovementFocusRow[] {
  const agg = new Map<
    string,
    {
      movementId: string;
      slug: string;
      name: string;
      sessions: Set<string>;
      lastAt: string;
    }
  >();

  for (const r of rows) {
    const session = Array.isArray(r.sessions) ? r.sessions[0] : r.sessions;
    const movement = Array.isArray(r.movements) ? r.movements[0] : r.movements;
    if (!session || !movement) continue;
    const sessionId = session.id;
    const performedAt = session.performed_at;
    if (!sessionId || !performedAt) continue;
    const movementId = r.movement_id;
    if (!movementId) continue;

    let entry = agg.get(movementId);
    if (!entry) {
      entry = {
        movementId,
        slug: movement.slug,
        name: movement.display_name,
        sessions: new Set<string>(),
        lastAt: performedAt,
      };
      agg.set(movementId, entry);
    }
    entry.sessions.add(sessionId);
    if (performedAt > entry.lastAt) entry.lastAt = performedAt;
  }

  const ranked: MovementFocusRow[] = Array.from(agg.values())
    .map((e) => ({
      movementId: e.movementId,
      movementName: e.name,
      movementSlug: e.slug,
      sessionCount: e.sessions.size,
      lastPerformedAt: e.lastAt,
    }))
    .sort((a, b) => {
      if (b.sessionCount !== a.sessionCount) {
        return b.sessionCount - a.sessionCount;
      }
      return b.lastPerformedAt.localeCompare(a.lastPerformedAt);
    });

  return ranked.slice(0, Math.max(0, limit));
}

export async function getMovementFocus(
  supabase: SupabaseClient,
  userId: string,
  /** Window in days; defaults to 12 weeks = 84 days. */
  windowDays: number = 84,
  limit: number = 6,
  now: Date = new Date(),
): Promise<MovementFocusRow[]> {
  const since = new Date(now.getTime() - windowDays * 86_400_000).toISOString();

  // `set_logs` has no user_id column; join through `sessions` and
  // filter there. PostgREST returns nested objects when joins are
  // requested in the select.
  const { data } = await supabase
    .from("set_logs")
    .select(
      "movement_id, sessions!inner(id, performed_at, user_id, deleted_at), movements(id, slug, display_name)",
    )
    .eq("sessions.user_id", userId)
    .is("sessions.deleted_at", null)
    .gte("sessions.performed_at", since)
    .limit(5000);

  const rows = (data ?? []) as unknown as SetLogJoinRow[];
  return rankTopMovements(rows, limit);
}

// ────────────────────────────────────────────────────────────────────
// Limitations summary
// ────────────────────────────────────────────────────────────────────

export type LimitationSummaryRow = {
  id: string;
  kind: string | null;
  severity: "mild" | "moderate" | "severe";
  startedAt: string;
};

export async function getActiveLimitations(
  supabase: SupabaseClient,
  userId: string,
): Promise<LimitationSummaryRow[]> {
  const { data } = await supabase
    .from("limitations")
    .select("id, kind, severity, started_at")
    .eq("user_id", userId)
    .is("resolved_at", null)
    .order("started_at", { ascending: false })
    .limit(6);

  return (data ?? []).map((r) => ({
    id: r.id as string,
    kind: (r.kind as string | null) ?? null,
    severity: r.severity as LimitationSummaryRow["severity"],
    startedAt: r.started_at as string,
  }));
}

// ────────────────────────────────────────────────────────────────────
// Pending TM suggestion count
// ────────────────────────────────────────────────────────────────────

export async function getPendingTmSuggestionCount(
  supabase: SupabaseClient,
  userId: string,
): Promise<number> {
  const { count } = await supabase
    .from("tm_suggestions")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("status", "pending");
  return count ?? 0;
}

// ────────────────────────────────────────────────────────────────────
// Relative-time helpers (no external deps — keep small + tested)
// ────────────────────────────────────────────────────────────────────

/** "Member since N months / years" style relative phrase from an ISO timestamp. */
export function memberSincePhrase(iso: string, now: Date = new Date()): string {
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return "Member";
  const diffMs = now.getTime() - ts;
  const days = Math.max(0, Math.round(diffMs / 86_400_000));
  if (days < 1) return "Joined today";
  if (days < 14) return `Member since ${days} day${days === 1 ? "" : "s"}`;
  if (days < 60) return `Member since ${Math.round(days / 7)} weeks`;
  if (days < 365) return `Member since ${Math.round(days / 30)} months`;
  const years = Math.floor(days / 365);
  return `Member since ${years} year${years === 1 ? "" : "s"}`;
}

/** Short "Updated 3h ago / 4d ago" relative for AI-notes-style hints. */
export function shortRelative(iso: string | null, now: Date = new Date()): string {
  if (!iso) return "";
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return "";
  const diff = Math.max(0, now.getTime() - ts);
  const mins = Math.round(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.round(months / 12)}y ago`;
}
