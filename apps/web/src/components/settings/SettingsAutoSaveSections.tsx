"use client";

/**
 * Per-section auto-save wrappers used by /app/settings.
 *
 * Each wrapper owns the inputs for one card on the settings page, builds
 * a `FormData` from the new value, and calls the shared `updateProfile`
 * server action (which already supports partial updates — only the
 * touched columns get written).
 *
 * No "Save" buttons here by design — fields commit on the contract
 * documented in each wrapper:
 *   - radios / segments → commit on change
 *
 * The "Log weight" form on the same page stays explicit — logging a
 * bodyweight reading is a discrete action, not a config save.
 */
import { useCallback } from "react";
import { updateProfile } from "@/lib/settings/actions";
import {
  AutoSaveRadioGroup,
  AutoSaveSegmented,
  AutoSaveTextField,
  AutoSaveTimeField,
} from "./auto-save";

type TrainingExperience =
  | "beginner_lt_6m"
  | "novice_6m_2y"
  | "intermediate_2y_5y"
  | "advanced_5y_10y"
  | "highly_advanced_10y_plus";

async function saveField(name: string, value: string): Promise<void> {
  const fd = new FormData();
  fd.set(name, value);
  await updateProfile(fd);
}

// ─── Display name ────────────────────────────────────────────────────
// Back on the training-profile page. It had been dropped on the grounds
// that the name was click-to-edit on the /app/profile identity header —
// but that route had no inbound link anywhere in the app and has since
// been retired, which would have left the display name uneditable.

export function DisplayNameAutoSave({
  initialDisplayName,
}: {
  initialDisplayName: string;
}) {
  const save = useCallback((v: string) => saveField("displayName", v), []);
  return (
    <div data-testid="settings-profile-basics">
      <AutoSaveTextField
        label="Display name"
        initial={initialDisplayName}
        save={save}
        testId="settings-display-name-input"
        inputProps={{ maxLength: 60, placeholder: "What should we call you?" }}
      />
    </div>
  );
}

const UNIT_OPTIONS = [
  { value: "metric" as const, label: "kg / km" },
  { value: "imperial" as const, label: "lb / mi" },
];

// ─── Units (kg / lb · km / mi) ───────────────────────────────────────

export function UnitsAutoSave({
  initialUnits,
}: {
  initialUnits: "metric" | "imperial";
}) {
  const saveUnits = useCallback((v: string) => saveField("units", v), []);
  return (
    <div data-testid="settings-units-form">
      <AutoSaveSegmented
        name="units"
        legend="Units"
        initial={initialUnits}
        options={UNIT_OPTIONS}
        save={saveUnits}
        statusTestIdSuffix="settings-units"
      />
    </div>
  );
}

// ─── Gender (sex-specific race loads + strength-standard defaults) ───

const GENDER_OPTIONS = [
  { value: "male" as const, label: "Male", testId: "settings-gender-male" },
  { value: "female" as const, label: "Female", testId: "settings-gender-female" },
];

export function GenderAutoSave({
  initial,
}: {
  initial: "male" | "female" | null;
}) {
  const save = useCallback((v: string) => saveField("gender", v), []);
  return (
    <div data-testid="settings-gender-form">
      <AutoSaveSegmented
        name="gender"
        legend="Sex used for strength standards"
        initial={initial ?? ""}
        options={GENDER_OPTIONS}
        save={save}
        statusTestIdSuffix="settings-gender"
      />
    </div>
  );
}

// ─── Training experience ─────────────────────────────────────────────

