/**
 * GET /api/ai/threads/[id]/messages — verbatim history for a thread.
 */
import { NextResponse } from "next/server";

import { createClient, getAuthUser } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
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

  const { data: messages } = await supabase
    .from("chat_messages")
    .select("id, role, content, tool_calls, tool_results, created_at")
    .eq("thread_id", id)
    .order("created_at", { ascending: true });

  return NextResponse.json({ ok: true, messages: messages ?? [] });
}
