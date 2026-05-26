/**
 * Unit tests for the planned-session swap helper extracted from
 * `actions.ts` in response to the review on PR #133.
 *
 * The helper is supposed to:
 *   - Land both rows on each other's slots (the happy path).
 *   - Roll back any partial failure so no row is left stranded on the
 *     parking guard slot.
 *   - Pick a session-unique parking slot so two concurrent swaps in
 *     the same block don't collide on the (block, week, day, slot)
 *     unique index.
 *   - Constrain every UPDATE by user_id so an unauthorized caller
 *     can't mutate someone else's rows (belt-and-braces alongside RLS).
 */
import { describe, it, expect } from "vitest";
import {
  parkingSlotForSession,
  swapPlannedSessions,
  type SwapClient,
  type SwapUpdateBuilder,
} from "../swap";

type Row = {
  id: string;
  user_id: string;
  block_id: string;
  week_index: number;
  day_index: number;
  slot: "single" | "am" | "pm";
};

/**
 * Hand-rolled fake of the slice of supabase-js we use. Maintains a
 * tiny in-memory DB so we can assert post-conditions on the rows and
 * raise unique-constraint errors on collisions, just like the real
 * Postgres index would.
 */
function makeFakeClient(initial: Row[]) {
  const rows: Row[] = initial.map((r) => ({ ...r }));
  // Failure injection: { onUpdateNthCall: 2, error: "..." } fails the
  // 2nd update call (1-indexed). Useful for partial-failure scenarios.
  let injection: { onUpdateNthCall: number; error: string } | null = null;
  let updateCallCount = 0;
  const auditLog: Array<{
    rowId: string | undefined;
    userIdFilter: string | undefined;
    values: Record<string, unknown>;
  }> = [];

  function findUnique(
    blockId: string,
    week: number,
    day: number,
    slot: string,
    exceptId: string,
  ): Row | undefined {
    return rows.find(
      (r) =>
        r.block_id === blockId &&
        r.week_index === week &&
        r.day_index === day &&
        r.slot === slot &&
        r.id !== exceptId,
    );
  }

  const client: SwapClient = {
    from(table) {
      if (table !== "planned_sessions") throw new Error(`unexpected table: ${table}`);
      const builder: SwapUpdateBuilder = {
        update(values) {
          updateCallCount += 1;
          const myCall = updateCallCount;
          let idFilter: string | undefined;
          let userIdFilter: string | undefined;
          const eqChain = {
            eq(col: string, val: unknown) {
              if (col === "id") idFilter = String(val);
              else if (col === "user_id") userIdFilter = String(val);
              return {
                async eq(col2: string, val2: unknown) {
                  if (col2 === "id") idFilter = String(val2);
                  else if (col2 === "user_id") userIdFilter = String(val2);
                  auditLog.push({
                    rowId: idFilter,
                    userIdFilter,
                    values: { ...values },
                  });
                  if (
                    injection &&
                    injection.onUpdateNthCall === myCall
                  ) {
                    return { error: { message: injection.error } };
                  }
                  const target = rows.find(
                    (r) =>
                      r.id === idFilter &&
                      (userIdFilter === undefined || r.user_id === userIdFilter),
                  );
                  if (!target) {
                    // Mimic Supabase: rows that don't match the filter
                    // simply produce zero updates — not an error. The
                    // "unauthorized" scenario relies on this so the
                    // swap helper still completes its steps but the
                    // underlying rows never move. We expose that via
                    // the audit log + the rows snapshot.
                    return { error: null };
                  }
                  if (
                    typeof values.week_index === "number" &&
                    typeof values.day_index === "number"
                  ) {
                    const week = values.week_index as number;
                    const day = values.day_index as number;
                    const conflict = findUnique(
                      target.block_id,
                      week,
                      day,
                      target.slot,
                      target.id,
                    );
                    if (conflict) {
                      return {
                        error: {
                          message: `duplicate key value violates unique constraint planned_sessions_block_week_day_slot_unique_idx (existing row ${conflict.id})`,
                        },
                      };
                    }
                    target.week_index = week;
                    target.day_index = day;
                  }
                  return { error: null };
                },
              };
            },
          };
          return { eq: eqChain.eq };
        },
      };
      return builder;
    },
  };

  return {
    client,
    rows,
    auditLog,
    injectFailure(onUpdateNthCall: number, error: string) {
      injection = { onUpdateNthCall, error };
    },
    updateCallCount: () => updateCallCount,
  };
}

