/**
 * Unit coverage for the plate-per-side breakdown helper that feeds
 * `<PlateView>`. Greedy + report-remainder — see plate-math.ts for
 * the contract notes.
 *
 * Pair counts are no longer tracked (PR: feat/equipment-overhaul);
 * the inventory is now just a list of available plate weights.
 */
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { computePlateBreakdown, type PlateInventoryItem } from "../plate-math";
import { PlateView } from "../PlateView";

const FULL_INVENTORY: PlateInventoryItem[] = [
  { weightKg: 25 },
  { weightKg: 20 },
  { weightKg: 15 },
  { weightKg: 10 },
  { weightKg: 5 },
  { weightKg: 2.5 },
  { weightKg: 1.25 },
];

describe("computePlateBreakdown", () => {
  it("breaks 102.5 kg on a 20 kg bar — per-side 41.25 stays in 20s (below 25 kg threshold)", () => {
    // 41.25 kg per side < HEAVY_THRESHOLD_KG (80), so 25 kg plates are
    // gated out and the greedy walk falls back to 20+20+1.25. This is
    // the behaviour the user requested: prefer 20s unless the load is
    // genuinely heavy.
    const out = computePlateBreakdown(102.5, 20, FULL_INVENTORY);
    expect(out.perSide).toEqual([20, 20, 1.25]);
    expect(out.remainderKg).toBe(0);
  });

  it("unlocks 25 kg plates when per-side load is ≥ 80 kg", () => {
    // 200 kg total / 20 kg bar → 90 kg per side → above threshold,
    // so 25s join the pool. Greedy on full inventory: 25+25+25+15
    // = 90 per side.
    const out = computePlateBreakdown(200, 20, FULL_INVENTORY);
    expect(out.perSide[0]).toBe(25);
    expect(out.perSide.includes(25)).toBe(true);
    expect(out.remainderKg).toBe(0);
  });

  it("stays in 20s right at the threshold (per-side 79.5 < 80)", () => {
    // 179 kg total / 20 kg bar → 79.5 kg per side → just under, no 25s.
    const out = computePlateBreakdown(179, 20, FULL_INVENTORY);
    expect(out.perSide.includes(25)).toBe(false);
  });

  it("disableHeavyGate unlocks the heaviest plate regardless of per-side load", () => {
    // With the gate off, a light load can still use 25 kg plates — the flag is
    // for non-kg sets (e.g. lb) where the top plate is always available.
    const out = computePlateBreakdown(110, 20, FULL_INVENTORY, { disableHeavyGate: true });
    // (110-20)/2 = 45 per side → 25 + 20 (greedy, 25s now allowed).
    expect(out.perSide[0]).toBe(25);
    expect(out.remainderKg).toBe(0);
  });

  it("computes a real US lb plate breakdown (185 lb on a 45 lb bar → 45+25 per side)", () => {
    // Standard US set on a 45 lb bar: (185-45)/2 = 70 per side → 45 + 25.
    const LB_SET = [45, 35, 25, 10, 5, 2.5].map((w) => ({ weightKg: w }));
    const out = computePlateBreakdown(185, 45, LB_SET, { disableHeavyGate: true });
    expect(out.perSide).toEqual([45, 25]);
    expect(out.remainderKg).toBe(0);
  });

  it("reports a real-pounds remainder when the lb target isn't loadable (193 lb)", () => {
    // 193 lb (≈87.5 kg converted) on a 45 lb bar: 74 per side → 45+25+2.5 = 72.5,
    // 1.5 lb short per side → 3 lb total. The US lifter just rounds to 185/195.
    const LB_SET = [45, 35, 25, 10, 5, 2.5].map((w) => ({ weightKg: w }));
    const out = computePlateBreakdown(193, 45, LB_SET, { disableHeavyGate: true });
    expect(out.perSide).toEqual([45, 25, 2.5]);
    expect(out.remainderKg).toBeCloseTo(3, 5);
  });

  it("returns an empty stack when the target is below the bar weight", () => {
    const out = computePlateBreakdown(15, 20, FULL_INVENTORY);
    expect(out.perSide).toEqual([]);
    // The remainder surfaces the gap so the caller can warn the user.
    expect(out.remainderKg).toBe(5);
  });

  it("returns empty stack + remainder when the inventory has no plates", () => {
    const out = computePlateBreakdown(60, 20, []);
    expect(out.perSide).toEqual([]);
    expect(out.remainderKg).toBe(40);
  });

  it("hits an exact match with mixed plates: 60 kg on a 20 kg bar → [20] per side", () => {
    const out = computePlateBreakdown(60, 20, FULL_INVENTORY);
    expect(out.perSide).toEqual([20]);
    expect(out.remainderKg).toBe(0);
  });

  it("treats every listed plate weight as having infinite pairs", () => {
    // Inventory = a single 20 kg plate weight. With the old per-pair
    // model this would have capped at one pair; under the real-gym
    // assumption it stacks as many as the load needs.
    const out = computePlateBreakdown(100, 20, [{ weightKg: 20 }]);
    expect(out.perSide).toEqual([20, 20]);
    expect(out.remainderKg).toBe(0);
  });

  it("reports the unmatched remainder when the listed plates can't reach the target", () => {
    // No micro plates available — target 81.25 kg on a 20 kg bar
    // leaves 30.625 kg per side. Greedy with 20+5: [20, 5, 5] eats
    // 30 kg per side, 0.625 kg short → 1.25 kg total remainder.
    const out = computePlateBreakdown(81.25, 20, [{ weightKg: 20 }, { weightKg: 5 }]);
    expect(out.perSide).toEqual([20, 5, 5]);
    expect(out.remainderKg).toBeCloseTo(1.25, 5);
  });
});

