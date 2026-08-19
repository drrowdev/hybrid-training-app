/**
 * MovementFocusView — dumbbell stepper increment + rehab RPE suppression.
 *
 * Static-markup assertions (`renderToStaticMarkup`) in the same style as the
 * neighbouring focus-view tests: the stepper renders a "± <step>" hint and the
 * effort picker renders `data-testid="rpe-zone-picker"`.
 */
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { MovementGroup } from "@/lib/sessions/movement-grouping";
import { MovementFocusView } from "../MovementFocusView";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}));

const addStrengthSet = async () => ({ ok: true as const });

function groupFor(
  movementSlug: string,
  overrides: Partial<MovementGroup["items"][number]> = {},
): MovementGroup {
  return {
    movementId: "mov",
    movementName: "Movement",
    movementSlug,
    itemIndices: [0],
    items: [
      {
        movementId: "mov",
        movementSlug,
        movementName: "Movement",
        kind: "accessory",
        sets: 1,
        reps: 15,
        targetWeightKg: 5.5,
        ...overrides,
      },
    ],
    slotBuckets: { warmup: [], working: [], accessory: [0] },
  };
}

function render(group: MovementGroup, equipmentTag?: string | null) {
  return renderToStaticMarkup(
    <MovementFocusView
      sessionId="session"
      group={group}
      tmKg={undefined}
      oneRmKg={undefined}
      loggedItemIndices={new Set()}
      loggedSetIdByItemIndex={{}}
      loggedSets={[]}
      priorBest={undefined}
      addStrengthSet={addStrengthSet}
      hapticsEnabled={false}
      timerSoundEnabled={false}
      restTimerEnabled={true}
      equipmentTag={equipmentTag}
    />,
  );
}

/**
 * The "± <step>" hint rendered under the weight stepper. Scoped to the weight
 * stepper because the reps stepper also renders a "± 1" hint.
 */
function weightStepHint(html: string): string | null {
  const stepper = html.slice(html.indexOf('data-testid="stepper-weight"'));
  return /± ([\d.]+)/.exec(stepper)?.[1] ?? null;
}

describe("MovementFocusView weight increments", () => {
  it("steps a dumbbell movement by 1 kg, not the 2.5 kg plate default", () => {
    const html = render(groupFor("supported-wrist-radial-deviation-db"), "dumbbell");
    expect(html).toContain('data-testid="stepper-weight"');
    expect(weightStepHint(html)).toBe("1");
  });

  it("uses the equipment tag when the slug hides the implement", () => {
    expect(weightStepHint(render(groupFor("hammer-curl"), "dumbbells"))).toBe("1");
  });

  it("falls back to the slug when no equipment tag is supplied", () => {
    expect(weightStepHint(render(groupFor("db-curl-standing")))).toBe("1");
  });

  it("keeps 2.5 kg for barbell work", () => {
    expect(weightStepHint(render(groupFor("back-squat"), "barbell"))).toBe("2.5");
  });
});

describe("MovementFocusView rehab effort picker", () => {
  it("hides the RPE picker on rehab sets", () => {
    const html = render(
      groupFor("supported-wrist-radial-deviation-db", {
        kind: "tendon",
        meta: { rehab: true },
      }),
      "dumbbell",
    );
    expect(html).not.toContain('data-testid="rpe-zone-picker"');
    expect(html).not.toContain("How did it feel?");
  });

  it("still shows the RPE picker on a non-rehab accessory of the same movement", () => {
    const html = render(groupFor("supported-wrist-radial-deviation-db"), "dumbbell");
    expect(html).toContain('data-testid="rpe-zone-picker"');
  });
});
