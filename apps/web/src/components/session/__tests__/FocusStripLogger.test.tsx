import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { MovementGroup } from "@/lib/sessions/movement-grouping";
import {
  FocusStripLogger,
  reconcileConfirmedSwaps,
} from "../FocusStripLogger";
import { MovementFocusView } from "../MovementFocusView";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}));

const mainGroup: MovementGroup = {
  movementId: "bench",
  movementName: "Bench Press",
  movementSlug: "bench-press-flat",
  itemIndices: [0, 1, 2, 3],
  items: Array.from({ length: 4 }, () => ({
    movementId: "bench",
    movementSlug: "bench-press-flat",
    movementName: "Bench Press",
    kind: "main" as const,
    sets: 1,
    reps: 8,
    percentTm: 70,
  })),
  slotBuckets: {
    warmup: [],
    working: [0, 1, 2, 3],
    accessory: [],
  },
};

const supplementalGroup: MovementGroup = {
  movementId: "press",
  movementName: "Overhead Press",
  movementSlug: "ohp-standing",
  itemIndices: [4, 5, 6, 7, 8],
  items: Array.from({ length: 5 }, (_, index) => ({
    movementId: "press",
    movementSlug: "ohp-standing",
    movementName: "Overhead Press",
    kind: "back_off" as const,
    sets: 1,
    reps: 8,
    percentTm: 65,
    setRange: { min: 3, max: 5 },
    repRange: { min: 8, max: 10 },
    ...(index >= 3 ? { optional: true } : {}),
  })),
  slotBuckets: {
    warmup: [],
    working: [0, 1, 2, 3, 4],
    accessory: [],
  },
};

const accessoryA: MovementGroup = {
  movementId: "curl",
  movementName: "Curl",
  movementSlug: "curl",
  itemIndices: [9],
  items: [
    {
      movementId: "curl",
      movementSlug: "curl",
      movementName: "Curl",
      kind: "accessory",
      sets: 1,
      reps: 12,
    },
  ],
  slotBuckets: { warmup: [], working: [], accessory: [0] },
};

const accessoryB: MovementGroup = {
  movementId: "extension",
  movementName: "Triceps Extension",
  movementSlug: "extension",
  itemIndices: [10],
  items: [
    {
      movementId: "extension",
      movementSlug: "extension",
      movementName: "Triceps Extension",
      kind: "accessory",
      sets: 1,
      reps: 12,
    },
  ],
  slotBuckets: { warmup: [], working: [], accessory: [0] },
};

const rehabGroup: MovementGroup = {
  movementId: "hip-adduction",
  movementName: "Standing Banded Hip Adduction",
  movementSlug: "standing-banded-hip-adduction",
  itemIndices: [0, 1, 2],
  items: Array.from({ length: 3 }, () => ({
    movementId: "hip-adduction",
    movementSlug: "standing-banded-hip-adduction",
    movementName: "Standing Banded Hip Adduction",
    kind: "tendon" as const,
    sets: 1,
    reps: 15,
    meta: { rehab: true },
  })),
  slotBuckets: {
    warmup: [],
    working: [],
    accessory: [0, 1, 2],
  },
};

const triadGroups: MovementGroup[] = [
  ["leg", "Hanging Leg Raise", 0],
  ["knee", "Hanging Knee Raise", 1],
  ["toes", "Toes-to-Bar", 2],
].map(([movementId, movementName, position], movementIndex) => ({
  movementId: String(movementId),
  movementName: String(movementName),
  movementSlug: String(movementId),
  itemIndices: [0, 1, 2].map(
    (round) => movementIndex * 3 + round,
  ),
  items: [0, 1, 2].map(() => ({
    movementId: String(movementId),
    movementSlug: String(movementId),
    movementName: String(movementName),
    kind: "accessory" as const,
    sets: 1,
    reps: 5,
    circuit: {
      id: "tb-ab-triad",
      name: "AB Triad",
      position: Number(position),
      size: 3,
      rounds: 3,
    },
  })),
  slotBuckets: {
    warmup: [],
    working: [],
    accessory: [0, 1, 2],
  },
}));

const addStrengthSet = vi.fn(async () => ({ ok: true as const }));
const updateStrengthSet = vi.fn(async () => ({ ok: true as const }));