describe("PlateView", () => {
  it("renders one plate per side with the test ids the e2e relies on", () => {
    const html = renderToStaticMarkup(
      <PlateView
        targetWeightKg={60}
        barWeightKg={20}
        inventory={FULL_INVENTORY}
      />,
    );
    expect(html).toContain('data-testid="plate-view"');
    expect(html).toContain('data-testid="plate-view-bar"');
    expect(html).toContain('data-testid="plate-left-0"');
    expect(html).toContain('data-testid="plate-right-0"');
    expect(html).toContain("per side: 20 kg");
  });

  it("surfaces the 'bar only' label when the target equals the bar weight", () => {
    const html = renderToStaticMarkup(
      <PlateView targetWeightKg={20} barWeightKg={20} inventory={FULL_INVENTORY} />,
    );
    expect(html).toContain("bar only");
    expect(html).not.toContain('data-testid="plate-left-0"');
  });

  it("renders a REAL US lb plate breakdown for imperial users (not lb-converted kg)", () => {
    // 100 kg ≈ 220 lb on a 20 kg bar (→ 45 lb bar): (220-45)/2 = 87.5 →
    // 45 + 35 + 5 + 2.5 = 87.5 per side. Real US plates, not "44 / 33".
    const html = renderToStaticMarkup(
      <PlateView
        targetWeightKg={100}
        barWeightKg={20}
        inventory={FULL_INVENTORY}
        units="imperial"
      />,
    );
    expect(html).toContain("per side: 45 + 35 + 5 + 2.5 lb");
    // Real lb plate labels appear; the metric per-side "kg" suffix does not.
    expect(html).toContain(">45<");
    expect(html).not.toContain(" kg");
  });

  it("uses the user's REAL plates when imperial + preferStandardLbPlates=false", () => {
    // Custom inventory: only 20 kg and 10 kg plates.
    // 20 kg → 44 lb, 10 kg → 22 lb.
    // 100 kg ≈ 220 lb on a 20 kg (→ 45 lb) bar: (220-45)/2 = 87.5 per side
    // Available: 44, 22 → 44 + 22 + 22 = 88? No: greedy 44 first then 22+22=44, total 88 > 87.5
    // Actually: 44 fits (87.5-44=43.5 left), 22 fits (43.5-22=21.5), 22 fits again? no 21.5 < 22.
    // So per side: [44, 22], remainder = 87.5-44-22 = 21.5 lb (short)
    const customInv = [{ weightKg: 20 }, { weightKg: 10 }];
    const html = renderToStaticMarkup(
      <PlateView
        targetWeightKg={100}
        barWeightKg={20}
        inventory={customInv}
        units="imperial"
        preferStandardLbPlates={false}
      />,
    );
    // Should use converted plates (44, 22) not standard (45, 35, 25, 10, 5, 2.5)
    expect(html).toContain(">44<");
    expect(html).toContain(">22<");
    // Standard 45 lb plate should NOT appear
    expect(html).not.toContain(">45<");
  });

  it("falls back to standard LB_PLATE_SET when preferStandardLbPlates=true (default)", () => {
    const customInv = [{ weightKg: 20 }, { weightKg: 10 }];
    const html = renderToStaticMarkup(
      <PlateView
        targetWeightKg={100}
        barWeightKg={20}
        inventory={customInv}
        units="imperial"
        preferStandardLbPlates={true}
      />,
    );
    // Should use the standard 45 lb plate
    expect(html).toContain(">45<");
  });
});
