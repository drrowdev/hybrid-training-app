/**
 * Optimistic set-logging overlay.
 *
 * Logging a set used to block on the server action's `revalidatePath`, which
 * re-renders the (heavy) session page before the UI could advance to the next
 * set — a multi-second stall on every tap. Instead we keep a client-side
 * overlay of just-logged sets so the cursor / dot strip / completion state
 * advance instantly, while the real write + revalidation settle in the
 * background. Once the server re-render lands (and `sets` includes the row),
 * the matching overlay entry is reconciled away — no flicker, no double-count.
 *
 * Pure helpers only (no React) so the merge + reconcile logic is unit-testable.
 */

import type { LoggedSet } from "@/components/session/SessionLogClient";

export type OptimisticLog = {
  /** Stable client id for this pending entry (also the overlay LoggedSet id). */
  clientKey: string;
  movementId: string;
  prescriptionItemIndex: number | null;
  setKind: string;
  weightKg: number | null;
  reps: number | null;
  durationSec: number | null;
  distanceM: number | null;
  rpe: number | null;
  skipped: boolean;
  skipReason: string | null;
};

function numOrNull(v: FormDataEntryValue | null): number | null {
  if (v == null) return null;
  const s = String(v).trim();
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * Build an `OptimisticLog` from the FormData the focus view submits. Returns
 * null when the essential ids are missing (defensive — the caller then just
 * fires the server action without an overlay).
 */
export function optimisticLogFromFormData(
  fd: FormData,
  clientKey: string,
): OptimisticLog | null {
  const movementId = fd.get("movementId");
  if (typeof movementId !== "string" || movementId === "") return null;
  const idxRaw = numOrNull(fd.get("prescriptionItemIndex"));
  const skipped = String(fd.get("skipped") ?? "") === "true";
  return {
    clientKey,
    movementId,
    prescriptionItemIndex: idxRaw == null ? null : Math.trunc(idxRaw),
    setKind: String(fd.get("setKind") ?? "main"),
    weightKg: skipped ? 0 : numOrNull(fd.get("weightKg")),
    reps: skipped ? 0 : numOrNull(fd.get("reps")),
    durationSec: skipped ? null : numOrNull(fd.get("durationSec")),
    distanceM: skipped ? null : numOrNull(fd.get("distanceM")),
    rpe: skipped ? null : numOrNull(fd.get("rpe")),
    skipped,
    skipReason:
      skipped && typeof fd.get("skipReason") === "string"
        ? (fd.get("skipReason") as string)
        : null,
  };
}

/**
 * A `LoggedSet`-shaped overlay row for a pending log. Only `movement.id` is
 * meaningful — optimistic logs are always for a *prescribed* movement, whose id
 * is in the prescription, so the freestyle/all-logged surfaces (which key off
 * `movement.id`) never mistake it for an off-plan movement; the slug / name /
 * region fields are unused for prescribed cards and stubbed empty.
 */
export function pendingLogToLoggedSet(
  log: OptimisticLog,
  setIndex: number,
): LoggedSet {
  return {
    id: log.clientKey,
    set_index: setIndex,
    set_kind: log.setKind,
    weight_kg: log.weightKg,
    reps: log.reps,
    duration_sec: log.durationSec,
    distance_m: log.distanceM,
    rpe: log.rpe,
    skipped: log.skipped,
    skip_reason: log.skipReason,
    movement: { id: log.movementId, slug: "", display_name: "", primary_region: "" },
  };
}

/**
 * True when a server-fetched set already represents this pending log, so the
 * overlay entry can be dropped. Matches on (movement_id, prescription_item_index)
 * — the focus view always stamps an explicit index, and the engine never logs
 * two rows at the same prescribed index, so this is an exact reconcile.
 */
export function serverHasPendingLog(
  serverSets: ReadonlyArray<LoggedSet>,
  log: OptimisticLog,
): boolean {
  if (log.prescriptionItemIndex == null) {
    // No index to match on — reconcile by movement only is unsafe (would drop
    // on the first server set for that movement). Keep it until a real index
    // exists; in practice the focus view always supplies an index.
    return false;
  }
  return serverSets.some(
    (s) =>
      s.movement.id === log.movementId &&
      (s as { prescription_item_index?: number | null }).prescription_item_index ===
        log.prescriptionItemIndex,
  );
}

/**
 * Merge server sets with the still-pending overlay (server first, then any
 * overlay entry the server hasn't caught up to yet). Stable order so React
 * reconciliation stays cheap.
 */
export function mergeOptimisticSets(
  serverSets: ReadonlyArray<LoggedSet>,
  pending: ReadonlyArray<OptimisticLog>,
): LoggedSet[] {
  if (pending.length === 0) return serverSets as LoggedSet[];
  const out: LoggedSet[] = [...serverSets];
  let i = serverSets.length;
  for (const log of pending) {
    if (serverHasPendingLog(serverSets, log)) continue;
    out.push(pendingLogToLoggedSet(log, i));
    i += 1;
  }
  return out;
}
