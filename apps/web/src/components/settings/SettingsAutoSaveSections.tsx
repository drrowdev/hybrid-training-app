"use client";

/**
 * Per-section auto-save wrappers used by /app/settings.
 *
 * Each wrapper owns the inputs for one collapsible group on the
 * settings page, builds a `FormData` from the new value, and calls
 * the shared `updateProfile` server action (which already supports
 * partial updates — only the touched columns get written).
 *
 * No "Save" buttons here by design — fields commit on the contract
 * documented in each wrapper:
 *   - selects / radios / checkboxes  → commit on change
 *   - text / number inputs           → debounce 500ms + blur + Enter
 *   - time / date inputs             → commit on change
 *
 * The "Log weight" form on the same page stays explicit — logging a
 * bodyweight reading is a discrete action, not a config save.
 */
import { useCallback, useState } from "react";
import { updateProfile } from "@/lib/settings/actions";
import {
  AutoSaveCheckbox,
  AutoSaveDateField,
  AutoSaveNumberField,
  AutoSaveRadioGroup,
  AutoSaveSelect,
  AutoSaveTextField,
} from "./auto-save";

type TrainingExperience =
  | "beginner_lt_6m"
  | "novice_6m_2y"
  | "intermediate_2y_5y"
  | "advanced_5y_10y"
  | "highly_advanced_10y_plus";
type BodyCompPhase = "gain" | "maintain" | "lean_out";

async function saveField(name: string, value: string): Promise<void> {
  const fd = new FormData();
  fd.set(name, value);
  await updateProfile(fd);
}

async function saveCheckbox(name: string, value: boolean): Promise<void> {
  // The `updateProfile` action expects a *Present marker so it can
  // distinguish "checkbox cleared" from "checkbox not in this form".
  // Auto-save fires one field at a time, so always set the marker.
  const fd = new FormData();
  fd.set(`${name}Present`, "1");
  if (value) fd.set(name, "on");
  await updateProfile(fd);
}

// ─── Profile basics ──────────────────────────────────────────────────

const UNIT_OPTIONS = [
  { value: "metric", label: "kg / km" },
  { value: "imperial", label: "lb / mi" },
] as const;

export function ProfileBasicsAutoSave({
  initialDisplayName,
}: {
  initialDisplayName: string;
}) {
  const saveDisplayName = useCallback(
    (v: string) => saveField("displayName", v),
    [],
  );
  return (
    <div
      className="space-y-3 rounded-lg border border-foreground/10 p-4"
      data-testid="settings-profile-basics"
    >
      <AutoSaveTextField
        label="Display name"
        initial={initialDisplayName}
        save={saveDisplayName}
        testId="settings-display-name-input"
        inputProps={{ maxLength: 60, placeholder: "What should we call you?" }}
      />
    </div>
  );
}

// ─── Units (kg / lb · km / mi) ───────────────────────────────────────

export function UnitsAutoSave({
  initialUnits,
}: {
  initialUnits: "metric" | "imperial";
}) {
  const saveUnits = useCallback((v: string) => saveField("units", v), []);
  return (
    <div
      className="space-y-3 rounded-lg border border-foreground/10 p-4"
      data-testid="settings-units-form"
    >
      <AutoSaveSelect
        label="Units"
        initial={initialUnits}
        options={UNIT_OPTIONS}
        save={saveUnits}
        testId="settings-units-select"
      />
    </div>
  );
}

// ─── Body composition phase ──────────────────────────────────────────

const PHASE_OPTIONS = [
  { value: "maintain", label: "Maintain" },
  { value: "gain", label: "Gain (lean bulk)" },
  { value: "lean_out", label: "Lean out (cut)" },
] as const;

export function BodyCompPhaseAutoSave({
  initialPhase,
  initialStartedAt,
  initialTargetWeeks,
}: {
  initialPhase: BodyCompPhase;
  initialStartedAt: string;
  initialTargetWeeks: string;
}) {
  const savePhase = useCallback(
    (v: string) => saveField("bodyCompPhase", v),
    [],
  );
  const saveStartedAt = useCallback(
    (v: string) => saveField("phaseStartedAt", v),
    [],
  );
  const saveTargetWeeks = useCallback(
    (v: string) => saveField("phaseTargetWeeks", v),
    [],
  );
  return (
    <div
      className="space-y-3 rounded-lg border border-foreground/10 p-4"
      data-testid="settings-body-comp-phase"
    >
      <AutoSaveSelect
        label="Current phase"
        initial={initialPhase}
        options={PHASE_OPTIONS}
        save={savePhase}
        testId="settings-body-comp-phase-select"
      />
      <div className="grid grid-cols-2 gap-3">
        <AutoSaveDateField
          label="Started on"
          initial={initialStartedAt}
          save={saveStartedAt}
          testId="settings-phase-started-at"
        />
        <AutoSaveNumberField
          label="Target length (weeks)"
          initial={initialTargetWeeks}
          save={saveTargetWeeks}
          testId="settings-phase-target-weeks"
          inputProps={{ min: 1, max: 52, placeholder: "e.g. 10" }}
        />
      </div>
    </div>
  );
}

// ─── Training experience ─────────────────────────────────────────────

const EXPERIENCE_OPTIONS = [
  {
    value: "beginner_lt_6m" as const,
    label: "Beginner",
    hint: "New to training. <6 months. Still building the habit.",
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
    <div
      className="space-y-3 rounded-lg border border-foreground/10 p-4"
      data-testid="settings-training-experience-form"
    >
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

// ─── Effort / volume dial ────────────────────────────────────────────

type EffortPreference = "low" | "standard" | "high";

const EFFORT_PREFERENCE_OPTIONS = [
  {
    value: "low" as const,
    label: "Easier",
    hint: "Lower volume, more reps in reserve. Good when endurance work is heavy or you're managing fatigue.",
    testId: "settings-effort-low",
  },
  {
    value: "standard" as const,
    label: "Balanced",
    hint: "The default. Challenging but submaximal — concurrent-safe.",
    testId: "settings-effort-standard",
  },
  {
    value: "high" as const,
    label: "Harder",
    hint: "More accessory sets and closer to failure on muscle-building work. For when growth is the priority.",
    testId: "settings-effort-high",
  },
];

export function EffortPreferenceAutoSave({
  initial,
}: {
  initial: EffortPreference;
}) {
  const save = useCallback(
    (v: EffortPreference) => saveField("effortPreference", v),
    [],
  );
  return (
    <div
      className="space-y-3 rounded-lg border border-foreground/10 p-4"
      data-testid="settings-effort-preference-form"
    >
      <AutoSaveRadioGroup
        name="effortPreference"
        initial={initial}
        options={EFFORT_PREFERENCE_OPTIONS}
        save={save}
        statusTestIdSuffix="settings-effort"
      />
    </div>
  );
}

// ─── Session feedback (haptics + timer tone) ─────────────────────────

// ─── Daily recovery check-in ─────────────────────────────────────────
// Removed — the Today wellness check-in card was retired (see
// chore/retire-wellness-checkin). The `show_today_recovery_card`
// profile column stays in the DB for historic optionality, but the
// UI toggle has no surface to gate any more.
