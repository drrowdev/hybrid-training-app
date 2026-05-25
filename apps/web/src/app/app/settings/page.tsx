import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { deleteAccount } from "@/lib/auth/delete-account";
import { logBodyweight } from "@/lib/settings/actions";
import { TrainingDaysControl } from "@/components/settings/TrainingDaysControl";
import { DateTimeFormatCard } from "@/components/settings/DateTimeFormatCard";
import { SettingsGroup } from "@/components/settings/SettingsGroup";
import {
  BodyCompPhaseAutoSave,
  FeedbackAutoSave,
  ProfileBasicsAutoSave,
  RecoveryCheckinAutoSave,
  TrainingExperienceAutoSave,
  TwoADayAutoSave,
} from "@/components/settings/SettingsAutoSaveSections";
import { todayYmd } from "@/lib/dates";
import {
  isDateFormat,
  isTimeFormat,
  resolveDateFormat,
  resolveTimeFormat,
} from "@/lib/format/datetime";
import { resolveEquipment } from "@/lib/settings/equipment-presets";
import { TrainingProgressionCards } from "@/components/settings/TrainingProgressionCards";

type TrainingExperience = "lt_1y" | "1_3y" | "gte_3y";
type BodyCompPhase = "gain" | "maintain" | "lean_out";

function asTrainingExperience(v: unknown): TrainingExperience | "" {
  return v === "lt_1y" || v === "1_3y" || v === "gte_3y" ? v : "";
}

function asBodyCompPhase(v: unknown): BodyCompPhase {
  return v === "gain" || v === "lean_out" ? v : "maintain";
}

function toHHMM(value: string | null | undefined, fallback: string): string {
  if (typeof value !== "string" || value === "") return fallback;
  return value.slice(0, 5);
}

