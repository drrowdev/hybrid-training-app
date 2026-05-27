/**
 * Heart-rate zone settings — server action tests.
 *
 * Exercises the test-friendly core (`performUpdateHrZones`) with a
 * stub Supabase client so we don't need to stand up next/headers.
 * Covers: validation rejection, intake merge (keeps unrelated keys),
 * computed-bands cache, and a no-op switch between methods (each
 * method's raw inputs survive when the user flips the picker).
 */
import { describe, expect, it, vi } from "vitest";
import { performUpdateHrZones } from "../hr-zones-actions";

type Stub = Parameters<typeof performUpdateHrZones>[1]["supabase"];

function makeStub(initialIntake: unknown) {
  const writes: Array<Record<string, unknown>> = [];
  const stub: Stub = {
    from: (_table: string) => ({
      select: (_cols: string) => ({
        eq: (_col: string, _val: string) => ({
          maybeSingle: async () => ({
            data: { intake: initialIntake },
            error: null,
          }),
        }),
      }),
      update: (row: Record<string, unknown>) => {
        writes.push(row);
        return {
          eq: async (_col: string, _val: string) => ({ error: null }),
        };
      },
    }),
  };
  return { stub, writes };
}

describe("performUpdateHrZones", () => {
  it("rejects out-of-range max HR", async () => {
    const { stub } = makeStub({});
    await expect(
      performUpdateHrZones({ hrMethod: "max", hrMax: 9999 }, { supabase: stub, userId: "u1" }),
    ).rejects.toThrow();
  });

  it("rejects missing method", async () => {
    const { stub } = makeStub({});
    await expect(
      performUpdateHrZones({ hrMax: 190 }, { supabase: stub, userId: "u1" }),
    ).rejects.toThrow();
  });

  it("computes %Max bands and caches them on intake.hrZones", async () => {
    const { stub, writes } = makeStub({});
    const res = await performUpdateHrZones(
      { hrMethod: "max", hrMax: 200 },
      { supabase: stub, userId: "u1" },
    );
    expect(res.hrZones).toEqual({ z1Max: 120, z2Max: 140, z3Max: 160, z4Max: 180 });
    expect(writes).toHaveLength(1);
    const intake = writes[0].intake as Record<string, unknown>;
    expect(intake.hrMethod).toBe("max");
    expect(intake.hrMax).toBe(200);
    expect(intake.hrZones).toEqual({ z1Max: 120, z2Max: 140, z3Max: 160, z4Max: 180 });
  });

  it("merges into existing intake without clobbering unrelated keys", async () => {
    const { stub, writes } = makeStub({
      goals: "hypertrophy",
      equipment: ["barbell"],
      hrMax: 999, // stale value should be overwritten
    });
    await performUpdateHrZones(
      { hrMethod: "hrr", hrMax: 195, hrResting: 55 },
      { supabase: stub, userId: "u1" },
    );
    const intake = writes[0].intake as Record<string, unknown>;
    expect(intake.goals).toBe("hypertrophy");
    expect(intake.equipment).toEqual(["barbell"]);
    expect(intake.hrMethod).toBe("hrr");
    expect(intake.hrMax).toBe(195);
    expect(intake.hrResting).toBe(55);
    // bands cached: span 140, z1 = 55 + 0.5*140 = 125
    const bands = intake.hrZones as Record<string, number>;
    expect(bands.z1Max).toBeCloseTo(125, 6);
  });

  it("persists null bands when required inputs for the picked method are missing", async () => {
    // hrr without hrResting is invalid → bands null but write still happens
    // so the user's chosen method + the field they did fill in stick.
    const { stub, writes } = makeStub({});
    const res = await performUpdateHrZones(
      { hrMethod: "hrr", hrMax: 195 },
      { supabase: stub, userId: "u1" },
    );
    expect(res.hrZones).toBeNull();
    const intake = writes[0].intake as Record<string, unknown>;
    expect(intake.hrMethod).toBe("hrr");
    expect(intake.hrMax).toBe(195);
    expect(intake.hrResting).toBeNull();
    expect(intake.hrZones).toBeNull();
  });

  it("preserves OTHER methods' raw inputs across saves (user can flip method without data loss)", async () => {
    // First save: %Max with hrMax=200
    const stubA = makeStub({});
    await performUpdateHrZones(
      { hrMethod: "max", hrMax: 200 },
      { supabase: stubA.stub, userId: "u1" },
    );
    const afterMax = stubA.writes[0].intake as Record<string, unknown>;

    // Second save: switch to LTHR with hrLthr=170, but the client
    // also re-sends the existing hrMax so it's not lost.
    const stubB = makeStub(afterMax);
    await performUpdateHrZones(
      { hrMethod: "lthr", hrMax: 200, hrLthr: 170 },
      { supabase: stubB.stub, userId: "u1" },
    );
    const afterLthr = stubB.writes[0].intake as Record<string, unknown>;
    expect(afterLthr.hrMethod).toBe("lthr");
    expect(afterLthr.hrMax).toBe(200); // preserved
    expect(afterLthr.hrLthr).toBe(170); // new
    const bands = afterLthr.hrZones as Record<string, number>;
    expect(bands.z1Max).toBeCloseTo(170 * 0.81, 6);
  });

  it("surfaces supabase write errors as thrown errors", async () => {
    const stub: Stub = {
      from: (_t: string) => ({
        select: (_c: string) => ({
          eq: (_col: string, _val: string) => ({
            maybeSingle: async () => ({ data: { intake: {} }, error: null }),
          }),
        }),
        update: (_row: Record<string, unknown>) => ({
          eq: async (_col: string, _val: string) => ({
            error: { message: "rls denied" },
          }),
        }),
      }),
    };
    await expect(
      performUpdateHrZones(
        { hrMethod: "max", hrMax: 190 },
        { supabase: stub, userId: "u1" },
      ),
    ).rejects.toThrow(/rls denied/);
  });
});

