"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

type GoalId = "strength" | "hypertrophy" | "endurance" | "rebuild" | "explore";

type Goal = {
  id: GoalId;
  label: string;
  description: string;
  recommendedArchetypeId: string | null;
  recommendedArchetypeName: string | null;
  tmPercentDefault: number;
  recommendsTms: boolean;
};

const GOALS: Goal[] = [
  {
    id: "strength",
    label: "Build strength",
    description: "Heavy lifts, weekly intensity wave, classic 5/3/1-style peaking with deload.",
    recommendedArchetypeId: "strength_anchor",
    recommendedArchetypeName: "Strength Anchor",
    tmPercentDefault: 90,
    recommendsTms: true,
  },
  {
    id: "hypertrophy",
    label: "Build muscle",
    description: "Higher rep ranges (6–10), more working sets, moderate intensity (60–75% TM).",
    recommendedArchetypeId: "hypertrophy_anchor",
    recommendedArchetypeName: "Hypertrophy Anchor",
    tmPercentDefault: 90,
    recommendsTms: true,
  },
  {
    id: "endurance",
    label: "Build endurance",
    description: "Cardio-led week with polarized Z2 + VO2, two strength maintenance days to hold strength.",
    recommendedArchetypeId: "endurance_anchor",
    recommendedArchetypeName: "Endurance Anchor",
    tmPercentDefault: 90,
    recommendsTms: true,
  },
  {
    id: "rebuild",
    label: "Coming back from injury or layoff",
    description: "Capped intensity, slow-tempo tendon work, easy aerobic. Loads tissue safely.",
    recommendedArchetypeId: "rebuild",
    recommendedArchetypeName: "Rebuild",
    tmPercentDefault: 85,
    recommendsTms: true,
  },
  {
    id: "explore",
    label: "Just exploring",
    description: "Skip the recommendation. You can browse focuses or log freestyle sessions.",
    recommendedArchetypeId: null,
    recommendedArchetypeName: null,
    tmPercentDefault: 90,
    recommendsTms: false,
  },
];

type CanonicalLift = { slug: string; name: string };

const CANONICAL_LIFTS: CanonicalLift[] = [
  { slug: "back-squat-high-bar", name: "Back Squat (high-bar)" },
  { slug: "bench-press-flat", name: "Bench Press (flat)" },
  { slug: "conventional-deadlift", name: "Conventional Deadlift" },
  { slug: "ohp-standing", name: "Standing Overhead Press" },
];

type Payload = {
  displayName?: string;
  units?: "metric" | "imperial";
  trainingDaysPerWeek?: number;
  allowsTwoADays?: boolean;
  tmPercentDefault?: number;
  oneRmBySlug?: Record<string, number>;
};

const STEPS = ["Welcome", "About you", "Schedule", "Goal", "Training maxes", "Done"] as const;

