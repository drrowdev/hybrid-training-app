"use server";

/**
 * Server actions for the `session_movements` persistence layer that
 * backs the freestyle "+ Add off-plan movement" surface.
 *
 * - `addSessionMovementAction`: idempotent insert. Verifies the
 *   session is owned by the caller and not yet completed; computes the
 *   next sort_order as max+10 to leave reorder gaps; ON CONFLICT DO
 *   NOTHING for repeat adds.
 * - `removeSessionMovementAction`: hard delete. Verifies ownership and
 *   refuses with a friendly error if any `set_logs` row already exists
 *   for the pair — once you've logged a set the right action is "Done
 *   with this movement", not "Remove".
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
  // filter belt-and-braces the RLS policy on `sessions`.
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

  // Compute next sort_order = max(existing) + 10. Leaves gaps so a
  // future drag-to-reorder can slot a row between two existing ones
  // without renumbering. First add lands at 10.
  const { data: existing, error: existErr } = await supabase
    .from("session_movements")
    .select("sort_order")
    .eq("session_id", parsed.data.sessionId)
    .eq("user_id", user.id)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existErr) return { ok: false, error: existErr.message };
  const nextSortOrder = ((existing?.sort_order as number | null) ?? 0) + 10;

  // Idempotent insert. The PK is (session_id, movement_id) so a repeat
  // add of the same movement is a no-op; we still return ok so the
  // client UI can settle on the same optimistic state regardless.
  const { error: insErr } = await supabase
    .from("session_movements")
    .upsert(
      {
        session_id: parsed.data.sessionId,
        movement_id: parsed.data.movementId,
        user_id: user.id,
        sort_order: nextSortOrder,
      },
      { onConflict: "session_id,movement_id", ignoreDuplicates: true },
    );
  if (insErr) return { ok: false, error: insErr.message };

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
  // so RLS + the explicit filter agree on access.
  const { data: sessionRow, error: sessErr } = await supabase
    .from("sessions")
    .select("id")
    .eq("id", parsed.data.sessionId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (sessErr) return { ok: false, error: sessErr.message };
  if (!sessionRow) return { ok: false, error: "Session not found." };

  // Refuse removal once any set is logged against this (session,
  // movement). The user-facing message points to the "Done with this
  // movement" alternative so the UI doesn't have to translate.
  const { count, error: countErr } = await supabase
    .from("set_logs")
    .select("id", { count: "exact", head: true })
    .eq("session_id", parsed.data.sessionId)
    .eq("movement_id", parsed.data.movementId);
  if (countErr) return { ok: false, error: countErr.message };
  if ((count ?? 0) > 0) {
    return {
      ok: false,
      error:
        "Can't remove a movement once you've logged a set against it. Use 'Done with this movement' instead.",
    };
  }

  const { error: delErr } = await supabase
    .from("session_movements")
    .delete()
    .eq("session_id", parsed.data.sessionId)
    .eq("movement_id", parsed.data.movementId)
    .eq("user_id", user.id);
  if (delErr) return { ok: false, error: delErr.message };

  revalidatePath(`/app/sessions/${parsed.data.sessionId}`);
  return { ok: true };
}
