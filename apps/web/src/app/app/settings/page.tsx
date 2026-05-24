import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { deleteAccount } from "@/lib/auth/delete-account";
import { logBodyweight, updateProfile } from "@/lib/settings/actions";
import { TrainingDaysControl } from "@/components/settings/TrainingDaysControl";
import { DateTimeFormatCard } from "@/components/settings/DateTimeFormatCard";
import { todayYmd } from "@/lib/dates";
import {
  isDateFormat,
  isTimeFormat,
  resolveDateFormat,
  resolveTimeFormat,
} from "@/lib/format/datetime";

export default async function SettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select(
      "display_name, units, bodyweight_kg, body_comp_phase, phase_started_at, phase_target_weeks, training_days_per_week, training_experience, allows_two_a_days, am_window_start, pm_window_start, timezone, haptics_enabled, timer_sound_enabled, time_format, date_format",
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

  // Trash count = soft-deleted blocks + sessions belonging to the
  // current user. Both queries are cheap (partial index in 0026 on
  // `deleted_at IS NOT NULL`).
  const [{ count: trashedBlockCount }, { count: trashedSessionCount }] = await Promise.all([
    supabase
      .from("training_blocks")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .not("deleted_at", "is", null),
    supabase
      .from("sessions")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .not("deleted_at", "is", null),
  ]);
  const trashCount = (trashedBlockCount ?? 0) + (trashedSessionCount ?? 0);

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
          <button
            type="submit"
            className="rounded-md bg-foreground text-background px-3 py-1.5 text-sm font-medium hover:opacity-90"
          >
            Save profile
          </button>
        </form>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Training experience</h2>
        <p className="text-xs text-foreground/60">
          How long you&apos;ve been training consistently. Used to seed your
          training tier — your tier adjusts automatically as the app observes
          your training (DC-G1).
        </p>
        <form
          action={updateProfile}
          className="space-y-3 rounded-lg border border-foreground/10 p-4"
          data-testid="settings-training-experience-form"
        >
          <div className="space-y-2">
            {(
              [
                { id: "lt_1y", label: "≤ 1 year", hint: "Beginner · still building habits." },
                { id: "1_3y", label: "1–3 years", hint: "Intermediate · regular training, clear progress." },
                { id: "gte_3y", label: "3+ years", hint: "Advanced · structured programming, plateau-aware." },
              ] as const
            ).map((opt) => {
              const sel = (profile?.training_experience ?? null) === opt.id;
              return (
                <label
                  key={opt.id}
                  className="flex items-start gap-3 rounded-md border border-foreground/10 p-3 cursor-pointer hover:bg-foreground/5"
                  data-testid={`settings-experience-${opt.id}`}
                  data-selected={sel ? "true" : "false"}
                >
                  <input
                    type="radio"
                    name="trainingExperience"
                    value={opt.id}
                    defaultChecked={sel}
                    className="mt-1"
                  />
                  <span className="text-sm">
                    {opt.label}
                    <span className="block text-xs text-foreground/60 mt-1">
                      {opt.hint}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
          <button
            type="submit"
            className="rounded-md bg-foreground text-background px-3 py-1.5 text-sm font-medium hover:opacity-90"
            data-testid="settings-experience-save"
          >
            Save experience
          </button>
          <details className="text-xs text-foreground/60" data-testid="settings-experience-how">
            <summary className="cursor-pointer select-none hover:text-foreground">
              How does this work?
            </summary>
            <p className="mt-2 leading-relaxed">
              Your declared experience anchors your starting tier. From there,
              the engine refines it from four observed signals: per-lift e1RM
              relative to bodyweight, 12-week anchor adherence, schedule
              regularity, and recovery check-in fill rate. When your declared
              tier and observed signals disagree, the app keeps your
              declaration and surfaces a soft note (DC-K4 — override and warn,
              never silent overrule). See <code>/app/stats/engine</code>{" "}
              section E for the live contributor breakdown, and{" "}
              <code>docs/knowledge/hybrid-training-design-constraints.md</code>{" "}
              §G (DC-G1..G6) for the constraint contract.
            </p>
          </details>
        </form>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Training days per week</h2>
        <p className="text-xs text-foreground/60">
          The default the planner uses when you start a new block. You can still override it per block.
        </p>
        <TrainingDaysControl initial={Number(profile?.training_days_per_week ?? 4)} />
      </section>

      <section className="space-y-3" data-testid="settings-feedback">
        <h2 className="text-lg font-medium">Feedback</h2>
        <p className="text-xs text-foreground/60">
          Subtle haptic + audio cues during a session — a short buzz when you commit a set,
          and a short tone when the rest timer reaches zero. Browser support varies; both are
          best-effort and silently no-op on devices that don&apos;t expose the underlying APIs.
        </p>
        <form action={updateProfile} className="rounded-lg border border-foreground/10 p-4 space-y-3">
          <input type="hidden" name="hapticsEnabledPresent" value="1" />
          <input type="hidden" name="timerSoundEnabledPresent" value="1" />
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              name="hapticsEnabled"
              data-testid="settings-haptics-toggle"
              defaultChecked={profile?.haptics_enabled !== false}
              className="mt-1"
            />
            <span className="text-sm">
              Haptic tick on set save
              <span className="block text-xs text-foreground/60 mt-1">
                A ~10ms vibration when a logged set commits. Web Vibration API.
              </span>
            </span>
          </label>
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              name="timerSoundEnabled"
              data-testid="settings-timer-sound-toggle"
              defaultChecked={profile?.timer_sound_enabled !== false}
              className="mt-1"
            />
            <span className="text-sm">
              Rest-timer tone at zero
              <span className="block text-xs text-foreground/60 mt-1">
                A short 200ms beep when the auto rest timer hits zero. Web Audio API
                (gated by browser autoplay rules — needs a first user gesture).
              </span>
            </span>
          </label>
          <button
            type="submit"
            className="rounded-md bg-foreground text-background px-3 py-1.5 text-sm font-medium hover:opacity-90"
          >
            Save feedback preferences
          </button>
        </form>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Two-a-day sessions</h2>
        <p className="text-xs text-foreground/60">
          Two sessions on the same day: AM lift + PM cardio, ideally 6+ hours apart so the
          strength signal and the aerobic signal don&apos;t fight each other (AMPK / mTORC1).
          When this is on, curated focuses get a two-a-day variant and the custom builder lets you
          add a PM session per day. New blocks only — existing blocks aren&apos;t re-compiled.
        </p>
        <form action={updateProfile} className="rounded-lg border border-foreground/10 p-4 space-y-4">
          <input type="hidden" name="allowsTwoADaysPresent" value="1" />
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              name="allowsTwoADays"
              defaultChecked={!!profile?.allows_two_a_days}
              className="mt-1"
            />
            <span className="text-sm">
              Enable two-a-day sessions
              <span className="block text-xs text-foreground/60 mt-1">
                Currently {profile?.allows_two_a_days ? "on" : "off"}.
              </span>
            </span>
          </label>
          <div className="grid grid-cols-2 gap-3 pt-2 border-t border-foreground/10">
            <Field
              name="amWindowStart"
              label="AM session start"
              type="time"
              defaultValue={(profile?.am_window_start ?? "07:00:00").slice(0, 5)}
              step="300"
            />
            <Field
              name="pmWindowStart"
              label="PM session start"
              type="time"
              defaultValue={(profile?.pm_window_start ?? "17:00:00").slice(0, 5)}
              step="300"
            />
          </div>
          <p className="text-xs text-foreground/60 -mt-2">
            Used as the default time-of-day shown on Today and Plan when you haven&apos;t set
            an explicit time on a session. Override per-session from the Plan page.
          </p>
          <button
            type="submit"
            className="rounded-md bg-foreground text-background px-3 py-1.5 text-sm font-medium hover:opacity-90"
          >
            Save preference
          </button>
        </form>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Body composition phase</h2>
        <p className="text-xs text-foreground/60">
          Tell the app whether you&apos;re building, holding, or cutting. During a cut the app
          pulls back top-end intensity slightly and protects strength via heavy, low-volume work.
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
          Log when you weigh — weekly is plenty. Helps the app spot weight drift over time.
        </p>
        <form action={logBodyweight} className="space-y-3 rounded-lg border border-foreground/10 p-4">
          <div className="grid grid-cols-2 gap-3">
            <Field name="date" label="Date" type="date" required defaultValue={todayYmd(profile?.timezone ?? "UTC")} />
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

      <section className="space-y-3" data-testid="settings-datetime-format">
        <h2 className="text-lg font-medium">Time &amp; date format</h2>
        <p className="text-xs text-foreground/60">
          How wall-clock times and calendar dates render across the app.
          Durations like the rest-timer countdown stay in mm:ss regardless.
        </p>
        <DateTimeFormatCard
          initialTimeFormat={isTimeFormat(profile?.time_format) ? profile.time_format : null}
          initialDateFormat={isDateFormat(profile?.date_format) ? profile.date_format : null}
          resolvedTimeFormat={resolveTimeFormat(profile ?? null)}
          resolvedDateFormat={resolveDateFormat(profile ?? null)}
        />
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Equipment</h2>
        <p className="text-xs text-foreground/60">
          Bar weights + plate inventory. The session logger uses these to
          show a plate-per-side breakdown next to your target weight.
        </p>
        <Link
          href="/app/settings/equipment"
          data-testid="settings-equipment-link"
          className="inline-flex items-center justify-between gap-3 rounded-lg border border-foreground/10 p-4 w-full hover:bg-foreground/5"
        >
          <span className="text-sm">Manage equipment</span>
          <span className="text-xs text-foreground/60">→</span>
        </Link>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Warmups</h2>
        <p className="text-xs text-foreground/60">
          Auto-generated warmup ladder before each main lift. Pick a preset or
          dial in a custom percent/rep ramp.
        </p>
        <Link
          href="/app/settings/training"
          data-testid="settings-warmups-link"
          className="inline-flex items-center justify-between gap-3 rounded-lg border border-foreground/10 p-4 w-full hover:bg-foreground/5"
        >
          <span className="text-sm">Configure warmups</span>
          <span className="text-xs text-foreground/60">→</span>
        </Link>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Training maxes</h2>
        <p className="text-xs text-foreground/60">
          Reference numbers for percentage-based prescription. Set one per main lift —
          the Log shows &quot;% of TM&quot; next to the weight.
        </p>
        <Link
          href="/app/settings/training-maxes"
          className="inline-flex items-center justify-between gap-3 rounded-lg border border-foreground/10 p-4 w-full hover:bg-foreground/5"
        >
          <span className="text-sm">Manage training maxes</span>
          <span className="text-xs text-foreground/60">→</span>
        </Link>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Active limitations</h2>
        <p className="text-xs text-foreground/60">
          Flag injuries by region. The app avoids loading those regions until you mark them resolved.
        </p>
        <Link
          href="/app/recovery/injuries"
          className="inline-flex items-center justify-between gap-3 rounded-lg border border-foreground/10 p-4 w-full hover:bg-foreground/5"
        >
          <span className="text-sm">Manage limitations</span>
          <span className="text-xs text-foreground/60">{activeLim ?? 0} active →</span>
        </Link>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Priority events</h2>
        <p className="text-xs text-foreground/60">
          Mark races, comps, and tests. A-priority events trigger a 14-day taper plan.
        </p>
        <Link
          href="/app/settings/events"
          className="inline-flex items-center justify-between gap-3 rounded-lg border border-foreground/10 p-4 w-full hover:bg-foreground/5"
        >
          <span className="text-sm">Manage events</span>
          <span className="text-xs text-foreground/60">→</span>
        </Link>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Connections</h2>
        <p className="text-xs text-foreground/60">
          Import cardio activities so region freshness reflects all your training, not just lifts.
        </p>
        <Link
          href="/app/settings/strava"
          className="inline-flex items-center justify-between gap-3 rounded-lg border border-foreground/10 p-4 w-full hover:bg-foreground/5"
        >
          <span className="text-sm">Strava</span>
          <span className="text-xs text-foreground/60">→</span>
        </Link>
      </section>

      <section className="space-y-3 pt-6 border-t border-foreground/10">
        <h2 className="text-lg font-medium">Your data</h2>
        <Link
          href="/app/settings/trash"
          data-testid="settings-trash-link"
          className="inline-flex items-center justify-between gap-3 rounded-lg border border-foreground/10 p-4 w-full hover:bg-foreground/5"
        >
          <span className="text-sm">Trash</span>
          <span className="text-xs text-foreground/60">
            {trashCount} item{trashCount === 1 ? "" : "s"} →
          </span>
        </Link>
        <p className="text-xs text-foreground/60">
          Download everything we hold on you (GDPR Articles 15 + 20).
        </p>
        <a
          href="/api/me/export"
          download
          className="inline-block rounded-md border border-foreground/20 px-3 py-1.5 text-sm hover:bg-foreground/5"
        >
          Export my data (JSON)
        </a>
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
