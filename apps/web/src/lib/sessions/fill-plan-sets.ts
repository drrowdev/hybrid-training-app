import type { PrescriptionItem } from "@hta/db";
import { createHash } from "node:crypto";

export type PlannedSetKind =
  | "warmup"
  | "main"
  | "back_off"
  | "accessory"
  | "tendon";

export type ExistingPlannedSet = {
  movement_id: string;
  set_kind: string;
  set_index: number;
  prescription_item_index: number | null;
  client_log_id: string | null;
};

export type MissingPlannedSet = {
  itemIndex: number;
  copyIndex: number;
  setIndex: number;
  setKind: PlannedSetKind;
};

const STRENGTH_KINDS: ReadonlySet<string> = new Set([
  "warmup",
  "main",
  "back_off",
  "accessory",
  "tendon",
]);

function movementKindKey(
  movementId: string,
  setKind: string,
): string {
  return `${movementId}::${setKind}`;
}

export function plannedSetClientId(
  sessionId: string,
  itemIndex: number,
  copyIndex: number,
  movementId: string,
  setKind: PlannedSetKind,
): string {
  const hash = createHash("sha256")
    .update(
      `${sessionId}:${itemIndex}:${copyIndex}:${movementId}:${setKind}`,
    )
    .digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(
    13,
    16,
  )}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

export function planMissingPrescriptionSets(
  sessionId: string,
  items: readonly PrescriptionItem[],
  existing: readonly ExistingPlannedSet[],
): MissingPlannedSet[] {
  const exactByItem = new Map<string, ExistingPlannedSet[]>();
  const legacyUnindexedByMovement = new Map<
    string,
    ExistingPlannedSet[]
  >();
  for (const row of existing) {
    const movementKey = movementKindKey(row.movement_id, row.set_kind);
    if (row.prescription_item_index == null) {
      const rows = legacyUnindexedByMovement.get(movementKey) ?? [];
      rows.push(row);
      legacyUnindexedByMovement.set(movementKey, rows);
      continue;
    }
    const exactKey = `${movementKey}::${row.prescription_item_index}`;
    const rows = exactByItem.get(exactKey) ?? [];
    rows.push(row);
    exactByItem.set(exactKey, rows);
  }

  let nextSetIndex =
    existing.reduce(
      (highest, row) => Math.max(highest, row.set_index),
      -1,
    ) + 1;
  const missing: MissingPlannedSet[] = [];

  items.forEach((item, itemIndex) => {
    if (!STRENGTH_KINDS.has(item.kind) || !item.movementId) return;
    const setKind = item.kind as PlannedSetKind;
    const desired = Math.max(1, item.sets ?? 1);
    const movementKey = movementKindKey(item.movementId, setKind);
    const exactKey = `${movementKey}::${itemIndex}`;
    const expectedIds = new Map(
      Array.from({ length: desired }, (_, copyIndex) => [
        plannedSetClientId(
          sessionId,
          itemIndex,
          copyIndex,
          item.movementId,
          setKind,
        ),
        copyIndex,
      ]),
    );
    const deterministicOrdinals = new Set<number>();
    let legacyCoverage = 0;
    for (const row of exactByItem.get(exactKey) ?? []) {
      const ordinal =
        row.client_log_id != null
          ? expectedIds.get(row.client_log_id)
          : undefined;
      if (ordinal != null) deterministicOrdinals.add(ordinal);
      else legacyCoverage += 1;
    }
    const unindexed =
      legacyUnindexedByMovement.get(movementKey) ?? [];
    const unindexedUsed = Math.min(
      unindexed.length,
      Math.max(
        0,
        desired - legacyCoverage - deterministicOrdinals.size,
      ),
    );
    if (unindexedUsed > 0) {
      legacyCoverage += unindexedUsed;
      legacyUnindexedByMovement.set(
        movementKey,
        unindexed.slice(unindexedUsed),
      );
    }

    const legacyReserved = new Set(
      Array.from(
        { length: Math.min(desired, legacyCoverage) },
        (_, ordinal) => ordinal,
      ),
    );
    for (let copyIndex = 0; copyIndex < desired; copyIndex++) {
      if (
        legacyReserved.has(copyIndex) ||
        deterministicOrdinals.has(copyIndex)
      ) {
        continue;
      }
      missing.push({
        itemIndex,
        copyIndex,
        setIndex: nextSetIndex++,
        setKind,
      });
    }
  });

  return missing;
}
