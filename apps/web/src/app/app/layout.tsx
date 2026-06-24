import { redirect } from "next/navigation";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import { signOut } from "@/lib/auth/actions";
import { AppShell } from "@/components/shell/AppShell";
import { PullToRefresh } from "@/components/shell/PullToRefresh";
import { CommandPaletteProvider } from "@/components/cmd-k/CommandPaletteProvider";
import { needsOnboarding } from "@/lib/onboarding/gate";
import { loadPaletteIndices } from "@/lib/cmd-k/indices";
import { ChatMount } from "@/components/ai/ChatMount";

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
      .select("display_name, onboarded_at, haptics_enabled")
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

  // Top-bar Strava sync indicator — best-effort: a missing/borked row
  // never blocks the layout (the indicator just hides).
  const { data: strava } = await supabase
    .from("strava_connections")
    .select("last_synced_at")
    .eq("user_id", user.id)
    .maybeSingle();

  const hasStravaConnection = !!strava;
  const lastSyncedAt = strava?.last_synced_at ?? null;

  return (
    <CommandPaletteProvider indices={paletteIndices}>
      <PullToRefresh />
      <AppShell
        signOutAction={signOut}
        displayName={profile?.display_name ?? null}
        email={user.email ?? null}
        hasStravaConnection={hasStravaConnection}
        lastSyncedAt={lastSyncedAt}
        hapticsEnabled={(profile?.haptics_enabled as boolean | null) ?? true}
        buildSha={process.env.NEXT_PUBLIC_BUILD_SHA ?? "dev"}
      >
        {children}
        <ChatMount />
      </AppShell>
    </CommandPaletteProvider>
  );
}
