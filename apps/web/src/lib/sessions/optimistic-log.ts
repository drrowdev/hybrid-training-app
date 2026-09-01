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
import type { AddStrengthSetResult } from "@/lib/sessions/actions";

export type OptimisticLog = {
  /** Stable client id for this pending entry (overlay LoggedSet id until confirmed). */
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
  /**
   * Real DB id, set once the server write resolves. Its presence means the entry
   * is "confirmed" (persisted) — at which point the overlay can surface the real
   * id for the edit link and the entry survives until the next server refresh
   * (rather than depending on a per-set revalidation).
   */
  serverId?: string;
};

/**
 * Outcome of a single `logSet` call, decided purely from its inputs so the
 * decision (defect #1) is unit-testable without mounting `SessionWorkArea`.
 */
export type LogSetOutcome = {
  /** Remove the overlay row so the failed slot doesn't keep showing "logged". */
  dropOverlay: boolean;
  /** Undo the provider registration (`registerStrengthLog`) for this key. */
  rollbackProvider: boolean;
  /** Server-assigned id to stamp onto the confirmed overlay row, if any. */
  confirmedServerId: string | null;
  /** Bodyweight TUT override to apply, if the server returned one. */
  bwTut: { family: string; tutAccumulated: number } | null;
  /** What `logSet` itself should return to its caller (the Focus Strip). */
  result: AddStrengthSetResult;
};

/**
 * Decide what `logSet` should do with its optimistic/overlay state once the
 * server action has settled (or thrown).
 *
 * The bug this pins (defect #1): a rejected **freestyle** log has no overlay
 * row (`hadOverlay` false — freestyle logs carry no `prescriptionItemIndex`
 * to reconcile against), but it still registered optimistic provider state
 * via `registerStrengthLog` before the write (`hadOptimistic` true, since
 * the provider tracks *any* logged movement, prescribed or not). The old
 * code gated the provider rollback behind `if (overlay)`, so a rejected
 * freestyle log rolled back nothing and returned before reaching the
 * rollback at all — `hasStrengthSets` stayed permanently true and Finish
 * could enable with zero persisted sets. The fix: rollback is keyed on
 * `hadOptimistic`, never on `hadOverlay`.
 */
export function planLogSetOutcome(
  input:
    | { kind: "network-error" }
    | {
        kind: "resolved";
        hadOptimistic: boolean;
        hadOverlay: boolean;
        result: AddStrengthSetResult;
      },
): LogSetOutcome {
  if (input.kind === "network-error") {
    // Offline / dropped connection. The outbox already has the durable entry
    // and will replay it on reconnect — keep every bit of optimistic state
    // and report success so the logger advances to the next set.
    return {
      dropOverlay: false,
      rollbackProvider: false,
      confirmedServerId: null,
      bwTut: null,
      result: { ok: true },
    };
  }

  const { hadOptimistic, hadOverlay, result } = input;

  if (result.error) {
    // Validation rejection — roll back EVERY bit of optimistic state this
    // call registered, whether or not it had an overlay entry.
    return {
      dropOverlay: hadOverlay,
      rollbackProvider: hadOptimistic,
      confirmedServerId: null,
      bwTut: null,
      result,
    };
  }

  if (!hadOverlay) {
    return {
      dropOverlay: false,
      rollbackProvider: false,
      confirmedServerId: null,
      bwTut: null,
      result,
    };
  }

  return {
    dropOverlay: false,
    rollbackProvider: false,
    confirmedServerId: result.set?.id ?? null,
    bwTut: result.bwTut ?? null,
    result,
  };
}

/** True once the server write has persisted and returned a real id. */
export function isConfirmed(log: OptimisticLog): boolean {
  return log.serverId != null;
}

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
    // Use the real DB id once confirmed so any id-keyed logic gets the true id.
    id: log.serverId ?? log.clientKey,
    set_index: setIndex,
    set_kind: log.setKind,
    weight_kg: log.weightKg,
    reps: log.reps,
    duration_sec: log.durationSec,
    distance_m: log.distanceM,
    rpe: log.rpe,
    skipped: log.skipped,
    skip_reason: log.skipReason,
    prescription_item_index: log.prescriptionItemIndex,
    movement: { id: log.movementId, slug: "", display_name: "", primary_region: "" },
  };
}

/**
 * Overlay the server's prescription-index -> real-set-id map with confirmed
 * pending entries, so the "Edit set" link works mid-session WITHOUT a per-set
 * page revalidation. The server map wins where it already has an index (it's
 * authoritative once the refresh that populated it has landed); confirmed
 * overlay entries fill the gaps for sets the server snapshot predates.
 */
export function buildLoggedSetIdOverlay(
  serverMap: Readonly<Record<number, string>>,
  pending: ReadonlyArray<OptimisticLog>,
): Record<number, string> {
  let out: Record<number, string> = serverMap as Record<number, string>;
  let copied = false;
  for (const log of pending) {
    if (log.serverId == null) continue; // confirmed only — needs the real id
    if (log.prescriptionItemIndex == null) continue;
    if (out[log.prescriptionItemIndex] != null) continue; // server wins
    if (!copied) {
      out = { ...serverMap };
      copied = true;
    }
    out[log.prescriptionItemIndex] = log.serverId;
  }
  return out;
}

/**
 * Reconcile the overlay against a freshly-fetched server snapshot. Drops every
 * CONFIRMED entry: any server refresh re-queries set_logs, so its snapshot
 * already reflects every persisted write up to that point — the server becomes
 * authoritative for those rows (and a set deleted via the edit page is then
 * correctly absent, instead of lingering as a stale "logged" slot). In-flight
 * entries (no serverId yet) are kept until their own write resolves.
 */
export function dropConfirmed(
  pending: ReadonlyArray<OptimisticLog>,
): OptimisticLog[] {
  return pending.filter((log) => log.serverId == null);
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
