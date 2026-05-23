/**
 * GET /api/cron/trash-cleanup — daily hard-delete of soft-deleted rows
 * older than 30 days. Triggered by Vercel Cron (configured in
 * `vercel.json`).
 *
 * ## Cron implementation choice
 *
 * We chose Vercel Cron over Supabase pg_cron because:
 *   1. The Supabase project is on the Free tier, where the pg_cron
 *      extension is available but not under our IaC. Hosting cron
 *      definitions in `vercel.json` keeps the schedule in the same
 *      repo as the code that runs.
 *   2. Cleanup logic that's identical to `permanentlyDeleteSession` /
 *      `permanentlyDeleteBlock` already exists in TypeScript — re-
 *      implementing it as PL/pgSQL would split the source of truth.
 *   3. Vercel's auth-via-secret header (CRON_SECRET) gives us auth
 *      out of the box; with pg_cron we'd also need to manage a SECURITY
 *      DEFINER wrapper to bypass RLS without leaking service-role.
 *
 * ## Auth
 *
 * Vercel injects `Authorization: Bearer $CRON_SECRET` on cron
 * invocations. We reject anything else. Also gated by the service-
 * role client (set up via `createAdmin`) so RLS can't block the
 * cleanup of a row whose user has since been removed.
 *
 * ## Behavior
 *
 * Hard-deletes from both tables where `deleted_at < NOW() - INTERVAL
 * '30 days'`. Cascades fire automatically (set_logs, cardio_logs,
 * planned_sessions per the existing FKs).
 */
import { NextResponse } from "next/server";
import { createAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CUTOFF_DAYS = 30;

export async function GET(req: Request): Promise<Response> {
  const expected = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!expected || auth !== `Bearer ${expected}`) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const cutoffIso = new Date(Date.now() - CUTOFF_DAYS * 86_400_000).toISOString();
  const supabase = createAdmin();

  // Use service-role to bypass RLS — the cleanup must work even for
  // orphaned rows whose owning user has been removed (the FK cascade
  // from auth.users handles those at the source, but defensive code
  // here ensures the cron stays correct if that path is ever changed).
  const [{ data: deletedBlocks, error: bErr }, { data: deletedSessions, error: sErr }] = await Promise.all([
    supabase
      .from("training_blocks")
      .delete()
      .lt("deleted_at", cutoffIso)
      .not("deleted_at", "is", null)
      .select("id"),
    supabase
      .from("sessions")
      .delete()
      .lt("deleted_at", cutoffIso)
      .not("deleted_at", "is", null)
      .select("id"),
  ]);

  if (bErr || sErr) {
    return NextResponse.json(
      {
        ok: false,
        blocksError: bErr?.message ?? null,
        sessionsError: sErr?.message ?? null,
      },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    cutoff: cutoffIso,
    deletedBlocks: deletedBlocks?.length ?? 0,
    deletedSessions: deletedSessions?.length ?? 0,
  });
}
