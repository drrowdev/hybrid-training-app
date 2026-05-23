/**
 * Restore a soft-deleted session.
 *
 * POST /api/sessions/[id]/restore — called by the Undo banner and by
 * the Trash page "Recover" button. Thin wrapper around the
 * `restoreSession` server action so we can call it from a client
 * component without crossing the Server Actions boundary (the banner
 * is mounted in the app shell and doesn't have a form bound to a
 * specific action). RLS in `restoreSession` covers ownership.
 *
 * Returns `{ ok: true }` on success, `{ ok: false, error }` otherwise.
 */
import { NextResponse } from "next/server";
import { restoreSession } from "@/lib/sessions/actions";

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await ctx.params;
  const result = await restoreSession(id);
  if (!result.ok) {
    return NextResponse.json(result, { status: 400 });
  }
  return NextResponse.json(result);
}
