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
import { useCallback } from "react";
import { updateProfile } from "@/lib/settings/actions";
import {
  AutoSaveCheckbox,
  AutoSaveDateField,
  AutoSaveNumberField,
  AutoSaveRadioGroup,
  AutoSaveSelect,
  AutoSaveTextField,
  AutoSaveTimeField,
} from "./auto-save";

type TrainingExperience = "lt_1y" | "1_3y" | "gte_3y";
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
  initialUnits,
}: {
  initialDisplayName: string;
  initialUnits: "metric" | "imperial";
}) {
  const saveDisplayName = useCallback(
    (v: string) => saveField("displayName", v),
    [],
  );
  const saveUnits = useCallback((v: string) => saveField("units", v), []);
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
    value: "lt_1y" as const,
    label: "≤ 1 year",
    hint: "Beginner · still building habits.",
    testId: "settings-experience-lt_1y",
  },
  {
    value: "1_3y" as const,
    label: "1–3 years",
    hint: "Intermediate · regular training, clear progress.",
    testId: "settings-experience-1_3y",
  },
  {
    value: "gte_3y" as const,
    label: "3+ years",
    hint: "Advanced · structured programming, plateau-aware.",
    testId: "settings-experience-gte_3y",
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
  // Default the radio to "lt_1y" visually when the user has nothing
  // declared yet — but mark nothing selected via data-selected.
  const seed: TrainingExperience = initial || "lt_1y";
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

// ─── Two-a-day toggle + windows ──────────────────────────────────────

export function TwoADayAutoSave({
  initialAllowsTwoADays,
  initialAmStart,
  initialPmStart,
}: {
  initialAllowsTwoADays: boolean;
  initialAmStart: string;
  initialPmStart: string;
}) {
  const saveEnabled = useCallback(
    (v: boolean) => saveCheckbox("allowsTwoADays", v),
    [],
  );
  const saveAm = useCallback(
    (v: string) => saveField("amWindowStart", v),
    [],
  );
  const savePm = useCallback(
    (v: string) => saveField("pmWindowStart", v),
    [],
  );
  return (
    <div
      className="rounded-lg border border-foreground/10 p-4 space-y-4"
      data-testid="settings-two-a-day"
    >
      <AutoSaveCheckbox
        label={
          <>
            Enable two-a-day sessions
            <span className="block text-xs text-foreground/60 mt-1">
              Currently {initialAllowsTwoADays ? "on" : "off"}.
            </span>
          </>
        }
        initial={initialAllowsTwoADays}
        save={saveEnabled}
        testId="settings-two-a-day-toggle"
      />
      <div className="grid grid-cols-2 gap-3 pt-2 border-t border-foreground/10">
        <AutoSaveTimeField
          label="AM session start"
          initial={initialAmStart}
          save={saveAm}
          testId="settings-am-window-start"
          inputProps={{ step: 300 }}
        />
        <AutoSaveTimeField
          label="PM session start"
          initial={initialPmStart}
          save={savePm}
          testId="settings-pm-window-start"
          inputProps={{ step: 300 }}
        />
      </div>
      <p className="text-xs text-foreground/60">
        Used as the default time-of-day shown on Today and Plan when you
        haven&apos;t set an explicit time on a session. Override per-session
        from the Plan page.
      </p>
    </div>
  );
}

// ─── Session feedback (haptics + timer tone) ─────────────────────────

export function FeedbackAutoSave({
  initialHaptics,
  initialTimerSound,
}: {
  initialHaptics: boolean;
  initialTimerSound: boolean;
}) {
  const saveHaptics = useCallback(
    (v: boolean) => saveCheckbox("hapticsEnabled", v),
    [],
  );
  const saveTimer = useCallback(
    (v: boolean) => saveCheckbox("timerSoundEnabled", v),
    [],
  );
  return (
    <div
      className="rounded-lg border border-foreground/10 p-4 space-y-3"
      data-testid="settings-feedback-form"
    >
      <AutoSaveCheckbox
        label={
          <>
            Haptic tick on set save
            <span className="block text-xs text-foreground/60 mt-1">
              A ~10ms vibration when a logged set commits. Web Vibration API.
            </span>
          </>
        }
        initial={initialHaptics}
        save={saveHaptics}
        testId="settings-haptics-toggle"
      />
      <AutoSaveCheckbox
        label={
          <>
            Rest-timer tone at zero
            <span className="block text-xs text-foreground/60 mt-1">
              A short 200ms beep when the auto rest timer hits zero. Web Audio
              API (gated by browser autoplay rules — needs a first user
              gesture).
            </span>
          </>
        }
        initial={initialTimerSound}
        save={saveTimer}
        testId="settings-timer-sound-toggle"
      />
    </div>
  );
}

// ─── Daily recovery check-in ─────────────────────────────────────────

export function RecoveryCheckinAutoSave({
  initialShow,
}: {
  initialShow: boolean;
}) {
  const save = useCallback(
    (v: boolean) => saveCheckbox("showTodayRecoveryCard", v),
    [],
  );
  return (
    <div
      className="rounded-lg border border-foreground/10 p-4 space-y-3"
      data-testid="settings-recovery-form"
    >
      <AutoSaveCheckbox
        label={
          <>
            Show on Today
            <span className="block text-xs text-foreground/60 mt-1">
              Inline fatigue + soreness scale (1 fresh · 9 wrecked). Writes to
              your daily wellness log.
            </span>
          </>
        }
        initial={initialShow}
        save={save}
        testId="settings-show-today-recovery-card-toggle"
      />
    </div>
  );
}
