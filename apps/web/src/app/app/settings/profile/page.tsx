import { redirect } from "next/navigation";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import { TrainingDaysControl } from "@/components/settings/TrainingDaysControl";
import {
  BodyCompPhaseAutoSave,
  EffortPreferenceAutoSave,
  ProfileBasicsAutoSave,
  TrainingExperienceAutoSave,
  TwoADayAutoSave,
} from "@/components/settings/SettingsAutoSaveSections";
import { SettingsGroup } from "@/components/settings/SettingsGroup";
import { PageHeader } from "@/components/ui/PageHeader";

type TrainingExperience =
  | "beginner_lt_6m"
  | "novice_6m_2y"
  | "intermediate_2y_5y"
  | "advanced_5y_10y"
  | "highly_advanced_10y_plus";
type BodyCompPhase = "gain" | "maintain" | "lean_out";
type EffortPreference = "low" | "standard" | "high";

const EFFORT_PREFERENCE_LABEL: Record<EffortPreference, string> = {
  low: "Easier",
  standard: "Balanced",
  high: "Harder",
};

function asEffortPreference(v: unknown): EffortPreference {
  return v === "low" || v === "high" ? v : "standard";
}

const TRAINING_EXPERIENCE_VALUES: ReadonlySet<TrainingExperience> = new Set([
  "beginner_lt_6m",
  "novice_6m_2y",
  "intermediate_2y_5y",
  "advanced_5y_10y",
  "highly_advanced_10y_plus",
]);

const EXPERIENCE_LABEL: Record<TrainingExperience, string> = {
  beginner_lt_6m: "Beginner",
  novice_6m_2y: "Novice",
  intermediate_2y_5y: "Intermediate",
  advanced_5y_10y: "Advanced",
  highly_advanced_10y_plus: "Highly advanced",
};

const PHASE_LABEL: Record<BodyCompPhase, string> = {
  maintain: "Maintain",
  gain: "Gain",
  lean_out: "Lean out",
};

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
  } = await getAuthUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select(
      "display_name, units, body_comp_phase, phase_started_at, phase_target_weeks, training_days_per_week, training_experience, allows_two_a_days, am_window_start, pm_window_start, timezone, effort_preference",
    )
    .eq("id", user.id)
    .maybeSingle();

  const experience = asTrainingExperience(profile?.training_experience);
  const phase = asBodyCompPhase(profile?.body_comp_phase);
  const effortPreference = asEffortPreference(profile?.effort_preference);
  const days = Number(profile?.training_days_per_week ?? 4);
  const twoADay = !!profile?.allows_two_a_days;

  const experienceSummary = experience ? EXPERIENCE_LABEL[experience] : "Not set";
  const phaseSummary = PHASE_LABEL[phase];
  const effortSummary = EFFORT_PREFERENCE_LABEL[effortPreference];
  const preferencesSummary = `${days} days/wk · ${
    twoADay ? "two-a-day" : "single session"
  }`;

  return (
    <div className="space-y-8">
      <PageHeader
        back={{ href: "/app/settings", label: "Settings" }}
        title="Training profile"
        subtitle="Identity and the defaults the planner uses when building a new block."
      />

      <div className="space-y-3">
        {/* Profile — name + units. Always open: smallest section and the
            only one a user is likely to revisit. */}
        <SettingsGroup
          id="profile"
          title="Profile"
          testId="settings-group-profile"
          defaultOpen
        >
          <ProfileBasicsAutoSave
            initialDisplayName={profile?.display_name ?? ""}
          />
        </SettingsGroup>

        {/* Training experience — one-time-ish; collapsed by default. */}
        <SettingsGroup
          id="experience"
          title="Training experience"
          summary={experienceSummary}
          testId="settings-group-experience"
        >
          <p className="text-xs text-foreground/60">
            How long you&apos;ve been training consistently. Used to seed your
            training tier — your tier adjusts automatically as the app observes
            your training.
          </p>
          <TrainingExperienceAutoSave initial={experience} />
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
        </SettingsGroup>

        {/* Body composition phase — one-time-ish; collapsed by default. */}
        <SettingsGroup
          id="body-comp-phase"
          title="Body composition phase"
          summary={phaseSummary}
          testId="settings-group-body-comp-phase"
        >
          <p className="text-xs text-foreground/60">
            Tell the app whether you&apos;re building, holding, or cutting.
            During a cut the app pulls back top-end intensity slightly and
            protects strength via heavy, low-volume work.
          </p>
          <BodyCompPhaseAutoSave
            initialPhase={phase}
            initialStartedAt={profile?.phase_started_at ?? ""}
            initialTargetWeeks={
              profile?.phase_target_weeks != null
                ? String(profile.phase_target_weeks)
                : ""
            }
          />
        </SettingsGroup>

        {/* Effort / volume dial (ADR 0016) — hypertrophy-archetype lever.
            Collapsed by default. New blocks only. */}
        <SettingsGroup
          id="effort-preference"
          title="Effort &amp; volume"
          summary={effortSummary}
          testId="settings-group-effort-preference"
        >
          <p className="text-xs text-foreground/60">
            How hard and high-volume your muscle-building work should be. This
            tunes the muscle-building focus only — your strength and endurance
            work is unchanged. Applies to new blocks; existing blocks keep what
            they were built with.
          </p>
          <EffortPreferenceAutoSave initial={effortPreference} />
        </SettingsGroup>

        {/* Training preferences — frequency + two-a-day toggle.
            Collapsed by default. */}
        <SettingsGroup
          id="training-preferences"
          title="Training preferences"
          summary={preferencesSummary}
          testId="settings-group-training-preferences"
        >
          <div className="space-y-3">
            <p className="text-xs text-foreground/60">
              The default training frequency the planner uses when you start a
              new block. You can still override it per block.
            </p>
            <TrainingDaysControl initial={days} />
          </div>
          <div className="space-y-3">
            <p className="text-xs text-foreground/60">
              Two sessions on the same day: AM lift + PM cardio, ideally 6+
              hours apart so the strength signal and the aerobic signal
              don&apos;t fight each other (AMPK / mTORC1). When this is on,
              curated focuses get a two-a-day variant and the custom builder
              lets you add a PM session per day. New blocks only — existing
              blocks aren&apos;t re-compiled.
            </p>
            <TwoADayAutoSave
              initialAllowsTwoADays={twoADay}
              initialAmStart={toHHMM(profile?.am_window_start, "07:00")}
              initialPmStart={toHHMM(profile?.pm_window_start, "17:00")}
            />
          </div>
        </SettingsGroup>
      </div>
    </div>
  );
}
