import { describe, it, expect } from "vitest";
import type { PrescriptionItem } from "@hta/db";
import type { PrescriptionMovementRow } from "../prescription-grouping";
import {
  segmentSupersetRows,
  supersetGroupOfRow,
  supersetSlotOfRow,
} from "../superset-grouping";

function accItem(
  movementId: string,
  meta?: Record<string, unknown>,
): PrescriptionItem {
  return {
    movementId,
    movementSlug: movementId,
    movementName: movementId,
    kind: "accessory",
    sets: 3,
    reps: 10,
    ...(meta ? { meta } : {}),
  } as PrescriptionItem;
}

function row(
  movementId: string,
  meta?: Record<string, unknown>,
): PrescriptionMovementRow {
  return {
    rowKey: movementId,
    movementId,
    movementName: movementId,
    movementSlug: movementId,
    items: [accItem(movementId, meta)],
  };
}

describe("segmentSupersetRows", () => {
  it("returns one solo segment per row when nothing is paired", () => {
    const rows = [row("a"), row("b"), row("c")];
    const segs = segmentSupersetRows(rows);
    expect(segs).toHaveLength(3);
    expect(segs.every((s) => s.kind === "solo")).toBe(true);
  });

  it("clusters two consecutive rows sharing a group id into a superset", () => {
    const rows = [
      row("curl", { supersetGroup: "ss-1", supersetSlot: "A1" }),
      row("pushdown", { supersetGroup: "ss-1", supersetSlot: "A2" }),
      row("calf"),
    ];
    const segs = segmentSupersetRows(rows);
    expect(segs).toHaveLength(2);
    expect(segs[0]).toMatchObject({ kind: "superset", groupId: "ss-1" });
    if (segs[0].kind === "superset") {
      expect(segs[0].rows.map((r) => r.movementId)).toEqual(["curl", "pushdown"]);
    }
    expect(segs[1]).toMatchObject({ kind: "solo" });
  });

  it("renders a widowed member (lone group id) as solo, not a half-bracket", () => {
    const rows = [row("curl", { supersetGroup: "ss-1", supersetSlot: "A1" }), row("calf")];
    const segs = segmentSupersetRows(rows);
    expect(segs).toHaveLength(2);
    expect(segs.every((s) => s.kind === "solo")).toBe(true);
  });

  it("keeps two different adjacent supersets separate", () => {
    const rows = [
      row("curl", { supersetGroup: "ss-1", supersetSlot: "A1" }),
      row("pushdown", { supersetGroup: "ss-1", supersetSlot: "A2" }),
      row("legext", { supersetGroup: "ss-2", supersetSlot: "A1" }),
      row("legcurl", { supersetGroup: "ss-2", supersetSlot: "A2" }),
    ];
    const segs = segmentSupersetRows(rows);
    expect(segs).toHaveLength(2);
    expect(segs[0]).toMatchObject({ kind: "superset", groupId: "ss-1" });
    expect(segs[1]).toMatchObject({ kind: "superset", groupId: "ss-2" });
  });

  it("supersetGroupOfRow / supersetSlotOfRow read the item meta", () => {
    const r = row("curl", { supersetGroup: "ss-1", supersetSlot: "A2" });
    expect(supersetGroupOfRow(r)).toBe("ss-1");
    expect(supersetSlotOfRow(r)).toBe("A2");
    expect(supersetGroupOfRow(row("calf"))).toBeNull();
    expect(supersetSlotOfRow(row("calf"))).toBeNull();
  });
});
