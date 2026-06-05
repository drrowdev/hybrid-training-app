/**
 * /app/settings/bodyweight — dedicated bodyweight log + history page.
 *
 * Split out of /app/settings/profile in the settings polish pass. The
 * log form is the most-touched control on the old profile page, so it
 * lives on its own card here and surfaces a "last logged" state badge
 * on the hub card. Profile is now reserved for identity + training
 * preferences only.
 */
import { redirect } from "next/navigation";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import { logBodyweight } from "@/lib/settings/actions";
import { todayYmd } from "@/lib/dates";
import { PageHeader } from "@/components/ui/PageHeader";

export const dynamic = "force-dynamic";

export default async function BodyweightSettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("bodyweight_kg, timezone")
    .eq("id", user.id)
    .maybeSingle();

  const { data: weights } = await supabase
    .from("wellness")
    .select("date, bodyweight_kg")
    .not("bodyweight_kg", "is", null)
    .order("date", { ascending: false })
    .limit(12);

  return (
    <main
      data-testid="bodyweight-page"
      className="min-h-screen px-6 py-8 max-w-2xl mx-auto space-y-8"
    >
      <PageHeader
        back={{ href: "/app/settings", label: "Settings" }}
        title="Bodyweight"
        subtitle="Log when you weigh — weekly is plenty. Helps the app spot weight drift over time."
      />

      <section className="space-y-3">
        <form
          action={logBodyweight}
          className="space-y-3 rounded-lg border border-foreground/10 p-4"
          data-testid="bodyweight-log-form"
        >
          <div className="grid grid-cols-2 gap-3">
            <Field
              name="date"
              label="Date"
              type="date"
              required
              defaultValue={todayYmd(profile?.timezone ?? "UTC")}
            />
            <Field
              name="bodyweightKg"
              label="Weight (kg)"
              type="number"
              step="0.1"
              min="20"
              max="400"
              required
              defaultValue={profile?.bodyweight_kg ?? ""}
              inputMode="decimal"
            />
          </div>
          <button
            type="submit"
            className="rounded-md bg-foreground text-background px-3 py-1.5 text-sm font-medium hover:opacity-90"
          >
            Log weight
          </button>
        </form>

        {weights && weights.length > 0 && (
          <details
            className="text-xs text-foreground/60"
            data-testid="bodyweight-history"
          >
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
      <label className="text-xs text-foreground/60" htmlFor={name}>
        {label}
      </label>
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
