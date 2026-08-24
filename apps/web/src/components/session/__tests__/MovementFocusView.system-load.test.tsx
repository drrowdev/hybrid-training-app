/**
 * The live logger opens a weighted pull-up at the belt load, not the total.
 *
 * The prescription only stores a percentage; the load is re-derived here on
 * every render. Without the bodyweight subtraction the card opened at the whole
 * bodyweight-inclusive total — 77 kg of plates for an 85 kg lifter at 70%.
 *
 * Server-side counterpart: `lib/sessions/__tests__/system-load-fill.test.ts`.
 */
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { MovementGroup } from "@/lib/sessions/movement-grouping";
import { MovementFocusView } from "../MovementFocusView";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}));

const addStrengthSet = vi.fn(async () => ({ ok: true as const }));
const updateStrengthSet = vi.fn(async () => ({ ok: true as const }));

function pullupGroup(item: Record<string, unknown>): MovementGroup {
  return {
    movementId: "movement-1",
    movementName: "Weighted Pull-up",
    movementSlug: "weighted-pull-up",
    itemIndices: [0],
    items: [
      {
        movementId: "movement-1",
        movementSlug: "weighted-pull-up",
        movementName: "Weighted Pull-up",
        sets: 1,
        reps: 5,
        ...item,
      } as MovementGroup["items"][number],
    ],
    slotBuckets: { warmup: [], working: [0], accessory: [] },
  };
}

function render(options: {
  item: Record<string, unknown>;
  tmKg?: number;
  bodyweightKg?: number;
  isSystemLoad?: boolean;
  lastSetHint?: { weightKg: number; reps: number; performedAt: string };
}) {
  return renderToStaticMarkup(
    <MovementFocusView
      sessionId="session"
      group={pullupGroup(options.item)}
      tmKg={options.tmKg}
      bodyweightKg={options.bodyweightKg}
      isSystemLoad={options.isSystemLoad ?? true}
      oneRmKg={options.tmKg}
      loggedItemIndices={new Set()}
      skippedItemIndices={new Set()}
      loggedSetIdByItemIndex={{}}
      loggedSets={[]}
      priorBest={undefined}
      lastSetHint={options.lastSetHint ?? null}
      addStrengthSet={addStrengthSet}
      updateStrengthSet={updateStrengthSet}
      hapticsEnabled={false}
      timerSoundEnabled={false}
      restTimerEnabled={true}
      barbellKg={20}
      trapBarKg={null}
      safetyBarKg={null}
      plateInventory={[{ weightKg: 1.25 }, { weightKg: 2.5 }]}
    />,
  );
}

describe("MovementFocusView — weighted bodyweight movements", () => {
  it("opens at the belt load rather than the bodyweight-inclusive total", () => {
    // 95% of a 110 kg system max = 104.5 kg − 85 kg bodyweight = 19.5 → 20 kg.
    const html = render({
      item: { kind: "main", percentTm: 95 },
      tmKg: 110,
      bodyweightKg: 85,
    });
    expect(html).toContain('value="20"');
    expect(html).not.toContain('value="104.5"');
    expect(html).not.toContain('value="105"');
  });

  it("opens at zero when the percentage lands under bodyweight", () => {
    const html = render({
      item: { kind: "main", percentTm: 70 },
      tmKg: 110,
      bodyweightKg: 85,
      // A remembered belt load must not stand in for a bodyweight prescription.
      lastSetHint: { weightKg: 25, reps: 5, performedAt: "2026-08-01T00:00:00Z" },
    });
    expect(html).toContain('value="0"');
    expect(html).not.toContain('value="25"');
  });

  it("keeps a prescribed 0 kg warm-up instead of falling back to history", () => {
    const html = render({
      item: { kind: "warmup", targetWeightKg: 0, systemLoad: true },
      tmKg: 110,
      bodyweightKg: 85,
      lastSetHint: { weightKg: 25, reps: 5, performedAt: "2026-08-01T00:00:00Z" },
    });
    expect(html).toContain('value="0"');
    expect(html).not.toContain('value="25"');
  });

  it("still subtracts bodyweight for a lifter on a plain barbell lift's percentage", () => {
    // Same percentage, no system-load flag: nothing is subtracted.
    const html = render({
      item: { kind: "main", percentTm: 70 },
      tmKg: 200,
      bodyweightKg: 85,
      isSystemLoad: false,
    });
    expect(html).toContain('value="140"');
  });
});
