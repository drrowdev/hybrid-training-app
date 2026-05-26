/**
 * Atomic-ish swap of two planned_sessions rows on the (block, week, day, slot)
 * unique index.
 *
 * Background — review feedback on PR #133 (feat/plan-redesign-timeline):
 * `movePlannedSession` used to do three Supabase updates in a row with a
 * shared "park at weeks+100" guard slot, no error checks, and no rollback.
 * Two concurrent swaps in the same block would collide on the unique index,
 * and any mid-flight failure would leave a session stranded in the parking
 * slot, invisible on the calendar.
 *
 * Supabase's REST client has no transaction primitive. The repo also has
 * no pre-existing `supabase.rpc(...)` pattern, so a SECURITY DEFINER RPC
 * would be the first of its kind here — kept the option in our pocket but
 * went with the simpler-to-review JS variant:
 *
 *   1. The parking slot is derived from the moving row's own UUID so two
 *      concurrent swaps in the same block land on different guard slots
 *      and don't collide on the unique index. The DB CHECK enforces
 *      week_index >= 0 / 0 <= day_index <= 6, so we can't use negatives —
 *      instead we park at (block.weeks + 100 + hash % 1000, hash % 7).
 *      With ~7000 distinct parking buckets the odds of two UUIDs colliding
 *      on a manual user-driven swap are vanishingly small.
 *
 *   2. Every update checks `.error` and throws with a useful message.
 *
 *   3. If step 2 or 3 fails we manually roll back so no row stays
 *      stranded at the parking slot.
 *
 *   4. Every update is constrained by `user_id = <caller>` so a leaked /
 *      guessed row ID can't be mutated even if RLS were ever weakened.
 *
 * Extracted from `actions.ts` so it can be unit-tested against a fake
 * Supabase client. `actions.ts` is "use server" + pulls in the entire
 * planner engine; this module is plain TS.
 */

/**
 * Minimal Supabase update surface we depend on. Matches `supabase-js`'s
 * fluent builder so the real client implements it structurally — the
 * tests provide a hand-rolled fake.
 */
export interface SwapUpdateBuilder {
  update(values: Record<string, unknown>): {
    eq(column: string, value: unknown): {
      eq(column: string, value: unknown): Promise<{
        error: { message: string } | null;
      }>;
    };
  };
}

export interface SwapClient {
  from(table: "planned_sessions"): SwapUpdateBuilder;
}

export interface SwapPlannedSessionsParams {
  client: SwapClient;
  userId: string;
  /** Row currently sitting at (sourceWeek, sourceDay) — the one the user dragged. */
  sourceId: string;
  sourceWeek: number;
  sourceDay: number;
  /** Row currently sitting at (targetWeek, targetDay) — the one being displaced. */
  targetId: string;
  targetWeek: number;
  targetDay: number;
  /** training_blocks.weeks for the host block, used to pick a parking week. */
  blockWeeks: number;
}

/**
 * Compute a session-specific parking slot. Two different UUIDs map to
 * different (week, day) buckets with high probability (~1 in 7000), so
 * concurrent swaps in the same block don't fight over the same guard row.
 */
export function parkingSlotForSession(
  sessionId: string,
  blockWeeks: number,
): { weekIndex: number; dayIndex: number } {
  const digits = sessionId.replace(/-/g, "");
  // First 4 hex digits → 0..65535, fold into 1000 buckets above the block.
  const weekBucket = Number.parseInt(digits.slice(0, 4) || "0", 16) % 1000;
  // Next 2 hex digits → 0..255, fold into the 7 valid day_index values.
  const dayBucket = Number.parseInt(digits.slice(4, 6) || "0", 16) % 7;
  return {
    weekIndex: blockWeeks + 100 + weekBucket,
    dayIndex: dayBucket,
  };
}

async function applyMove(
  client: SwapClient,
  rowId: string,
  userId: string,
  weekIndex: number,
  dayIndex: number,
): Promise<{ error: { message: string } | null }> {
  return client
    .from("planned_sessions")
    .update({ week_index: weekIndex, day_index: dayIndex })
    .eq("id", rowId)
    .eq("user_id", userId);
}

/**
 * Swap two planned_sessions rows on the (block, week, day, slot) unique
 * index. Throws on any DB error; on a partial failure attempts to roll
 * back so no row is left stranded at the parking slot.
 */
export async function swapPlannedSessions(
  p: SwapPlannedSessionsParams,
): Promise<void> {
  const park = parkingSlotForSession(p.sourceId, p.blockWeeks);

  // Step 1: park the moving row at a session-unique guard slot. After
  // this, (sourceWeek, sourceDay) is free for the displaced row to land on.
  const parkRes = await applyMove(
    p.client,
    p.sourceId,
    p.userId,
    park.weekIndex,
    park.dayIndex,
  );
  if (parkRes.error) {
    throw new Error(
      `swapPlannedSessions: failed to park source row ${p.sourceId}: ${parkRes.error.message}`,
    );
  }

  // Step 2: move the displaced row into the source's old slot.
  const moveTargetRes = await applyMove(
    p.client,
    p.targetId,
    p.userId,
    p.sourceWeek,
    p.sourceDay,
  );
  if (moveTargetRes.error) {
    // Roll back step 1 so the source row reappears on the calendar.
    await applyMove(
      p.client,
      p.sourceId,
      p.userId,
      p.sourceWeek,
      p.sourceDay,
    );
    throw new Error(
      `swapPlannedSessions: failed to move target row ${p.targetId} into source slot: ${moveTargetRes.error.message}`,
    );
  }

  // Step 3: move the parked source row to the target's old slot.
  const moveSourceRes = await applyMove(
    p.client,
    p.sourceId,
    p.userId,
    p.targetWeek,
    p.targetDay,
  );
  if (moveSourceRes.error) {
    // Roll back steps 1 + 2 so both rows end up on their original slots.
    await applyMove(
      p.client,
      p.targetId,
      p.userId,
      p.targetWeek,
      p.targetDay,
    );
    await applyMove(
      p.client,
      p.sourceId,
      p.userId,
      p.sourceWeek,
      p.sourceDay,
    );
    throw new Error(
      `swapPlannedSessions: failed to finalize source row ${p.sourceId} at target slot: ${moveSourceRes.error.message}`,
    );
  }
}
