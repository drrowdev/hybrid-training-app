/**
 * Rehab session links.
 *
 * The cases that matter here are the ones that separate rehab from strength: a
 * station spanning several items (sides), circuit-id collision with a strength
 * link in the same embedded session, and contiguity for the preview bracket.
 */
import { describe, it, expect } from "vitest";
import type { PrescriptionItem } from "@hta/db";
import {
  applyRehabLinks,
  rehabCircuitId,
  rehabLinkableMovements,
  rehabSeriesKey,
} from "../rehab-links";

/** One expanded (single-set) rehab item. */
function item(movementId: string, name = movementId): PrescriptionItem {
  return {
    movementId,
    movementName: name,
    kind: "tendon",
    sets: 1,
    meta: { rehab: true },
  } as PrescriptionItem;
}

/** `n` expanded items for one movement, as a protocol row with `n` sets gives. */
function sets(movementId: string, n: number): PrescriptionItem[] {
  return Array.from({ length: n }, () => item(movementId));
}

const link = (id: string, members: string[], name = "Superset") => ({
  id,
  name,
  members,
});

function circuits(items: readonly PrescriptionItem[]) {
  return items.map((i) =>
    i.circuit
      ? `${i.movementId}:A${i.circuit.position + 1}r${i.circuit.round}`
      : `${i.movementId}:solo`,
  );
}

describe("rehabSeriesKey / rehabCircuitId", () => {
  it("keys links by protocol, so a link travels with the protocol", () => {
    expect(rehabSeriesKey("protocol-2")).toBe("rehab.protocol-2");
  });

  it("accepts the legacy synthetic protocol id", () => {
    // V2 customizations normalise to `protocol-1`, so legacy needs no special
    // case — it resolves through the same key.
    expect(rehabSeriesKey("protocol-1")).toBe("rehab.protocol-1");
  });

  it("namespaces the circuit id away from strength links", () => {
    // Both editors mint `link-1`, and rehab is embedded INTO the strength
    // prescription. Unnamespaced, the logger would see four groups claiming a
    // two-station circuit and drop both.
    expect(rehabCircuitId("protocol-1", "link-1")).toBe(
      "rehab:protocol-1:link-1",
    );
    expect(rehabCircuitId("protocol-1", "link-1")).not.toBe("link-1");
  });
});

describe("applyRehabLinks — the ordinary case", () => {
  const items = [...sets("cope", 3), ...sets("band", 3)];

  it("returns items untouched when nothing is linked", () => {
    expect(applyRehabLinks(items, [], "p1")).toEqual(items);
  });

  it("stamps a station and a round on every participating set", () => {
    const out = applyRehabLinks(items, [link("link-1", ["cope", "band"])], "p1");
    // Station-major, like the strength path: the preview brackets CONSECUTIVE
    // rows sharing a circuit id, and navigation is round-major off the stamped
    // `round` rather than off physical order.
    expect(circuits(out)).toEqual([
      "cope:A1r0",
      "cope:A1r1",
      "cope:A1r2",
      "band:A2r0",
      "band:A2r1",
      "band:A2r2",
    ]);
  });

  it("describes the circuit consistently on each member", () => {
    const out = applyRehabLinks(items, [link("link-1", ["cope", "band"])], "p1");
    for (const i of out) {
      expect(i.circuit?.id).toBe("rehab:p1:link-1");
      expect(i.circuit?.size).toBe(2);
      expect(i.circuit?.rounds).toBe(3);
    }
  });

  it("names a three-station link as authored", () => {
    const out = applyRehabLinks(
      [...sets("a", 2), ...sets("b", 2), ...sets("c", 2)],
      [link("link-1", ["a", "b", "c"], "Tri-set")],
      "p1",
    );
    expect(out[0]!.circuit?.name).toBe("Tri-set");
    expect(out[0]!.circuit?.size).toBe(3);
  });
});

describe("a movement appearing twice is ONE station", () => {
  // The reported shape: a protocol addresses sides as separate rows, but the
  // logger keys rehab cards as `rehab:<movementId>` with side excluded, so both
  // rows are one card.
  it("puts BOTH sides in the rotation, not just the first", () => {
    // 3 left + 3 right = a 6-deep station; paired with a 6-set partner it
    // rotates fully. Left-only participation is exactly the bug the round
    // stamp exists to prevent.
    const items = [...sets("cope", 6), ...sets("band", 6)];
    const out = applyRehabLinks(items, [link("link-1", ["cope", "band"])], "p1");
    const copeRounds = out
      .filter((i) => i.movementId === "cope")
      .map((i) => i.circuit?.round);
    expect(copeRounds).toEqual([0, 1, 2, 3, 4, 5]);
    expect(out.every((i) => i.circuit != null)).toBe(true);
  });

  it("assigns each set a distinct round — never a duplicate", () => {
    const items = [...sets("cope", 4), ...sets("band", 4)];
    const out = applyRehabLinks(items, [link("link-1", ["cope", "band"])], "p1");
    const rounds = out
      .filter((i) => i.movementId === "cope")
      .map((i) => i.circuit!.round);
    expect(new Set(rounds).size).toBe(rounds.length);
  });

  it("counts the station's depth in sets, so rounds is not the row count", () => {
    // Two rows (left/right) × 3 sets is a 6-deep station, not a 2-deep one.
    const out = applyRehabLinks(
      [...sets("cope", 6), ...sets("band", 6)],
      [link("link-1", ["cope", "band"])],
      "p1",
    );
    expect(out[0]!.circuit?.rounds).toBe(6);
  });
});

