/**
 * AB Triad end-to-end through the REAL engine and the REAL adapter.
 *
 * The Playwright suite (`platform-program-desktop.spec.ts`) asserts the stored
 * prescription carries `circuit.id === "tb-ab-triad"` with `rounds === 3`, and
 * that the logger's focus strip walks "Round 1 of 3" → "Round 2 of 3". Those
 * specs need a live Supabase, so this pins the same contract at the seam the
 * rework actually touched: engine emission → adapter set-expansion → logger
 * membership and navigation.
 */
import { describe, it, expect } from "vitest";
import type { PlatformContext } from "@hta/program-core";
import { tacticalBarbellEngine as tb } from "@hta/tacticalbarbell";
import { adaptSessionPrescription } from "../adapter";
import { groupPrescriptionByMovement } from "@/lib/sessions/movement-grouping";
import {
  buildLinkedCircuitByMovementId,
  circuitRoundFor,
  firstOpenCircuitMovementId,
  participatingItemIndices,
} from "@/lib/sessions/linked-circuit";

const ctx: PlatformContext = {
  oneRepMaxes: {
    squat: 200,
    bench: 100,
    deadlift: 250,
    press: 100,
    "overhead-press": 100,
    "weighted-pullup": 50,
    pullup: 50,
    "barbell-row": 120,
    "rack-pull": 250,
  },
  roundingKg: 2.5,
};

const resolveMovement = (name: string, movementId?: string) => ({
  movementId: movementId ?? name,
  slug: name,
  displayName: name,
});

/** The first materialised session in any TB template that carries the triad. */
function abTriadPrescription() {
  for (const templateId of ["zulu", "operator", "fighter", "mass", "activation"]) {
    const instance = tb.setup({ values: { templateId } }, ctx);
    for (const spec of tb.timeline(instance)) {
      const engineRx = tb.prescribe(instance, spec.ref, ctx);
      if (!engineRx.items.some((it) => it.circuit?.id === "tb-ab-triad")) continue;
      return adaptSessionPrescription(engineRx, resolveMovement).prescription;
    }
  }
  return null;
}

describe("AB Triad — engine → adapter → logger", () => {
  const prescription = abTriadPrescription();

  it("still materialises somewhere in the TB catalog", () => {
    expect(prescription).not.toBeNull();
  });

  it("keeps the circuit identity the e2e suite asserts", () => {
    if (!prescription) return;
    const tagged = prescription.items.filter(
      (it) => it.circuit?.id === "tb-ab-triad",
    );
    expect(tagged.length).toBeGreaterThan(0);
    for (const it of tagged) {
      expect(it.circuit).toMatchObject({
        id: "tb-ab-triad",
        name: "AB Triad",
        size: 3,
      });
      expect(it.circuit!.rounds).toBeGreaterThanOrEqual(1);
    }
  });

  it("stamps a round on every rotating set and never on an optional one", () => {
    if (!prescription) return;
    const tagged = prescription.items.filter(
      (it) => it.circuit?.id === "tb-ab-triad",
    );
    for (const it of tagged) {
      expect(typeof it.circuit!.round).toBe("number");
      expect(it.circuit!.round!).toBeLessThan(it.circuit!.rounds);
      expect(it.optional ?? false).toBe(false);
    }
  });

  it("resolves as a complete three-movement circuit in the logger", () => {
    if (!prescription) return;
    const groups = groupPrescriptionByMovement(prescription);
    const membership = buildLinkedCircuitByMovementId(groups);
    const members = groups.filter(
      (g) => membership.get(g.movementId)?.id === "tb-ab-triad",
    );
    expect(members).toHaveLength(3);
    // Distinct positions 0,1,2 — the round-major order.
    expect(
      members
        .map((g) => membership.get(g.movementId)!.position)
        .sort((a, b) => a - b),
    ).toEqual([0, 1, 2]);
  });

  it("walks round-major and reports the round the focus strip shows", () => {
    if (!prescription) return;
    const groups = groupPrescriptionByMovement(prescription);
    const membership = buildLinkedCircuitByMovementId(groups);
    const members = groups
      .filter((g) => membership.get(g.movementId)?.id === "tb-ab-triad")
      .sort(
        (a, b) =>
          membership.get(a.movementId)!.position -
          membership.get(b.movementId)!.position,
      );
    const info = membership.get(members[0]!.movementId)!;
    const covered = new Set<number>();

    // Round 1 — one set of each, in position order.
    expect(circuitRoundFor(members[0]!, info, covered)).toBe(1);
    for (const member of members) {
      const open = firstOpenCircuitMovementId(
        "tb-ab-triad",
        groups,
        membership,
        covered,
      );
      expect(open).toBe(member.movementId);
      covered.add(participatingItemIndices(member, membership.get(member.movementId)!)[0]!);
    }

    // Round 2 — back to the first movement.
    expect(circuitRoundFor(members[0]!, info, covered)).toBe(2);
    expect(
      firstOpenCircuitMovementId("tb-ab-triad", groups, membership, covered),
    ).toBe(members[0]!.movementId);
  });

  it("exhausts cleanly once every round is covered", () => {
    if (!prescription) return;
    const groups = groupPrescriptionByMovement(prescription);
    const membership = buildLinkedCircuitByMovementId(groups);
    const covered = new Set<number>();
    for (const g of groups) {
      const info = membership.get(g.movementId);
      if (!info) continue;
      participatingItemIndices(g, info).forEach((i) => covered.add(i));
    }
    expect(
      firstOpenCircuitMovementId("tb-ab-triad", groups, membership, covered),
    ).toBeNull();
  });
});
