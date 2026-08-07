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
  it("renders one active movement with a horizontal movement queue", () => {
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
      />,
    );
    expect(html).toContain('data-testid="focus-strip-logger"');
    expect(html).toContain("0 of 7 required sets");
    expect(html).toContain("Bench Press 0/4");
    expect(html).toContain("Overhead Press 0/5");
    expect(html).toContain('data-testid="focus-strip-swap"');
    expect(html).not.toContain("movement-card-header-");
    expect(html).not.toContain("± 2.5");
    expect(html).not.toContain("± 1");
  });

  it("preserves superset alternation guidance", () => {
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
        supersetByMovementId={
          new Map([
            ["curl", { groupId: "arms", slot: "A1" as const }],
            ["extension", { groupId: "arms", slot: "A2" as const }],
          ])
        }
        reorderableMovementIds={["curl", "extension"]}
        onReorderMovements={vi.fn()}
        addStrengthSet={addStrengthSet}
        updateStrengthSet={updateStrengthSet}
        hapticsEnabled={false}
        timerSoundEnabled={false}
      />,
    );
    expect(html).toContain('data-testid="focus-strip-superset-cue"');
    expect(html).toContain("alternate with Triceps Extension, then rest once");
    expect(html).toContain('data-testid="focus-strip-reorder"');
    expect(html).toContain('aria-label="Move Curl later"');
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
        focusStrip
      />,
    );
    expect(html).toContain('aria-label="Weight (kg)"');
    expect(html).toContain('value="0"');
    expect(html).not.toContain('value="200"');
  });
});