describe("unequal stations", () => {
  it("rotates the shallowest depth and leaves the tail solo", () => {
    const out = applyRehabLinks(
      [...sets("cope", 4), ...sets("band", 2)],
      [link("link-1", ["cope", "band"])],
      "p1",
    );
    const cope = out.filter((i) => i.movementId === "cope");
    expect(cope.map((i) => i.circuit?.round)).toEqual([0, 1, undefined, undefined]);
    expect(out[0]!.circuit?.rounds).toBe(2);
  });

  it("gives the solo tail no circuit at all, so it rests in full", () => {
    const out = applyRehabLinks(
      [...sets("cope", 3), ...sets("band", 1)],
      [link("link-1", ["cope", "band"])],
      "p1",
    );
    const tail = out.filter((i) => i.movementId === "cope").slice(1);
    expect(tail.every((i) => i.circuit == null)).toBe(true);
  });
});

describe("members are emitted contiguously", () => {
  it("gathers a split link at the earliest member's position", () => {
    // Ordered A, solo, B: without reordering this navigates as a circuit but
    // the preview brackets nothing, because it only brackets consecutive rows.
    const items = [item("a"), item("mid"), item("b")];
    const out = applyRehabLinks(items, [link("link-1", ["a", "b"])], "p1");
    expect(out.map((i) => i.movementId)).toEqual(["a", "b", "mid"]);
  });

  it("emits stations in the authored order, not protocol order", () => {
    const items = [item("a"), item("b")];
    const out = applyRehabLinks(items, [link("link-1", ["b", "a"])], "p1");
    expect(out.map((i) => i.movementId)).toEqual(["b", "a"]);
    expect(out[0]!.circuit?.position).toBe(0);
  });

  it("leaves unrelated items in their original order", () => {
    const items = [item("x"), item("a"), item("y"), item("b"), item("z")];
    const out = applyRehabLinks(items, [link("link-1", ["a", "b"])], "p1");
    expect(out.map((i) => i.movementId)).toEqual(["x", "a", "b", "y", "z"]);
  });
});

describe("links that cannot be realised", () => {
  it("drops a link whole when a member is absent — never a half-bracket", () => {
    const items = [...sets("cope", 2), ...sets("band", 2)];
    const out = applyRehabLinks(items, [link("link-1", ["cope", "gone"])], "p1");
    expect(out.every((i) => i.circuit == null)).toBe(true);
    expect(out).toEqual(items);
  });

  it("keeps other links when one is unrealisable", () => {
    const items = [...sets("a", 1), ...sets("b", 1), ...sets("c", 1)];
    const out = applyRehabLinks(
      items,
      [link("link-1", ["a", "gone"]), link("link-2", ["b", "c"])],
      "p1",
    );
    expect(out.find((i) => i.movementId === "a")?.circuit).toBeUndefined();
    expect(out.find((i) => i.movementId === "b")?.circuit?.id).toBe(
      "rehab:p1:link-2",
    );
  });

  it("refuses to let a second link claim a movement the first took", () => {
    // `PrescriptionItem.circuit` is singular, so overlap is unrepresentable.
    const items = [...sets("a", 1), ...sets("b", 1), ...sets("c", 1)];
    const out = applyRehabLinks(
      items,
      [link("link-1", ["a", "b"]), link("link-2", ["b", "c"])],
      "p1",
    );
    expect(out.find((i) => i.movementId === "a")?.circuit?.id).toBe(
      "rehab:p1:link-1",
    );
    expect(out.find((i) => i.movementId === "c")?.circuit).toBeUndefined();
  });
});

describe("two independent links in one protocol", () => {
  it("keeps them separate, each with its own id and stations", () => {
    const items = [
      ...sets("a", 2),
      ...sets("b", 2),
      ...sets("c", 2),
      ...sets("d", 2),
    ];
    const out = applyRehabLinks(
      items,
      [link("link-1", ["a", "b"]), link("link-2", ["c", "d"])],
      "p1",
    );
    expect(out.find((i) => i.movementId === "a")?.circuit?.id).toBe(
      "rehab:p1:link-1",
    );
    expect(out.find((i) => i.movementId === "c")?.circuit?.id).toBe(
      "rehab:p1:link-2",
    );
    expect(out.find((i) => i.movementId === "d")?.circuit?.position).toBe(1);
  });
});

describe("input is not mutated", () => {
  it("leaves the caller's items untouched", () => {
    const items = [...sets("a", 1), ...sets("b", 1)];
    const before = JSON.stringify(items);
    applyRehabLinks(items, [link("link-1", ["a", "b"])], "p1");
    expect(JSON.stringify(items)).toBe(before);
  });
});

describe("rehabLinkableMovements", () => {
  it("offers one entry per distinct movement, merging repeated rows", () => {
    expect(
      rehabLinkableMovements([
        { movementId: "cope", movementName: "Copenhagen plank" },
        { movementId: "cope", movementName: "Copenhagen plank" },
        { movementId: "band", movementName: "Band pull-apart" },
      ]),
    ).toEqual([
      { key: "cope", label: "Copenhagen plank" },
      { key: "band", label: "Band pull-apart" },
    ]);
  });

  it("skips rows with no movement chosen yet", () => {
    expect(rehabLinkableMovements([{ movementId: "" }])).toEqual([]);
  });
});
