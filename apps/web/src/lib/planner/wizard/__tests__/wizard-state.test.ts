/**
 * Reducer tests for the block wizard. Focused on the Step-5 swap +
 * drag-and-drop actions added in fix/step5-layout-dnd-and-banner.
 */
import { describe, it, expect } from "vitest";
import { initialWizardState, wizardReducer, type WizardState } from "../wizard-state";
import type { ScheduleCell, SessionShape } from "../schedule";

function mkSession(title: string): SessionShape {
  return {
    title,
    icon: "🏋️",
    durationMin: 60,
    meta: title,
    weightKey: "Strength day (moderate)",
  };
}

function mkSchedule(): ScheduleCell[] {
  return [0, 1, 2, 3, 4, 5, 6].map((day) => {
    if (day === 0) return { day, am: mkSession("Lift A"), pm: null };
    if (day === 4) return { day, am: mkSession("Run"), pm: null };
    return { day, am: null, pm: null };
  });
}

function baseState(): WizardState {
  return { ...initialWizardState, schedule: mkSchedule() };
}

describe("wizardReducer — drag-and-drop actions", () => {
  it("drag-start sets dragSourceIdx and clears dragOverIdx", () => {
    const s = wizardReducer({ ...baseState(), dragOverIdx: 3 }, { type: "drag-start", idx: 0 });
    expect(s.dragSourceIdx).toBe(0);
    expect(s.dragOverIdx).toBeNull();
  });

  it("drag-over updates dragOverIdx", () => {
    const after = wizardReducer(
      { ...baseState(), dragSourceIdx: 0 },
      { type: "drag-over", idx: 4 },
    );
    expect(after.dragOverIdx).toBe(4);
    const cleared = wizardReducer(after, { type: "drag-over", idx: null });
    expect(cleared.dragOverIdx).toBeNull();
  });

  it("drag-end clears both drag fields without touching the schedule", () => {
    const before: WizardState = {
      ...baseState(),
      dragSourceIdx: 0,
      dragOverIdx: 4,
    };
    const after = wizardReducer(before, { type: "drag-end" });
    expect(after.dragSourceIdx).toBeNull();
    expect(after.dragOverIdx).toBeNull();
    expect(after.schedule).toEqual(before.schedule);
  });

  it("apply-swap during a drag swaps payloads and clears drag state", () => {
    const before: WizardState = {
      ...baseState(),
      dragSourceIdx: 0,
      dragOverIdx: 4,
      usingSavedPref: true,
    };
    const after = wizardReducer(before, { type: "apply-swap", sourceIdx: 0, targetIdx: 4 });
    expect(after.dragSourceIdx).toBeNull();
    expect(after.dragOverIdx).toBeNull();
    expect(after.swapSourceIdx).toBeNull();
    expect(after.usingSavedPref).toBe(false);
    expect(after.schedule[0]?.am?.title).toBe("Run");
    expect(after.schedule[4]?.am?.title).toBe("Lift A");
  });

  it("apply-swap onto an empty (rest) target moves the session", () => {
    const before = baseState();
    const after = wizardReducer(before, { type: "apply-swap", sourceIdx: 0, targetIdx: 5 });
    expect(after.schedule[0]?.am).toBeNull();
    expect(after.schedule[5]?.am?.title).toBe("Lift A");
  });
});

describe("wizardReducer — accessory-volume actions", () => {
  it("set-accessory-volume sets the level and marks it touched", () => {
    const after = wizardReducer(baseState(), { type: "set-accessory-volume", level: "high" });
    expect(after.accessoryVolume).toBe("high");
    expect(after.accessoryVolumeTouched).toBe(true);
  });

  it("recommend-accessory-volume applies only while untouched", () => {
    const untouched = wizardReducer(
      { ...baseState(), accessoryVolumeTouched: false },
      { type: "recommend-accessory-volume", level: "low" },
    );
    expect(untouched.accessoryVolume).toBe("low");
    const touched = wizardReducer(
      { ...baseState(), accessoryVolume: "high", accessoryVolumeTouched: true },
      { type: "recommend-accessory-volume", level: "low" },
    );
    expect(touched.accessoryVolume).toBe("high");
  });

  it("clamp-accessory-volume moves selection down WITHOUT marking touched (even when touched)", () => {
    const after = wizardReducer(
      { ...baseState(), accessoryVolume: "high", accessoryVolumeTouched: true },
      { type: "clamp-accessory-volume", level: "medium" },
    );
    expect(after.accessoryVolume).toBe("medium");
    // The clamp is a correctness move, not a user choice — touched is preserved
    // as-is so it doesn't suppress a later re-recommendation.
    expect(after.accessoryVolumeTouched).toBe(true);
    const untouched = wizardReducer(
      { ...baseState(), accessoryVolume: "high", accessoryVolumeTouched: false },
      { type: "clamp-accessory-volume", level: "low" },
    );
    expect(untouched.accessoryVolume).toBe("low");
    expect(untouched.accessoryVolumeTouched).toBe(false);
  });

  it("clamp-accessory-volume is a no-op when already at the target level", () => {
    const before = { ...baseState(), accessoryVolume: "low" as const };
    const after = wizardReducer(before, { type: "clamp-accessory-volume", level: "low" });
    expect(after).toBe(before);
  });
});
