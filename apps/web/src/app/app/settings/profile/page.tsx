import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { logBodyweight } from "@/lib/settings/actions";
import { TrainingDaysControl } from "@/components/settings/TrainingDaysControl";
import {
  BodyCompPhaseAutoSave,
  ProfileBasicsAutoSave,
  TrainingExperienceAutoSave,
  TwoADayAutoSave,
} from "@/components/settings/SettingsAutoSaveSections";
import { todayYmd } from "@/lib/dates";

type TrainingExperience =
  | "beginner_lt_6m"
  | "novice_6m_2y"
  | "intermediate_2y_5y"
  | "advanced_5y_10y"
  | "highly_advanced_10y_plus";
type BodyCompPhase = "gain" | "maintain" | "lean_out";

const TRAINING_EXPERIENCE_VALUES: ReadonlySet<TrainingExperience> = new Set([
  "beginner_lt_6m",
  "novice_6m_2y",
  "intermediate_2y_5y",
  "advanced_5y_10y",
  "highly_advanced_10y_plus",
]);

function asTrainingExperience(v: unknown): TrainingExperience | "" {
  return typeof v === "string" &&
    TRAINING_EXPERIENCE_VALUES.has(v as TrainingExperience)
    ? (v as TrainingExperience)
    : "";
}

function asBodyCompPhase(v: unknown): BodyCompPhase {
  return v === "gain" || v === "lean_out" ? v : "maintain";
}

function toHHMM(value: string | null | undefined, fallback: string): string {
  if (typeof value !== "string" || value === "") return fallback;
  return value.slice(0, 5);
}

export default async function ProfileSettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select(
      "display_name, units, bodyweight_kg, body_comp_phase, phase_started_at, phase_target_weeks, training_days_per_week, training_experience, allows_two_a_days, am_window_start, pm_window_start, timezone",
    )
    .eq("id", user.id)
    .maybeSingle();

  const { data: weights } = await supabase
    .from("wellness")
    .select("date, bodyweight_kg")
    .not("bodyweight_kg", "is", null)
    .order("date", { ascending: false })
    .limit(12);

  return (
    <main className="min-h-screen px-6 py-8 max-w-2xl mx-auto space-y-8">
      <header className="space-y-1">
        <Link
          href="/app/settings"
          style={{ fontSize: 12, color: "var(--cp-text-muted)" }}
        >
          ← Settings
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">
          Training profile
        </h1>
        <p className="text-xs text-foreground/60">
          Your background, body composition, weight history, and how often you
          train.
        </p>
      </header>

      <div className="space-y-6">
        {/* Display name + units */}
        <ProfileBasicsAutoSave
          initialDisplayName={profile?.display_name ?? ""}
          initialUnits={profile?.units === "imperial" ? "imperial" : "metric"}
        />

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
          <details
            className="text-xs text-foreground/60"
            data-testid="settings-experience-how"
          >
            <summary className="cursor-pointer select-none hover:text-foreground">
              How does this work?
            </summary>
            <p className="mt-2 leading-relaxed">
              Your declared experience anchors your starting tier. From there,
              the engine refines it based on four observed signals: per-lift
              strength relative to bodyweight, 12-week training adherence,
              schedule regularity, and recovery check-in fill rate. When your
              declared tier and the engine&apos;s observations disagree, the
              app keeps your choice and shows a soft note — never silently
              overrules you.
            </p>
          </details>
        </div>

        {/* Body composition phase */}
        <div className="space-y-3">
          <p className="text-xs text-foreground/60">
            Tell the app whether you&apos;re building, holding, or cutting.
            During a cut the app pulls back top-end intensity slightly and
            protects strength via heavy, low-volume work.
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

        {/* Training days per week */}
        <div className="space-y-3">
          <p className="text-xs text-foreground/60">
            The default the planner uses when you start a new block. You can
            still override it per block.
          </p>
          <TrainingDaysControl
            initial={Number(profile?.training_days_per_week ?? 4)}
          />
        </div>

        {/* Two-a-day */}
        <div className="space-y-3">
          <p className="text-xs text-foreground/60">
            Two sessions on the same day: AM lift + PM cardio, ideally 6+ hours
            apart so the strength signal and the aerobic signal don&apos;t
            fight each other (AMPK / mTORC1). When this is on, curated focuses
            get a two-a-day variant and the custom builder lets you add a PM
            session per day. New blocks only — existing blocks aren&apos;t
            re-compiled.
          </p>
          <TwoADayAutoSave
            initialAllowsTwoADays={!!profile?.allows_two_a_days}
            initialAmStart={toHHMM(profile?.am_window_start, "07:00")}
            initialPmStart={toHHMM(profile?.pm_window_start, "17:00")}
          />
        </div>

        {/* Bodyweight log — discrete action, keep the Log weight button. */}
        <div className="space-y-3">
          <p className="text-xs text-foreground/60">
            Log when you weigh — weekly is plenty. Helps the app spot weight
            drift over time.
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
                  <li
                    key={w.date}
                    className="flex justify-between font-mono"
                  >
                    <span>{w.date}</span>
                    <span>{w.bodyweight_kg} kg</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
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
