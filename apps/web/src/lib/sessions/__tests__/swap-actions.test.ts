/**
 * Swap-active-movement audit-action test.
 *
 * Asserts the action records an `engine_override_events` row whose
 * `context.kind` is `"movement_swap"` and carries the session id +
 * reason category, per the mid-workout swap contract.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { wendler531Engine } from "@hta/wendler";

type Movement = { id: string; slug: string; display_name: string };
type SessionRow = { id: string; user_id: string; deleted_at: string | null };

const USER_ID = "00000000-0000-4000-8000-000000000001";
const SESSION_ID = "00000000-0000-4000-8000-000000000010";
const PLANNED_ID = "00000000-0000-4000-8000-000000000020";
const ORIGINAL_ID = "00000000-0000-4000-8000-0000000000a1";
const NEW_ID = "00000000-0000-4000-8000-0000000000a2";

const movements: Movement[] = [
  { id: ORIGINAL_ID, slug: "front-squat", display_name: "Front Squat" },
  { id: NEW_ID, slug: "goblet-squat", display_name: "Goblet Squat" },
];
const sessions: SessionRow[] = [
  { id: SESSION_ID, user_id: USER_ID, deleted_at: null },
];
const overrideInserts: Array<Record<string, unknown>> = [];
const plannedUpdates: Array<Record<string, unknown>> = [];
const rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = [];
let rpcError: string | null = null;
// A planned_session linked to the active session, with the original movement.
let plannedPrescription: { items: Array<Record<string, unknown>> } | null = null;
let replacementOneRmKg: number | null = null;
let profileWarmupScheme: Record<string, unknown> | null = null;
/** program_id of the training_block that owns the linked planned_session. */
let plannedProgramId: string | null = null;

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: USER_ID } } }),
    },
    rpc: async (fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn, args });
      if (rpcError) return { data: null, error: { message: rpcError } };
      return {
        data: fn === "remove_session_movement" ? [{ deleted: true }] : null,
        error: null,
      };
    },
    from: (table: string) => {
      const state: {
        eqs: Array<[string, unknown]>;
        ises: Array<[string, unknown]>;
        insert?: Record<string, unknown>;
        update?: Record<string, unknown>;
      } = { eqs: [], ises: [] };
      const q: Record<string, (...a: never[]) => unknown> = {
        select: (() => q) as (...a: never[]) => unknown,
        eq: ((col: string, val: unknown) => {
          state.eqs.push([col, val]);
          return q as unknown;
        }) as (...a: never[]) => unknown,
        is: ((col: string, val: unknown) => {
          state.ises.push([col, val]);
          return q as unknown;
        }) as (...a: never[]) => unknown,
        insert: ((row: Record<string, unknown>) => {
          state.insert = row;
          if (table === "engine_override_events") overrideInserts.push(row);
          return q as unknown;
        }) as (...a: never[]) => unknown,
        update: ((row: Record<string, unknown>) => {
          state.update = row;
          if (table === "planned_sessions") plannedUpdates.push(row);
          return q as unknown;
        }) as (...a: never[]) => unknown,
        maybeSingle: (() => {
          if (table === "movements") {
            const id = state.eqs.find(([c]) => c === "id")?.[1];
            return Promise.resolve({ data: movements.find((m) => m.id === id) ?? null, error: null });
          }
          if (table === "sessions") {
            const id = state.eqs.find(([c]) => c === "id")?.[1];
            return Promise.resolve({
              data:
                sessions.find(
                  (s) =>
                    s.id === id &&
                    state.ises.every(
                      ([column, value]) => (s[column as keyof SessionRow] ?? null) === value,
                    ),
                ) ?? null,
              error: null,
            });
          }
          if (table === "planned_sessions") {
            return Promise.resolve({
              data: plannedPrescription
                ? {
                    id: PLANNED_ID,
                    prescription: plannedPrescription,
                    training_blocks: { program_id: plannedProgramId },
                  }
                : null,
              error: null,
            });
          }
          if (table === "training_maxes") {
            return Promise.resolve({
              data:
                replacementOneRmKg == null
                  ? null
                  : { one_rm_kg: replacementOneRmKg, bw_node_id: null },
              error: null,
            });
          }
          if (table === "profiles") {
            return Promise.resolve({
              data: profileWarmupScheme
                ? { warmup_scheme: profileWarmupScheme }
                : null,
              error: null,
            });
          }
          if (table === "engine_override_events") {
            return Promise.resolve({ data: { id: "ovr-1" }, error: null });
          }
          return Promise.resolve({ data: null, error: null });
        }) as (...a: never[]) => unknown,
      };
      return q;
    },
  }),
  getAuthUser: async () => ({ data: { user: { id: USER_ID } }, error: null }),
}));