const USER = "11111111-1111-4111-8111-111111111111";
const BLOCK = "22222222-2222-4222-8222-222222222222";
const SESSION_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SESSION_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function rowAt(
  id: string,
  week: number,
  day: number,
  overrides: Partial<Row> = {},
): Row {
  return {
    id,
    user_id: USER,
    block_id: BLOCK,
    week_index: week,
    day_index: day,
    slot: "single",
    ...overrides,
  };
}

describe("swap.parkingSlotForSession", () => {
  it("lands above the block (week >= blockWeeks + 100) and on a valid day index", () => {
    const slot = parkingSlotForSession(SESSION_A, 4);
    expect(slot.weekIndex).toBeGreaterThanOrEqual(104);
    expect(slot.weekIndex).toBeLessThanOrEqual(4 + 100 + 999);
    expect(slot.dayIndex).toBeGreaterThanOrEqual(0);
    expect(slot.dayIndex).toBeLessThanOrEqual(6);
  });

  it("derives different buckets for different UUIDs (collision avoidance)", () => {
    const a = parkingSlotForSession(SESSION_A, 4);
    const b = parkingSlotForSession(SESSION_B, 4);
    expect(`${a.weekIndex}:${a.dayIndex}`).not.toBe(`${b.weekIndex}:${b.dayIndex}`);
  });

  it("is deterministic for the same UUID", () => {
    const a1 = parkingSlotForSession(SESSION_A, 4);
    const a2 = parkingSlotForSession(SESSION_A, 4);
    expect(a1).toEqual(a2);
  });
});

describe("swapPlannedSessions — happy path", () => {
  it("ends with both rows on each other's original slots", async () => {
    const fake = makeFakeClient([rowAt(SESSION_A, 0, 1), rowAt(SESSION_B, 1, 3)]);
    await swapPlannedSessions({
      client: fake.client,
      userId: USER,
      sourceId: SESSION_A,
      sourceWeek: 0,
      sourceDay: 1,
      targetId: SESSION_B,
      targetWeek: 1,
      targetDay: 3,
      blockWeeks: 4,
    });
    const a = fake.rows.find((r) => r.id === SESSION_A)!;
    const b = fake.rows.find((r) => r.id === SESSION_B)!;
    expect({ week: a.week_index, day: a.day_index }).toEqual({ week: 1, day: 3 });
    expect({ week: b.week_index, day: b.day_index }).toEqual({ week: 0, day: 1 });
    expect(fake.updateCallCount()).toBe(3);
  });

  it("filters every UPDATE by both id AND user_id (defense-in-depth)", async () => {
    const fake = makeFakeClient([rowAt(SESSION_A, 0, 1), rowAt(SESSION_B, 1, 3)]);
    await swapPlannedSessions({
      client: fake.client,
      userId: USER,
      sourceId: SESSION_A,
      sourceWeek: 0,
      sourceDay: 1,
      targetId: SESSION_B,
      targetWeek: 1,
      targetDay: 3,
      blockWeeks: 4,
    });
    for (const entry of fake.auditLog) {
      expect(entry.rowId).toBeDefined();
      expect(entry.userIdFilter).toBe(USER);
    }
  });
});

describe("swapPlannedSessions — partial-failure rollback", () => {
  it("rolls back when the 2nd update (move target into source slot) fails", async () => {
    const fake = makeFakeClient([rowAt(SESSION_A, 0, 1), rowAt(SESSION_B, 1, 3)]);
    fake.injectFailure(2, "simulated network blip");
    await expect(
      swapPlannedSessions({
        client: fake.client,
        userId: USER,
        sourceId: SESSION_A,
        sourceWeek: 0,
        sourceDay: 1,
        targetId: SESSION_B,
        targetWeek: 1,
        targetDay: 3,
        blockWeeks: 4,
      }),
    ).rejects.toThrow(/simulated network blip/);
    // Source A must be back at its original (0,1) — not stranded at
    // the parking slot. Target B never moved.
    const a = fake.rows.find((r) => r.id === SESSION_A)!;
    const b = fake.rows.find((r) => r.id === SESSION_B)!;
    expect({ week: a.week_index, day: a.day_index }).toEqual({ week: 0, day: 1 });
    expect({ week: b.week_index, day: b.day_index }).toEqual({ week: 1, day: 3 });
  });

  it("rolls back when the 3rd update (finalize source) fails", async () => {
    const fake = makeFakeClient([rowAt(SESSION_A, 0, 1), rowAt(SESSION_B, 1, 3)]);
    fake.injectFailure(3, "constraint blip");
    await expect(
      swapPlannedSessions({
        client: fake.client,
        userId: USER,
        sourceId: SESSION_A,
        sourceWeek: 0,
        sourceDay: 1,
        targetId: SESSION_B,
        targetWeek: 1,
        targetDay: 3,
        blockWeeks: 4,
      }),
    ).rejects.toThrow(/constraint blip/);
    // Both rows are restored to their original slots.
    const a = fake.rows.find((r) => r.id === SESSION_A)!;
    const b = fake.rows.find((r) => r.id === SESSION_B)!;
    expect({ week: a.week_index, day: a.day_index }).toEqual({ week: 0, day: 1 });
    expect({ week: b.week_index, day: b.day_index }).toEqual({ week: 1, day: 3 });
  });
});

