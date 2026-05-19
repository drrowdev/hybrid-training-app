import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "@/lib/auth/actions";

export default async function AppPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name, timezone, bodyweight_kg, created_at")
    .eq("id", user.id)
    .maybeSingle();

  return (
    <main className="min-h-screen px-6 py-12 max-w-2xl mx-auto space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          Signed in
        </h1>
        <p className="text-sm text-foreground/60">
          Phase 0 placeholder — features land in Phase 1.
        </p>
      </header>

      <section className="rounded-lg border border-foreground/10 p-4 space-y-2 text-sm">
        <p>
          <span className="text-foreground/60">Email:</span>{" "}
          <span className="font-mono">{user.email}</span>
        </p>
        <p>
          <span className="text-foreground/60">User ID:</span>{" "}
          <span className="font-mono text-xs">{user.id}</span>
        </p>
        <p>
          <span className="text-foreground/60">Profile auto-created:</span>{" "}
          {profile ? "yes" : "no (waiting on trigger)"}
        </p>
        {profile?.created_at && (
          <p>
            <span className="text-foreground/60">Created at:</span>{" "}
            <span className="font-mono text-xs">
              {new Date(profile.created_at).toISOString()}
            </span>
          </p>
        )}
      </section>

      <form action={signOut}>
        <button
          type="submit"
          className="rounded-md border border-foreground/20 px-3 py-2 text-sm hover:bg-foreground/5"
        >
          Sign out
        </button>
      </form>
    </main>
  );
}