describe("FocusStripLogger", () => {
  it("renders one active movement and lists the rest in the navigator", () => {
    const html = renderToStaticMarkup(
      <FocusStripLogger
        sessionId="session"
        groups={[mainGroup, supplementalGroup]}
        setsByMovement={new Map()}
        tmBySlug={{ "bench-press-flat": 100, "ohp-standing": 80 }}
        oneRmBySlug={{ "bench-press-flat": 100, "ohp-standing": 80 }}
        loggedItemIndices={new Set()}
        skippedItemIndices={new Set()}
        loggedSetIdByItemIndex={{}}
        priorBests={{}}
        addStrengthSet={addStrengthSet}
        updateStrengthSet={updateStrengthSet}
        hapticsEnabled={false}
        timerSoundEnabled={false}
        restTimerEnabled={true}
      />,
    );
    expect(html).toContain('data-testid="focus-strip-logger"');
    // Compact progress line replaces the old uppercase "WORKOUT PROGRESS" block.
    expect(html).toContain('data-testid="focus-strip-progress"');
    expect(html).toContain("0/7");
    // The primary action is docked, not trailing the card.
    expect(html).toContain('data-testid="session-dock"');
    expect(html).toContain('data-testid="movement-focus-log-button"');
    // Every movement is reachable from the navigator, including supplemental
    // work, which the old section chips folded into "Main".
    expect(html).toContain('data-testid="movement-navigator"');
    expect(html).toContain('data-testid="movement-navigator-item-bench"');
    expect(html).toContain('data-testid="movement-navigator-item-press"');
    expect(html).toContain("Supplemental");
    // The clipped horizontal queue is gone.
    expect(html).not.toContain('data-testid="focus-strip-movement-queue"');
    expect(html).not.toContain('data-testid="focus-strip-section-nav"');
    expect(html).toContain('data-testid="focus-strip-swap"');
    expect(html).not.toContain("movement-card-header-");
    expect(html).not.toContain("± 2.5");
    expect(html).not.toContain("± 1");
  });

  it("keeps the accessory reorder controls", () => {
    const html = renderToStaticMarkup(
      <FocusStripLogger
        sessionId="session"
        groups={[accessoryA, accessoryB]}
        setsByMovement={new Map()}
        tmBySlug={{}}
        oneRmBySlug={{}}
        loggedItemIndices={new Set()}
        skippedItemIndices={new Set()}
        loggedSetIdByItemIndex={{}}
        priorBests={{}}
        reorderableMovementIds={["curl", "extension"]}
        onReorderMovements={vi.fn()}
        addStrengthSet={addStrengthSet}
        updateStrengthSet={updateStrengthSet}
        hapticsEnabled={false}
        timerSoundEnabled={false}
        restTimerEnabled={true}
      />,
    );
    // Auto-pairing is gone: unlinked accessories carry no superset cue. A user
    // link surfaces through the circuit cue instead (see linked-circuit tests).
    expect(html).not.toContain('data-testid="focus-strip-superset-cue"');
    expect(html).toContain('data-testid="focus-strip-reorder"');
    expect(html).toContain('aria-label="Move Curl later"');
  });

  it("renders granular rehab sets without exposing the tendon label", () => {
    const html = renderToStaticMarkup(
      <FocusStripLogger
        sessionId="session"
        groups={[rehabGroup]}
        setsByMovement={new Map()}
        tmBySlug={{}}
        oneRmBySlug={{}}
        loggedItemIndices={new Set()}
        skippedItemIndices={new Set()}
        loggedSetIdByItemIndex={{}}
        priorBests={{}}
        addStrengthSet={addStrengthSet}
        updateStrengthSet={updateStrengthSet}
        hapticsEnabled={false}
        timerSoundEnabled={false}
        restTimerEnabled={true}
      />,
    );
    expect(html).toContain("0/3");
    expect(html).toContain('data-testid="movement-navigator-item-hip-adduction"');
    expect(html).toContain("Rehab · 3×15");
    expect(html).toContain("Rehab · 1 of 3");
    expect(html).not.toContain("Tendon ·");
  });

  it("starts a combined workout in rehab with section progress and explicit skip", () => {
    const mixedMain = {
      ...mainGroup,
      itemIndices: [3, 4, 5, 6],
    };
    const mixedAccessory = {
      ...accessoryA,
      itemIndices: [7],
    };
    const html = renderToStaticMarkup(
      <FocusStripLogger
        sessionId="session"
        groups={[rehabGroup, mixedMain, mixedAccessory]}
        setsByMovement={new Map()}
        tmBySlug={{ "bench-press-flat": 100 }}
        oneRmBySlug={{ "bench-press-flat": 100 }}
        loggedItemIndices={new Set()}
        skippedItemIndices={new Set()}
        loggedSetIdByItemIndex={{}}
        priorBests={{}}
        addStrengthSet={addStrengthSet}
        updateStrengthSet={updateStrengthSet}
        hapticsEnabled={false}
        timerSoundEnabled={false}
        restTimerEnabled={true}
      />,
    );

    // Sections live in the navigator now, and each is addressable on every
    // day — not only when the day happens to contain rehab.
    expect(html).toContain('data-testid="movement-navigator"');
    expect(html).toContain("Rehab · during warm-up");
    expect(html).toContain(">Main<");
    expect(html).toContain(">Accessories<");
    expect(html).toContain("Skip remaining rehab (3)");
    expect(html).not.toContain('data-testid="focus-strip-section-nav"');
  });

  it("keeps rehab navigation distinct when the main workout uses the same movement", () => {
    const sameMovementRehab: MovementGroup = {
      ...rehabGroup,
      groupKey: "rehab:bench",
      movementId: "bench",
      movementName: "Bench Press",
      itemIndices: [0],
      items: [
        {
          movementId: "bench",
          movementName: "Bench Press",
          movementSlug: "bench-press-flat",
          kind: "tendon",
          sets: 1,
          reps: 15,
          meta: { rehab: true },
        },
      ],
      slotBuckets: { warmup: [], working: [], accessory: [0] },
    };
    const sameMovementMain: MovementGroup = {
      ...mainGroup,
      groupKey: "bench",
      itemIndices: [1, 2, 3, 4],
    };
    const html = renderToStaticMarkup(
      <FocusStripLogger
        sessionId="session"
        groups={[sameMovementRehab, sameMovementMain]}
        setsByMovement={new Map()}
        tmBySlug={{ "bench-press-flat": 100 }}
        oneRmBySlug={{ "bench-press-flat": 100 }}
        loggedItemIndices={new Set()}
        skippedItemIndices={new Set()}
        loggedSetIdByItemIndex={{}}
        priorBests={{}}
        addStrengthSet={addStrengthSet}
        updateStrengthSet={updateStrengthSet}
        hapticsEnabled={false}
        timerSoundEnabled={false}
        restTimerEnabled={true}
      />,
    );

    // Same catalog movement in both rehab and main must stay two distinct,
    // separately addressable navigator rows.
    expect(html).toContain('data-testid="movement-navigator-item-rehab:bench"');
    expect(html).toContain('data-testid="movement-navigator-item-bench"');
    expect(html).toContain("Rehab · during warm-up");
    expect(html).toContain("Skip remaining rehab (1)");
  });

  it("shows linked AB Triad round and movement guidance", () => {
    const html = renderToStaticMarkup(
      <FocusStripLogger
        sessionId="session"
        groups={triadGroups}
        setsByMovement={new Map()}
        tmBySlug={{}}
        oneRmBySlug={{}}
        loggedItemIndices={new Set([0, 3, 6])}
        skippedItemIndices={new Set()}
        loggedSetIdByItemIndex={{}}
        priorBests={{}}
        addStrengthSet={addStrengthSet}
        updateStrengthSet={updateStrengthSet}
        hapticsEnabled={false}
        timerSoundEnabled={false}
        restTimerEnabled={true}
      />,
    );
    expect(html).toContain('data-testid="focus-strip-circuit-cue"');
    expect(html).toContain("AB Triad");
    expect(html).toContain("Round 2 of 3");
    expect(html).toContain(
      "Hanging Leg Raise → Hanging Knee Raise → Toes-to-Bar",
    );
  });

  it("clears a confirmed optimistic swap before a later reverse swap", () => {
    const previous = {
      bench: {
        id: "press",
        slug: "press",
        displayName: "Press",
      },
    };
    expect(
      reconcileConfirmedSwaps(previous, [{ movementId: "press" }]),
    ).toEqual({});
    expect(
      reconcileConfirmedSwaps(previous, [{ movementId: "bench" }]),
    ).toBe(previous);
  });
});

