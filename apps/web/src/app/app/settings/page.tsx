import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { deleteAccount } from "@/lib/auth/delete-account";
import { logBodyweight, updateProfile } from "@/lib/settings/actions";

const TIMEZONES = [
  "Europe/Helsinki",
  "Europe/Stockholm",
  "Europe/London",
  "Europe/Berlin",
  "America/New_York",
  "America/Los_Angeles",
  "UTC",
];

export default async function SettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select(
      "display_name, timezone, units, bodyweight_kg, body_comp_phase, phase_started_at, phase_target_weeks",
    )
    .eq("id", user.id)
    .maybeSingle();

  const { data: weights } = await supabase
    .from("wellness")
    .select("date, bodyweight_kg")
    .not("bodyweight_kg", "is", null)
    .order("date", { ascending: false })
    .limit(12);

  const { count: activeLim } = await supabase
    .from("limitations")
    .select("id", { count: "exact", head: true })
    .is("resolved_at", null);

  return (
    <main className="min-h-screen px-6 py-8 max-w-2xl mx-auto space-y-8">
      <header className="space-y-1">
        <Link href="/app" className="text-xs text-foreground/50 hover:text-foreground">
          ← back
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-xs text-foreground/50 font-mono">{user.email}</p>
      </header>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Profile</h2>
        <form action={updateProfile} className="space-y-3 rounded-lg border border-foreground/10 p-4">
          <Field
            name="displayName"
            label="Display name"
            type="text"
            defaultValue={profile?.display_name ?? ""}
            placeholder="What should we call you?"
            maxLength={60}
          />
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs text-foreground/60" htmlFor="timezone">Timezone</label>
              <select
                id="timezone"
                name="timezone"
                defaultValue={profile?.timezone ?? "UTC"}
                className="w-full rounded-md border border-foreground/15 bg-transparent px-2 py-2 text-sm"
              >
                {TIMEZONES.map((tz) => (
                  <option key={tz} value={tz}>{tz}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-foreground/60" htmlFor="units">Units</label>
              <select
                id="units"
                name="units"
                defaultValue={profile?.units ?? "metric"}
                className="w-full rounded-md border border-foreground/15 bg-transparent px-2 py-2 text-sm"
              >
                <option value="metric">kg / km</option>
                <option value="imperial">lb / mi</option>
              </select>
            </div>
          </div>
          <button
            type="submit"
            className="rounded-md bg-foreground text-background px-3 py-1.5 text-sm font-medium hover:opacity-90"
          >
            Save profile
          </button>
        </form>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Body composition phase</h2>
        <p className="text-xs text-foreground/60">
          Declared phases drive DC-F11 / DC-Q2 — engine caps top-end intensity at −5%
          and protects strength via heavy low-volume work when you&apos;re in a cut.
        </p>
        <form action={updateProfile} className="space-y-3 rounded-lg border border-foreground/10 p-4">
          <div className="space-y-1">
            <label className="text-xs text-foreground/60" htmlFor="bodyCompPhase">Current phase</label>
            <select
              id="bodyCompPhase"
              name="bodyCompPhase"
              defaultValue={profile?.body_comp_phase ?? "maintain"}
              className="w-full rounded-md border border-foreground/15 bg-transparent px-2 py-2 text-sm"
            >
              <option value="maintain">Maintain</option>
              <option value="gain">Gain (lean bulk)</option>
              <option value="lean_out">Lean out (cut)</option>
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field name="phaseStartedAt" label="Started on" type="date" defaultValue={profile?.phase_started_at ?? ""} />
            <Field name="phaseTargetWeeks" label="Target length (weeks)" type="number" min="1" max="52" defaultValue={profile?.phase_target_weeks ?? ""} placeholder="e.g. 10" />
          </div>
          <button
            type="submit"
            className="rounded-md bg-foreground text-background px-3 py-1.5 text-sm font-medium hover:opacity-90"
          >
            Save phase
          </button>
        </form>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Bodyweight</h2>
        <p className="text-xs text-foreground/60">
          Log when you weigh — weekly is plenty. History feeds DC-T3 drift detection.
        </p>
        <form action={logBodyweight} className="space-y-3 rounded-lg border border-foreground/10 p-4">
          <div className="grid grid-cols-2 gap-3">
            <Field name="date" label="Date" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} />
            <Field name="bodyweightKg" label="Weight (kg)" type="number" step="0.1" min="20" max="400" required defaultValue={profile?.bodyweight_kg ?? ""} inputMode="decimal" />
          </div>
          <button
            type="submit"
            className="rounded-md bg-foreground text-background px-3 py-1.5 text-sm font-medium hover:opacity-90"
          >
            Log weight
          </button>
        </form>
        {weights && weights.length > 0 && (
          <details className="text-xs text-foreground/60">
            <summary className="cursor-pointer select-none hover:text-foreground">
              History (last {weights.length})
            </summary>
            <ul className="mt-2 space-y-1">
              {weights.map((w) => (
                <li key={w.date} className="flex justify-between font-mono">
                  <span>{w.date}</span>
                  <span>{w.bodyweight_kg} kg</span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Active limitations</h2>
        <p className="text-xs text-foreground/60">
          Per-region injury flags. Drive DC-D5 / DC-D7 / DC-J9 safety hard-blocks.
        </p>
        <Link
          href="/app/settings/limitations"
          className="inline-flex items-center justify-between gap-3 rounded-lg border border-foreground/10 p-4 w-full hover:bg-foreground/5"
        >
          <span className="text-sm">Manage limitations</span>
          <span className="text-xs text-foreground/60">{activeLim ?? 0} active →</span>
        </Link>
      </section>

      <section className="space-y-3 pt-6 border-t border-foreground/10">
        <h2 className="text-lg font-medium text-red-700 dark:text-red-400">Danger zone</h2>
        <form action={deleteAccount}>
          <button
            type="submit"
            className="rounded-md border border-red-600/40 text-red-700 dark:text-red-400 px-3 py-1.5 text-sm hover:bg-red-50 dark:hover:bg-red-950/30"
          >
            Delete account (GDPR Art. 17)
          </button>
          <p className="text-xs text-foreground/50 mt-2">
            Hard-deletes your auth record and cascades to all sessions, sets,
            cardio entries, limitations, and bodyweight history. Irreversible.
          </p>
        </form>
      </section>
    </main>
  );
}

function Field({
  name,
  label,
  defaultValue,
  ...rest
}: {
  name: string;
  label: string;
  defaultValue?: string | number | null;
} & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="space-y-1">
      <label className="text-xs text-foreground/60" htmlFor={name}>{label}</label>
      <input
        id={name}
        name={name}
        defaultValue={defaultValue ?? undefined}
        {...rest}
        className="w-full rounded-md border border-foreground/15 bg-transparent px-2 py-2 text-sm"
      />
    </div>
  );
}
