import { redirect } from "next/navigation";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import { signOut } from "@/lib/auth/actions";
import { AppShell, type TopBarAuditEntry } from "@/components/shell/AppShell";
import { PullToRefresh } from "@/components/shell/PullToRefresh";
import { CommandPaletteProvider } from "@/components/cmd-k/CommandPaletteProvider";
import { needsOnboarding } from "@/lib/onboarding/gate";
import { loadPaletteIndices } from "@/lib/cmd-k/indices";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) redirect("/login");

  const [{ data: profile }, { count: tmCount }] = await Promise.all([
    supabase
      .from("profiles")
      .select("display_name, onboarded_at")
      .eq("id", user.id)
      .maybeSingle(),
    supabase
      .from("training_maxes")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id),
  ]);

  // First-run gate: brand-new accounts (no completion marker, no TMs)
  // get sent to /onboarding. Skipping leaves `onboarded_at` null so the
  // gate re-fires on the next visit — see lib/onboarding/gate.ts.
  if (
    needsOnboarding({
      hasAnyTm: (tmCount ?? 0) > 0,
      onboardedAt: profile?.onboarded_at ?? null,
    })
  ) {
    redirect("/onboarding");
  }

  // Quick-jump (⌘K) indices — small bundle preloaded server-side so
  // the client filters in-memory without a per-keystroke round trip.
  const paletteIndices = await loadPaletteIndices(supabase, user.id);

  // Top-bar status cluster — read sync state + recent overrides in
  // parallel. Both are best-effort: any failure leaves the cluster in
  // its empty-state so a missing/borked row never blocks the layout.
  const [stravaRes, auditRes, auditCountRes] = await Promise.all([
    supabase
      .from("strava_connections")
      .select("last_synced_at")
      .eq("user_id", user.id)
      .maybeSingle(),
    supabase
      .from("engine_override_events")
      .select("id, event_type, occurred_at, planned_session_id, reason")
      .eq("user_id", user.id)
      .order("occurred_at", { ascending: false })
      .limit(5),
    supabase
      .from("engine_override_events")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id),
  ]);

  const hasStravaConnection = !!stravaRes.data;
  const lastSyncedAt = stravaRes.data?.last_synced_at ?? null;

  const recentAudit: TopBarAuditEntry[] = (auditRes.data ?? []).map((row) => ({
    id: row.id as string,
    eventType: row.event_type as string,
    occurredAt: row.occurred_at as string,
    plannedSessionId: (row.planned_session_id as string | null) ?? null,
    reason: (row.reason as string | null) ?? null,
  }));
  const auditCount = auditCountRes.count ?? recentAudit.length;

  return (
    <CommandPaletteProvider indices={paletteIndices}>
      <PullToRefresh />
      <AppShell
        signOutAction={signOut}
        displayName={profile?.display_name ?? null}
        email={user.email ?? null}
        hasStravaConnection={hasStravaConnection}
        lastSyncedAt={lastSyncedAt}
        recentAudit={recentAudit}
        auditCount={auditCount}
        buildSha={process.env.NEXT_PUBLIC_BUILD_SHA ?? "dev"}
      >
        {children}
      </AppShell>
    </CommandPaletteProvider>
  );
}
