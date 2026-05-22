"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import {
  BlockWizard,
  type TmReadinessByArchetype,
  type WizardSubmit,
} from "@/components/planner/BlockWizard";
import {
  ARCHETYPES,
  STRENGTH_ROLE_LABELS,
  effectiveDays,
  type ArchetypeId,
  type StrengthRole,
} from "@/lib/planner/archetypes";
import { seedDefaultOneRm } from "@/lib/training-maxes/defaults";

// ── Types coming in from the server page ─────────────────────────────────

export type RoleCandidates = {
  role: StrengthRole;
  label: string;
  candidates: { slug: string; displayName: string }[];
};

type OnboardingResult = { ok: true } | { ok: false; error: string };

type ProfilePayload = {
  displayName?: string | null;
  units?: "metric" | "imperial";
  trainingExperience?: TrainingExperience;
  bodyweightKg?: number;
};

type TrainingExperience = "lt_1y" | "1_3y" | "gte_3y";

const EXPERIENCE_OPTIONS: { id: TrainingExperience; label: string; hint: string }[] = [
  { id: "lt_1y", label: "≤ 1 year", hint: "New or returning — starts on the consumer load tier." },
  { id: "1_3y", label: "1–3 years", hint: "Past the novice phase, recovers fine from normal weeks." },
  { id: "gte_3y", label: "3+ years", hint: "Experienced — knows their lifts and how to push them." },
];

const STEPS = ["Welcome", "Profile", "Training maxes", "Build your block", "Confirm"] as const;
type StepLabel = (typeof STEPS)[number];

const MAIN_ROLES: StrengthRole[] = ["squat", "horizontal_press", "deadlift", "vertical_press"];

// ── Component ─────────────────────────────────────────────────────────────

