/**
 * Per-set circuit stamping in the adapter.
 *
 * The adapter expands a `sets > 1` engine item into one loggable prescription
 * item per set. Circuit participation has to be decided at that moment: a linked
 * group runs `rounds = min(required sets)` across its members, so a member with
 * more sets keeps them but only the first `rounds` rotate. Without a per-set
 * marker every expanded set carries an identical copy of the circuit and the
 * logger cannot tell a rotation set from a solo tail set.
 */
import { describe, it, expect } from "vitest";
import type { PrescribedItem, SessionPrescription } from "@hta/program-core";
import { adaptSessionPrescription } from "../adapter";

const resolveMovement = (name: string, movementId?: string) => ({
  movementId: movementId ?? name,
  slug: name,
  displayName: name,
});

function adapt(items: PrescribedItem[]) {
  const session = { items } as SessionPrescription;
  return adaptSessionPrescription(session, resolveMovement).prescription.items;
}

const circuit = (over: Record<string, unknown> = {}) => ({
  id: "link-1",
  name: "Superset",
  position: 0,
  size: 2,
  rounds: 3,
  ...over,
});

function mainItem(over: Partial<PrescribedItem> = {}): PrescribedItem {
  return {
    kind: "main",
    name: "squat",
    movementId: "squat",
    sets: 3,
    reps: 5,
    weightKg: 100,
    ...over,
  } as PrescribedItem;
}

describe("adapter — circuit round stamping", () => {
  it("stamps an ascending round on each expanded set", () => {
    const out = adapt([mainItem({ circuit: circuit() })]);
    expect(out).toHaveLength(3);
    expect(out.map((it) => it.circuit?.round)).toEqual([0, 1, 2]);
    expect(out.every((it) => it.circuit?.id === "link-1")).toBe(true);
  });

  it("leaves sets beyond the round count with NO circuit", () => {
    // Five prescribed sets, but the group only rotates three rounds.
    const out = adapt([mainItem({ sets: 5, circuit: circuit({ rounds: 3 }) })]);
    expect(out).toHaveLength(5);
    expect(out.map((it) => it.circuit?.round)).toEqual([0, 1, 2, undefined, undefined]);
    expect(out[3]!.circuit).toBeUndefined();
    expect(out[4]!.circuit).toBeUndefined();
  });

  it("never stamps an optional set", () => {
    // setsMax above sets => the surplus is optional work, outside the rotation.
    const out = adapt([
      mainItem({ sets: 2, setsMax: 4, circuit: circuit({ rounds: 4 }) }),
    ]);
    expect(out).toHaveLength(4);
    expect(out.map((it) => it.optional ?? false)).toEqual([
      false,
      false,
      true,
      true,
    ]);
    expect(out.map((it) => it.circuit?.round)).toEqual([0, 1, undefined, undefined]);
  });

  it("does not stamp warm-ups", () => {
    const out = adapt([
      { kind: "warmup", name: "squat", movementId: "squat", sets: 1, reps: 5, weightKg: 60 } as PrescribedItem,
      mainItem({ circuit: circuit() }),
    ]);
    const warm = out.filter((it) => it.kind === "warmup");
    expect(warm).toHaveLength(1);
    expect(warm[0]!.circuit).toBeUndefined();
  });

  it("leaves un-linked items untouched", () => {
    const out = adapt([mainItem()]);
    expect(out).toHaveLength(3);
    expect(out.every((it) => it.circuit === undefined)).toBe(true);
    expect(out.every((it) => !("circuit" in it))).toBe(true);
  });

  it("keeps a single-set item's circuit as-is", () => {
    // No expansion happens, so there is no round to stamp.
    const out = adapt([mainItem({ sets: 1, circuit: circuit({ rounds: 1 }) })]);
    expect(out).toHaveLength(1);
    expect(out[0]!.circuit).toMatchObject({ id: "link-1", rounds: 1 });
  });

  it("stamps each member of a link independently", () => {
    const out = adapt([
      mainItem({ circuit: circuit({ position: 0 }) }),
      mainItem({
        name: "bench",
        movementId: "bench",
        circuit: circuit({ position: 1 }),
      }),
    ]);
    const squat = out.filter((it) => it.movementId === "squat");
    const bench = out.filter((it) => it.movementId === "bench");
    expect(squat.map((it) => it.circuit?.round)).toEqual([0, 1, 2]);
    expect(bench.map((it) => it.circuit?.round)).toEqual([0, 1, 2]);
    expect(squat[0]!.circuit?.position).toBe(0);
    expect(bench[0]!.circuit?.position).toBe(1);
  });
});
