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
});