describe("swapPlannedSessions — concurrent swaps in the same block", () => {
  it("two different pairs swap in parallel without parking-slot collisions", async () => {
    const SESSION_C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const SESSION_D = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    // Single shared in-memory "DB" so collisions on the unique index
    // would surface as duplicate-key errors. Pair (A↔B) sits at
    // weeks 0/1; pair (C↔D) sits at weeks 2/3. Same block.
    const fake = makeFakeClient([
      rowAt(SESSION_A, 0, 1),
      rowAt(SESSION_B, 1, 3),
      rowAt(SESSION_C, 2, 2),
      rowAt(SESSION_D, 3, 4),
    ]);
    await Promise.all([
      swapPlannedSessions({
        client: fake.client,
        userId: USER,
        sourceId: SESSION_A,
        sourceWeek: 0,
        sourceDay: 1,
        targetId: SESSION_B,
        targetWeek: 1,
        targetDay: 3,
        blockWeeks: 4,
      }),
      swapPlannedSessions({
        client: fake.client,
        userId: USER,
        sourceId: SESSION_C,
        sourceWeek: 2,
        sourceDay: 2,
        targetId: SESSION_D,
        targetWeek: 3,
        targetDay: 4,
        blockWeeks: 4,
      }),
    ]);
    const a = fake.rows.find((r) => r.id === SESSION_A)!;
    const b = fake.rows.find((r) => r.id === SESSION_B)!;
    const c = fake.rows.find((r) => r.id === SESSION_C)!;
    const d = fake.rows.find((r) => r.id === SESSION_D)!;
    expect({ w: a.week_index, d: a.day_index }).toEqual({ w: 1, d: 3 });
    expect({ w: b.week_index, d: b.day_index }).toEqual({ w: 0, d: 1 });
    expect({ w: c.week_index, d: c.day_index }).toEqual({ w: 3, d: 4 });
    expect({ w: d.week_index, d: d.day_index }).toEqual({ w: 2, d: 2 });
  });
});

describe("swapPlannedSessions — unauthorized user attempt", () => {
  it("does not mutate rows owned by another user", async () => {
    // Rows belong to USER but the caller claims to be OTHER. Every
    // UPDATE is constrained by .eq("user_id", OTHER), so the fake
    // (and real RLS) sees zero affected rows and the underlying data
    // never moves.
    const OTHER = "ffffffff-ffff-4fff-8fff-ffffffffffff";
    const fake = makeFakeClient([rowAt(SESSION_A, 0, 1), rowAt(SESSION_B, 1, 3)]);
    await swapPlannedSessions({
      client: fake.client,
      userId: OTHER,
      sourceId: SESSION_A,
      sourceWeek: 0,
      sourceDay: 1,
      targetId: SESSION_B,
      targetWeek: 1,
      targetDay: 3,
      blockWeeks: 4,
    });
    const a = fake.rows.find((r) => r.id === SESSION_A)!;
    const b = fake.rows.find((r) => r.id === SESSION_B)!;
    expect({ w: a.week_index, d: a.day_index }).toEqual({ w: 0, d: 1 });
    expect({ w: b.week_index, d: b.day_index }).toEqual({ w: 1, d: 3 });
    // And every UPDATE attempted explicitly carried the (wrong) user_id
    // filter — verifying the helper never issues an unconstrained update.
    for (const entry of fake.auditLog) {
      expect(entry.userIdFilter).toBe(OTHER);
    }
  });
});
