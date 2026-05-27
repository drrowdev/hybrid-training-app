"use server";

/**
 * Server actions for the `session_movements` persistence layer that
 * backs the freestyle "+ Add off-plan movement" surface.
 *
 * - `addSessionMovementAction`: idempotent insert via the
 *   `add_session_movement` RPC. Verifies the session is owned by the
 *   caller and not yet completed; the RPC computes the next
 *   sort_order as max+10 atomically (MAX + INSERT inside a single
 *   statement) so two concurrent adds can't collide on the same
 *   sort_order. Repeat adds of the same (session, movement) return
 *   the existing row — still `{ ok: true }` so the optimistic UI
 *   settles.
 * - `removeSessionMovementAction`: hard delete via the
 *   `remove_session_movement` RPC. Verifies ownership; the RPC does
 *   a single `DELETE ... WHERE NOT EXISTS (set_logs …)` so the
 *   "no set logged yet" guard is evaluated atomically with the
 *   delete. The RPC reports `has_set_logs` (blocked) vs
 *   `not_present` / `removed` (success); already-removed counts as
 *   success because the caller's intent is satisfied.
 *
 * Both follow the actions.ts pattern: `getAuthUser()` first, then a
 * `.eq('user_id', user.id)` defence-in-depth filter on top of RLS, and
 * return `{ ok: true } | { ok: false, error: string }`.
 */
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient, getAuthUser } from "@/lib/supabase/server";

const sessionMovementSchema = z.object({
  sessionId: z.string().uuid(),
  movementId: z.string().uuid(),
});

export type SessionMovementResult =
  | { ok: true }
  | { ok: false; error: string };

export async function addSessionMovementAction(
  sessionId: string,
  movementId: string,
): Promise<SessionMovementResult> {
  const parsed = sessionMovementSchema.safeParse({ sessionId, movementId });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) return { ok: false, error: "Not signed in." };

  // Ownership + not-yet-completed guard. The defence-in-depth user_id
  // filter belt-and-braces the RLS policy on `sessions`. This stays
  // in the action layer because the "session already completed"
  // policy is a UX concern that doesn't belong in the RPC.
  const { data: sessionRow, error: sessErr } = await supabase
    .from("sessions")
    .select("id, completed_at, deleted_at")
    .eq("id", parsed.data.sessionId)
    .eq("user_id", user.id)
    .is("deleted_at", null)
    .maybeSingle();
  if (sessErr) return { ok: false, error: sessErr.message };
  if (!sessionRow) return { ok: false, error: "Session not found." };
  if (sessionRow.completed_at) {
    return { ok: false, error: "Session is already completed." };
  }

  // Atomic add: MAX(sort_order) + INSERT live inside the same SQL
  // statement, so two concurrent adds can't land on the same
  // sort_order. Idempotent — re-add of the same (session, movement)
  // returns the existing row.
  const { error: rpcErr } = await supabase.rpc("add_session_movement", {
    p_session_id: parsed.data.sessionId,
    p_movement_id: parsed.data.movementId,
    p_user_id: user.id,
  });
  if (rpcErr) return { ok: false, error: rpcErr.message };

  revalidatePath(`/app/sessions/${parsed.data.sessionId}`);
  return { ok: true };
}

export async function removeSessionMovementAction(
  sessionId: string,
  movementId: string,
): Promise<SessionMovementResult> {
  const parsed = sessionMovementSchema.safeParse({ sessionId, movementId });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) return { ok: false, error: "Not signed in." };

  // Ownership guard — we read the session row via the user_id filter
  // so RLS + the explicit filter agree on access. Stays in the action
  // layer so the "session not found" error path is consistent with
  // the rest of the action surface.
  const { data: sessionRow, error: sessErr } = await supabase
    .from("sessions")
    .select("id")
    .eq("id", parsed.data.sessionId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (sessErr) return { ok: false, error: sessErr.message };
  if (!sessionRow) return { ok: false, error: "Session not found." };

  // Atomic remove: the RPC does `DELETE … WHERE NOT EXISTS (set_logs)`
  // in a single statement, so another tab logging a set in between
  // can no longer race past the "no sets logged yet" guard. The RPC
  // returns (deleted, reason) so we can surface the same friendly
  // message the UI used to render.
  const { data, error: rpcErr } = await supabase.rpc("remove_session_movement", {
    p_session_id: parsed.data.sessionId,
    p_movement_id: parsed.data.movementId,
  });
  if (rpcErr) return { ok: false, error: rpcErr.message };

  const row = Array.isArray(data) ? (data[0] as { deleted?: boolean; reason?: string } | undefined) : undefined;
  if (!row?.deleted) {
    if (row?.reason === "has_set_logs") {
      return {
        ok: false,
        error:
          "Can't remove a movement once you've logged a set against it. Use 'Done with this movement' instead.",
      };
    }
    return { ok: false, error: "Couldn't remove movement." };
  }

  revalidatePath(`/app/sessions/${parsed.data.sessionId}`);
  return { ok: true };
}
