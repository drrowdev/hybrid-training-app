/**
 * Phase 1 "external cardio" — pure helper for the placeholder
 * prescription emitted when a block has `cardio_source: 'external'`.
 *
 * Lives in its own module (not in `actions.ts`) because the "use
 * server" boundary requires every export to be async. This helper is
 * called from both the materialiser inside `createBlock` and the unit
 * tests, so it has to be regular synchronous code.
 *
 * The single item exists so the calendar still shows the day and the
 * modality classifier still registers it as cardio (with stress load
 * 0 — see `itemsToClassifierMovements` in `actions.ts`). The user
 * logs the actual run via Runna / Garmin Coach / Hal Higdon / etc.
 */
import type { PrescriptionItem } from "@hta/db";

export function buildExternalCardioItems(
  cardioSourceName: string | null,
): PrescriptionItem[] {
  const trimmed =
    cardioSourceName && cardioSourceName.trim().length > 0
      ? cardioSourceName.trim()
      : null;
  const label = trimmed ?? "External program";
  return [
    {
      // No specific movement — `movementId` is the empty string sentinel
      // for items with `kind: "cardio_external"`. Callers that key off
      // `movementId` (movement-match dedupe, logged-set joins) should
      // gate on `kind` first.
      movementId: "",
      kind: "cardio_external",
      intensityLabel: label,
      protocolNote: `Logged via ${trimmed ?? "your external program"}.`,
    },
  ];
}
