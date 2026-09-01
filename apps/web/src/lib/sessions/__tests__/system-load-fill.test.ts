/**
 * Server-side materialisation of a SYSTEM-LOAD movement.
 *
 * The engine's own load never reaches the database for a working set — the
 * adapter keeps only `percentTm`, and this action re-derives the kg from the
 * saved max. That is exactly where a weighted pull-up went wrong: a percentage
 * of a bodyweight-inclusive 110 kg max was persisted as 77 kg on a dip belt.
 * These tests hold the subtraction at the point the rows are written.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const USER_ID = "00000000-0000-4000-8000-000000000001";
const SESSION_ID = "00000000-0000-4000-8000-000000000002";
const PULLUP_ID = "movement-weighted-pullup";

const mockState = vi.hoisted(() => ({
  planned: null as Record<string, unknown> | null,
  profile: null as Record<string, unknown> | null,
  trainingMaxes: [] as Array<Record<string, unknown>>,
  movements: [] as Array<Record<string, unknown>>,
  existingSets: [] as Array<Record<string, unknown>>,
  upserts: [] as Array<Record<string, unknown>>,
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/engine/region-ledger", () => ({ recomputeRegionState: vi.fn() }));
vi.mock("@/lib/engine/recompute-actual-session-load", () => ({
  recomputeActualSessionLoad: vi.fn(),
}));
vi.mock("../post-completion-recompute", () => ({
  recomputeAfterCompletedSessionMutation: vi.fn(async () => ({ recomputed: false })),
}));
vi.mock("@/lib/planner/completion", () => ({ maybeCompleteBlock: vi.fn() }));
vi.mock("@/lib/planner/queries", () => ({
  dayDate: vi.fn(),
  getUserTimezone: vi.fn(async () => "UTC"),
}));
vi.mock("@/lib/planner/modifications", () => ({
  applyModificationsToPrescription: (prescription: unknown) => prescription,
  getActiveModifications: vi.fn(async () => []),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => {
      const builder: Record<string, unknown> = {};
      const execute = () => {
        if (table === "planned_sessions") return { data: mockState.planned, error: null };
        if (table === "profiles") return { data: mockState.profile, error: null };
        if (table === "training_maxes") return { data: mockState.trainingMaxes, error: null };
        if (table === "set_logs") return { data: mockState.existingSets, error: null };
        if (table === "movements") return { data: mockState.movements, error: null };
        return { data: null, error: null };
      };

      Object.assign(builder, {
        select: () => builder,
        eq: () => builder,
        in: () => builder,
        maybeSingle: () => Promise.resolve(execute()),
        upsert: (rows: Array<Record<string, unknown>>) => {
          mockState.upserts.push(...rows);
          return Promise.resolve({ error: null });
        },
        then: (resolve: (value: { data: unknown; error: null }) => unknown) =>
          Promise.resolve(resolve(execute())),
      });
      return builder;
    },
  }),
  getAuthUser: async () => ({ data: { user: { id: USER_ID } }, error: null }),
}));

function pullupPrescription(items: Array<Record<string, unknown>>) {
  return {
    id: "planned-1",
    prescription: { items },
    week_index: 0,
    day_index: 0,
    training_blocks: null,
  };
}

describe("fillSessionFromPlan — weighted bodyweight movements", () => {
  beforeEach(() => {
    mockState.planned = pullupPrescription([
      {
        movementId: PULLUP_ID,
        movementSlug: "weighted-pull-up",
        kind: "main",
        sets: 1,
        reps: 5,
        percentTm: 100,
      },
    ]);
    mockState.profile = {
      tm_percent_default: 100,
      barbell_kg: 20,
      trap_bar_kg: null,
      plate_inventory_kg: [{ weight_kg: 1.25 }],
      equipment: null,
      bodyweight_kg: 85,
    };
    mockState.trainingMaxes = [
      { movement_id: PULLUP_ID, one_rm_kg: 110, tm_percent: 100 },
    ];
    // The catalog is what marks the movement, so plans materialised before the
    // engine learned to subtract bodyweight are corrected too.
    mockState.movements = [{ id: PULLUP_ID, slug: "weighted-pull-up" }];
    mockState.existingSets = [];
    mockState.upserts = [];
  });

  it("persists the belt load, not the bodyweight-inclusive total", async () => {
    mockState.planned = pullupPrescription([
      {
        movementId: PULLUP_ID,
        movementSlug: "weighted-pull-up",
        kind: "main",
        sets: 1,
        reps: 5,
        percentTm: 95,
      },
    ]);
    const { fillSessionFromPlan } = await import("../actions");
    const formData = new FormData();
    formData.set("sessionId", SESSION_ID);

    const result = await fillSessionFromPlan(formData);

    expect(result).toEqual({ ok: true, inserted: 1 });
    // 95% of 110 kg = 104.5 kg of system load − 85 kg = 19.5 → 20 kg.
    expect(mockState.upserts[0]?.weight_kg).toBe(20);
    expect(mockState.upserts[0]?.target_weight_kg).toBe(20);
  });

  it("persists a bodyweight set when the percentage lands under bodyweight", async () => {
    mockState.planned = pullupPrescription([
      {
        movementId: PULLUP_ID,
        movementSlug: "weighted-pull-up",
        kind: "main",
        sets: 1,
        reps: 5,
        percentTm: 70,
      },
    ]);
    const { fillSessionFromPlan } = await import("../actions");
    const formData = new FormData();
    formData.set("sessionId", SESSION_ID);

    await fillSessionFromPlan(formData);

    // 70% of 110 kg = 77 kg, under an 85 kg lifter — a plain pull-up.
    expect(mockState.upserts[0]?.weight_kg).toBe(0);
  });

  it("leaves the load unset when no bodyweight is on file", async () => {
    mockState.profile = { ...mockState.profile, bodyweight_kg: null };
    const { fillSessionFromPlan } = await import("../actions");
    const formData = new FormData();
    formData.set("sessionId", SESSION_ID);

    await fillSessionFromPlan(formData);

    expect(mockState.upserts[0]?.weight_kg).toBeNull();
    expect(mockState.upserts[0]?.target_weight_kg).toBeNull();
  });

  it("corrects a warm-up stored before the bodyweight subtraction existed", async () => {
    // The reported bug, as it sits in an already-materialised plan: absolute
    // warm-up targets that are fractions of the bodyweight-inclusive total,
    // with no `systemLoad` marker because the path that wrote them didn't know
    // about bodyweight. Read as totals, all three are plain pull-ups.
    mockState.planned = pullupPrescription(
      [40, 60, 80].map((targetWeightKg) => ({
        movementId: PULLUP_ID,
        movementSlug: "weighted-pull-up",
        kind: "warmup",
        sets: 1,
        reps: 5,
        targetWeightKg,
      })),
    );
    const { fillSessionFromPlan } = await import("../actions");
    const formData = new FormData();
    formData.set("sessionId", SESSION_ID);

    await fillSessionFromPlan(formData);

    expect(mockState.upserts.map((row) => row.weight_kg)).toEqual([0, 0, 0]);
  });

  it("keeps a 0 kg warm-up instead of dropping it", async () => {
    mockState.planned = pullupPrescription([
      {
        movementId: PULLUP_ID,
        movementSlug: "weighted-pull-up",
        kind: "warmup",
        sets: 1,
        reps: 5,
        targetWeightKg: 0,
        systemLoad: true,
      },
    ]);
    const { fillSessionFromPlan } = await import("../actions");
    const formData = new FormData();
    formData.set("sessionId", SESSION_ID);

    await fillSessionFromPlan(formData);

    expect(mockState.upserts[0]?.weight_kg).toBe(0);
  });

  it("does not touch a barbell lift", async () => {
    mockState.planned = pullupPrescription([
      {
        movementId: "movement-squat",
        movementSlug: "barbell-back-squat",
        kind: "main",
        sets: 1,
        reps: 5,
        percentTm: 70,
      },
    ]);
    mockState.trainingMaxes = [
      { movement_id: "movement-squat", one_rm_kg: 200, tm_percent: 100 },
    ];
    mockState.movements = [{ id: "movement-squat", slug: "back-squat" }];
    const { fillSessionFromPlan } = await import("../actions");
    const formData = new FormData();
    formData.set("sessionId", SESSION_ID);

    await fillSessionFromPlan(formData);

    expect(mockState.upserts[0]?.weight_kg).toBe(140);
  });
});

const LUNGE_ID = "movement-forward-lunge";

describe("fillSessionFromPlan — bodyweight-capable lifts are not system loads", () => {
  // A Forward Lunge can be done with no external weight, which is what
  // `body_weight_loaded` marks. It does NOT mean the saved max counts the
  // lifter's bodyweight — a 100 kg lunge max is 100 kg on the bar. Treating the
  // two as the same question turned a 70% lunge into a bodyweight AMRAP.
  beforeEach(() => {
    mockState.planned = pullupPrescription([
      {
        movementId: LUNGE_ID,
        movementSlug: "forward-lunge",
        kind: "main",
        sets: 1,
        reps: 8,
        percentTm: 70,
      },
    ]);
    mockState.profile = {
      tm_percent_default: 100,
      barbell_kg: 20,
      equipment: null,
      bodyweight_kg: 80,
    };
    mockState.trainingMaxes = [{ movement_id: LUNGE_ID, one_rm_kg: 100, tm_percent: 100 }];
    mockState.movements = [{ id: LUNGE_ID, slug: "forward-lunge" }];
    mockState.existingSets = [];
    mockState.upserts = [];
  });

  it("DC-K4: 70% of a 100 kg lunge max is 70 kg on the bar, not a bodyweight set", async () => {
    const { fillSessionFromPlan } = await import("../actions");
    const formData = new FormData();
    formData.set("sessionId", SESSION_ID);

    await fillSessionFromPlan(formData);

    expect(mockState.upserts[0]?.weight_kg).toBe(70);
  });

  it("DC-K4: a plan materialised under the old rule is corrected, not honoured", async () => {
    // Same day, but the stored item still carries the marker written when
    // `body_weight_loaded` answered this question. The catalog decides.
    mockState.planned = pullupPrescription([
      {
        movementId: LUNGE_ID,
        movementSlug: "forward-lunge",
        kind: "main",
        sets: 1,
        reps: 8,
        percentTm: 70,
        systemLoad: true,
      },
    ]);
    const { fillSessionFromPlan } = await import("../actions");
    const formData = new FormData();
    formData.set("sessionId", SESSION_ID);

    await fillSessionFromPlan(formData);

    expect(mockState.upserts[0]?.weight_kg).toBe(70);
  });

  it("DC-K4: a weighted pull-up with no stored marker still comes off the belt", async () => {
    mockState.planned = pullupPrescription([
      {
        movementId: PULLUP_ID,
        movementSlug: "weighted-pull-up",
        kind: "main",
        sets: 1,
        reps: 5,
        percentTm: 100,
      },
    ]);
    mockState.trainingMaxes = [{ movement_id: PULLUP_ID, one_rm_kg: 110, tm_percent: 100 }];
    mockState.movements = [{ id: PULLUP_ID, slug: "weighted-pull-up" }];
    const { fillSessionFromPlan } = await import("../actions");
    const formData = new FormData();
    formData.set("sessionId", SESSION_ID);

    await fillSessionFromPlan(formData);

    // 110 kg of system load − 80 kg of lifter = 30 kg on the belt.
    expect(mockState.upserts[0]?.weight_kg).toBe(30);
  });

  it("DC-K4: a legacy lunge warm-up ramp is restated as the totals it meant", async () => {
    // The exact shape an old plan stored: bodyweight already subtracted into an
    // absolute, a `systemLoad` marker, and no percentage to fall back on. The
    // lightest rung was clamped to 0 on the way in. Top set 110 kg, lifter
    // 80 kg, a 50/75/100 ladder — so the ramp was always 55 / 82.5 / 110.
    mockState.trainingMaxes = [
      { movement_id: LUNGE_ID, one_rm_kg: 110, tm_percent: 100 },
    ];
    mockState.profile = {
      ...mockState.profile,
      warmup_scheme: {
        setCount: 3,
        percentLadder: [50, 75, 100],
        repLadder: [5, 5, 3],
      },
    };
    mockState.planned = pullupPrescription([
      ...[0, 2.5, 30].map((targetWeightKg) => ({
        movementId: LUNGE_ID,
        movementSlug: "forward-lunge",
        kind: "warmup",
        sets: 1,
        reps: 5,
        targetWeightKg,
        systemLoad: true,
      })),
      {
        movementId: LUNGE_ID,
        movementSlug: "forward-lunge",
        kind: "main",
        sets: 1,
        reps: 5,
        percentTm: 100,
      },
    ]);
    const { fillSessionFromPlan } = await import("../actions");
    const formData = new FormData();
    formData.set("sessionId", SESSION_ID);

    await fillSessionFromPlan(formData);

    expect(mockState.upserts.map((row) => row.weight_kg)).toEqual([
      55, 82.5, 110, 110,
    ]);
  });

  it("falls back to the stored marker when the catalog cannot resolve the movement", async () => {
    mockState.planned = pullupPrescription([
      {
        movementId: PULLUP_ID,
        movementSlug: "weighted-pull-up",
        kind: "main",
        sets: 1,
        reps: 5,
        percentTm: 100,
        systemLoad: true,
      },
    ]);
    mockState.trainingMaxes = [{ movement_id: PULLUP_ID, one_rm_kg: 110, tm_percent: 100 }];
    mockState.movements = [];
    const { fillSessionFromPlan } = await import("../actions");
    const formData = new FormData();
    formData.set("sessionId", SESSION_ID);

    await fillSessionFromPlan(formData);

    expect(mockState.upserts[0]?.weight_kg).toBe(30);
  });
});