export function OnboardingWizard({
  initialDisplayName,
  initialUnits,
  initialDaysPerWeek,
  initialAllowsTwoADays,
  completeAction,
  skipAction,
}: {
  initialDisplayName: string;
  initialUnits: "metric" | "imperial";
  initialDaysPerWeek: number;
  initialAllowsTwoADays: boolean;
  completeAction: (fd: FormData) => Promise<{ ok: true } | { ok: false; error: string }>;
  skipAction: () => Promise<void>;
}) {
  const router = useRouter();
  const [step, setStep] = useState(0);

  // Collected state.
  const [displayName, setDisplayName] = useState(initialDisplayName);
  const [units, setUnits] = useState<"metric" | "imperial">(initialUnits);
  const [daysPerWeek, setDaysPerWeek] = useState(initialDaysPerWeek);
  const [allowsTwoADays, setAllowsTwoADays] = useState(initialAllowsTwoADays);
  const [goalId, setGoalId] = useState<GoalId>("strength");
  const [oneRmBySlug, setOneRmBySlug] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const goal = useMemo(() => GOALS.find((g) => g.id === goalId) ?? GOALS[0]!, [goalId]);
  // If the user's goal doesn't recommend TMs, skip the TM step entirely.
  const visibleSteps = useMemo(
    () => (goal.recommendsTms ? STEPS : STEPS.filter((s) => s !== "Training maxes")),
    [goal.recommendsTms],
  );
  const currentStepLabel = visibleSteps[step] ?? "Done";

  const next = () => setStep((s) => Math.min(visibleSteps.length - 1, s + 1));
  const back = () => setStep((s) => Math.max(0, s - 1));

  const onSkip = () => {
    startTransition(async () => {
      await skipAction();
      // skipAction redirects on the server; this is a safety net.
      router.push("/app");
    });
  };

  const onComplete = (action: "start_block" | "browse" | "custom" | "later") => {
    setError(null);
    const oneRmNumeric: Record<string, number> = {};
    for (const [slug, raw] of Object.entries(oneRmBySlug)) {
      const n = Number(raw);
      if (Number.isFinite(n) && n > 0) oneRmNumeric[slug] = n;
    }
    const payload: Payload = {
      displayName: displayName.trim() || undefined,
      units,
      trainingDaysPerWeek: daysPerWeek,
      allowsTwoADays,
      tmPercentDefault: goal.tmPercentDefault,
      oneRmBySlug: Object.keys(oneRmNumeric).length > 0 ? oneRmNumeric : undefined,
    };
    const fd = new FormData();
    fd.set("payload", JSON.stringify(payload));
    startTransition(async () => {
      const result = await completeAction(fd);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      // Route based on what the user chose to do.
      if (action === "start_block" && goal.recommendedArchetypeId) {
        router.push("/app/plan/new");
      } else if (action === "browse") {
        router.push("/app/plan/new");
      } else if (action === "custom") {
        router.push("/app/plan/new/custom");
      } else {
        router.push("/app");
      }
      router.refresh();
    });
  };

  return (
    <div style={{ display: "grid", gap: 20, maxWidth: 720, margin: "0 auto", padding: "24px 16px" }}>
      {/* Header with progress + skip */}
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
          {visibleSteps.map((s, i) => (
            <span
              key={s}
              style={{
                width: i === step ? 24 : 8,
                height: 8,
                borderRadius: 999,
                background: i <= step ? "var(--cp-accent)" : "var(--cp-border)",
                transition: "width .15s, background .15s",
              }}
              aria-label={`Step ${i + 1} of ${visibleSteps.length}: ${s}`}
            />
          ))}
        </div>
        <button
          type="button"
          onClick={onSkip}
          disabled={isPending}
          className="cp-btn ghost"
          style={{ fontSize: 12, color: "var(--cp-text-muted)" }}
        >
          Skip setup →
        </button>
      </header>

      {/* Step bodies */}
      <main className="cp-card" style={{ padding: 28, display: "grid", gap: 18 }}>
        {currentStepLabel === "Welcome" && (
          <>
            <div>
              <div style={{ fontSize: 11, color: "var(--cp-text-muted)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                Welcome
              </div>
              <h1 style={{ fontSize: 26, margin: "4px 0 0", letterSpacing: "-0.01em" }}>
                Let&apos;s set you up in a few quick steps.
              </h1>
            </div>
            <p style={{ margin: 0, fontSize: 14, color: "var(--cp-text-muted)", lineHeight: 1.55 }}>
              We&apos;ll collect a bit about you, your training schedule, and your current goal — then
              recommend a training focus that fits. Takes ~2 minutes. Skip any time and configure things later in Settings.
            </p>
          </>
        )}

        {currentStepLabel === "About you" && (
          <>
            <Heading kicker="Step 2" title="About you" />
            <div style={{ display: "grid", gap: 12 }}>
              <div>
                <Label>Display name (optional)</Label>
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  maxLength={60}
                  placeholder="What should we call you?"
                  style={{ width: "100%", padding: "8px 10px", fontSize: 14, marginTop: 4 }}
                />
              </div>
              <div>
                <Label>Units</Label>
                <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                  {(["metric", "imperial"] as const).map((u) => {
                    const sel = u === units;
                    return (
                      <button
                        type="button"
                        key={u}
                        onClick={() => setUnits(u)}
                        aria-pressed={sel}
                        style={pillStyle(sel)}
                      >
                        {u === "metric" ? "kg / km" : "lb / mi"}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </>
        )}

        {currentStepLabel === "Schedule" && (
          <>
            <Heading kicker="Step 3" title="How often can you train?" />
            <p style={{ margin: 0, fontSize: 13, color: "var(--cp-text-muted)", lineHeight: 1.5 }}>
              Pick the number of days per week you can realistically commit to. We&apos;ll shape the
              focus suggestions to fit. Change this any time in Settings.
            </p>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {[3, 4, 5, 6, 7].map((n) => {
                const sel = n === daysPerWeek;
                return (
                  <button
                    type="button"
                    key={n}
                    onClick={() => setDaysPerWeek(n)}
                    aria-pressed={sel}
                    style={{ ...pillStyle(sel), padding: "10px 18px" }}
                  >
                    {n} d/wk
                  </button>
                );
              })}
            </div>
            <label
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 10,
                marginTop: 8,
                padding: "12px 14px",
                border: "1px solid var(--cp-border)",
                borderRadius: 10,
                background: "var(--cp-surface-soft)",
                cursor: "pointer",
              }}
            >
              <input
                type="checkbox"
                checked={allowsTwoADays}
                onChange={(e) => setAllowsTwoADays(e.target.checked)}
                style={{ marginTop: 3 }}
              />
              <span style={{ display: "grid", gap: 4 }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>
                  I&apos;m open to occasional two-a-day sessions
                </span>
                <span style={{ fontSize: 12, color: "var(--cp-text-muted)", lineHeight: 1.5 }}>
                  Typical hybrid pattern: AM lift + PM cardio, ideally 6+ hours apart. We&apos;re just
                  capturing your preference — full two-a-day planning lands in a future update.
                </span>
              </span>
            </label>
          </>
        )}

        {currentStepLabel === "Goal" && (
          <>
            <Heading kicker="Step 4" title="What are you training for right now?" />
            <p style={{ margin: 0, fontSize: 13, color: "var(--cp-text-muted)", lineHeight: 1.5 }}>
              Pick the closest match. You can change focus between blocks — this just seeds your first one.
            </p>
            <div style={{ display: "grid", gap: 8 }}>
              {GOALS.map((g) => {
                const sel = g.id === goalId;
                return (
                  <button
                    type="button"
                    key={g.id}
                    onClick={() => setGoalId(g.id)}
                    aria-pressed={sel}
                    style={{
                      textAlign: "left",
                      padding: 14,
                      borderRadius: 12,
                      border: `1px solid ${sel ? "var(--cp-accent)" : "var(--cp-border)"}`,
                      background: sel ? "var(--cp-accent-soft)" : "var(--cp-surface)",
                      color: "var(--cp-text)",
                      cursor: "pointer",
                      display: "grid",
                      gap: 4,
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                      <div style={{ fontSize: 14, fontWeight: 600 }}>{g.label}</div>
                      {g.recommendedArchetypeName && (
                        <span className="cp-pill" style={{ fontSize: 10 }}>{g.recommendedArchetypeName}</span>
                      )}
                    </div>
                    <div style={{ fontSize: 12, color: "var(--cp-text-muted)", lineHeight: 1.45 }}>
                      {g.description}
                    </div>
                  </button>
                );
              })}
            </div>
          </>
        )}

        {currentStepLabel === "Training maxes" && (
          <>
            <Heading kicker="Step 5" title="Your main-lift maxes" />
            <p style={{ margin: 0, fontSize: 13, color: "var(--cp-text-muted)", lineHeight: 1.5 }}>
              Enter your 1RM for each lift you want the planner to schedule. We&apos;ll apply a default
              TM% of <strong>{goal.tmPercentDefault}%</strong> to get the working training max. Skip any
              you don&apos;t do. You can pick different variants (front squat, trap-bar, push press, etc.)
              in Settings later — these are just the canonical defaults.
            </p>
            <div style={{ display: "grid", gap: 10 }}>
              {CANONICAL_LIFTS.map((l) => (
                <div
                  key={l.slug}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 110px",
                    gap: 10,
                    alignItems: "center",
                  }}
                >
                  <div style={{ fontSize: 14, fontWeight: 500 }}>{l.name}</div>
                  <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                    <input
                      type="number"
                      value={oneRmBySlug[l.slug] ?? ""}
                      onChange={(e) =>
                        setOneRmBySlug((prev) => ({ ...prev, [l.slug]: e.target.value }))
                      }
                      placeholder="1RM"
                      step="0.5"
                      min="1"
                      max="1000"
                      inputMode="decimal"
                      aria-label={`${l.name} 1RM`}
                      className="mono"
                      style={{ width: 80, padding: "8px 8px", fontSize: 14, textAlign: "right" }}
                    />
                    <span style={{ fontSize: 11, color: "var(--cp-text-muted)" }}>kg</span>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {currentStepLabel === "Done" && (
          <>
            <Heading kicker="All set" title={goal.recommendedArchetypeName ? `We recommend: ${goal.recommendedArchetypeName}` : "You're ready"} />
            {goal.recommendedArchetypeName ? (
              <p style={{ margin: 0, fontSize: 14, color: "var(--cp-text-muted)", lineHeight: 1.5 }}>
                Based on your goal of <strong>{goal.label.toLowerCase()}</strong> and {daysPerWeek} training days/week,
                <strong> {goal.recommendedArchetypeName}</strong> is the best fit. You can also browse the other
                focuses or build your own — your TMs are saved either way.
              </p>
            ) : (
              <p style={{ margin: 0, fontSize: 14, color: "var(--cp-text-muted)", lineHeight: 1.5 }}>
                You can log freestyle sessions from the Today tab, or browse focuses from the Plan tab when
                you&apos;re ready to start one.
              </p>
            )}
            {error && (
              <div
                role="alert"
                style={{
                  fontSize: 13,
                  color: "var(--cp-danger)",
                  padding: "10px 12px",
                  borderRadius: 10,
                  border: "1px solid var(--cp-danger)",
                  background: "color-mix(in oklab, var(--cp-danger) 8%, transparent)",
                }}
              >
                Couldn&apos;t finish setup: {error}
              </div>
            )}
            <div style={{ display: "grid", gap: 8, marginTop: 4 }}>
              {goal.recommendedArchetypeId && (
                <button
                  type="button"
                  onClick={() => onComplete("start_block")}
                  className="cp-btn primary big"
                  disabled={isPending}
                >
                  {isPending ? "Saving…" : `⚡ Start ${goal.recommendedArchetypeName} block →`}
                </button>
              )}
              <button
                type="button"
                onClick={() => onComplete("browse")}
                className="cp-btn"
                disabled={isPending}
              >
                Browse all focuses
              </button>
              <button
                type="button"
                onClick={() => onComplete("custom")}
                className="cp-btn"
                disabled={isPending}
              >
                Build a custom block
              </button>
              <button
                type="button"
                onClick={() => onComplete("later")}
                className="cp-btn ghost"
                disabled={isPending}
              >
                Set up a block later
              </button>
            </div>
          </>
        )}

        {/* Footer nav for steps that aren't Done */}
        {currentStepLabel !== "Done" && (
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8 }}>
            <button
              type="button"
              onClick={back}
              className="cp-btn ghost"
              disabled={step === 0 || isPending}
              style={{ visibility: step === 0 ? "hidden" : "visible" }}
            >
              ← Back
            </button>
            <button
              type="button"
              onClick={next}
              className="cp-btn primary"
              disabled={isPending}
            >
              Next →
            </button>
          </div>
        )}
      </main>

      <div style={{ textAlign: "center" }}>
        <Link href="/login" style={{ fontSize: 11, color: "var(--cp-text-muted)" }}>
          Sign out
        </Link>
      </div>
    </div>
  );
}

function Heading({ kicker, title }: { kicker: string; title: string }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: "var(--cp-text-muted)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
        {kicker}
      </div>
      <h2 style={{ fontSize: 22, margin: "4px 0 0", letterSpacing: "-0.01em" }}>{title}</h2>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <span style={{ fontSize: 11, color: "var(--cp-text-muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
      {children}
    </span>
  );
}

function pillStyle(selected: boolean): React.CSSProperties {
  return {
    padding: "8px 16px",
    borderRadius: 999,
    border: `1px solid ${selected ? "var(--cp-accent)" : "var(--cp-border)"}`,
    background: selected ? "var(--cp-accent-soft)" : "var(--cp-surface)",
    color: selected ? "var(--cp-accent)" : "var(--cp-text)",
    fontWeight: selected ? 600 : 500,
    fontSize: 13,
    cursor: "pointer",
  };
}