const EXPERIENCE_OPTIONS = [
  {
    value: "beginner_lt_6m" as const,
    label: "Beginner",
    hint: "Under 6 months. Still building the habit.",
    testId: "settings-experience-beginner_lt_6m",
  },
  {
    value: "novice_6m_2y" as const,
    label: "Novice",
    hint: "6 months – 2 years. Consistent, learning the lifts.",
    testId: "settings-experience-novice_6m_2y",
  },
  {
    value: "intermediate_2y_5y" as const,
    label: "Intermediate",
    hint: "2 – 5 years. Programmed work, plateaus emerging.",
    testId: "settings-experience-intermediate_2y_5y",
  },
  {
    value: "advanced_5y_10y" as const,
    label: "Advanced",
    hint: "5 – 10 years. Needs structured waves and periodisation.",
    testId: "settings-experience-advanced_5y_10y",
  },
  {
    value: "highly_advanced_10y_plus" as const,
    label: "Highly advanced",
    hint: "10+ years. Long-term context, minimal noob gains.",
    testId: "settings-experience-highly_advanced_10y_plus",
  },
];

export function TrainingExperienceAutoSave({
  initial,
}: {
  initial: TrainingExperience | "";
}) {
  const save = useCallback(
    (v: TrainingExperience) => saveField("trainingExperience", v),
    [],
  );
  // Default the radio to "beginner_lt_6m" visually when the user has
  // nothing declared yet — but mark nothing selected via data-selected.
  const seed: TrainingExperience = initial || "beginner_lt_6m";
  return (
    <div data-testid="settings-training-experience-form">
      <AutoSaveRadioGroup
        name="trainingExperience"
        initial={seed}
        options={EXPERIENCE_OPTIONS}
        save={save}
        statusTestIdSuffix="settings-experience"
      />
    </div>
  );
}

// ─── Body composition phase ──────────────────────────────────────────
// Removed. `profiles.body_comp_phase` / `phase_started_at` /
// `phase_target_weeks` had no engine consumer — nothing in the planner
// ever read them, despite the UI claiming a cut pulled back top-end
// intensity. Migration 0131 drops all three columns and the enum.
// DC-Q2 / DC-T3 are ⏸ [BACKLOG] until a real consumer exists.

// ─── Effort / volume dial ────────────────────────────────────────────
// Removed. `profiles.effort_preference` was labelled "Accessory volume"
// and claimed to apply to every program. Its only live consumer was
// 5/3/1 assistance volume, which now collects the choice per block in
// the program wizard's Loadout step (see
// `@/lib/platform/assistance-volume`). The column is still read there as
// a fallback for deploys that carry no wizard value.
// Its other code path — the ADR 0016 hypertrophy effort anchor — only
// fires on `hypertrophy_anchor` blocks, and the Hybrid program hardwires
// `concurrent_hybrid`, so that path is unreachable.
// TODO: retire the column once no in-flight deploy relies on the fallback.

// ─── Session feedback (haptics + timer tone) ─────────────────────────

// ─── Two-a-day training windows ──────────────────────────────────────
// Absorbed from the retired /app/profile page. The Today page uses these
// to decide whether a session lands in the morning or evening slot; each
// window is stored as a 2-hour span derived from the start time.

export function TrainingWindowsAutoSave({
  initialAmStart,
  initialPmStart,
}: {
  initialAmStart: string;
  initialPmStart: string;
}) {
  const saveAm = useCallback((v: string) => saveField("amWindowStart", v), []);
  const savePm = useCallback((v: string) => saveField("pmWindowStart", v), []);
  return (
    <div
      className="grid grid-cols-2 gap-3"
      data-testid="settings-training-windows"
    >
      <AutoSaveTimeField
        label="Morning window starts"
        initial={initialAmStart}
        save={saveAm}
        testId="settings-am-window-start"
      />
      <AutoSaveTimeField
        label="Evening window starts"
        initial={initialPmStart}
        save={savePm}
        testId="settings-pm-window-start"
      />
    </div>
  );
}

// ─── Daily recovery check-in ─────────────────────────────────────────
// Removed — the Today wellness check-in card was retired (see
// chore/retire-wellness-checkin). The `show_today_recovery_card`
// profile column stays in the DB for historic optionality, but the
// UI toggle has no surface to gate any more.