describe("MovementFocusView inline history", () => {
  it("restores a skipped set inline instead of linking to the edit page", () => {
    const html = renderToStaticMarkup(
      <MovementFocusView
        sessionId="session"
        group={mainGroup}
        tmKg={100}
        oneRmKg={100}
        loggedItemIndices={new Set([0])}
        skippedItemIndices={new Set([0])}
        loggedSetIdByItemIndex={{ 0: "set-1" }}
        loggedSets={[
          {
            id: "set-1",
            weightKg: 0,
            reps: 0,
            rpe: null,
            skipped: true,
            skipReason: "fatigue",
          },
        ]}
        priorBest={undefined}
        addStrengthSet={addStrengthSet}
        updateStrengthSet={updateStrengthSet}
        hapticsEnabled={false}
        timerSoundEnabled={false}
        restTimerEnabled={true}
        focusStrip
        initialCursor={0}
      />,
    );
    expect(html).toContain("Restore set");
    expect(html).toContain('aria-label="Set 1 of 4 — skipped"');
    expect(html).not.toContain("/sets/set-1/edit");
  });

  it("does not duplicate an optimistic set before its server id arrives", () => {
    const html = renderToStaticMarkup(
      <MovementFocusView
        sessionId="session"
        group={mainGroup}
        tmKg={100}
        oneRmKg={100}
        loggedItemIndices={new Set([0])}
        skippedItemIndices={new Set()}
        loggedSetIdByItemIndex={{}}
        loggedSets={[]}
        priorBest={undefined}
        addStrengthSet={addStrengthSet}
        updateStrengthSet={updateStrengthSet}
        hapticsEnabled={false}
        timerSoundEnabled={false}
        restTimerEnabled={true}
        focusStrip
        initialCursor={0}
      />,
    );
    expect(html).toContain("Sync pending");
    expect(html).toContain("queued offline");
    expect(html).toMatch(/disabled="" data-testid="movement-focus-log-button"/);
  });

  it("preserves the original attribution of a set logged before a swap", () => {
    const html = renderToStaticMarkup(
      <MovementFocusView
        sessionId="session"
        group={mainGroup}
        tmKg={100}
        oneRmKg={100}
        loggedItemIndices={new Set([0])}
        skippedItemIndices={new Set()}
        loggedSetIdByItemIndex={{ 0: "set-1" }}
        loggedSets={[
          {
            id: "set-1",
            movementId: "squat",
            weightKg: 100,
            reps: 5,
            rpe: 8,
          },
        ]}
        priorBest={undefined}
        addStrengthSet={addStrengthSet}
        updateStrengthSet={updateStrengthSet}
        hapticsEnabled={false}
        timerSoundEnabled={false}
        restTimerEnabled={true}
        focusStrip
        initialCursor={0}
      />,
    );
    expect(html).toContain("Logged before swap");
    expect(html).toContain("original movement attribution is preserved");
    expect(html).toMatch(/disabled="" data-testid="movement-focus-log-button"/);
  });

  it("hydrates an initially selected logged set from its saved values", () => {
    const html = renderToStaticMarkup(
      <MovementFocusView
        sessionId="session"
        group={mainGroup}
        tmKg={100}
        oneRmKg={100}
        loggedItemIndices={new Set([0])}
        skippedItemIndices={new Set()}
        loggedSetIdByItemIndex={{ 0: "set-1" }}
        loggedSets={[
          {
            id: "set-1",
            movementId: "bench",
            weightKg: 82.5,
            reps: 4,
            rpe: 8.8,
          },
        ]}
        priorBest={undefined}
        addStrengthSet={addStrengthSet}
        updateStrengthSet={updateStrengthSet}
        hapticsEnabled={false}
        timerSoundEnabled={false}
        restTimerEnabled={true}
        focusStrip
        initialCursor={0}
      />,
    );
    expect(html).toContain('aria-label="Weight (kg)"');
    expect(html).toContain('value="82.5"');
    expect(html).toContain('aria-label="Reps"');
    expect(html).toContain('value="4"');
    expect(html).toContain('data-active-zone="hard"');
  });

  it("does not inherit a different movement's fallback weight", () => {
    const html = renderToStaticMarkup(
      <MovementFocusView
        sessionId="session"
        group={accessoryA}
        tmKg={undefined}
        oneRmKg={undefined}
        loggedItemIndices={new Set()}
        skippedItemIndices={new Set()}
        loggedSetIdByItemIndex={{}}
        loggedSets={[
          {
            id: "squat-set",
            movementId: "squat",
            weightKg: 200,
            reps: 5,
            rpe: 8,
          },
        ]}
        priorBest={undefined}
        addStrengthSet={addStrengthSet}
        updateStrengthSet={updateStrengthSet}
        hapticsEnabled={false}
        timerSoundEnabled={false}
        restTimerEnabled={true}
        focusStrip
      />,
    );
    expect(html).toContain('aria-label="Weight (kg)"');
    expect(html).toContain('value="0"');
    expect(html).not.toContain('value="200"');
  });

  it("still renders the logger when a pinned slot is out of the group's range", () => {
    // Regression: the focus strip drives every movement through one logger
    // instance, so a slot pinned on a 5-set lift (e.g. after editing set 5)
    // followed by a tap on a 3-set lift resolved to a slot that doesn't exist.
    // The card kept its header and dropped the entire logging UI — the user
    // saw just the movement name until they resumed the workout from Today.
    const html = renderToStaticMarkup(
      <MovementFocusView
        sessionId="session"
        group={rehabGroup}
        tmKg={undefined}
        oneRmKg={undefined}
        loggedItemIndices={new Set()}
        skippedItemIndices={new Set()}
        loggedSetIdByItemIndex={{}}
        loggedSets={[]}
        priorBest={undefined}
        addStrengthSet={addStrengthSet}
        updateStrengthSet={updateStrengthSet}
        hapticsEnabled={false}
        timerSoundEnabled={false}
        restTimerEnabled={true}
        focusStrip
        initialCursor={4}
      />,
    );
    expect(html).toContain('data-testid="movement-focus-log-button"');
    expect(html).toContain('aria-label="Reps"');
    // Clamped onto the group's last real slot rather than resolving to nothing.
    expect(html).toContain("3 of 3");
  });
});