export default async function SettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select(
      "display_name, units, bodyweight_kg, body_comp_phase, phase_started_at, phase_target_weeks, training_days_per_week, training_experience, allows_two_a_days, am_window_start, pm_window_start, timezone, haptics_enabled, timer_sound_enabled, show_today_recovery_card, time_format, date_format, equipment, barbell_kg, trap_bar_kg, plate_inventory_kg",
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

  // Equipment-preset-aware discoverability for Training maxes vs.
  // Bodyweight progression. BW-only users have no %TM concept; mixed
  // users (non-BW preset but prior BW assessment rows) get both cards.
  const equipment = resolveEquipment(profile ?? null);
  const isBodyweightOnly = equipment.preset === "bodyweight_only";

  let hasBwProgress = false;
  // Skip the existence check when we already know we'll render the card
  // (BW-only always shows it).
  if (!isBodyweightOnly) {
    const { data: bwRow } = await supabase
      .from("bw_progress")
      .select("user_id")
      .eq("user_id", user.id)
      .limit(1)
      .maybeSingle();
    hasBwProgress = !!bwRow;
  }

  return (
    <main className="min-h-screen px-6 py-8 max-w-2xl mx-auto space-y-8">
      <header className="space-y-1">
        <Link href="/app" className="text-xs text-foreground/50 hover:text-foreground">
          ← back
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-xs text-foreground/50 font-mono">{user.email}</p>
      </header>

      <div className="space-y-3">
        {/* ---------------- Profile ---------------- */}
        <SettingsGroup
          id="profile"
          title="Profile"
          summary="Name, units, body composition, weight log"
          testId="settings-group-profile"
        >
          {/* Display name + units */}
          <ProfileBasicsAutoSave
            initialDisplayName={profile?.display_name ?? ""}
            initialUnits={profile?.units === "imperial" ? "imperial" : "metric"}
          />

          {/* Body composition phase */}
          <div className="space-y-3">
            <p className="text-xs text-foreground/60">
              Tell the app whether you&apos;re building, holding, or cutting. During a cut the app
              pulls back top-end intensity slightly and protects strength via heavy, low-volume work.
            </p>
            <BodyCompPhaseAutoSave
              initialPhase={asBodyCompPhase(profile?.body_comp_phase)}
              initialStartedAt={profile?.phase_started_at ?? ""}
              initialTargetWeeks={
                profile?.phase_target_weeks != null
                  ? String(profile.phase_target_weeks)
                  : ""
              }
            />
          </div>

          {/* Bodyweight log — discrete action, keep the Log weight button. */}
          <div className="space-y-3">
            <p className="text-xs text-foreground/60">
              Log when you weigh — weekly is plenty. Helps the app spot weight drift over time.
            </p>
            <form
              action={logBodyweight}
              className="space-y-3 rounded-lg border border-foreground/10 p-4"
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
          </div>
        </SettingsGroup>

        {/* ---------------- Training preferences ---------------- */}
        <SettingsGroup
          id="training-preferences"
          title="Training preferences"
          summary="Frequency, equipment, training maxes, warmups"
          testId="settings-group-training-preferences"
        >
          {/* Training experience */}
          <div className="space-y-3">
            <p className="text-xs text-foreground/60">
              How long you&apos;ve been training consistently. Used to seed your
              training tier — your tier adjusts automatically as the app observes
              your training.
            </p>
            <TrainingExperienceAutoSave
              initial={asTrainingExperience(profile?.training_experience)}
            />
            <details className="text-xs text-foreground/60" data-testid="settings-experience-how">
              <summary className="cursor-pointer select-none hover:text-foreground">
                How does this work?
              </summary>
              <p className="mt-2 leading-relaxed">
                Your declared experience anchors your starting tier (DC-G1..G6).
                From there, the engine refines it based on four observed signals:
                per-lift strength relative to bodyweight, 12-week training
                adherence, schedule regularity, and recovery check-in fill rate.
                When your declared tier and the engine&apos;s observations
                disagree, the app keeps your choice and shows a soft note —
                never silently overrules you.
              </p>
            </details>
          </div>

          {/* Training days per week */}
          <div className="space-y-3">
            <p className="text-xs text-foreground/60">
              The default the planner uses when you start a new block. You can still override it per block.
            </p>
            <TrainingDaysControl initial={Number(profile?.training_days_per_week ?? 4)} />
          </div>

          {/* Two-a-day */}
          <div className="space-y-3">
            <p className="text-xs text-foreground/60">
              Two sessions on the same day: AM lift + PM cardio, ideally 6+ hours apart so the
              strength signal and the aerobic signal don&apos;t fight each other (AMPK / mTORC1).
              When this is on, curated focuses get a two-a-day variant and the custom builder lets you
              add a PM session per day. New blocks only — existing blocks aren&apos;t re-compiled.
            </p>
            <TwoADayAutoSave
              initialAllowsTwoADays={!!profile?.allows_two_a_days}
              initialAmStart={toHHMM(profile?.am_window_start, "07:00")}
              initialPmStart={toHHMM(profile?.pm_window_start, "17:00")}
            />
          </div>

          {/* Equipment link */}
          <div className="space-y-3">
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
          </div>

          {/* Warmups link */}
          <div className="space-y-3">
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
          </div>

          {/* Training maxes / Bodyweight progression cards */}
          <TrainingProgressionCards
            isBodyweightOnly={isBodyweightOnly}
            hasBwProgress={hasBwProgress}
          />
        </SettingsGroup>

        {/* ---------------- Session experience ---------------- */}
        <SettingsGroup
          id="session-experience"
          title="Session experience"
          summary="Time format, in-session feedback, recovery card"
          testId="settings-group-session-experience"
        >
          {/* Feedback */}
          <div className="space-y-3" data-testid="settings-feedback">
            <p className="text-xs text-foreground/60">
              Subtle haptic + audio cues during a session — a short buzz when you commit a set,
              and a short tone when the rest timer reaches zero. Browser support varies; both are
              best-effort and silently no-op on devices that don&apos;t expose the underlying APIs.
            </p>
            <FeedbackAutoSave
              initialHaptics={profile?.haptics_enabled !== false}
              initialTimerSound={profile?.timer_sound_enabled !== false}
            />
          </div>

          {/* Daily recovery check-in */}
          <div className="space-y-3" data-testid="settings-recovery-card">
            <p className="text-xs text-foreground/60">
              A 2-tap fatigue + soreness logger on the Today page. Bias the
              engine&apos;s recovery model. Toggle off to hide the card entirely
              — your existing logs stay put, and you can turn it back on at
              any time.
            </p>
            <RecoveryCheckinAutoSave
              initialShow={profile?.show_today_recovery_card !== false}
            />
          </div>

          {/* Time & date format */}
          <div className="space-y-3" data-testid="settings-datetime-format">
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
          </div>
        </SettingsGroup>

        {/* ---------------- Race & event planning ---------------- */}
        <SettingsGroup
          id="race-events"
          title="Race & event planning"
          summary="Limitations, races, Strava connection"
          testId="settings-group-race-events"
        >
          {/* Active limitations */}
          <div className="space-y-3">
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
          </div>

          {/* Priority events */}
          <div className="space-y-3">
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
          </div>

          {/* Connections */}
          <div className="space-y-3">
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
          </div>
        </SettingsGroup>

        {/* ---------------- Account & data ---------------- */}
        <SettingsGroup
          id="account"
          title="Account & data"
          summary="Trash, export, delete account"
          testId="settings-group-account"
        >
          {/* Trash */}
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

          {/* Export */}
          <div className="space-y-2">
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
          </div>

          {/* Danger zone sub-block — visually distinct, same content as before */}
          <div
            className="space-y-3 mt-2 pt-4 border-t border-red-600/30 rounded-lg border border-red-600/20 bg-red-50/40 dark:bg-red-950/20 p-4"
            data-testid="settings-danger-zone"
          >
            <h3 className="text-sm font-semibold text-red-700 dark:text-red-400">
              Danger zone
            </h3>
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
          </div>
        </SettingsGroup>
      </div>
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
