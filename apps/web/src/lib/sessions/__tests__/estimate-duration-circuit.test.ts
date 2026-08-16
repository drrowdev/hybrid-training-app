/**
 * Circuit-aware duration pricing, and the governor's solo-pricing guarantee.
 *
 * Fixtures deliberately mirror what the platform adapter actually stores: an
 * engine item with `sets > 1` is expanded into ONE loggable prescription item
 * per set, each carrying a copy of the circuit. So a 2-movement × 3-round link
 * is six items sharing one circuit id — not two. Pricing that groups by circuit
 * id alone would mis-count it.
 */
import { describe, expect, it } from "vitest";
import type { PrescriptionItem } from "@hta/db";
import {
  SUPERSET_TRANSITION_SEC,
  WORK_SEC_PER_SET,
  estimateSessionSeconds,
} from "../estimate-duration";
import { restSecondsForKind } from "../rest";

const REST_MAIN = restSecondsForKind("main");
const REST_ACCESSORY = restSecondsForKind("accessory");

/** One granular loggable set, as the adapter emits it. */
function set(
  kind: PrescriptionItem["kind"],
  movementId: string,
  circuit?: { id: string; position: number; size: number; rounds: number; round: number },
): PrescriptionItem {
  return {
    movementId,
    kind,
    sets: 1,
    reps: 5,
    ...(circuit ? { circuit: { name: "Superset", ...circuit } } : {}),
  };
}

/** `rounds` granular sets for one station of a circuit. */
function station(
  kind: PrescriptionItem["kind"],
  movementId: string,
  position: number,
  size: number,
  rounds: number,
): PrescriptionItem[] {
  return Array.from({ length: rounds }, (_, round) =>
    set(kind, movementId, { id: "link-1", position, size, rounds, round }),
  );
}

describe("circuit pricing", () => {
  it("prices a two-station link as one overlapped rest per round", () => {
    const items = [
      ...station("accessory", "curl", 0, 2, 3),
      ...station("accessory", "pushdown", 1, 2, 3),
    ];
    // 3 rounds × (2 × work + 1 switch + one accessory rest)
    const expected =
      3 * (2 * WORK_SEC_PER_SET + SUPERSET_TRANSITION_SEC + REST_ACCESSORY);
    expect(estimateSessionSeconds(items)).toBe(expected);
  });

  it("beats solo pricing of the same work", () => {
    const items = [
      ...station("accessory", "curl", 0, 2, 3),
      ...station("accessory", "pushdown", 1, 2, 3),
    ];
    const solo = 6 * (WORK_SEC_PER_SET + REST_ACCESSORY);
    expect(estimateSessionSeconds(items)).toBeLessThan(solo);
    expect(estimateSessionSeconds(items, "solo")).toBe(solo);
  });

  it("charges one switch per extra station in a tri-set", () => {
    const items = [
      ...station("accessory", "a", 0, 3, 3),
      ...station("accessory", "b", 1, 3, 3),
      ...station("accessory", "c", 2, 3, 3),
    ];
    const expected =
      3 * (3 * WORK_SEC_PER_SET + 2 * SUPERSET_TRANSITION_SEC + REST_ACCESSORY);
    expect(estimateSessionSeconds(items)).toBe(expected);
  });

  it("rests at the LONGEST member's requirement", () => {
    const items = [
      ...station("main", "squat", 0, 2, 3),
      ...station("accessory", "curl", 1, 2, 3),
    ];
    const expected =
      3 * (2 * WORK_SEC_PER_SET + SUPERSET_TRANSITION_SEC + REST_MAIN);
    expect(estimateSessionSeconds(items)).toBe(expected);
  });

  it("prices warm-ups and beyond-rounds sets solo", () => {
    const warmup = set("warmup", "squat");
    const tail = set("main", "squat");
    const items = [
      warmup,
      ...station("main", "squat", 0, 2, 3),
      tail,
      ...station("accessory", "curl", 1, 2, 3),
    ];
    const rounds =
      3 * (2 * WORK_SEC_PER_SET + SUPERSET_TRANSITION_SEC + REST_MAIN);
    const solo =
      WORK_SEC_PER_SET +
      restSecondsForKind("warmup") +
      (WORK_SEC_PER_SET + REST_MAIN);
    expect(estimateSessionSeconds(items)).toBe(rounds + solo);
  });

  it("prices a circuit missing a station entirely solo", () => {
    // Declared size 2 but only one station present — never a half-bracket.
    const items = station("accessory", "curl", 0, 2, 3);
    expect(estimateSessionSeconds(items)).toBe(
      3 * (WORK_SEC_PER_SET + REST_ACCESSORY),
    );
  });

  it("prices surplus rounds at one station solo", () => {
    const items = [
      ...station("accessory", "curl", 0, 2, 4),
      ...station("accessory", "pushdown", 1, 2, 3),
    ];
    // Three complete rounds, then the fourth curl set runs alone.
    const paired =
      3 * (2 * WORK_SEC_PER_SET + SUPERSET_TRANSITION_SEC + REST_ACCESSORY);
    expect(estimateSessionSeconds(items)).toBe(
      paired + (WORK_SEC_PER_SET + REST_ACCESSORY),
    );
  });

  it("still prices legacy circuits that carry no round stamp", () => {
    // Pre-stamp stored sessions (the engine's AB Triad): position order within
    // each station IS round order.
    const legacy = (movementId: string, position: number) =>
      Array.from({ length: 3 }, () => ({
        movementId,
        kind: "accessory" as const,
        sets: 1,
        reps: 5,
        circuit: {
          id: "tb-ab-triad",
          name: "AB Triad",
          position,
          size: 3,
          rounds: 3,
        },
      }));
    const items = [
      ...legacy("leg", 0),
      ...legacy("knee", 1),
      ...legacy("toes", 2),
    ];
    const expected =
      3 * (3 * WORK_SEC_PER_SET + 2 * SUPERSET_TRANSITION_SEC + REST_ACCESSORY);
    expect(estimateSessionSeconds(items)).toBe(expected);
  });
});