describe("swapActiveMovement", () => {
  beforeEach(() => {
    overrideInserts.length = 0;
    plannedUpdates.length = 0;
    rpcCalls.length = 0;
    rpcError = null;
    sessions[0]!.deleted_at = null;
    plannedPrescription = null;
    replacementOneRmKg = null;
    profileWarmupScheme = null;
    plannedProgramId = null;
  });

  it("writes an override-audit row with movement_swap context", async () => {
    const { swapActiveMovement } = await import("../swap-actions");
    const fd = new FormData();
    fd.set("sessionId", SESSION_ID);
    fd.set("originalMovementId", ORIGINAL_ID);
    fd.set("newMovementId", NEW_ID);
    fd.set("reason", "pain");
    fd.set("freeformReason", "right knee twinge");
    const result = await swapActiveMovement(fd);
    expect(result.ok).toBe(true);
    expect(result.newMovement?.slug).toBe("goblet-squat");
    expect(overrideInserts).toHaveLength(1);
    const row = overrideInserts[0]!;
    expect(row.event_type).toBe("swap");
    expect(row.original_movement_slug).toBe("front-squat");
    expect(row.new_movement_slug).toBe("goblet-squat");
    expect(row.user_id).toBe(USER_ID);
    const ctx = row.context as Record<string, unknown>;
    expect(ctx.kind).toBe("movement_swap");
    expect(ctx.sessionId).toBe(SESSION_ID);
    expect(ctx.originalMovementId).toBe(ORIGINAL_ID);
    expect(ctx.newMovementId).toBe(NEW_ID);
    expect(ctx.reasonCategory).toBe("pain");
    expect(ctx.freeformReason).toBe("right knee twinge");
    // Issue 9: a session with no prescription (quick/freestyle) has nothing to
    // rewrite. Don't claim a load problem for a swap that changed no loads.
    expect(result.warning).toBeUndefined();
    expect(ctx.loadWarning).toBeNull();
    expect(ctx.prescriptionUpdated).toBe(false);
    expect(plannedUpdates).toHaveLength(0);
    // …and the swap is still persisted, via the freestyle movement list.
    expect(rpcCalls.map((call) => call.fn)).toEqual([
      "add_session_movement",
      "remove_session_movement",
    ]);
    expect(rpcCalls[0]!.args).toMatchObject({
      p_session_id: SESSION_ID,
      p_movement_id: NEW_ID,
      p_user_id: USER_ID,
    });
    expect(rpcCalls[1]!.args).toMatchObject({
      p_session_id: SESSION_ID,
      p_movement_id: ORIGINAL_ID,
    });
  });

  it("surfaces an error instead of a phantom swap when the freestyle add fails", async () => {
    rpcError = "insert or update violates row-level security policy";
    const { swapActiveMovement } = await import("../swap-actions");
    const fd = new FormData();
    fd.set("sessionId", SESSION_ID);
    fd.set("originalMovementId", ORIGINAL_ID);
    fd.set("newMovementId", NEW_ID);
    fd.set("reason", "equipment");

    const result = await swapActiveMovement(fd);
    expect(result.ok).toBeUndefined();
    expect(result.error).toMatch(/row-level security/);
    // The original movement is never removed when the replacement didn't land.
    expect(rpcCalls.map((call) => call.fn)).toEqual(["add_session_movement"]);
  });

  it("leaves session_movements alone when the session has a prescription", async () => {
    plannedPrescription = {
      items: [
        {
          movementId: ORIGINAL_ID,
          movementSlug: "front-squat",
          movementName: "Front Squat",
          kind: "main",
          sets: 3,
          reps: 5,
        },
      ],
    };
    const { swapActiveMovement } = await import("../swap-actions");
    const fd = new FormData();
    fd.set("sessionId", SESSION_ID);
    fd.set("originalMovementId", ORIGINAL_ID);
    fd.set("newMovementId", NEW_ID);
    fd.set("reason", "equipment");

    await swapActiveMovement(fd);
    expect(rpcCalls).toHaveLength(0);
    expect(plannedUpdates).toHaveLength(1);
  });

  it("persists the swap onto the linked planned_session prescription", async () => {
    plannedPrescription = {
      items: [
        { movementId: ORIGINAL_ID, movementSlug: "front-squat", movementName: "Front Squat", kind: "main", sets: 3, reps: 5 },
      ],
    };
    const { swapActiveMovement } = await import("../swap-actions");
    const fd = new FormData();
    fd.set("sessionId", SESSION_ID);
    fd.set("originalMovementId", ORIGINAL_ID);
    fd.set("newMovementId", NEW_ID);
    fd.set("reason", "equipment");
    const result = await swapActiveMovement(fd);
    expect(result.ok).toBe(true);
    expect(plannedUpdates).toHaveLength(1);
    const updated = plannedUpdates[0]!.prescription as { items: Array<Record<string, unknown>> };
    expect(updated.items[0]!.movementId).toBe(NEW_ID);
    const updatedMain = updated.items.find((item) => item.kind === "main");
    expect(updatedMain?.movementSlug).toBe("goblet-squat");
    // Set/rep shape preserved.
    expect(updatedMain?.sets).toBe(3);
    expect(updatedMain?.reps).toBe(5);
  });

  it("rebuilds warmups from the replacement TM and preserves every working set", async () => {
    replacementOneRmKg = 50;
    profileWarmupScheme = {
      setCount: 2,
      percentLadder: [50, 75],
      repLadder: [5, 3],
    };
    plannedPrescription = {
      items: [
        {
          movementId: ORIGINAL_ID,
          movementSlug: "front-squat",
          movementName: "Front Squat",
          kind: "warmup",
          sets: 1,
          reps: 5,
          percentTm: 34,
          targetWeightKg: 120,
        },
        ...Array.from({ length: 4 }, (_, i) => ({
          movementId: ORIGINAL_ID,
          movementSlug: "front-squat",
          movementName: "Front Squat",
          kind: "main",
          sets: 1,
          reps: 5,
          percentTm: [65, 75, 85, 90][i],
        })),
      ],
    };
    const { swapActiveMovement } = await import("../swap-actions");
    const fd = new FormData();
    fd.set("sessionId", SESSION_ID);
    fd.set("originalMovementId", ORIGINAL_ID);
    fd.set("newMovementId", NEW_ID);
    fd.set("reason", "equipment");

    const result = await swapActiveMovement(fd);
    expect(result.ok).toBe(true);
    expect(result.warning).toBeUndefined();
    const updated = plannedUpdates[0]!.prescription as {
      items: Array<Record<string, unknown>>;
    };
    const warmups = updated.items.filter((item) => item.kind === "warmup");
    const working = updated.items.filter((item) => item.kind !== "warmup");
    // Mid-workout the existing slot is re-anchored in place — the item count
    // (and therefore every set_logs.prescription_item_index) is unchanged even
    // though the user's scheme asks for two warm-up sets.
    expect(updated.items).toHaveLength(5);
    expect(warmups).toHaveLength(1);
    expect(working).toHaveLength(4);
    expect(warmups.every((item) => item.targetWeightKg == null)).toBe(true);
    // Resampled to the top of the user's ladder: 75 % of the 90 % top set.
    expect(warmups.map((item) => item.percentTm)).toEqual([67.5]);
  });

  it("a program-owned block honours the user's EXPLICIT ladder over the program's ramp (DC-K4)", async () => {
    // Owner decision: a program's published ramp is a DEFAULT, not a mandate.
    // A lifter who configured their own ladder gets it everywhere — silently
    // substituting 5/3/1's ramp here would be the overrule DC-K4 forbids.
    plannedProgramId = wendler531Engine.meta.id;
    replacementOneRmKg = 50;
    profileWarmupScheme = {
      setCount: 2,
      percentLadder: [50, 75],
      repLadder: [5, 3],
    };
    plannedPrescription = {
      items: [
        ...Array.from({ length: 3 }, (_, i) => ({
          movementId: ORIGINAL_ID,
          movementSlug: "front-squat",
          movementName: "Front Squat",
          kind: "warmup",
          sets: 1,
          reps: [5, 5, 3][i],
          percentTm: [34, 51, 68][i],
          targetWeightKg: 120,
        })),
        ...Array.from({ length: 3 }, (_, i) => ({
          movementId: ORIGINAL_ID,
          movementSlug: "front-squat",
          movementName: "Front Squat",
          kind: "main",
          sets: 1,
          reps: 5,
          percentTm: [75, 85, 95][i],
        })),
      ],
    };
    const { swapActiveMovement } = await import("../swap-actions");
    const fd = new FormData();
    fd.set("sessionId", SESSION_ID);
    fd.set("originalMovementId", ORIGINAL_ID);
    fd.set("newMovementId", NEW_ID);
    fd.set("reason", "equipment");

    const result = await swapActiveMovement(fd);
    expect(result.ok).toBe(true);
    const updated = plannedUpdates[0]!.prescription as {
      items: Array<Record<string, unknown>>;
    };
    // Item count (and therefore every set_logs.prescription_item_index) is
    // still preserved — this is a live session, so slots are rewritten in place
    // rather than re-counted to the user's 2-rung ladder.
    expect(updated.items).toHaveLength(6);
    const warmups = updated.items.filter((item) => item.kind === "warmup");
    expect(warmups).toHaveLength(3);
    // The user's 50/75 ladder against the 95 % top set — NOT the program's
    // flat 40/50/60 % of Training Max.
    expect(warmups.map((item) => item.percentTm)).not.toEqual([40, 50, 60]);
    expect(warmups.map((item) => item.percentTm)).toEqual([47.5, 71.5, 71.5]);
  });

  it("a program-owned block falls back to the PROGRAM's ramp when the user never chose", async () => {
    // warmup_scheme IS NULL — no preference, so 5/3/1's own flat 40/50/60 % of
    // the Training Max applies and does not climb with the top set.
    plannedProgramId = wendler531Engine.meta.id;
    replacementOneRmKg = 50;
    profileWarmupScheme = null;
    plannedPrescription = {
      items: [
        ...Array.from({ length: 3 }, (_, i) => ({
          movementId: ORIGINAL_ID,
          movementSlug: "front-squat",
          movementName: "Front Squat",
          kind: "warmup",
          sets: 1,
          reps: [5, 5, 3][i],
          percentTm: [34, 51, 68][i],
          targetWeightKg: 120,
        })),
        ...Array.from({ length: 3 }, (_, i) => ({
          movementId: ORIGINAL_ID,
          movementSlug: "front-squat",
          movementName: "Front Squat",
          kind: "main",
          sets: 1,
          reps: 5,
          percentTm: [75, 85, 95][i],
        })),
      ],
    };
    const { swapActiveMovement } = await import("../swap-actions");
    const fd = new FormData();
    fd.set("sessionId", SESSION_ID);
    fd.set("originalMovementId", ORIGINAL_ID);
    fd.set("newMovementId", NEW_ID);
    fd.set("reason", "equipment");

    const result = await swapActiveMovement(fd);
    expect(result.ok).toBe(true);
    const updated = plannedUpdates[0]!.prescription as {
      items: Array<Record<string, unknown>>;
    };
    expect(updated.items).toHaveLength(6);
    const warmups = updated.items.filter((item) => item.kind === "warmup");
    expect(warmups).toHaveLength(3);
    expect(warmups.map((item) => item.percentTm)).toEqual([40, 50, 60]);
    expect(warmups.map((item) => item.reps)).toEqual([5, 5, 3]);
    expect(warmups.every((item) => item.targetWeightKg == null)).toBe(true);
  });

  it("a block with no program keeps the user's ladder (regression guard)", async () => {
    plannedProgramId = null;
    replacementOneRmKg = 50;
    profileWarmupScheme = {
      setCount: 2,
      percentLadder: [50, 75],
      repLadder: [5, 3],
    };
    plannedPrescription = {
      items: [
        ...Array.from({ length: 3 }, (_, i) => ({
          movementId: ORIGINAL_ID,
          movementSlug: "front-squat",
          movementName: "Front Squat",
          kind: "warmup",
          sets: 1,
          reps: [5, 5, 3][i],
          percentTm: [34, 51, 68][i],
        })),
        {
          movementId: ORIGINAL_ID,
          movementSlug: "front-squat",
          movementName: "Front Squat",
          kind: "main",
          sets: 1,
          reps: 5,
          percentTm: 90,
        },
      ],
    };
    const { swapActiveMovement } = await import("../swap-actions");
    const fd = new FormData();
    fd.set("sessionId", SESSION_ID);
    fd.set("originalMovementId", ORIGINAL_ID);
    fd.set("newMovementId", NEW_ID);
    fd.set("reason", "equipment");

    await swapActiveMovement(fd);
    const updated = plannedUpdates[0]!.prescription as {
      items: Array<Record<string, unknown>>;
    };
    // 50/75 of the 90 % top set, nearest-neighbour resampled to 3 slots.
    expect(
      updated.items
        .filter((item) => item.kind === "warmup")
        .map((item) => item.percentTm),
    ).toEqual([45, 67.5, 67.5]);
  });

  it("keeps prescription item indices stable across a mid-session swap (set_logs join key)", async () => {
    replacementOneRmKg = 50;
    profileWarmupScheme = {
      setCount: 2,
      percentLadder: [50, 75],
      repLadder: [5, 3],
    };
    plannedPrescription = {
      items: [
        ...Array.from({ length: 3 }, (_, i) => ({
          movementId: ORIGINAL_ID,
          movementSlug: "front-squat",
          movementName: "Front Squat",
          kind: "warmup",
          sets: 1,
          reps: [5, 5, 3][i],
          percentTm: [40, 60, 80][i],
        })),
        ...Array.from({ length: 3 }, () => ({
          movementId: ORIGINAL_ID,
          movementSlug: "front-squat",
          movementName: "Front Squat",
          kind: "main",
          sets: 1,
          reps: 5,
          percentTm: 90,
        })),
        ...Array.from({ length: 3 }, () => ({
          movementId: "00000000-0000-4000-8000-0000000000a9",
          movementSlug: "barbell-row",
          movementName: "Barbell Row",
          kind: "accessory",
          sets: 1,
          reps: 10,
        })),
      ],
    };
    const before = plannedPrescription.items.map((item) => ({ ...item }));
    const { swapActiveMovement } = await import("../swap-actions");
    const fd = new FormData();
    fd.set("sessionId", SESSION_ID);
    fd.set("originalMovementId", ORIGINAL_ID);
    fd.set("newMovementId", NEW_ID);
    fd.set("reason", "equipment");

    const result = await swapActiveMovement(fd);
    expect(result.ok).toBe(true);
    const updated = plannedUpdates[0]!.prescription as {
      items: Array<Record<string, unknown>>;
    };
    expect(updated.items).toHaveLength(before.length);
    before.forEach((prior, index) => {
      if (prior.kind === "warmup") return;
      expect(updated.items[index]!.kind).toBe(prior.kind);
      expect(updated.items[index]!.reps).toBe(prior.reps);
      expect(updated.items[index]!.movementId).toBe(
        prior.movementId === ORIGINAL_ID ? NEW_ID : prior.movementId,
      );
    });
    // The other movement's items are untouched, byte for byte.
    expect(updated.items.slice(6)).toEqual(before.slice(6));
  });

  it("retains warm-up slots with blank loads when the replacement has no TM", async () => {
    profileWarmupScheme = {
      setCount: 2,
      percentLadder: [50, 75],
      repLadder: [5, 3],
    };
    plannedPrescription = {
      items: [
        {
          movementId: ORIGINAL_ID,
          movementSlug: "front-squat",
          movementName: "Front Squat",
          kind: "warmup",
          sets: 1,
          reps: 5,
          percentTm: 34,
          targetWeightKg: 120,
        },
        ...Array.from({ length: 4 }, (_, i) => ({
          movementId: ORIGINAL_ID,
          movementSlug: "front-squat",
          movementName: "Front Squat",
          kind: "main",
          sets: 1,
          reps: 5,
          percentTm: [65, 75, 85, 90][i],
        })),
      ],
    };
    const { swapActiveMovement } = await import("../swap-actions");
    const fd = new FormData();
    fd.set("sessionId", SESSION_ID);
    fd.set("originalMovementId", ORIGINAL_ID);
    fd.set("newMovementId", NEW_ID);
    fd.set("reason", "equipment");

    const result = await swapActiveMovement(fd);
    expect(result.warning).toMatch(/training max/i);
    const updated = plannedUpdates[0]!.prescription as {
      items: Array<Record<string, unknown>>;
    };
    const warmups = updated.items.filter((item) => item.kind === "warmup");
    const working = updated.items.filter((item) => item.kind !== "warmup");
    expect(updated.items).toHaveLength(5);
    expect(warmups).toHaveLength(1);
    expect(warmups.every((item) => item.targetWeightKg == null)).toBe(true);
    expect(warmups.every((item) => item.percentTm == null)).toBe(true);
    expect(working).toHaveLength(4);
  });

  it("DC-K4 warns when a bodyweight main has no %TM warm-up anchor", async () => {
    replacementOneRmKg = 50;
    profileWarmupScheme = {
      setCount: 2,
      percentLadder: [50, 75],
      repLadder: [5, 3],
    };
    plannedPrescription = {
      items: [
        {
          movementId: ORIGINAL_ID,
          movementSlug: "push-up",
          movementName: "Push-up",
          kind: "main",
          sets: 5,
          reps: 8,
          bw: {
            prescriptionType: "reps",
            sets: 5,
            reps: 8,
          },
        },
      ],
    };
    const { swapActiveMovement } = await import("../swap-actions");
    const fd = new FormData();
    fd.set("sessionId", SESSION_ID);
    fd.set("originalMovementId", ORIGINAL_ID);
    fd.set("newMovementId", NEW_ID);
    fd.set("reason", "equipment");

    const result = await swapActiveMovement(fd);
    expect(result.warning).toMatch(/%TM|anchor/i);
    // The movement had no warm-up slots, so none are added mid-workout — say
    // so instead of silently skipping the ladder (DC-K4).
    expect(result.warning).toMatch(/already in progress/i);
    const updated = plannedUpdates[0]!.prescription as {
      items: Array<Record<string, unknown>>;
    };
    const warmups = updated.items.filter((item) => item.kind === "warmup");
    expect(updated.items).toHaveLength(1);
    expect(warmups).toHaveLength(0);
    expect(updated.items.find((item) => item.kind === "main")?.sets).toBe(5);
  });

  it("carries a rehab movement's hand-entered load across the swap and says so", async () => {
    profileWarmupScheme = {
      setCount: 2,
      percentLadder: [50, 75],
      repLadder: [5, 3],
    };
    plannedPrescription = {
      items: [
        {
          movementId: ORIGINAL_ID,
          movementSlug: "front-squat",
          movementName: "Front Squat",
          kind: "tendon",
          sets: 3,
          reps: 12,
          targetWeightKg: 10,
          meta: { rehab: true },
        },
      ],
    };
    const { swapActiveMovement } = await import("../swap-actions");
    const fd = new FormData();
    fd.set("sessionId", SESSION_ID);
    fd.set("originalMovementId", ORIGINAL_ID);
    fd.set("newMovementId", NEW_ID);
    fd.set("reason", "equipment");
    fd.set("rehab", "true");

    const result = await swapActiveMovement(fd);
    expect(result.ok).toBe(true);
    const updated = plannedUpdates[0]!.prescription as {
      items: Array<Record<string, unknown>>;
    };
    // Rehab loads have no %TM fallback — clearing them would silently delete
    // the prescribed load instead of re-deriving it.
    expect(updated.items[0]!.targetWeightKg).toBe(10);
    expect(updated.items[0]!.movementId).toBe(NEW_ID);
    expect(result.warning).toMatch(/rehab load/i);
    // Never the strength-lift training-max warning for a rehab swap.
    expect(result.warning).not.toMatch(/training max/i);
  });

  it("rejects an unknown reason category", async () => {
    const { swapActiveMovement } = await import("../swap-actions");
    const fd = new FormData();
    fd.set("sessionId", SESSION_ID);
    fd.set("originalMovementId", ORIGINAL_ID);
    fd.set("newMovementId", NEW_ID);
    fd.set("reason", "bored");
    const result = await swapActiveMovement(fd);
    expect(result.error).toBeTruthy();
    expect(overrideInserts).toHaveLength(0);
  });

  it("does not operate on a soft-deleted session", async () => {
    sessions[0]!.deleted_at = "2026-08-15T00:00:00.000Z";
    const { swapActiveMovement } = await import("../swap-actions");
    const fd = new FormData();
    fd.set("sessionId", SESSION_ID);
    fd.set("originalMovementId", ORIGINAL_ID);
    fd.set("newMovementId", NEW_ID);
    fd.set("reason", "equipment");

    const result = await swapActiveMovement(fd);

    expect(result).toEqual({ error: "Session not found." });
    expect(overrideInserts).toHaveLength(0);
    expect(plannedUpdates).toHaveLength(0);
  });
});
