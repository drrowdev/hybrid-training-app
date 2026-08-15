/**
 * Warm-up bar floor in the focus view.
 *
 * The focus view and `fillSessionFromPlan` both feed `roundWarmupLoadKg`.
 * They must agree on `barWeightKg` or the displayed warm-up target and the
 * persisted `set_logs.weight_kg` diverge for the presets that encode "no
 * such bar" (`bars.trapBarKg === null`, `bars.barbellKg === 0`).
 *
 * Server-side counterpart: `lib/sessions/__tests__/fill-session-warmup.test.ts`.
 */
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { MovementGroup } from "@/lib/sessions/movement-grouping";
import {
  COMMERCIAL_GYM_PRESET,
  HOME_GYM_PRESET,
  TRAVEL_HOTEL_PRESET,
} from "@/lib/settings/equipment-presets";
import { MovementFocusView } from "../MovementFocusView";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}));

const addStrengthSet = vi.fn(async () => ({ ok: true as const }));
const updateStrengthSet = vi.fn(async () => ({ ok: true as const }));

function warmupGroup(movementSlug: string, percentTm: number): MovementGroup {
  return {
    movementId: "movement-1",
    movementName: "Warm-up lift",
    movementSlug,
    itemIndices: [0],
    items: [
      {
        movementId: "movement-1",
        movementSlug,
        movementName: "Warm-up lift",
        kind: "warmup",
        sets: 1,
        reps: 5,
        percentTm,
      },
    ],
    slotBuckets: { warmup: [0], working: [], accessory: [] },
  };
}

function render(options: {
  movementSlug: string;
  percentTm: number;
  tmKg: number;
  barbellKg: number;
  trapBarKg: number | null;
  plates: readonly number[];
}) {
  return renderToStaticMarkup(
    <MovementFocusView
      sessionId="session"
      group={warmupGroup(options.movementSlug, options.percentTm)}
      tmKg={options.tmKg}
      oneRmKg={options.tmKg}
      loggedItemIndices={new Set()}
      skippedItemIndices={new Set()}
      loggedSetIdByItemIndex={{}}
      loggedSets={[]}
      priorBest={undefined}
      addStrengthSet={addStrengthSet}
      updateStrengthSet={updateStrengthSet}
      hapticsEnabled={false}
      timerSoundEnabled={false}
      barbellKg={options.barbellKg}
      trapBarKg={options.trapBarKg}
      plateInventory={options.plates.map((weightKg) => ({ weightKg }))}
    />,
  );
}

describe("MovementFocusView warm-up bar floor", () => {
  it("does not invent a trap bar the user does not own (home gym: trapBarKg null)", () => {
    // DC-K4: the engine may raise a warm-up to the empty bar, but it must not
    // claim a 25 kg minimum for a bar absent from the user's inventory — and
    // fillSessionFromPlan persists 20 kg for exactly this input.
    const html = render({
      movementSlug: "trap_bar_deadlift",
      percentTm: 34,
      tmKg: 60,
      barbellKg: HOME_GYM_PRESET.bars.barbellKg,
      trapBarKg: HOME_GYM_PRESET.bars.trapBarKg,
      plates: HOME_GYM_PRESET.plates,
    });

    // 60 × 34% = 20.4 kg → nearest 2.5 kg plate-pair increment = 20 kg.
    expect(html).toContain('aria-label="Weight (kg)"');
    expect(html).toContain('value="20"');
    expect(html).not.toContain('data-testid="warmup-load-floor-warning"');
    expect(html).not.toContain("bar minimum");
    // No trap bar → nothing to subtract → no plate breakdown claim.
    expect(html).not.toContain("cp-plate-wrap");
    expect(html).not.toContain('data-testid="plate-view-empty"');
  });

  it("does not impose a 20 kg floor for a preset with no barbell (travel / hotel)", () => {
    const html = render({
      movementSlug: "barbell_bench_press",
      percentTm: 34,
      tmKg: 40,
      barbellKg: TRAVEL_HOTEL_PRESET.bars.barbellKg,
      trapBarKg: TRAVEL_HOTEL_PRESET.bars.trapBarKg,
      plates: TRAVEL_HOTEL_PRESET.plates,
    });

    // 40 × 34% = 13.6 kg → default 2.5 kg increment = 12.5 kg, no bar floor.
    expect(html).toContain('value="12.5"');
    expect(html).not.toContain('data-testid="warmup-load-floor-warning"');
    expect(html).not.toContain("bar minimum");
  });

  it("still raises to the empty bar when the user owns one", () => {
    const html = render({
      movementSlug: "barbell_back_squat",
      percentTm: 34,
      tmKg: 40,
      barbellKg: COMMERCIAL_GYM_PRESET.bars.barbellKg,
      trapBarKg: COMMERCIAL_GYM_PRESET.bars.trapBarKg,
      plates: COMMERCIAL_GYM_PRESET.plates,
    });

    // 13.6 kg raw is below the 20 kg bar → floored, and the override is
    // surfaced rather than applied silently.
    expect(html).toContain('value="20"');
    expect(html).toContain('data-testid="warmup-load-floor-warning"');
    expect(html).toContain("Raised to the 20 kg bar minimum");
  });

  it("uses the trap bar mass when the user does own one", () => {
    const html = render({
      movementSlug: "trap_bar_deadlift",
      percentTm: 34,
      tmKg: 60,
      barbellKg: COMMERCIAL_GYM_PRESET.bars.barbellKg,
      trapBarKg: COMMERCIAL_GYM_PRESET.bars.trapBarKg,
      plates: COMMERCIAL_GYM_PRESET.plates,
    });

    // 20.4 kg raw rounds to 20 kg, then floors to the 25 kg trap bar.
    expect(html).toContain('value="25"');
    expect(html).toContain("Raised to the 25 kg bar minimum");
  });
});
