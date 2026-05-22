import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "@/lib/auth/actions";
import { AppShell } from "@/components/shell/AppShell";
import { needsOnboarding } from "@/lib/onboarding/gate";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
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

  return (
    <AppShell
      signOutAction={signOut}
      displayName={profile?.display_name ?? null}
      email={user.email ?? null}
    >
      {children}
    </AppShell>
  );
}
