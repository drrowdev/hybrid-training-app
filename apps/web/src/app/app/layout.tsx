import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "@/lib/auth/actions";
import { AppShell } from "@/components/shell/AppShell";

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

  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name, onboarded_at")
    .eq("id", user.id)
    .maybeSingle();

  // First-run gate: never-onboarded users go to the wizard.
  if (!profile?.onboarded_at) redirect("/onboarding");

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
