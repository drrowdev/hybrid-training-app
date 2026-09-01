/**
 * Regression for server-side plan materialisation of warm-up targets.
 *
 * The client rounds warm-up targets for display, but fillSessionFromPlan also
 * persists weight_kg rows. Those rows must use the same empty-bar and
 * plate-pair rules or a refresh will reintroduce the old target.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  COMMERCIAL_GYM_PRESET,
  HOME_GYM_PRESET,
  TRAVEL_HOTEL_PRESET,
} from "@/lib/settings/equipment-presets";

const USER_ID = "00000000-0000-4000-8000-000000000001";
const SESSION_ID = "00000000-0000-4000-8000-000000000002";

const mockState = vi.hoisted(() => ({
  planned: null as Record<string, unknown> | null,
  profile: null as Record<string, unknown> | null,
  trainingMaxes: [] as Array<Record<string, unknown>>,
  existingSets: [] as Array<Record<string, unknown>>,
  upserts: [] as Array<Record<string, unknown>>,
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/engine/region-ledger", () => ({
  recomputeRegionState: vi.fn(),
}));
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
    rpc: async (name: string, args: Record<string, unknown>) => {
      if (name === "insert_set_logs_with_bw_progress") {
        mockState.upserts.push(
          ...((args.p_set_logs as Array<Record<string, unknown>>) ?? []),
        );
        return { data: [], error: null };
      }
      return {
        data: null,
        error: { code: "PGRST202", message: "Function not found" },
      };
    },
    from: (table: string) => {
      const builder: Record<string, unknown> = {};
      const execute = () => {
        if (table === "planned_sessions") {
          return { data: mockState.planned, error: null };
        }
        if (table === "profiles") {
          return { data: mockState.profile, error: null };
        }
        if (table === "training_maxes") {
          return { data: mockState.trainingMaxes, error: null };
        }
        if (table === "set_logs") {
          return { data: mockState.existingSets, error: null };
        }
        if (table === "movements") {
          // Barbell lifts — none of these maxes include bodyweight.
          return { data: [], error: null };
        }
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
        then: (
          resolve: (value: { data: unknown; error: null }) => unknown,
        ) => Promise.resolve(resolve(execute())),
      });
      return builder;
    },
  }),
  getAuthUser: async () => ({
    data: { user: { id: USER_ID } },
    error: null,
  }),
}));

describe("fillSessionFromPlan warm-up loads", () => {
  beforeEach(() => {
    mockState.planned = {
      id: "planned-1",
      prescription: {
        items: [
          {
            movementId: "movement-squat",
            movementSlug: "barbell-back-squat",
            kind: "warmup",
            sets: 1,
            reps: 5,
            percentTm: 10,
          },
          {
            movementId: "movement-squat",
            movementSlug: "barbell-back-squat",
            kind: "warmup",
            sets: 1,
            reps: 3,
            percentTm: 30,
          },
          {
            movementId: "movement-squat",
            movementSlug: "barbell-back-squat",
            kind: "warmup",
            sets: 1,
            reps: 2,
            targetWeightKg: 18,
          },
        ],
      },
      week_index: 0,
      day_index: 0,
      training_blocks: null,
    };
    mockState.profile = {
      tm_percent_default: 90,
      barbell_kg: 20,
      trap_bar_kg: null,
      plate_inventory_kg: [{ weight_kg: 2.5 }],
      equipment: null,
    };
    mockState.trainingMaxes = [
      {
        movement_id: "movement-squat",
        one_rm_kg: 100,
        tm_percent: 90,
      },
    ];
    mockState.existingSets = [];
    mockState.upserts = [];
  });

  it("persists floored and plate-pair-rounded warm-up loads", async () => {
    // DC-K4: server materialisation must not silently overrule the canonical
    // warm-up target that the client displays.
    const { fillSessionFromPlan } = await import("../actions");
    const formData = new FormData();
    formData.set("sessionId", SESSION_ID);

    const result = await fillSessionFromPlan(formData);

    expect(result).toEqual({ ok: true, inserted: 3 });
    expect(mockState.upserts.map((row) => row.weight_kg)).toEqual([
      20, // 9 kg raw → empty 20 kg bar floor
      25, // 27 kg raw → nearest 5 kg plate-pair increment
      20, // 18 kg absolute target → empty 20 kg bar floor
    ]);
  });

  it("does not impose a 20 kg floor when the warm-up movement has no bar", async () => {
    mockState.planned = {
      ...mockState.planned,
      prescription: {
        items: [
          {
            movementId: "movement-db",
            movementSlug: "dumbbell-bench-press",
            kind: "warmup",
            sets: 1,
            reps: 5,
            percentTm: 10,
          },
        ],
      },
    };
    mockState.profile = {
      tm_percent_default: 90,
      barbell_kg: 0,
      trap_bar_kg: null,
      plate_inventory_kg: [],
      equipment: null,
    };
    mockState.trainingMaxes = [
      {
        movement_id: "movement-db",
        one_rm_kg: 100,
        tm_percent: 90,
      },
    ];
    mockState.upserts = [];

    const { fillSessionFromPlan } = await import("../actions");
    const formData = new FormData();
    formData.set("sessionId", SESSION_ID);

    await fillSessionFromPlan(formData);

    expect(mockState.upserts.map((row) => row.weight_kg)).toEqual([10]);
  });

  it("persists the same load the focus view displays for a trap-bar lift in a home gym", async () => {
    // `HOME_GYM_PRESET.bars.trapBarKg === null` — the lifter owns no trap
    // bar, so neither side may floor to 25 kg. Client counterpart:
    // components/session/__tests__/MovementFocusView.warmup-bar.test.tsx.
    mockState.planned = {
      ...mockState.planned,
      prescription: {
        items: [
          {
            movementId: "movement-trap-dl",
            movementSlug: "trap-bar-deadlift",
            kind: "warmup",
            sets: 1,
            reps: 5,
            percentTm: 34,
          },
        ],
      },
    };
    mockState.profile = {
      tm_percent_default: 90,
      plate_inventory_kg: [],
      equipment: HOME_GYM_PRESET,
    };
    mockState.trainingMaxes = [
      { movement_id: "movement-trap-dl", one_rm_kg: 60, tm_percent: 100 },
    ];
    mockState.upserts = [];

    const { fillSessionFromPlan } = await import("../actions");
    const formData = new FormData();
    formData.set("sessionId", SESSION_ID);

    await fillSessionFromPlan(formData);

    // 60 × 34% = 20.4 kg → 2.5 kg plate-pair increment → 20 kg, no bar floor.
    expect(mockState.upserts.map((row) => row.weight_kg)).toEqual([20]);
  });

  it("persists the same load the focus view displays for an SSB squat", async () => {
    // The safety-squat bar is 25 kg in a commercial gym against a 20 kg
    // straight bar. `ssb-squat` used to resolve as a plain barbell, so both
    // sides floored to the wrong bar. Client counterpart:
    // components/session/__tests__/MovementFocusView.warmup-bar.test.tsx.
    mockState.planned = {
      ...mockState.planned,
      prescription: {
        items: [
          {
            movementId: "movement-ssb",
            movementSlug: "ssb-squat",
            kind: "warmup",
            sets: 1,
            reps: 5,
            percentTm: 34,
          },
        ],
      },
    };
    mockState.profile = {
      tm_percent_default: 90,
      plate_inventory_kg: [],
      equipment: COMMERCIAL_GYM_PRESET,
    };
    mockState.trainingMaxes = [
      { movement_id: "movement-ssb", one_rm_kg: 60, tm_percent: 100 },
    ];
    mockState.upserts = [];

    const { fillSessionFromPlan } = await import("../actions");
    const formData = new FormData();
    formData.set("sessionId", SESSION_ID);

    await fillSessionFromPlan(formData);

    // 60 × 34% = 20.4 kg → rounds to 20 kg → floored to the 25 kg SSB, not
    // the 20 kg straight bar.
    expect(mockState.upserts.map((row) => row.weight_kg)).toEqual([25]);
  });

  it("persists the same load the focus view displays for a preset with no barbell", async () => {
    // `TRAVEL_HOTEL_PRESET.bars.barbellKg === 0` — "No barbell" must not be
    // coerced to a 20 kg bar on either side.
    mockState.planned = {
      ...mockState.planned,
      prescription: {
        items: [
          {
            movementId: "movement-bench",
            movementSlug: "barbell-bench-press",
            kind: "warmup",
            sets: 1,
            reps: 5,
            percentTm: 34,
          },
        ],
      },
    };
    mockState.profile = {
      tm_percent_default: 90,
      plate_inventory_kg: [],
      equipment: TRAVEL_HOTEL_PRESET,
    };
    mockState.trainingMaxes = [
      { movement_id: "movement-bench", one_rm_kg: 40, tm_percent: 100 },
    ];
    mockState.upserts = [];

    const { fillSessionFromPlan } = await import("../actions");
    const formData = new FormData();
    formData.set("sessionId", SESSION_ID);

    await fillSessionFromPlan(formData);

    // 40 × 34% = 13.6 kg → default 2.5 kg increment → 12.5 kg, no bar floor.
    expect(mockState.upserts.map((row) => row.weight_kg)).toEqual([12.5]);
  });

  it("materialises a TM-anchored ladder as flat loads with the bar floor and plate rounding", async () => {
    // A session from a program whose ramp is a fixed 40/50/60% of the Training
    // Max: percentTm IS the ladder, so a 200 kg TM ramps 80/100/120 kg in every
    // week of the wave. The light press proves the empty-bar floor still wins.
    const ladder = [40, 50, 60].map((percentTm, index) => ({
      movementId: "movement-dl",
      movementSlug: "deadlift",
      kind: "warmup" as const,
      sets: 1,
      reps: [5, 5, 3][index],
      percentTm,
    }));
    mockState.planned = {
      ...mockState.planned,
      prescription: {
        items: [
          ...ladder,
          {
            movementId: "movement-press",
            movementSlug: "overhead-press",
            kind: "warmup" as const,
            sets: 1,
            reps: 5,
            percentTm: 40,
          },
        ],
      },
    };
    mockState.profile = {
      tm_percent_default: 90,
      barbell_kg: 20,
      trap_bar_kg: null,
      plate_inventory_kg: [{ weight_kg: 2.5 }],
      equipment: null,
    };
    mockState.trainingMaxes = [
      { movement_id: "movement-dl", one_rm_kg: 200, tm_percent: 100 },
      { movement_id: "movement-press", one_rm_kg: 30, tm_percent: 100 },
    ];
    mockState.upserts = [];

    const { fillSessionFromPlan } = await import("../actions");
    const formData = new FormData();
    formData.set("sessionId", SESSION_ID);

    await fillSessionFromPlan(formData);

    expect(mockState.upserts.map((row) => row.weight_kg)).toEqual([
      80, // 200 × 40%
      100, // 200 × 50%
      120, // 200 × 60%
      20, // 30 × 40% = 12 kg raw → empty 20 kg bar floor
    ]);
  });
});
