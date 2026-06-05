/**
 * Expand multi-set prescription items into single-set items.
 *
 * The session-log view (`groupPrescriptionByMovement` → MovementCard) and the
 * "same as planned" auto-fill treat **one prescription item = one loggable
 * set**. Main lifts already honour that: the assembler emits a strength wave as
 * N separate `sets: 1` items (e.g. 5·5·5 → three items). Accessories / back-off,
 * however, were emitted as a SINGLE item carrying a `sets: 4` count — so the
 * grouping under-rendered them as "1×12" and only let the user log one of the
 * four prescribed sets.
 *
 * This normaliser fans every item with `sets > 1` out into `sets` consecutive
 * `sets: 1` copies (all other fields preserved, original order kept). Items with
 * `sets <= 1` / no `sets` (warm-ups, cardio) pass through untouched. Applied at
 * the STORAGE boundary (block creation + quick-session generation) so every
 * downstream reader sees the uniform one-set-per-item shape. The engine
 * assembler output is unchanged — only what we persist is normalised.
 */
import type { Prescription, PrescriptionItem } from "@hta/db";

export function expandPrescriptionSetItems(
  items: readonly PrescriptionItem[],
): PrescriptionItem[] {
  const out: PrescriptionItem[] = [];
  for (const item of items) {
    const n = typeof item.sets === "number" ? item.sets : 1;
    if (n <= 1) {
      out.push(item);
      continue;
    }
    for (let i = 0; i < n; i++) {
      out.push({ ...item, sets: 1 });
    }
  }
  return out;
}

/** Convenience wrapper that normalises a whole `Prescription`. */
export function expandPrescriptionSets(prescription: Prescription): Prescription {
  return { ...prescription, items: expandPrescriptionSetItems(prescription.items ?? []) };
}