describe("solo mode — the ADR-0026 governor invariant", () => {
  it("ignores circuit grouping entirely", () => {
    const items = [
      ...station("accessory", "curl", 0, 2, 3),
      ...station("accessory", "pushdown", 1, 2, 3),
    ];
    const bare = items.map((it) => {
      const copy = { ...it };
      delete copy.circuit;
      return copy;
    });
    expect(estimateSessionSeconds(items, "solo")).toBe(
      estimateSessionSeconds(bare, "solo"),
    );
  });

  it("ignores antagonist-superset grouping too", () => {
    const paired: PrescriptionItem[] = [
      { movementId: "curl", kind: "accessory", sets: 3, meta: { supersetGroup: "ss-1" } },
      { movementId: "pushdown", kind: "accessory", sets: 3, meta: { supersetGroup: "ss-1" } },
    ];
    expect(estimateSessionSeconds(paired, "solo")).toBe(
      6 * (WORK_SEC_PER_SET + REST_ACCESSORY),
    );
  });

  it("is monotonic in added work, which the governor relies on", () => {
    const base = station("accessory", "curl", 0, 2, 3);
    const more = [...base, set("accessory", "extra")];
    expect(estimateSessionSeconds(more, "solo")).toBeGreaterThan(
      estimateSessionSeconds(base, "solo"),
    );
  });

  it("defaults to grouped so display surfaces need no opt-in", () => {
    const items = [
      ...station("accessory", "curl", 0, 2, 3),
      ...station("accessory", "pushdown", 1, 2, 3),
    ];
    expect(estimateSessionSeconds(items)).toBe(
      estimateSessionSeconds(items, "grouped"),
    );
    expect(estimateSessionSeconds(items)).not.toBe(
      estimateSessionSeconds(items, "solo"),
    );
  });

  it("agrees with grouped pricing when nothing is grouped", () => {
    const items = [set("main", "squat"), set("accessory", "curl")];
    expect(estimateSessionSeconds(items, "solo")).toBe(
      estimateSessionSeconds(items, "grouped"),
    );
  });
});
