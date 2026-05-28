/**
 * GET /api/ai/threads — list the caller's chat threads, newest first.
 */
import { NextResponse } from "next/server";

import { hasAiAccess } from "@/lib/ai/access";
import { createClient, getAuthUser } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) {
    return NextResponse.json(
      { ok: false, errorCode: "auth-failed" },
      { status: 401 },
    );
  }
  const supabase = await createClient();
  const { data: profile } = await supabase
    .from("profiles")
    .select(
      "byoai_provider, byoai_key_vault_id, byoai_unlocked_at",
    )
    .eq("id", user.id)
    .maybeSingle();
  if (
    !profile ||
    !hasAiAccess({
      byoai_provider: profile.byoai_provider,
      byoai_key_vault_id: profile.byoai_key_vault_id,
      byoai_unlocked_at: profile.byoai_unlocked_at,
    })
  ) {
    return NextResponse.json({ ok: true, threads: [] });
  }

  const { data } = await supabase
    .from("chat_threads")
    .select("id, title, created_at, updated_at")
    .eq("user_id", user.id)
    .order("updated_at", { ascending: false })
    .limit(50);

  return NextResponse.json({ ok: true, threads: data ?? [] });
}
