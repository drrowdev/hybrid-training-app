import { redirect } from "next/navigation";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import {
  GenderAutoSave,
  TrainingExperienceAutoSave,
  UnitsAutoSave,
} from "@/components/settings/SettingsAutoSaveSections";
import { SettingCard, SettingNote } from "@/components/settings/SettingCard";
import { SettingInfo } from "@/components/settings/SettingInfo";
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
 *     pulled back top-end intensity.
 *   - Accessory volume was labelled global but only ever shifted 5/3/1
 *     assistance volume, so it moved into the 5/3/1 wizard's Loadout step.
 *
 * The display name is not repeated here either — it is click-to-edit on the
 * /app/profile identity header.
 */
export default async function ProfileSettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("units, gender, training_experience")
    .eq("id", user.id)
    .maybeSingle();

  const experience = asTrainingExperience(profile?.training_experience);
  const gender = (profile?.gender as "male" | "female" | null) ?? null;
  const units = profile?.units === "imperial" ? "imperial" : "metric";

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
      </div>
    </div>
  );
}