// Silence unused-import linting for `vi` if added later — kept for parity
// with other action tests that mock revalidatePath.
void vi;

describe("performUpdateHrZones — pcts overrides", () => {
  it("persists pcts under intake.hrPercents[method] and uses them for cached bands", async () => {
    const { stub, writes } = makeStub({});
    const res = await performUpdateHrZones(
      {
        hrMethod: "max",
        hrMax: 200,
        pcts: { z1: 0.55, z2: 0.65, z3: 0.75, z4: 0.88 },
      },
      { supabase: stub, userId: "u1" },
    );
    expect(res.hrZones?.z1Max).toBeCloseTo(110, 6); // 200 * 0.55
    const intake = writes[0].intake as Record<string, unknown>;
    const hrPercents = intake.hrPercents as Record<string, unknown>;
    expect(hrPercents.max).toEqual({ z1: 0.55, z2: 0.65, z3: 0.75, z4: 0.88 });
  });

  it("rejects invalid pcts (non-ascending) without writing", async () => {
    const { stub, writes } = makeStub({});
    await expect(
      performUpdateHrZones(
        {
          hrMethod: "max",
          hrMax: 200,
          pcts: { z1: 0.9, z2: 0.6, z3: 0.7, z4: 0.85 },
        },
        { supabase: stub, userId: "u1" },
      ),
    ).rejects.toThrow(/Invalid HR zone percentages/);
    expect(writes).toHaveLength(0);
  });

  it("rejects out-of-range pcts (above 150%)", async () => {
    const { stub } = makeStub({});
    await expect(
      performUpdateHrZones(
        {
          hrMethod: "lthr",
          hrLthr: 170,
          pcts: { z1: 0.81, z2: 0.89, z3: 0.93, z4: 1.6 },
        },
        { supabase: stub, userId: "u1" },
      ),
    ).rejects.toThrow(/Invalid HR zone percentages/);
  });

  it("clears just the active method's pcts when pcts is omitted / null, preserving siblings", async () => {
    // Existing intake has overrides for BOTH max AND lthr.
    const initial = {
      hrPercents: {
        max: { z1: 0.55, z2: 0.65, z3: 0.75, z4: 0.88 },
        lthr: { z1: 0.8, z2: 0.88, z3: 0.94, z4: 1.0 },
      },
    };
    // User saves the max method WITHOUT a pcts override → max override
    // is cleared, but lthr override survives.
    const { stub, writes } = makeStub(initial);
    await performUpdateHrZones(
      { hrMethod: "max", hrMax: 200, pcts: null },
      { supabase: stub, userId: "u1" },
    );
    const intake = writes[0].intake as Record<string, unknown>;
    const hrPercents = intake.hrPercents as Record<string, unknown>;
    expect(hrPercents.max).toBeUndefined();
    expect(hrPercents.lthr).toEqual({ z1: 0.8, z2: 0.88, z3: 0.94, z4: 1.0 });
    // Cached bands fall back to defaults (200 * 0.6 = 120).
    const bands = intake.hrZones as Record<string, number>;
    expect(bands.z1Max).toBeCloseTo(120, 6);
  });

  it("preserves sibling-method pcts when saving a new method override", async () => {
    const initial = {
      hrPercents: {
        lthr: { z1: 0.8, z2: 0.88, z3: 0.94, z4: 1.0 },
      },
    };
    const { stub, writes } = makeStub(initial);
    await performUpdateHrZones(
      {
        hrMethod: "max",
        hrMax: 200,
        pcts: { z1: 0.55, z2: 0.65, z3: 0.75, z4: 0.88 },
      },
      { supabase: stub, userId: "u1" },
    );
    const intake = writes[0].intake as Record<string, unknown>;
    const hrPercents = intake.hrPercents as Record<string, unknown>;
    expect(hrPercents.max).toEqual({ z1: 0.55, z2: 0.65, z3: 0.75, z4: 0.88 });
    expect(hrPercents.lthr).toEqual({ z1: 0.8, z2: 0.88, z3: 0.94, z4: 1.0 });
  });

  it("drops the hrPercents key entirely once the last override is cleared", async () => {
    const initial = {
      hrPercents: {
        max: { z1: 0.55, z2: 0.65, z3: 0.75, z4: 0.88 },
      },
    };
    const { stub, writes } = makeStub(initial);
    await performUpdateHrZones(
      { hrMethod: "max", hrMax: 200 },
      { supabase: stub, userId: "u1" },
    );
    const intake = writes[0].intake as Record<string, unknown>;
    expect(intake.hrPercents).toBeUndefined();
  });
});
