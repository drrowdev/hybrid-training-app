import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  addLimitation,
  deleteLimitation,
  editLimitation,
  reopenLimitation,
  resolveLimitation,
} from "@/lib/limitations/actions";

const REGIONS: { value: string; label: string }[] = [
  { value: "foot_ankle_calf", label: "Foot / ankle / calf" },
  { value: "knee", label: "Knee" },
  { value: "hamstring_posterior", label: "Hamstring / posterior chain" },
  { value: "adductor_groin", label: "Adductor / groin" },
  { value: "lumbar_trunk", label: "Lumbar / trunk" },
  { value: "shoulder_scapular", label: "Shoulder / scapular" },
  { value: "elbow_forearm", label: "Elbow / forearm" },
];

const SEVERITY_COLORS: Record<string, string> = {
  mild: "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200",
  moderate: "bg-orange-100 text-orange-900 dark:bg-orange-900/40 dark:text-orange-200",
  severe: "bg-red-100 text-red-900 dark:bg-red-900/40 dark:text-red-200",
};

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

export default async function LimitationsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: all } = await supabase
    .from("limitations")
    .select("id, region, severity, started_at, resolved_at, notes")
    .order("started_at", { ascending: false });

  const active = (all ?? []).filter((l) => !l.resolved_at);
  const resolved = (all ?? []).filter((l) => l.resolved_at);

  // Server Component: rendered per request, not subject to the React
  // purity rule for hooks/components. The lint can't tell the difference.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();
  const longOpen = active.filter(
    (l) => now - new Date(l.started_at).getTime() > NINETY_DAYS_MS,
  );

  return (
    <main className="min-h-screen px-6 py-8 max-w-2xl mx-auto space-y-8">
      <header className="space-y-1">
        <Link href="/app/settings" className="text-xs text-foreground/50 hover:text-foreground">
          ← settings
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Active limitations</h1>
        <p className="text-xs text-foreground/60">
          Add a row when you&apos;re hurt; mark resolved when better. The app uses these to avoid
          loading the affected region until you say it&apos;s fine. Not asked daily.
        </p>
      </header>

      {longOpen.length > 0 && (
        <section className="rounded-lg border border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-900/20 p-4 space-y-2">
          <h3 className="text-sm font-medium text-amber-900 dark:text-amber-200">
            Still bothering you?
          </h3>
          <p className="text-xs text-amber-900/80 dark:text-amber-200/80">
            {longOpen.length} limitation{longOpen.length > 1 ? "s have" : " has"} been
            open more than 90 days. If they&apos;re resolved, mark them so — they keep
            constraining your prescriptions until you do.
          </p>
        </section>
      )}

      <section className="space-y-3">
        <h2 className="text-base font-medium">Add limitation</h2>
        <form action={addLimitation} className="space-y-3 rounded-lg border border-foreground/10 p-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs text-foreground/60" htmlFor="region">Region</label>
              <select id="region" name="region" required className="w-full rounded-md border border-foreground/15 bg-transparent px-2 py-2 text-sm">
                {REGIONS.map((r) => (
                  <option key={r.value} value={r.value}>{r.label}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-foreground/60" htmlFor="severity">Severity</label>
              <select id="severity" name="severity" required defaultValue="mild" className="w-full rounded-md border border-foreground/15 bg-transparent px-2 py-2 text-sm">
                <option value="mild">Mild (niggle)</option>
                <option value="moderate">Moderate (pain at load)</option>
                <option value="severe">Severe (can&apos;t train through)</option>
              </select>
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-xs text-foreground/60" htmlFor="startedAt">Started on (optional)</label>
            <input id="startedAt" name="startedAt" type="date" className="w-full rounded-md border border-foreground/15 bg-transparent px-2 py-2 text-sm" />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-foreground/60" htmlFor="notes">Notes (optional)</label>
            <textarea id="notes" name="notes" rows={3} maxLength={1000} placeholder="What's happening? When does it hurt? What helps?" className="w-full rounded-md border border-foreground/15 bg-transparent px-3 py-2 text-sm" />
          </div>
          <button type="submit" className="rounded-md bg-foreground text-background px-3 py-1.5 text-sm font-medium hover:opacity-90">
            Add
          </button>
        </form>
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-medium">
          Active <span className="text-xs text-foreground/50">({active.length})</span>
        </h2>
        {active.length === 0 && (
          <p className="text-sm text-foreground/50">
            No active limitations 🎉 — engine running with full safety latitude.
          </p>
        )}
        <ul className="space-y-3">
          {active.map((l) => (
            <li key={l.id} className="rounded-lg border border-foreground/10 p-4 space-y-3">
              <div className="flex items-baseline justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium">
                      {REGIONS.find((r) => r.value === l.region)?.label ?? l.region}
                    </span>
                    <span className={`text-xs rounded-full px-2 py-0.5 ${SEVERITY_COLORS[l.severity] ?? ""}`}>
                      {l.severity}
                    </span>
                  </div>
                  <div className="text-xs text-foreground/50">
                    started {new Date(l.started_at).toLocaleDateString()}
                  </div>
                </div>
                <form action={resolveLimitation}>
                  <input type="hidden" name="id" value={l.id} />
                  <button type="submit" className="rounded-md border border-emerald-600/40 text-emerald-700 dark:text-emerald-400 px-3 py-1 text-xs hover:bg-emerald-50 dark:hover:bg-emerald-950/30">
                    Mark resolved
                  </button>
                </form>
              </div>

              <form action={editLimitation} className="space-y-2">
                <input type="hidden" name="id" value={l.id} />
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <label className="text-xs text-foreground/60">Severity</label>
                    <select name="severity" defaultValue={l.severity} className="w-full rounded-md border border-foreground/15 bg-transparent px-2 py-1.5 text-sm">
                      <option value="mild">mild</option>
                      <option value="moderate">moderate</option>
                      <option value="severe">severe</option>
                    </select>
                  </div>
                  <div />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-foreground/60">Notes</label>
                  <textarea name="notes" rows={2} defaultValue={l.notes ?? ""} maxLength={1000} className="w-full rounded-md border border-foreground/15 bg-transparent px-3 py-2 text-sm" />
                </div>
                <button type="submit" className="rounded-md border border-foreground/20 px-2 py-1 text-xs hover:bg-foreground/5">
                  Save edits
                </button>
              </form>

              <form action={deleteLimitation}>
                <input type="hidden" name="id" value={l.id} />
                <button type="submit" className="text-xs text-foreground/40 hover:text-red-600">
                  Delete row (no audit trail)
                </button>
              </form>
            </li>
          ))}
        </ul>
      </section>

      {resolved.length > 0 && (
        <details className="space-y-3">
          <summary className="cursor-pointer text-sm text-foreground/70 hover:text-foreground">
            Resolved ({resolved.length})
          </summary>
          <ul className="mt-3 divide-y divide-foreground/10 rounded-lg border border-foreground/10">
            {resolved.map((l) => (
              <li key={l.id} className="px-3 py-2 flex items-baseline justify-between gap-3 text-sm">
                <div>
                  <span className="font-medium">
                    {REGIONS.find((r) => r.value === l.region)?.label ?? l.region}
                  </span>{" "}
                  <span className="text-xs text-foreground/50">
                    {l.severity} · {new Date(l.started_at).toLocaleDateString()}
                    {l.resolved_at && ` → ${new Date(l.resolved_at).toLocaleDateString()}`}
                  </span>
                </div>
                <form action={reopenLimitation}>
                  <input type="hidden" name="id" value={l.id} />
                  <button type="submit" className="text-xs text-foreground/50 hover:text-foreground">
                    reopen
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </details>
      )}
    </main>
  );
}
