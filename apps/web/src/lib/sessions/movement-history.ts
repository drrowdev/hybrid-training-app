/**
 * Previously logged sets of one movement, grouped by session.
 *
 * Pure: the server action in `movement-history-actions.ts` reads the rows, this
 * module shapes and formats them, and the sheet only renders the result.
 * Warm-up sets are never read. Skipped sets stay, with their reason.
 */
import { formatWeight, type WeightUnit } from "@/lib/stats/units";
import { formatDistance } from "@/lib/cardio/units";
import { skipReasonLabel } from "@/lib/sessions/skip-reasons";

export type HistorySetEntry = {
  kind: "set";
  id: string;
  setIndex: number;
  createdAt: string;
  weightKg: number | null;
  reps: number | null;
  durationSec: number | null;
  distanceM: number | null;
  rpe: number | null;
  notes: string | null;
  skipped: boolean;
  skipReason: string | null;
};

export type HistoryCardioEntry = {
  kind: "cardio";
  id: string;
  createdAt: string;
  durationSec: number | null;
  distanceKm: number | null;
  rpe: number | null;
  notes: string | null;
};

export type HistoryEntry = HistorySetEntry | HistoryCardioEntry;

export type HistorySession = {
  sessionId: string;
  title: string | null;
  performedAt: string;
  entries: HistoryEntry[];
};

export type MovementHistory = {
  sessions: HistorySession[];
  /** True when the read hit its row cap, so older sessions may be missing. */
  truncated: boolean;
};

export type HistorySessionInfo = { id: string; title: string | null; performed_at: string };

export function buildMovementHistory(
  sets: ReadonlyArray<{ session: HistorySessionInfo; entry: HistorySetEntry }>,
  cardio: ReadonlyArray<{ session: HistorySessionInfo; entry: HistoryCardioEntry }>,
  truncated = false,
): MovementHistory {
  const bySession = new Map<string, HistorySession>();
  const add = (session: HistorySessionInfo, entry: HistoryEntry) => {
    const current = bySession.get(session.id) ?? {
      sessionId: session.id, title: session.title, performedAt: session.performed_at, entries: [],
    };
    current.entries.push(entry);
    bySession.set(session.id, current);
  };
  for (const row of sets) add(row.session, row.entry);
  for (const row of cardio) add(row.session, row.entry);
  const sessions = [...bySession.values()].map((session) => ({
    ...session,
    entries: session.entries
      .filter((entry) => entry.kind === "set" || isMeaningfulCardio(entry))
      .sort((a, b) => entryOrder(a) - entryOrder(b) || a.createdAt.localeCompare(b.createdAt)),
  })).filter((session) => session.entries.length > 0)
    .sort((a, b) => b.performedAt.localeCompare(a.performedAt));
  return { sessions, truncated };
}

function entryOrder(entry: HistoryEntry): number {
  return entry.kind === "set" ? entry.setIndex : Number.MAX_SAFE_INTEGER;
}

/** A circuit marker station is saved with a one-second duration and nothing else. */
function isMeaningfulCardio(entry: HistoryCardioEntry): boolean {
  return (entry.durationSec != null && entry.durationSec > 1) || entry.distanceKm != null || entry.rpe != null ||
    !!entry.notes;
}

function clock(totalSec: number): string {
  const sec = Math.round(totalSec);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
}

export function formatHistoryEntry(entry: HistoryEntry, units: WeightUnit): string {
  if (entry.kind === "cardio") {
    return [
      entry.durationSec != null && entry.durationSec > 1 ? clock(entry.durationSec) : null,
      entry.distanceKm != null ? formatDistance(entry.distanceKm, units) : null,
    ].filter(Boolean).join(" · ") || "Logged";
  }
  if (entry.skipped) {
    return entry.skipReason ? `Skipped · ${skipReasonLabel(entry.skipReason)}` : "Skipped";
  }
  const weight = entry.weightKg != null && entry.weightKg > 0 ? formatWeight(entry.weightKg, units) : null;
  const amount = entry.reps != null && entry.reps > 0
    ? weight ? `${entry.reps}` : `${entry.reps} reps`
    : entry.distanceM != null && entry.distanceM > 0 ? `${entry.distanceM} m`
      : entry.durationSec != null && entry.durationSec > 0 ? clock(entry.durationSec) : null;
  if (weight && amount) return `${weight} × ${amount}`;
  return weight ?? amount ?? "Logged";
}

/** Ids of sets that beat every earlier weight on this movement. The first session is the baseline. */
export function weightPrIds(history: MovementHistory): Set<string> {
  const ids = new Set<string>();
  const oldestFirst = [...history.sessions].reverse();
  let heaviest = 0;
  oldestFirst.forEach((session, index) => {
    let sessionBest = heaviest;
    for (const entry of session.entries) {
      if (entry.kind !== "set" || entry.skipped || !entry.weightKg || !entry.reps) continue;
      if (index > 0 && entry.weightKg > heaviest && entry.weightKg > sessionBest) ids.add(entry.id);
      sessionBest = Math.max(sessionBest, entry.weightKg);
    }
    heaviest = sessionBest;
  });
  return ids;
}

export function historySummary(history: MovementHistory): {
  heaviest: { weightKg: number; reps: number } | null;
  sessions: number;
} {
  let heaviest: { weightKg: number; reps: number } | null = null;
  for (const session of history.sessions) {
    for (const entry of session.entries) {
      if (entry.kind !== "set" || entry.skipped || !entry.weightKg || !entry.reps) continue;
      if (!heaviest || entry.weightKg > heaviest.weightKg ||
        (entry.weightKg === heaviest.weightKg && entry.reps > heaviest.reps)) {
        heaviest = { weightKg: entry.weightKg, reps: entry.reps };
      }
    }
  }
  return { heaviest, sessions: history.sessions.length };
}
