/**
 * Defect #1 — a failed freestyle log (no `prescriptionItemIndex`, so no
 * optimistic overlay) still registered optimistic strength-set state via
 * `registerStrengthLog`. The old code gated the rollback behind `if (overlay)`
 * and returned before ever reaching it for the no-overlay case, so a rejected
 * freestyle log left `hasStrengthSets` permanently true and let Finish enable
 * with zero persisted sets.
 *
 * `SessionWorkArea.logSet` is an async `useCallback` closing over provider
 * setters and local state setters — driving it end-to-end requires a real
 * async render cycle, which this repo intentionally doesn't do without
 * jsdom/@testing-library (see `LogNowDateForm.test.tsx`). Its rollback
 * decision is extracted into `planLogSetOutcome` (a pure function `logSet`
 * delegates to) precisely so it can be exercised behaviorally here: these
 * tests call the real function with representative inputs and assert on its
 * actual return value, not on the shape of the source.
 */
import { describe, expect, it } from "vitest";
import { planLogSetOutcome } from "@/lib/sessions/optimistic-log";

describe("planLogSetOutcome — rollback on rejection (defect #1)", () => {
  it("rolls back the provider registration for a rejected FREESTYLE log (optimistic, no overlay)", () => {
    const outcome = planLogSetOutcome({
      kind: "resolved",
      hadOptimistic: true,
      hadOverlay: false,
      result: { error: "set rejected" },
    });

    // The regression: a no-overlay (freestyle) rejection must still roll back
    // the provider registration, or `hasStrengthSets` stays stuck true and
    // Finish can enable with zero persisted sets.
    expect(outcome.rollbackProvider).toBe(true);
    expect(outcome.dropOverlay).toBe(false); // nothing to drop — there was no overlay row
    expect(outcome.confirmedServerId).toBeNull();
    expect(outcome.result).toEqual({ error: "set rejected" });
  });

  it("rolls back BOTH the overlay row and the provider registration for a rejected PRESCRIBED log", () => {
    const outcome = planLogSetOutcome({
      kind: "resolved",
      hadOptimistic: true,
      hadOverlay: true,
      result: { error: "set rejected" },
    });

    expect(outcome.dropOverlay).toBe(true);
    expect(outcome.rollbackProvider).toBe(true);
    expect(outcome.confirmedServerId).toBeNull();
    expect(outcome.result).toEqual({ error: "set rejected" });
  });

  it("never rolls back on a network error — offline state is kept for the outbox to replay", () => {
    const outcome = planLogSetOutcome({ kind: "network-error" });

    expect(outcome.dropOverlay).toBe(false);
    expect(outcome.rollbackProvider).toBe(false);
    expect(outcome.result).toEqual({ ok: true });
  });

  it("confirms a successful PRESCRIBED log with the real server id and any bwTut override", () => {
    const outcome = planLogSetOutcome({
      kind: "resolved",
      hadOptimistic: true,
      hadOverlay: true,
      result: {
        ok: true,
        set: { id: "real-1", movementId: "m1", prescriptionItemIndex: 2, setKind: "main", skipped: false },
        bwTut: { family: "push", tutAccumulated: 42 },
      },
    });

    expect(outcome.rollbackProvider).toBe(false);
    expect(outcome.dropOverlay).toBe(false);
    expect(outcome.confirmedServerId).toBe("real-1");
    expect(outcome.bwTut).toEqual({ family: "push", tutAccumulated: 42 });
  });

  it("passes through a successful FREESTYLE log (no overlay) without touching overlay/provider state", () => {
    const outcome = planLogSetOutcome({
      kind: "resolved",
      hadOptimistic: true,
      hadOverlay: false,
      result: { ok: true },
    });

    expect(outcome.dropOverlay).toBe(false);
    expect(outcome.rollbackProvider).toBe(false);
    expect(outcome.confirmedServerId).toBeNull();
    expect(outcome.bwTut).toBeNull();
    expect(outcome.result).toEqual({ ok: true });
  });
});
