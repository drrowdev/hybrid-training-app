/**
 * Unit coverage for the plate-per-side breakdown helper that feeds
 * `<PlateView>`. Greedy + report-remainder — see plate-math.ts for
 * the contract notes.
 */
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { computePlateBreakdown, type PlateInventoryItem } from "../plate-math";
import { PlateView } from "../PlateView";

const FULL_INVENTORY: PlateInventoryItem[] = [
  { weightKg: 25, pairCount: 2 },
  { weightKg: 20, pairCount: 2 },
  { weightKg: 15, pairCount: 1 },
  { weightKg: 10, pairCount: 2 },
  { weightKg: 5, pairCount: 2 },
  { weightKg: 2.5, pairCount: 2 },
  { weightKg: 1.25, pairCount: 2 },
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
    // so 25s join the pool. Greedy on full inventory: 25+25+20+15+5
    // = 90 per side.
    const heavyInventory: PlateInventoryItem[] = [
      { weightKg: 25, pairCount: 4 },
      { weightKg: 20, pairCount: 2 },
      { weightKg: 15, pairCount: 1 },
      { weightKg: 10, pairCount: 2 },
      { weightKg: 5, pairCount: 2 },
      { weightKg: 2.5, pairCount: 2 },
      { weightKg: 1.25, pairCount: 2 },
    ];
    const out = computePlateBreakdown(200, 20, heavyInventory);
    expect(out.perSide[0]).toBe(25);
    expect(out.perSide.includes(25)).toBe(true);
    expect(out.remainderKg).toBe(0);
  });

  it("stays in 20s right at the threshold (per-side 79.5 < 80)", () => {
    // 179 kg total / 20 kg bar → 79.5 kg per side → just under, no 25s.
    const inv: PlateInventoryItem[] = [
      { weightKg: 25, pairCount: 4 },
      { weightKg: 20, pairCount: 4 },
      { weightKg: 10, pairCount: 2 },
      { weightKg: 5, pairCount: 2 },
      { weightKg: 2.5, pairCount: 2 },
    ];
    const out = computePlateBreakdown(179, 20, inv);
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

  it("respects pair_count limits — exhausts the only 15-pair before falling back", () => {
    const inv: PlateInventoryItem[] = [
      { weightKg: 20, pairCount: 1 },
      { weightKg: 15, pairCount: 1 },
      { weightKg: 5, pairCount: 1 },
    ];
    // Target = 20 + 2*(20+15+5) = 100 kg per side capacity available.
    // We want 90: 20 bar + 70 total → 35 per side. Greedy: 20+15 = 35 ✓.
    const out = computePlateBreakdown(90, 20, inv);
    expect(out.perSide).toEqual([20, 15]);
    expect(out.remainderKg).toBe(0);
  });

  it("reports the unmatched remainder when the inventory cannot reach the target", () => {
    const inv: PlateInventoryItem[] = [{ weightKg: 20, pairCount: 1 }];
    const out = computePlateBreakdown(80, 20, inv);
    expect(out.perSide).toEqual([20]);
    // 80 - 20 = 60 desired load. One 20-pair = 40 kg. Short 20 kg.
    expect(out.remainderKg).toBe(20);
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
