/**
 * Plan / Preview bracketing driven by a linked circuit rather than the legacy
 * `meta.supersetGroup`. User-authored links are expressed as `item.circuit`, so
 * the preview must bracket them identically or the grouping disappears from the
 * Plan surfaces when auto-pairing is removed.
 */
import { describe, it, expect } from "vitest";
import type { PrescriptionItem } from "@hta/db";
import type { PrescriptionMovementRow } from "../prescription-grouping";
import {
  circuitNameOfRow,
  segmentSupersetRows,
  supersetGroupOfRow,
} from "../superset-grouping";

function circuitRow(
  movementId: string,
  position: number,
  opts: { id?: string; size?: number; name?: string } = {},
): PrescriptionMovementRow {
  const { id = "link-1", size = 2, name = "Superset" } = opts;
  const items: PrescriptionItem[] = Array.from({ length: 3 }, (_, round) => ({
    movementId,
    movementSlug: movementId,
    movementName: movementId,
    kind: "main",
    sets: 1,
    reps: 5,
    circuit: { id, name, position, size, rounds: 3, round },
  }));
  return {
    rowKey: movementId,
    movementId,
    movementName: movementId,
    movementSlug: movementId,
    items,
  };
}

function soloRow(movementId: string): PrescriptionMovementRow {
  return {
    rowKey: movementId,
    movementId,
    movementName: movementId,
    movementSlug: movementId,
    items: [
      {
        movementId,
        movementSlug: movementId,
        movementName: movementId,
        kind: "main",
        sets: 3,
        reps: 5,
      },
    ],
  };
}

describe("circuit-backed bracketing", () => {
  it("reads the circuit id as the group id", () => {
    expect(supersetGroupOfRow(circuitRow("squat", 0))).toBe("link-1");
    expect(supersetGroupOfRow(soloRow("squat"))).toBeNull();
  });

  it("exposes the user-facing link name", () => {
    expect(circuitNameOfRow(circuitRow("squat", 0))).toBe("Superset");
    expect(circuitNameOfRow(soloRow("squat"))).toBeNull();
  });

  it("brackets consecutive rows sharing a circuit id", () => {
    const rows = [
      soloRow("deadlift"),
      circuitRow("squat", 0),
      circuitRow("bench", 1),
      soloRow("row"),
    ];
    const segs = segmentSupersetRows(rows);
    expect(segs.map((s) => s.kind)).toEqual([
      "solo",
      "superset",
      "solo",
    ]);
    const cluster = segs[1];
    expect(cluster.kind === "superset" && cluster.groupId).toBe("link-1");
    expect(
      cluster.kind === "superset" &&
        cluster.rows.map((r) => r.movementId),
    ).toEqual(["squat", "bench"]);
  });

  it("brackets a three-member link", () => {
    const rows = [
      circuitRow("a", 0, { size: 3, name: "Tri-set" }),
      circuitRow("b", 1, { size: 3, name: "Tri-set" }),
      circuitRow("c", 2, { size: 3, name: "Tri-set" }),
    ];
    const segs = segmentSupersetRows(rows);
    expect(segs).toHaveLength(1);
    expect(segs[0].kind === "superset" && segs[0].rows).toHaveLength(3);
  });

  it("renders a lone member solo rather than a half-bracket", () => {
    const segs = segmentSupersetRows([circuitRow("squat", 0), soloRow("row")]);
    expect(segs.map((s) => s.kind)).toEqual(["solo", "solo"]);
  });

  it("keeps two different links apart", () => {
    const rows = [
      circuitRow("a", 0, { id: "link-1" }),
      circuitRow("b", 1, { id: "link-1" }),
      circuitRow("c", 0, { id: "link-2" }),
      circuitRow("d", 1, { id: "link-2" }),
    ];
    const segs = segmentSupersetRows(rows);
    expect(segs).toHaveLength(2);
    expect(segs.map((s) => (s.kind === "superset" ? s.groupId : null))).toEqual([
      "link-1",
      "link-2",
    ]);
  });

  it("prefers an explicit supersetGroup when both are somehow present", () => {
    const row = circuitRow("squat", 0);
    row.items = row.items.map((it) => ({ ...it, meta: { supersetGroup: "ss-9" } }));
    expect(supersetGroupOfRow(row)).toBe("ss-9");
  });
});
