import { redirect } from "next/navigation";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import {
  DisplayNameAutoSave,
  GenderAutoSave,
  TrainingExperienceAutoSave,
  TrainingWindowsAutoSave,
  UnitsAutoSave,
} from "@/components/settings/SettingsAutoSaveSections";
import { SettingCard, SettingNote } from "@/components/settings/SettingCard";
import { SettingInfo } from "@/components/settings/SettingInfo";
import { TrainingNotesEditor } from "@/components/settings/TrainingNotesEditor";
import { updateTrainingNotes } from "@/lib/profile/actions";
import { PageHeader } from "@/components/ui/PageHeader";

type TrainingExperience =
  | "beginner_lt_6m"
  | "novice_6m_2y"
  | "intermediate_2y_5y"
  | "advanced_5y_10y"
  | "highly_advanced_10y_plus";

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

function asTrainingExperience(v: unknown): TrainingExperience | "" {
  return typeof v === "string" &&
    TRAINING_EXPERIENCE_VALUES.has(v as TrainingExperience)
    ? (v as TrainingExperience)
    : "";
}

/**
 * Training profile — the athlete properties every program calibrates against.
 *
 * Two always-open cards grouped by EFFECT rather than by field type, each
 * leading with its current value. This replaced four collapsible groups that
 * hid three of four settings behind a click and rendered the current value as
 * the smallest, dimmest text on the page.
 *
 * Two settings that used to live here are gone:
 *
 *   - Body composition phase had no engine consumer at all — nothing in the
 *     planner ever read `body_comp_phase`, despite the copy claiming a cut
 *     pulled back top-end intensity. Migration 0131 drops the columns.
 *   - Accessory volume was labelled global but only ever shifted 5/3/1
 *     assistance volume, so it moved into the 5/3/1 wizard's Loadout step.
 *
 * Three settings arrived here from the retired /app/profile route, which had
 * no inbound link anywhere in the app: the display name, the training notes,
 * and the two-a-day training windows the Today page reads to place a morning
 * versus an evening session.
 */
export default async function ProfileSettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("units, gender, training_experience, display_name, am_window_start, pm_window_start, ai_notes")
    .eq("id", user.id)
    .maybeSingle();

  const experience = asTrainingExperience(profile?.training_experience);
  const gender = (profile?.gender as "male" | "female" | null) ?? null;
  const units = profile?.units === "imperial" ? "imperial" : "metric";
  const displayName = (profile?.display_name as string | null) ?? "";
  // Postgres hands back `HH:mm:ss`; the native time input wants `HH:mm`.
  const amWindowStart = ((profile?.am_window_start as string | null) ?? "07:00").slice(0, 5);
  const pmWindowStart = ((profile?.pm_window_start as string | null) ?? "17:00").slice(0, 5);
  const trainingNotes = (profile?.ai_notes as string | null) ?? "";

  return (
    <div className="space-y-8">
      <PageHeader
        back={{ href: "/app/settings", label: "Settings" }}
        title="Training profile"
        subtitle="How the app calibrates a new block to you."
      />

      <div className="settings-profile-grid">
        <SettingCard
          id="experience"
          eyebrow="Calibration"
          title="Training experience"
          value={experience ? EXPERIENCE_LABEL[experience] : "Not set"}
          testId="settings-card-experience"
          info={
            <SettingInfo
              label="How training experience works"
              testId="settings-experience-how"
            >
              Your declared experience anchors your starting tier. From there
              the app refines it from four observed signals: per-lift strength
              relative to bodyweight, 12-week training adherence, schedule
              regularity, and recovery check-in fill rate. When your declared
              tier and what the app observes disagree, the app keeps your choice
              and shows a soft note — it never silently overrules you.
            </SettingInfo>
          }
        >
          <p style={{ margin: 0, fontSize: 12, color: "var(--cp-text-muted)" }}>
            Sets which movement variations you&apos;re offered and how your
            loading progresses. Used by every program.
          </p>
          <TrainingExperienceAutoSave initial={experience} />

          <div
            style={{
              display: "grid",
              gap: 8,
              paddingTop: 14,
              borderTop: "1px solid var(--cp-border)",
            }}
            data-testid="settings-gender"
          >
            <div
              style={{
                fontFamily: "var(--cp-font-mono)",
                fontSize: 10,
                letterSpacing: "0.14em",
                textTransform: "uppercase",
                color: "var(--cp-text-muted)",
              }}
            >
              Strength standards
            </div>
            <p
              style={{ margin: 0, fontSize: 12, color: "var(--cp-text-muted)" }}
            >
              Sets sex-specific strength standards and the loads used for
              standardised race stations.
            </p>
            <GenderAutoSave initial={gender} />
            {gender == null && (
              <SettingNote>
                Not set — standards stay unisex until you choose.
              </SettingNote>
            )}
          </div>
        </SettingCard>

        <SettingCard
          id="units"
          eyebrow="Measurement"
          title="Units"
          value={units === "imperial" ? "lb / mi" : "kg / km"}
          testId="settings-card-units"
          info={
            <SettingInfo label="How units work" testId="settings-units-how">
              Display only. Everything is stored in metric and converted for
              display — switching never changes your logged numbers.
            </SettingInfo>
          }
        >
          <p style={{ margin: 0, fontSize: 12, color: "var(--cp-text-muted)" }}>
            Show weights and distances in kilograms and kilometres, or pounds
            and miles.
          </p>
          <div data-testid="settings-units">
            <UnitsAutoSave initialUnits={units} />
          </div>
        </SettingCard>

        <SettingCard
          id="identity"
          eyebrow="Identity"
          title="Display name"
          value={displayName || "Not set"}
          testId="settings-card-identity"
        >
          <p style={{ margin: 0, fontSize: 12, color: "var(--cp-text-muted)" }}>
            What the app calls you. Display only — it never affects programming.
          </p>
          <DisplayNameAutoSave initialDisplayName={displayName} />
        </SettingCard>

        <SettingCard
          id="training-windows"
          eyebrow="Scheduling"
          title="Training windows"
          value={`${amWindowStart} · ${pmWindowStart}`}
          testId="settings-card-training-windows"
          info={
            <SettingInfo
              label="How training windows work"
              testId="settings-windows-how"
            >
              When you train twice in a day, the app has to decide which
              session is the morning one and which is the evening one. These
              two times are how it decides. Each window covers two hours from
              the time you set.
            </SettingInfo>
          }
        >
          <p style={{ margin: 0, fontSize: 12, color: "var(--cp-text-muted)" }}>
            When your usual morning and evening sessions start.
          </p>
          <TrainingWindowsAutoSave
            initialAmStart={amWindowStart}
            initialPmStart={pmWindowStart}
          />
        </SettingCard>

        <SettingCard
          id="training-notes"
          eyebrow="Context"
          title="Training notes"
          value={trainingNotes ? "Written" : "Empty"}
          testId="settings-card-training-notes"
        >
          <p style={{ margin: 0, fontSize: 12, color: "var(--cp-text-muted)" }}>
            Anything worth remembering about how you train — what works, what
            flares up, what you want to keep an eye on.
          </p>
          <TrainingNotesEditor
            initialValue={trainingNotes}
            action={updateTrainingNotes}
          />
        </SettingCard>
      </div>
    </div>
  );
}