export function OnboardingWizard({
  initialDisplayName,
  initialUnits,
  initialBodyweightKg,
  roleCandidates,
  saveProfileAction,
  saveTmsAction,
  finishAction,
  skipAction,
}: {
  initialDisplayName: string;
  initialUnits: "metric" | "imperial";
  initialBodyweightKg: number | null;
  roleCandidates: RoleCandidates[];
  saveProfileAction: (fd: FormData) => Promise<OnboardingResult>;
  saveTmsAction: (fd: FormData) => Promise<OnboardingResult>;
  finishAction: (fd: FormData) => Promise<OnboardingResult>;
  skipAction: () => Promise<void>;
}) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Step 2 state
  const [displayName, setDisplayName] = useState(initialDisplayName);
  const [units, setUnits] = useState<"metric" | "imperial">(initialUnits);
  const [trainingExperience, setTrainingExperience] = useState<TrainingExperience | null>(null);
  const [bodyweightKg, setBodyweightKg] = useState<string>(
    initialBodyweightKg != null ? String(initialBodyweightKg) : "",
  );

  // Step 3 state — per-role variant slug + per-slug 1RM string + per-role mode.
  type RoleMode = "enter" | "seed" | "skip";
  const [variantByRole, setVariantByRole] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const g of roleCandidates) {
      if (g.candidates[0]) init[g.role] = g.candidates[0].slug;
    }
    return init;
  });
  const [oneRmBySlug, setOneRmBySlug] = useState<Record<string, string>>({});
  const [modeByRole, setModeByRole] = useState<Record<string, RoleMode>>(() => {
    const init: Record<string, RoleMode> = {};
    for (const g of roleCandidates) init[g.role] = "enter";
    return init;
  });

  // Step 4 state — the BlockWizard fills this in on its "Start" click.
  const [wizardSubmit, setWizardSubmit] = useState<WizardSubmit | null>(null);

  // Step 5 state — start date.
  const [startedOn, setStartedOn] = useState<string>(() => tomorrowYmd());

  // ── Derived: role → ready (used by BlockWizard TM gate) ───────────────
  // A role is "ready" if either the user entered/seeded a 1RM for one of
  // its candidate slugs.
  const readyRoles = useMemo<Set<StrengthRole>>(() => {
    const ready = new Set<StrengthRole>();
    for (const g of roleCandidates) {
      const mode = modeByRole[g.role] ?? "enter";
      if (mode === "skip") continue;
      const hasAny = g.candidates.some((c) => {
        const raw = oneRmBySlug[c.slug];
        if (raw == null || raw === "") return false;
        const n = Number(raw);
        return Number.isFinite(n) && n > 0;
      });
      if (hasAny) ready.add(g.role);
    }
    return ready;
  }, [modeByRole, oneRmBySlug, roleCandidates]);

  const tmReadinessByArchetype = useMemo<TmReadinessByArchetype>(() => {
    const ids: Exclude<ArchetypeId, "custom">[] = [
      "strength_anchor",
      "endurance_anchor",
      "concurrent_hybrid",
      "hypertrophy_anchor",
      "maintenance",
      "rebuild",
    ];
    return Object.fromEntries(
      ids.map((id) => {
        const archetype = ARCHETYPES[id];
        const pool = effectiveDays(archetype, false);
        const rolesSeen = new Set<StrengthRole>();
        for (const day of pool) {
          if (day.kind !== "strength") continue;
          rolesSeen.add(day.role);
        }
        const missingRoles: string[] = [];
        for (const r of rolesSeen) {
          if (!readyRoles.has(r)) missingRoles.push(STRENGTH_ROLE_LABELS[r]);
        }
        return [id, { ready: missingRoles.length === 0, missingRoles }];
      }),
    ) as TmReadinessByArchetype;
  }, [readyRoles]);

  // ── Step gating ───────────────────────────────────────────────────────

  const currentLabel: StepLabel = STEPS[step] ?? "Welcome";

  const canAdvance = (): string | null => {
    switch (currentLabel) {
      case "Welcome":
        return null;
      case "Profile":
        if (trainingExperience == null) return "Pick your training experience to continue.";
        return null;
      case "Training maxes": {
        // Allow continue when at least one role is ready OR all roles are skipped.
        const anyReady = readyRoles.size > 0;
        const allSkipped = MAIN_ROLES.every((r) => modeByRole[r] === "skip");
        if (!anyReady && !allSkipped)
          return "Enter or seed a 1RM for at least one lift, or skip them all.";
        return null;
      }
      case "Build your block":
        if (!wizardSubmit) return "Finish the block wizard to continue.";
        return null;
      case "Confirm":
        return null;
    }
    return null;
  };

  // ── Per-step actions ──────────────────────────────────────────────────

  const goNext = () => {
    const reason = canAdvance();
    if (reason) {
      setError(reason);
      return;
    }
    setError(null);

    if (currentLabel === "Profile") {
      saveProfile(() => setStep((s) => s + 1));
      return;
    }
    if (currentLabel === "Training maxes") {
      saveTms(() => setStep((s) => s + 1));
      return;
    }
    setStep((s) => Math.min(STEPS.length - 1, s + 1));
  };

  const goBack = () => {
    setError(null);
    setStep((s) => Math.max(0, s - 1));
  };

  const saveProfile = (after: () => void) => {
    const payload: ProfilePayload = {
      displayName: displayName.trim() || null,
      units,
      trainingExperience: trainingExperience ?? undefined,
      bodyweightKg: bodyweightKg ? Number(bodyweightKg) : undefined,
    };
    const fd = new FormData();
    fd.set("payload", JSON.stringify(payload));
    startTransition(async () => {
      const r = await saveProfileAction(fd);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      after();
    });
  };

  const saveTms = (after: () => void) => {
    const oneRmNumeric: Record<string, number> = {};
    const bwNumber = bodyweightKg ? Number(bodyweightKg) : null;

    for (const g of roleCandidates) {
      const mode = modeByRole[g.role] ?? "enter";
      if (mode === "skip") continue;
      const slug = variantByRole[g.role] ?? g.candidates[0]?.slug;
      if (!slug) continue;
      if (mode === "seed") {
        oneRmNumeric[slug] = seedDefaultOneRm({
          role: g.role,
          bodyweightKg: bwNumber,
          sex: null,
        });
        continue;
      }
      // mode === "enter"
      const raw = oneRmBySlug[slug];
      if (raw == null || raw === "") continue;
      const n = Number(raw);
      if (Number.isFinite(n) && n > 0) oneRmNumeric[slug] = n;
    }
    if (Object.keys(oneRmNumeric).length === 0) {
      after();
      return;
    }
    const fd = new FormData();
    fd.set("payload", JSON.stringify({ oneRmBySlug: oneRmNumeric }));
    startTransition(async () => {
      const r = await saveTmsAction(fd);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      after();
    });
  };

  // BlockWizard's onComplete: capture the submit and advance to confirm.
  const onWizardComplete = async (submit: WizardSubmit): Promise<OnboardingResult> => {
    setWizardSubmit(submit);
    setStep(STEPS.indexOf("Confirm"));
    return { ok: true };
  };

  const onConfirm = () => {
    if (!wizardSubmit) {
      setError("Block details missing — go back and re-run the block wizard.");
      return;
    }
    const fd = new FormData();
    fd.set("archetype", wizardSubmit.archetypeId);
    fd.set("startedOn", startedOn);
    fd.set("daysPerWeek", String(wizardSubmit.daysPerWeek));
    fd.set("dayIndexOverrides", JSON.stringify(wizardSubmit.dayIndexOverrides));
    startTransition(async () => {
      const r = await finishAction(fd);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      router.push("/app");
      router.refresh();
    });
  };

  const onSkip = () => {
    startTransition(async () => {
      await skipAction();
      router.push("/app");
    });
  };

  // ── Render ────────────────────────────────────────────────────────────

  return (
    <div style={{ display: "grid", gap: 20 }}>
      <header className="ob-header" style={headerStyle}>
        <ProgressPills total={STEPS.length} current={step} labels={STEPS} />
        <button
          type="button"
          onClick={onSkip}
          disabled={pending}
          className="cp-btn ghost"
          style={{ fontSize: 12, color: "var(--cp-text-muted)" }}
        >
          Skip for now →
        </button>
      </header>

      <main className="cp-card ob-card" style={{ padding: 28, display: "grid", gap: 18 }}>
        {currentLabel === "Welcome" && (
          <WelcomeStep />
        )}

        {currentLabel === "Profile" && (
          <ProfileStep
            displayName={displayName}
            setDisplayName={setDisplayName}
            units={units}
            setUnits={setUnits}
            trainingExperience={trainingExperience}
            setTrainingExperience={setTrainingExperience}
            bodyweightKg={bodyweightKg}
            setBodyweightKg={setBodyweightKg}
          />
        )}

        {currentLabel === "Training maxes" && (
          <TmStep
            roleCandidates={roleCandidates}
            variantByRole={variantByRole}
            setVariantByRole={setVariantByRole}
            oneRmBySlug={oneRmBySlug}
            setOneRmBySlug={setOneRmBySlug}
            modeByRole={modeByRole}
            setModeByRole={setModeByRole}
            bodyweightKg={bodyweightKg ? Number(bodyweightKg) : null}
            units={units}
          />
        )}

        {currentLabel === "Build your block" && (
          <div style={{ display: "grid", gap: 12 }}>
            <Heading kicker="Step 4" title="Build your first block" />
            <p style={{ margin: 0, fontSize: 13, color: "var(--cp-text-muted)", lineHeight: 1.55 }}>
              The wizard below shapes a week from your goals and your TMs. Start with 3 or 4
              days/week if you&apos;re unsure — you can rebuild any time. The &quot;Why this match?&quot;
              section explains the science behind each suggestion.
            </p>
            <BlockWizard
              onComplete={onWizardComplete}
              tmReadinessByArchetype={tmReadinessByArchetype}
              allowsTwoADays={false}
            />
          </div>
        )}

        {currentLabel === "Confirm" && wizardSubmit && (
          <ConfirmStep
            startedOn={startedOn}
            setStartedOn={setStartedOn}
            wizardSubmit={wizardSubmit}
          />
        )}

        {error && (
          <div role="alert" style={errorBoxStyle}>
            {error}
          </div>
        )}

        {currentLabel !== "Build your block" && (
          <div className="ob-nav" style={navRowStyle}>
            <button
              type="button"
              onClick={goBack}
              className="cp-btn ghost"
              disabled={step === 0 || pending}
              style={{ visibility: step === 0 ? "hidden" : "visible" }}
            >
              ← Back
            </button>
            {currentLabel === "Confirm" ? (
              <button
                type="button"
                onClick={onConfirm}
                className="cp-btn primary"
                disabled={pending}
              >
                {pending ? "Creating block…" : "Start training →"}
              </button>
            ) : (
              <button
                type="button"
                onClick={goNext}
                className="cp-btn primary"
                disabled={pending || canAdvance() != null}
              >
                {pending ? "Saving…" : "Continue →"}
              </button>
            )}
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

// ── Sub-views ─────────────────────────────────────────────────────────────

function WelcomeStep() {
  return (
    <>
      <div>
        <div style={kickerStyle}>Welcome</div>
        <h1 style={{ fontSize: 28, margin: "4px 0 0", letterSpacing: "-0.01em" }}>
          Build a training week that fits your life.
        </h1>
      </div>
      <p style={{ margin: 0, fontSize: 14, color: "var(--cp-text-muted)", lineHeight: 1.6 }}>
        We&apos;ll capture a bit about you, your main-lift maxes, then walk through a block-shaping
        wizard that fits strength + cardio into the days you have. Takes about three minutes.
        Skip any step you&apos;re not ready for — your progress is saved as you go.
      </p>
    </>
  );
}

function ProfileStep({
  displayName,
  setDisplayName,
  units,
  setUnits,
  trainingExperience,
  setTrainingExperience,
  bodyweightKg,
  setBodyweightKg,
}: {
  displayName: string;
  setDisplayName: (s: string) => void;
  units: "metric" | "imperial";
  setUnits: (u: "metric" | "imperial") => void;
  trainingExperience: TrainingExperience | null;
  setTrainingExperience: (e: TrainingExperience) => void;
  bodyweightKg: string;
  setBodyweightKg: (s: string) => void;
}) {
  return (
    <>
      <Heading kicker="Step 2" title="A bit about you" />
      <div style={{ display: "grid", gap: 14 }}>
        <div>
          <Label>Display name (optional)</Label>
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            maxLength={60}
            placeholder="What should we call you?"
            style={inputStyle}
          />
        </div>

        <div>
          <Label>Units</Label>
          <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
            {(["metric", "imperial"] as const).map((u) => (
              <button
                type="button"
                key={u}
                onClick={() => setUnits(u)}
                aria-pressed={u === units}
                style={pillStyle(u === units)}
              >
                {u === "metric" ? "kg / km" : "lb / mi"}
              </button>
            ))}
          </div>
        </div>

        <div>
          <Label>Bodyweight (optional)</Label>
          <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 6 }}>
            <input
              type="number"
              value={bodyweightKg}
              onChange={(e) => setBodyweightKg(e.target.value)}
              min="20"
              max="400"
              step="0.5"
              inputMode="decimal"
              placeholder="—"
              className="mono"
              style={{ ...inputStyle, width: 120 }}
            />
            <span style={{ fontSize: 12, color: "var(--cp-text-muted)" }}>
              {units === "metric" ? "kg" : "lb"} · used only to seed conservative TM defaults if you
              don&apos;t know yours.
            </span>
          </div>
        </div>

        <div>
          <Label>Training experience</Label>
          <p style={{ margin: "4px 0 8px", fontSize: 12, color: "var(--cp-text-muted)" }}>
            Drives the cold-start tier on your first block (DC-G5).
          </p>
          <div style={{ display: "grid", gap: 8 }}>
            {EXPERIENCE_OPTIONS.map((opt) => {
              const sel = opt.id === trainingExperience;
              return (
                <button
                  type="button"
                  key={opt.id}
                  onClick={() => setTrainingExperience(opt.id)}
                  aria-pressed={sel}
                  style={cardOptionStyle(sel)}
                >
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{opt.label}</div>
                  <div style={{ fontSize: 12, color: "var(--cp-text-muted)", lineHeight: 1.45 }}>
                    {opt.hint}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </>
  );
}

function TmStep({
  roleCandidates,
  variantByRole,
  setVariantByRole,
  oneRmBySlug,
  setOneRmBySlug,
  modeByRole,
  setModeByRole,
  bodyweightKg,
  units,
}: {
  roleCandidates: RoleCandidates[];
  variantByRole: Record<string, string>;
  setVariantByRole: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  oneRmBySlug: Record<string, string>;
  setOneRmBySlug: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  modeByRole: Record<string, "enter" | "seed" | "skip">;
  setModeByRole: React.Dispatch<React.SetStateAction<Record<string, "enter" | "seed" | "skip">>>;
  bodyweightKg: number | null;
  units: "metric" | "imperial";
}) {
  return (
    <>
      <Heading kicker="Step 3" title="Your main-lift maxes" />
      <p style={{ margin: 0, fontSize: 13, color: "var(--cp-text-muted)", lineHeight: 1.55 }}>
        Enter your 1RM for each of the four main lifts, pick a conservative seed if you&apos;re
        not sure, or skip a lift entirely. You can update everything later in Settings.
      </p>

      <div style={{ display: "grid", gap: 12 }}>
        {roleCandidates.map((g) => {
          const mode = modeByRole[g.role] ?? "enter";
          const selectedSlug = variantByRole[g.role] ?? g.candidates[0]?.slug;
          if (!selectedSlug || g.candidates.length === 0) return null;
          const seedPreview = seedDefaultOneRm({
            role: g.role,
            bodyweightKg,
            sex: null,
          });

          return (
            <div key={g.role} style={tmCardStyle(mode)}>
              <div className="ob-tm-card-row" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <Label>{g.label}</Label>
                <div className="ob-tm-mode-row" style={{ display: "flex", gap: 4 }}>
                  {(["enter", "seed", "skip"] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setModeByRole((p) => ({ ...p, [g.role]: m }))}
                      aria-pressed={m === mode}
                      style={miniPillStyle(m === mode)}
                    >
                      {m === "enter"
                        ? "Enter"
                        : m === "seed"
                          ? "I don\u2019t know yet"
                          : "Skip"}
                    </button>
                  ))}
                </div>
              </div>

              {mode === "enter" && (
                <div
                  className="ob-tm-input-row"
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 110px",
                    gap: 10,
                    alignItems: "center",
                    marginTop: 8,
                  }}
                >
                  <select
                    value={selectedSlug}
                    onChange={(e) => {
                      const newSlug = e.target.value;
                      setVariantByRole((prev) => {
                        const prevSlug = prev[g.role];
                        if (prevSlug && prevSlug !== newSlug) {
                          setOneRmBySlug((rmPrev) => {
                            const carried = rmPrev[prevSlug];
                            if (carried == null) return rmPrev;
                            const rest = { ...rmPrev };
                            delete rest[prevSlug];
                            return { ...rest, [newSlug]: carried };
                          });
                        }
                        return { ...prev, [g.role]: newSlug };
                      });
                    }}
                    aria-label={`${g.label} variant`}
                    style={selectStyle}
                  >
                    {g.candidates.map((c) => (
                      <option key={c.slug} value={c.slug}>
                        {c.displayName}
                      </option>
                    ))}
                  </select>
                  <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                    <input
                      type="number"
                      value={oneRmBySlug[selectedSlug] ?? ""}
                      onChange={(e) =>
                        setOneRmBySlug((prev) => ({ ...prev, [selectedSlug]: e.target.value }))
                      }
                      placeholder="1RM"
                      step="0.5"
                      min="1"
                      max="1000"
                      inputMode="decimal"
                      aria-label={`${g.label} 1RM`}
                      className="mono"
                      style={{ width: 80, padding: "8px 8px", fontSize: 14, textAlign: "right" }}
                    />
                    <span style={{ fontSize: 11, color: "var(--cp-text-muted)" }}>
                      {units === "metric" ? "kg" : "lb"}
                    </span>
                  </div>
                </div>
              )}

              {mode === "seed" && (
                <p style={{ margin: "8px 0 0", fontSize: 12, color: "var(--cp-text-muted)", lineHeight: 1.5 }}>
                  We&apos;ll seed{" "}
                  <strong className="mono">
                    {seedPreview} {units === "metric" ? "kg" : "kg"}
                  </strong>{" "}
                  as a conservative starting TM. Recalibrate from Settings after a few sessions.
                </p>
              )}

              {mode === "skip" && (
                <p style={{ margin: "8px 0 0", fontSize: 12, color: "var(--cp-text-muted)", lineHeight: 1.5 }}>
                  No TM saved. Blocks that need this role will warn you before starting.
                </p>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

function ConfirmStep({
  startedOn,
  setStartedOn,
  wizardSubmit,
}: {
  startedOn: string;
  setStartedOn: (s: string) => void;
  wizardSubmit: WizardSubmit;
}) {
  const today = todayYmd();
  const tomorrow = tomorrowYmd();
  const nextMonday = nextMondayYmd();

  const presets: { id: string; label: string; date: string }[] = [
    { id: "today", label: "Today", date: today },
    { id: "tomorrow", label: "Tomorrow", date: tomorrow },
    { id: "next_monday", label: "Next Monday", date: nextMonday },
  ];

  return (
    <>
      <Heading kicker="Step 5" title="When does your first block start?" />
      <p style={{ margin: 0, fontSize: 13, color: "var(--cp-text-muted)", lineHeight: 1.55 }}>
        Your first <strong>{wizardSubmit.daysPerWeek}-day</strong> block is ready. Pick a start
        date and we&apos;ll create the calendar.
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {presets.map((p) => (
          <button
            type="button"
            key={p.id}
            onClick={() => setStartedOn(p.date)}
            aria-pressed={p.date === startedOn}
            style={pillStyle(p.date === startedOn)}
          >
            {p.label}
          </button>
        ))}
      </div>
      <div>
        <Label>Or pick a custom date</Label>
        <input
          type="date"
          value={startedOn}
          min={today}
          onChange={(e) => setStartedOn(e.target.value)}
          style={{ ...inputStyle, marginTop: 4, width: 220 }}
        />
      </div>
    </>
  );
}

// ── Shared bits ───────────────────────────────────────────────────────────

function ProgressPills({
  total,
  current,
  labels,
}: {
  total: number;
  current: number;
  labels: readonly string[];
}) {
  return (
    <div className="ob-progress" style={{ display: "flex", gap: 4, alignItems: "center" }}>
      {Array.from({ length: total }).map((_, i) => (
        <span
          key={i}
          aria-label={`Step ${i + 1} of ${total}: ${labels[i]}`}
          style={{
            width: i === current ? 28 : 8,
            height: 8,
            borderRadius: 999,
            background: i <= current ? "var(--cp-accent)" : "var(--cp-border)",
            transition: "width .15s, background .15s",
            display: "inline-block",
            flexShrink: 0,
          }}
        />
      ))}
    </div>
  );
}

function Heading({ kicker, title }: { kicker: string; title: string }) {
  return (
    <div>
      <div style={kickerStyle}>{kicker}</div>
      <h2 style={{ fontSize: 22, margin: "4px 0 0", letterSpacing: "-0.01em" }}>{title}</h2>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        fontSize: 11,
        color: "var(--cp-text-muted)",
        textTransform: "uppercase",
        letterSpacing: "0.06em",
      }}
    >
      {children}
    </span>
  );
}

// ── Styles + date helpers ────────────────────────────────────────────────

const headerStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 12,
};

const navRowStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  marginTop: 8,
};

const errorBoxStyle: React.CSSProperties = {
  fontSize: 13,
  color: "var(--cp-text)",
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid var(--cp-warning, #d97706)",
  background: "color-mix(in oklab, var(--cp-warning, #d97706) 8%, transparent)",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  fontSize: 14,
  marginTop: 4,
  border: "1px solid var(--cp-border)",
  borderRadius: 8,
  background: "var(--cp-surface)",
  color: "var(--cp-text)",
};

const selectStyle: React.CSSProperties = {
  padding: "8px 10px",
  fontSize: 14,
  border: "1px solid var(--cp-border)",
  borderRadius: 8,
  background: "var(--cp-surface)",
  color: "var(--cp-text)",
};

const kickerStyle: React.CSSProperties = {
  fontSize: 11,
  color: "var(--cp-text-muted)",
  textTransform: "uppercase",
  letterSpacing: "0.08em",
};

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

function miniPillStyle(selected: boolean): React.CSSProperties {
  return {
    padding: "4px 10px",
    borderRadius: 999,
    border: `1px solid ${selected ? "var(--cp-accent)" : "var(--cp-border)"}`,
    background: selected ? "var(--cp-accent-soft)" : "transparent",
    color: selected ? "var(--cp-accent)" : "var(--cp-text-muted)",
    fontWeight: selected ? 600 : 500,
    fontSize: 11,
    cursor: "pointer",
  };
}

function cardOptionStyle(selected: boolean): React.CSSProperties {
  return {
    textAlign: "left",
    padding: 14,
    borderRadius: 12,
    border: `1px solid ${selected ? "var(--cp-accent)" : "var(--cp-border)"}`,
    background: selected ? "var(--cp-accent-soft)" : "var(--cp-surface)",
    color: "var(--cp-text)",
    cursor: "pointer",
    display: "grid",
    gap: 4,
  };
}

function tmCardStyle(mode: "enter" | "seed" | "skip"): React.CSSProperties {
  return {
    display: "grid",
    gap: 4,
    padding: "12px 14px",
    border: "1px solid var(--cp-border)",
    borderRadius: 10,
    background: mode === "skip" ? "transparent" : "var(--cp-surface-soft)",
    opacity: mode === "skip" ? 0.7 : 1,
  };
}

function todayYmd(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function tomorrowYmd(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function nextMondayYmd(): string {
  const d = new Date();
  // JS getDay: 0=Sun..6=Sat. Days until next Monday (1).
  const dow = d.getDay();
  const delta = ((1 - dow + 7) % 7) || 7;
  d.setDate(d.getDate() + delta);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}
