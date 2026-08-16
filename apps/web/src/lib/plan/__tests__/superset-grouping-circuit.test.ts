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
  segmentSupersetSections,
  supersetGroupOfRow,
  supersetGroupOfSection,
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
});

describe("bracketing main and supplemental lifts", () => {
  // The preview used to bracket ACCESSORY rows only, because auto-pairing could
  // only ever produce accessory pairs. A user link spans main and supplemental
  // lifts too, and if those cards are not segmented the link the lifter created
  // is invisible on the surface they check before training.
  function section(
    movementId: string,
    circuit?: { id: string; position: number; size: number; name?: string },
  ) {
    const item: PrescriptionItem = {
      movementId,
      movementSlug: movementId,
      movementName: movementId,
      kind: "main",
      sets: 1,
      reps: 5,
      ...(circuit
        ? { circuit: { name: "Superset", rounds: 3, ...circuit } }
        : {}),
    };
    return {
      rowKey: movementId,
      movementId,
      movementName: movementId,
      movementSlug: movementId,
      warmups: [] as PrescriptionItem[],
      sets: [0, 1, 2].map((i) => ({
        item,
        setNumber: i + 1,
        isTopSet: false,
        isBackOff: false,
      })),
    };
  }

  it("brackets two consecutive linked supplemental lifts", () => {
    const segs = segmentSupersetSections([
      section("barbell-row"),
      section("pullup", { id: "link-1", position: 0, size: 2 }),
      section("overhead-press", { id: "link-1", position: 1, size: 2 }),
    ]);
    expect(segs.map((s) => s.kind)).toEqual(["solo", "superset"]);
    const cluster = segs[1]!;
    expect(
      cluster.kind === "superset" && cluster.sections.map((s) => s.movementId),
    ).toEqual(["pullup", "overhead-press"]);
  });

  it("carries the link name so a tri-set doesn't read as a superset", () => {
    const segs = segmentSupersetSections([
      section("a", { id: "l", position: 0, size: 3, name: "Tri-set" }),
      section("b", { id: "l", position: 1, size: 3, name: "Tri-set" }),
      section("c", { id: "l", position: 2, size: 3, name: "Tri-set" }),
    ]);
    expect(segs).toHaveLength(1);
    expect(segs[0]!.kind === "superset" && segs[0]!.name).toBe("Tri-set");
  });

  it("ignores warm-ups when reading the link, since they never rotate", () => {
    const s = section("squat", { id: "link-1", position: 0, size: 2 });
    s.warmups = [
      { movementId: "squat", kind: "warmup", sets: 1, reps: 5 },
    ] as PrescriptionItem[];
    expect(supersetGroupOfSection(s)).toBe("link-1");
  });

  it("leaves an unlinked section solo", () => {
    const segs = segmentSupersetSections([section("squat"), section("bench")]);
    expect(segs.map((s) => s.kind)).toEqual(["solo", "solo"]);
  });

  it("renders a lone member solo rather than a half-bracket", () => {
    const segs = segmentSupersetSections([
      section("pullup", { id: "link-1", position: 0, size: 2 }),
      section("row"),
    ]);
    expect(segs.map((s) => s.kind)).toEqual(["solo", "solo"]);
  });
});
