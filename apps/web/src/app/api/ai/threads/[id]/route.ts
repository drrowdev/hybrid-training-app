/**
 * DELETE /api/ai/threads/[id] — delete one of the caller's chat threads
 * (and its messages). RLS-scoped: both deletes are filtered by user_id so a
 * thread the caller doesn't own can't be touched.
 */
import { NextResponse } from "next/server";

import { createClient, getAuthUser } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) {
    return NextResponse.json(
      { ok: false, errorCode: "auth-failed" },
      { status: 401 },
    );
  }
  const { id } = await ctx.params;
  const supabase = await createClient();

  const { data: thread } = await supabase
    .from("chat_threads")
    .select("id")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!thread) {
    return NextResponse.json(
      { ok: false, errorCode: "not-found" },
      { status: 404 },
    );
  }

  // Messages have no FK cascade — remove them first, then the thread. Both
  // scoped by user_id as defense-in-depth on top of RLS.
  await supabase
    .from("chat_messages")
    .delete()
    .eq("thread_id", id)
    .eq("user_id", user.id);

  const { error } = await supabase
    .from("chat_threads")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) {
    return NextResponse.json(
      { ok: false, errorCode: "delete-failed", message: error.message },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}
