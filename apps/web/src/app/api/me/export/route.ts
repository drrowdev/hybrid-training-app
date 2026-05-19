import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * GDPR Article 15 / 20 — right to access + portability.
 *
 *   GET /api/me/export
 *
 * Returns ALL data we hold on the authenticated user as JSON. Includes
 * profile, sessions (with sets + cardio), wellness, limitations,
 * region_state, and custom movements. RLS-scoped so each user sees only
 * their own data; no admin-key bypass.
 *
 * Plan §4.5 deliverable.
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const [
    profile,
    sessions,
    setLogs,
    cardioLogs,
    wellness,
    limitations,
    regionState,
    customMovements,
  ] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", user.id).maybeSingle(),
    supabase.from("sessions").select("*").order("performed_at", { ascending: true }),
    supabase
      .from("set_logs")
      .select("*, movement:movements(slug, display_name)")
      .order("created_at", { ascending: true }),
    supabase
      .from("cardio_logs")
      .select("*, movement:movements(slug, display_name)")
      .order("created_at", { ascending: true }),
    supabase.from("wellness").select("*").order("date", { ascending: true }),
    supabase.from("limitations").select("*").order("started_at", { ascending: true }),
    supabase.from("region_state").select("*"),
    supabase.from("movements").select("*").eq("user_id", user.id),
  ]);

  const exportedAt = new Date().toISOString();
  const payload = {
    schema: "hybrid-training-app/export-v1",
    exported_at: exportedAt,
    user: {
      id: user.id,
      email: user.email,
      created_at: user.created_at,
    },
    profile: profile.data ?? null,
    sessions: sessions.data ?? [],
    set_logs: setLogs.data ?? [],
    cardio_logs: cardioLogs.data ?? [],
    wellness: wellness.data ?? [],
    limitations: limitations.data ?? [],
    region_state: regionState.data ?? [],
    custom_movements: customMovements.data ?? [],
    notes:
      "This file is the complete record of every datum the app holds on you. " +
      "Global movements (user_id = null) are not included — they're the public catalog. " +
      "Sensitive auth fields (password hashes etc.) never leave the auth subsystem.",
  };

  const filename = `hta-export-${user.id}-${exportedAt.slice(0, 10)}.json`;
  return new NextResponse(JSON.stringify(payload, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store, max-age=0",
    },
  });
}
