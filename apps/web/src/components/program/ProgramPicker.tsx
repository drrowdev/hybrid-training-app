"use client";

/**
 * Minimal program picker (platform cutover PR4).
 *
 * Lets a signed-in user deploy a platform program end-to-end: pick a program,
 * fill its engine-described setup fields, choose training weekdays + a start
 * date, and deploy via `createProgramInstance`. Intentionally minimal — it
 * validates the deploy → Today → log → stats loop on 5/3/1. The richer wizard
 * (cluster/benchmark step, GP multi-block roadmap) is a follow-up.
 */
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createProgramInstance, type CreateProgramInstanceResult } from "@/lib/platform/actions";
import styles from "./ProgramPicker.module.css";

/** Stencil "code" + Oswald kicker shown on each program card (step 1). */
const CARD_META: Record<string, { kick: string; code: string }> = {
  hybrid: { kick: "Concurrent", code: "HYBRID" },
  "wendler-531": { kick: "Wendler", code: "5/3/1" },
  "tactical-barbell": { kick: "Tactical Barbell", code: "TB" },
  "green-protocol": { kick: "Tactical Barbell", code: "GP" },
};

const STEP_LABELS = ["Program", "Loadout", "Benchmarks", "Schedule"] as const;

export interface PickerField {
  key: string;
  label: string;
  type: "training-max" | "number" | "select" | "multi-select" | "boolean" | "days";
  options?: { value: string; label: string }[];
  /** For `multi-select`: the maximum number of options the user may pick. */
  maxSelections?: number;
  defaultValue?: unknown;
  help?: string;
}

export interface PickerProgram {
  id: string;
  name: string;
  family: string;
  summary: string;
  /** Whether this program's deploy path is wired (5/3/1 + TB today). */
  enabled: boolean;
  /** Program prescribes its own weekly calendar — hide the weekday chooser. */
  fixedSchedule?: boolean;
  /** Goal-driven program (the engine builds the plan from the user's goals) —
   *  the setup section is framed as "build for your goals" rather than a recipe config. */
  goalDriven?: boolean;
  /** Training sessions per program-week under default setup → weekdays to pick. */
  sessionsPerWeek?: number;
  fields: PickerField[];
}

/**
 * A cluster lift entry — mirrors the engine's TbClusterEntry shape but with
 * narrowed local types (the client component cannot import engine types).
 */
export interface PickerClusterEntry {
  movement: string;
  split?: "A" | "B";
  kind?: "barbell" | "weighted-bw" | "bodyweight";
}

/**
 * Plain-data projection of a TB template for the client. The full engine
 * `TbTemplate` carries non-serialisable fields (waves, sessions, …) that the
 * picker does not need; only the cluster-shape rules cross the boundary.
 */
export interface PickerTbTemplate {
  id: string;
  name: string;
  structure: "cluster" | "split";
  clusterMin: number;
  clusterMax: number;
  allowsBodyweightFourth?: boolean;
  /** Training sessions this template runs per week → required training weekdays. */
  sessionsPerWeek: number;
  defaultCluster: PickerClusterEntry[];
}

/** TB program id (matches the engine's program family / id). */
const TB_PROGRAM_ID = "tactical-barbell";

/** Plain-language program explainers for the info tooltip. */
const PROGRAM_BLURBS: Record<string, string> = {
  "wendler-531":
    "The most trusted get-strong-slowly barbell plan. Start lighter than you think, add a little each cycle, focus on the big lifts — squat, bench, deadlift and overhead press — and beat your old numbers by a rep or two rather than maxing out. Sessions feel manageable and you almost never miss. Best if your main goal is raw barbell strength.",
  [TB_PROGRAM_ID]:
    "Strength training for people who also run, ruck, or fight. Short sessions (often 20-30 min) at controlled submaximal weights, never grinding to failure — so it leaves energy for conditioning. You pick a small cluster of main lifts and train them often. Templates (Operator, Fighter, Zulu, …) change how many days a week you lift and how many lifts you carry. Best if you want to be strong and keep doing cardio.",
};

const MOVEMENT_LABEL: Record<string, string> = {
  squat: "Squat",
  bench: "Bench Press",
  deadlift: "Deadlift",
  press: "Overhead Press",
  pullup: "Pull-ups",
};

function movementLabel(key: string): string {
  return MOVEMENT_LABEL[key] ?? key;
}

const WD = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Sensible default weekday spread for a given sessions-per-week count (0=Mon). */
const DAY_SPREADS: Record<number, number[]> = {
  1: [0],
  2: [0, 3],
  3: [0, 2, 4],
  4: [0, 1, 3, 4],
  5: [0, 1, 2, 4, 5],
  6: [0, 1, 2, 3, 4, 5],
  7: [0, 1, 2, 3, 4, 5, 6],
};

function defaultDaysFor(sessionsPerWeek: number | undefined): number[] {
  const n = sessionsPerWeek && sessionsPerWeek >= 1 && sessionsPerWeek <= 7 ? sessionsPerWeek : 4;
  return [...(DAY_SPREADS[n] ?? DAY_SPREADS[4]!)];
}

/** Clone the template's defaultCluster, dropping unknown movement keys. */
export function defaultClusterFor(
  template: PickerTbTemplate,
  anchoredKeys: string[],
): PickerClusterEntry[] {
  const allowed = new Set(anchoredKeys);
  return template.defaultCluster
    .filter((c) => allowed.has(c.movement) || c.kind === "bodyweight")
    .map((c) => ({
      movement: c.movement,
      ...(c.split ? { split: c.split } : {}),
      ...(c.kind ? { kind: c.kind } : {}),
    }));
}

export interface ClusterValidationLite {
  ok: boolean;
  errors: string[];
  countingLifts: number;
}

/**
 * Replica of the engine's `validateCluster` that runs against the plain-data
 * `PickerTbTemplate`. Kept in sync with packages/tacticalbarbell/src/validate.ts.
 */
export function validateClusterClient(
  template: PickerTbTemplate,
  cluster: PickerClusterEntry[],
): ClusterValidationLite {
  const errors: string[] = [];
  const bw = cluster.filter((l) => l.kind === "bodyweight").length;
  const counting = template.allowsBodyweightFourth
    ? cluster.length - Math.min(bw, 1)
    : cluster.length;

  if (template.clusterMin === template.clusterMax) {
    if (counting !== template.clusterMin) {
      errors.push(
        `${template.name} uses exactly ${template.clusterMin} main lift${template.clusterMin === 1 ? "" : "s"}.`,
      );
    }
  } else {
    if (counting < template.clusterMin) {
      errors.push(`${template.name} needs at least ${template.clusterMin} main lifts.`);
    }
    if (counting > template.clusterMax) {
      errors.push(
        `${template.name} allows at most ${template.clusterMax} main lifts` +
          (template.allowsBodyweightFourth ? " (plus one optional bodyweight movement)." : "."),
      );
    }
  }

  if (template.allowsBodyweightFourth && bw > 1) {
    errors.push(`${template.name} allows only one optional bodyweight movement.`);
  }

  if (template.structure === "split") {
    const a = cluster.filter((l) => l.split === "A").length;
    const b = cluster.filter((l) => l.split === "B").length;
    const ungrouped = cluster.filter((l) => l.split !== "A" && l.split !== "B").length;
    if (ungrouped > 0) {
      errors.push(`${template.name} assigns every lift to an A or B session.`);
    }
    if (a === 0 || b === 0) {
      errors.push(
        `${template.name} divides lifts across an A and a B session — each needs at least one lift.`,
      );
    }
    if (cluster.length < 4) {
      errors.push(`${template.name} needs at least 4 lifts split across A and B.`);
    }
  }

  const seen = new Set<string>();
  for (const lift of cluster) {
    if (seen.has(lift.movement)) {
      errors.push(`Duplicate lift in the cluster: ${lift.movement}.`);
    }
    seen.add(lift.movement);
  }

  return { ok: errors.length === 0, errors, countingLifts: counting };
}

function defaultValuesFor(fields: PickerField[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    if (f.type === "boolean") out[f.key] = f.defaultValue ?? false;
    else if (f.type === "number") out[f.key] = f.defaultValue ?? 0;
    else if (f.type === "select") out[f.key] = f.defaultValue ?? f.options?.[0]?.value ?? "";
    else if (f.type === "multi-select") out[f.key] = f.defaultValue ?? [];
    else out[f.key] = f.defaultValue ?? "";
  }
  return out;
}

/**
 * Pure selection toggle for a `multi-select` field. Adds `value` if absent
 * (unless `max` is already reached), removes it if present. Order-preserving.
 * Exported for unit testing.
 */
export function toggleMultiSelect(
  current: readonly string[],
  value: string,
  max?: number,
): string[] {
  if (current.includes(value)) return current.filter((v) => v !== value);
  if (max != null && current.length >= max) return [...current];
  return [...current, value];
}

function todayYmd(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function ProgramPicker({
  programs,
  anchoredKeys,
  tbTemplates = [],
}: {
  programs: PickerProgram[];
  anchoredKeys: string[];
  tbTemplates?: PickerTbTemplate[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<CreateProgramInstanceResult | null>(null);
  const [infoProgramId, setInfoProgramId] = useState<string | null>(null);

  // Wizard step (0 Program · 1 Loadout · 2 Benchmarks · 3 Schedule).
  const [step, setStep] = useState<number>(0);

  // No pre-selection: the user must pick a program on step 1 before continuing.
  const [selectedId, setSelectedId] = useState<string>("");
  const selected = programs.find((p) => p.id === selectedId) ?? null;

  const [values, setValues] = useState<Record<string, unknown>>({});
  const [weekdays, setWeekdays] = useState<number[]>([]);
  const [startedOn, setStartedOn] = useState<string>(todayYmd());

  const isTb = selected?.id === TB_PROGRAM_ID;
  const tbTemplateById = useMemo(() => {
    const m = new Map<string, PickerTbTemplate>();
    for (const t of tbTemplates) m.set(t.id, t);
    return m;
  }, [tbTemplates]);

  const tbTemplateId = isTb ? String(values.templateId ?? "") : "";
  const activeTbTemplate = isTb ? tbTemplateById.get(tbTemplateId) ?? null : null;

  const [cluster, setCluster] = useState<PickerClusterEntry[]>(() =>
    activeTbTemplate ? defaultClusterFor(activeTbTemplate, anchoredKeys) : [],
  );
  // Reset the cluster to the template default whenever the selected template
  // changes — using React's "store-prev-prop-and-adjust-during-render" pattern
  // (https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes)
  // so we avoid a cascading-render effect.
  const [lastTbTemplateId, setLastTbTemplateId] = useState<string | null>(
    activeTbTemplate?.id ?? null,
  );
  const currentTbId = activeTbTemplate?.id ?? null;
  if (currentTbId !== lastTbTemplateId) {
    setLastTbTemplateId(currentTbId);
    setCluster(activeTbTemplate ? defaultClusterFor(activeTbTemplate, anchoredKeys) : []);
    // A TB template sets its own weekly frequency (Operator 3, Fighter 2, Zulu
    // 4, …) — reset the weekday spread to match when the template changes.
    if (activeTbTemplate) setWeekdays(defaultDaysFor(activeTbTemplate.sessionsPerWeek));
  }

  const hasNoTms = anchoredKeys.length === 0;

  function selectProgram(p: PickerProgram) {
    if (!p.enabled) return;
    setSelectedId(p.id);
    setValues(defaultValuesFor(p.fields));
    setWeekdays(defaultDaysFor(p.sessionsPerWeek));
    setResult(null);
  }

  function toggleDay(i: number) {
    setWeekdays((prev) => (prev.includes(i) ? prev.filter((d) => d !== i) : [...prev, i].sort((a, b) => a - b)));
  }

  function setField(key: string, raw: unknown) {
    setValues((prev) => ({ ...prev, [key]: raw }));
  }

  const fixedSchedule = !!selected?.fixedSchedule;

  // The program dictates how many training days a week it needs. For TB the
  // active TEMPLATE owns the frequency (Operator 3, Fighter 2, Zulu 4, …);
  // otherwise it's the program-level default. Fixed-schedule programs (Green
  // Protocol) prescribe their own calendar, so the weekday count is irrelevant.
  const requiredDays = activeTbTemplate?.sessionsPerWeek ?? selected?.sessionsPerWeek;
  const daysMatch = fixedSchedule || requiredDays == null || weekdays.length === requiredDays;

  const clusterValidation = useMemo<ClusterValidationLite | null>(() => {
    if (!activeTbTemplate) return null;
    return validateClusterClient(activeTbTemplate, cluster);
  }, [activeTbTemplate, cluster]);

  const clusterOk = !activeTbTemplate || (clusterValidation?.ok ?? false);

  const canDeploy = useMemo(
    () => !!selected?.enabled && (fixedSchedule || weekdays.length > 0) && daysMatch && !hasNoTms && clusterOk && !pending,
    [selected, fixedSchedule, weekdays, daysMatch, hasNoTms, clusterOk, pending],
  );

  function deploy() {
    if (!selected) return;
    setResult(null);
    const setupValues: Record<string, unknown> = { ...values };
    if (activeTbTemplate) {
      if (activeTbTemplate.structure === "split") {
        setupValues.splitA = cluster
          .filter((c) => c.split === "A")
          .map((c) => ({ movement: c.movement, ...(c.kind ? { kind: c.kind } : {}) }));
        setupValues.splitB = cluster
          .filter((c) => c.split === "B")
          .map((c) => ({ movement: c.movement, ...(c.kind ? { kind: c.kind } : {}) }));
      } else {
        setupValues.cluster = cluster.map((c) => ({
          movement: c.movement,
          ...(c.kind ? { kind: c.kind } : {}),
        }));
      }
    }
    startTransition(async () => {
      const res = await createProgramInstance({
        programId: selected.id,
        setupValues,
        weekdays,
        startedOn,
      });
      setResult(res);
      if (res.ok) router.push("/app");
    });
  }

  const infoProgram = infoProgramId ? programs.find((p) => p.id === infoProgramId) ?? null : null;
  const infoText = infoProgram
    ? PROGRAM_BLURBS[infoProgram.id] ?? infoProgram.summary
    : "";
  const infoKick = infoProgram ? CARD_META[infoProgram.id]?.kick ?? infoProgram.family : "";

  const canContinue = step !== 0 || !!selected;

  function goBack() {
    setStep((s) => Math.max(0, s - 1));
  }
  function goNext() {
    setStep((s) => Math.min(3, s + 1));
  }

  // ── Step renderers ─────────────────────────────────────────────────────────
  function renderProgramStep() {
    return (
      <div className={styles.step}>
        <h2 className={styles.h1}>Choose your program</h2>
        <p className={styles.sub}>
          {"Pick the methodology you\u2019ll run. Your strength numbers, history and stats stay with you if you switch later."}
        </p>
        <div className={styles.grid}>
          {programs.map((p) => {
            const meta = CARD_META[p.id] ?? { kick: "", code: p.name };
            const codeStyle = meta.code.length > 4 ? { fontSize: 20 } : undefined;
            if (!p.enabled) {
              return (
                <div key={p.id} className={`${styles.pcard} ${styles.locked}`} aria-disabled="true">
                  <Ticks />
                  <div className={styles.kick}>{"\u00A0"}</div>
                  <div className={styles.code} style={codeStyle}>
                    {meta.code}
                  </div>
                  <div className={styles.pdesc}>Coming soon</div>
                </div>
              );
            }
            const isSel = p.id === selectedId;
            return (
              <div key={p.id} style={{ position: "relative", display: "flex" }}>
                <button
                  type="button"
                  data-testid={`program-card-${p.id}`}
                  onClick={() => selectProgram(p)}
                  className={`${styles.pcard}${isSel ? ` ${styles.sel}` : ""}`}
                >
                  <Ticks />
                  <div className={styles.kick}>{meta.kick}</div>
                  <div className={styles.code} style={codeStyle}>
                    {meta.code}
                  </div>
                  <div className={styles.pdesc}>{p.summary}</div>
                </button>
                <button
                  type="button"
                  aria-label={`About ${p.name}`}
                  title={`About ${p.name}`}
                  className={styles.pinfo}
                  onClick={(e) => {
                    e.stopPropagation();
                    setInfoProgramId(p.id);
                  }}
                >
                  i
                </button>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  function renderLoadoutStep() {
    if (!selected) return null;
    const freqText =
      requiredDays != null ? `${requiredDays} / WEEK` : fixedSchedule ? "PRESCRIBED" : "FLEXIBLE";
    const schedText = fixedSchedule ? "Set by program" : "You choose the days";
    return (
      <div className={styles.step}>
        <h2 className={styles.h1}>{selected.goalDriven ? "Build for your goals" : "Configure your block"}</h2>
        <p className={styles.sub}>
          {selected.goalDriven
            ? "Tell us what you\u2019re training for and we build a personalised concurrent plan around it \u2014 the more you set, the more it\u2019s tailored to you."
            : "Choose how you\u2019ll run it. The defaults are a solid starting point."}
        </p>
        <div className={styles.label}>{selected.goalDriven ? "Your goals" : "Setup"}</div>
        <div style={{ display: "grid", gap: 14, maxWidth: 460 }}>
          {selected.fields.map((f) => (
            <SetupFieldControl key={f.key} field={f} value={values[f.key]} onChange={(v) => setField(f.key, v)} />
          ))}
        </div>
        <div className={styles.specwrap}>
          <div className={styles.label}>Your block</div>
          <div className={styles.spec}>
            <div className={styles.cell}>
              <div className={styles.cl}>Frequency</div>
              <div className={styles.cv}>{freqText}</div>
            </div>
            <div className={styles.cell}>
              <div className={styles.cl}>Schedule</div>
              <div className={`${styles.cv} ${styles.cvSm}`}>{schedText}</div>
            </div>
            <div className={`${styles.cell} ${styles.wide}`}>
              <div className={styles.cl}>About</div>
              <div className={`${styles.cv} ${styles.cvSm}`}>{selected.summary}</div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  function renderBenchmarksStep() {
    if (!selected) return null;
    const benchTitle = activeTbTemplate
      ? activeTbTemplate.structure === "split"
        ? "Your cluster"
        : "Your strength cluster"
      : "Your benchmarks";
    const anchoredList = anchoredKeys.map(movementLabel).join(" \u00B7 ");
    return (
      <div className={styles.step}>
        <h2 className={styles.h1}>{benchTitle}</h2>
        <p className={styles.sub}>
          {activeTbTemplate
            ? "Pick the main lifts for your cluster \u2014 each one loads off the 1-rep maxes saved to your profile."
            : "Your program trains off the 1-rep maxes saved to your profile."}
        </p>
        {hasNoTms && (
          <p className={styles.banner}>
            {"Set your 1-rep maxes first (Settings \u2192 Training maxes) so the program can prescribe weights."}
          </p>
        )}
        {activeTbTemplate ? (
          <ClusterEditor
            template={activeTbTemplate}
            anchoredKeys={anchoredKeys}
            cluster={cluster}
            onChange={setCluster}
            validation={clusterValidation}
          />
        ) : (
          !hasNoTms && (
            <p className={styles.note}>
              {`Training off your saved 1-rep maxes: ${anchoredList || "your lifts"}.`}
            </p>
          )
        )}
      </div>
    );
  }

  function renderScheduleStep() {
    if (!selected) return null;
    return (
      <div className={styles.step}>
        <h2 className={styles.h1}>Set your schedule</h2>
        <p className={styles.sub}>
          {fixedSchedule
            ? `${selected.name} prescribes both your lifting and conditioning days \u2014 just pick a start date.`
            : "Your strength days come from your program \u2014 pick which weekdays, then choose a start date."}
        </p>
        {fixedSchedule ? (
          <p className={styles.note}>
            {`${selected.name} sets its own weekly schedule (strength and conditioning days are prescribed by the program). Pick a start date below.`}
          </p>
        ) : (
          <>
            <div className={styles.label}>Training days</div>
            <div className={styles.week}>
              {WD.map((label, i) => {
                const on = weekdays.includes(i);
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => toggleDay(i)}
                    className={`${styles.wd}${on ? ` ${styles.on}` : ""}`}
                  >
                    <span className={styles.wn}>{label}</span>
                    <span className={styles.wt}>{on ? "Strength" : "Rest"}</span>
                  </button>
                );
              })}
            </div>
            <div
              className={styles.note}
              style={daysMatch ? undefined : { color: "var(--warn)" }}
            >
              {requiredDays != null
                ? daysMatch
                  ? `${selected.name} trains ${requiredDays} day${requiredDays === 1 ? "" : "s"} a week \u2014 pick ${requiredDays}.`
                  : `${selected.name} needs exactly ${requiredDays} training day${requiredDays === 1 ? "" : "s"} a week \u2014 you have ${weekdays.length} selected.`
                : "Pick one weekday per session in a program week."}
            </div>
          </>
        )}
        <div style={{ marginTop: 18 }}>
          <div className={styles.label}>Start date</div>
          <input
            type="date"
            value={startedOn}
            onChange={(e) => setStartedOn(e.target.value)}
            style={{
              padding: "11px 15px",
              borderRadius: "var(--wradius)",
              background: "var(--bg)",
              border: "1px solid var(--line2)",
              color: "var(--text)",
              fontFamily: "var(--font-mono-wizard), monospace",
              colorScheme: "dark",
            }}
          />
        </div>
      </div>
    );
  }

  const isFinalStep = step === 3;

  return (
    <div className={styles.wizard}>
      <h1 className={styles.pageTitle}>Start a program</h1>

      <div className={styles.top}>
        <div className={styles.mark}>
          <div className={styles.diamond}>
            <span>{"S\u00D7C"}</span>
          </div>
          <b>{"Strength \u00D7 Cardio"}</b>
        </div>
        <div className={styles.stepcount}>
          STEP <b>{step + 1}</b> / 4
        </div>
      </div>

      <div className={styles.rail}>
        {STEP_LABELS.map((label, i) => (
          <div
            key={label}
            className={`${styles.seg}${i === step ? ` ${styles.segActive}` : i < step ? ` ${styles.segDone}` : ""}`}
          >
            <i />
          </div>
        ))}
      </div>
      <div className={styles.raillabels}>
        {STEP_LABELS.map((label, i) => (
          <span key={label} className={i === step ? styles.rlActive : undefined}>
            {label}
          </span>
        ))}
      </div>

      {step === 0 && renderProgramStep()}
      {step === 1 && renderLoadoutStep()}
      {step === 2 && renderBenchmarksStep()}
      {step === 3 && renderScheduleStep()}

      <div className={styles.nav}>
        {step > 0 ? (
          <button type="button" className={`${styles.btn} ${styles.ghost}`} onClick={goBack}>
            Back
          </button>
        ) : (
          <span />
        )}
        {isFinalStep ? (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 14 }}>
            {result && !result.ok && (
              <span style={{ fontSize: 13, color: "var(--warn)" }}>{result.error}</span>
            )}
            <button
              type="button"
              className={`${styles.btn} ${styles.deploy}`}
              onClick={deploy}
              disabled={!canDeploy}
            >
              {pending ? "Deploying…" : "Deploy program"}
            </button>
          </span>
        ) : (
          <button
            type="button"
            className={`${styles.btn} ${styles.primary}`}
            onClick={goNext}
            disabled={!canContinue}
          >
            Continue
          </button>
        )}
      </div>

      {infoProgram && (
        <InfoModal
          kicker={infoKick}
          title={infoProgram.name}
          body={infoText}
          onClose={() => setInfoProgramId(null)}
        />
      )}
    </div>
  );
}

/** The four L-shaped corner ticks on a program card. */
function Ticks() {
  return (
    <>
      <span className={`${styles.tick} ${styles.tl}`} />
      <span className={`${styles.tick} ${styles.tr}`} />
      <span className={`${styles.tick} ${styles.bl}`} />
      <span className={`${styles.tick} ${styles.br}`} />
    </>
  );
}

function InfoModal({
  kicker,
  title,
  body,
  onClose,
}: {
  kicker: string;
  title: string;
  body: string;
  onClose: () => void;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onClose}
      className={styles.modal}
    >
      <div onClick={(e) => e.stopPropagation()} className={styles.box}>
        <button type="button" onClick={onClose} aria-label="Close" className={styles.modalX}>
          {"\u2715"}
        </button>
        {kicker ? <div className={styles.modalKick}>{kicker}</div> : null}
        <h3 className={styles.modalH3}>{title}</h3>
        <p className={styles.modalP}>{body}</p>
      </div>
    </div>
  );
}

function ClusterEditor({
  template,
  anchoredKeys,
  cluster,
  onChange,
  validation,
}: {
  template: PickerTbTemplate;
  anchoredKeys: string[];
  cluster: PickerClusterEntry[];
  onChange: (next: PickerClusterEntry[]) => void;
  validation: ClusterValidationLite | null;
}) {
  const isSplit = template.structure === "split";
  const counting = validation?.countingLifts ?? cluster.length;
  const ok = validation?.ok ?? false;

  function getEntry(movement: string): PickerClusterEntry | undefined {
    return cluster.find((c) => c.movement === movement);
  }

  function toggleClusterLift(movement: string) {
    const existing = getEntry(movement);
    if (existing) {
      onChange(cluster.filter((c) => c.movement !== movement));
      return;
    }
    if (counting >= template.clusterMax) return;
    onChange([...cluster, { movement }]);
  }

  function toggleBodyweightFourth() {
    const existing = cluster.find((c) => c.kind === "bodyweight");
    if (existing) {
      onChange(cluster.filter((c) => c !== existing));
      return;
    }
    onChange([...cluster, { movement: "pullup", kind: "bodyweight" }]);
  }

  function setSplit(movement: string, next: "A" | "B" | null) {
    const existing = getEntry(movement);
    if (next === null) {
      if (!existing) return;
      onChange(cluster.filter((c) => c.movement !== movement));
      return;
    }
    if (existing) {
      onChange(cluster.map((c) => (c.movement === movement ? { ...c, split: next } : c)));
      return;
    }
    onChange([...cluster, { movement, split: next }]);
  }

  const headline = isSplit
    ? `${template.name} splits ${template.clusterMin}+ lifts across an A and a B session.`
    : template.clusterMin === template.clusterMax
      ? `${template.name} uses exactly ${template.clusterMin} main lifts.`
      : `${template.name} uses ${template.clusterMin}-${template.clusterMax} main lifts.`;

  const summaryLine = isSplit
    ? (() => {
        const a = cluster.filter((c) => c.split === "A").map((c) => movementLabel(c.movement));
        const b = cluster.filter((c) => c.split === "B").map((c) => movementLabel(c.movement));
        return `A: ${a.length ? a.join(", ") : "—"} · B: ${b.length ? b.join(", ") : "—"}`;
      })()
    : `${counting} of ${template.clusterMax} lifts`;

  return (
    <section style={{ display: "grid", gap: 12 }}>
      <h2 style={{ fontSize: 13, textTransform: "uppercase", letterSpacing: "0.08em", margin: 0, color: "var(--cp-text-muted, #999)" }}>
        Cluster
      </h2>
      <div style={{ fontSize: 12, color: "var(--cp-text-muted, #999)", lineHeight: 1.5 }}>{headline}</div>

      {isSplit ? (
        <div style={{ display: "grid", gap: 8 }}>
          {anchoredKeys.map((mv) => {
            const entry = getEntry(mv);
            const onA = entry?.split === "A";
            const onB = entry?.split === "B";
            return (
              <div
                key={mv}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 8,
                  padding: "8px 12px",
                  borderRadius: 8,
                  border: "1px solid var(--cp-border, rgba(255,255,255,0.14))",
                }}
              >
                <span style={{ fontSize: 13 }}>{movementLabel(mv)}</span>
                <div style={{ display: "flex", gap: 6 }}>
                  <SplitChip label="Off" active={!onA && !onB} onClick={() => setSplit(mv, null)} />
                  <SplitChip label="A" active={onA} onClick={() => setSplit(mv, "A")} />
                  <SplitChip label="B" active={onB} onClick={() => setSplit(mv, "B")} />
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {anchoredKeys.map((mv) => {
            const entry = getEntry(mv);
            const on = !!entry;
            const atCap = !on && counting >= template.clusterMax;
            return (
              <button
                key={mv}
                type="button"
                onClick={() => toggleClusterLift(mv)}
                disabled={atCap}
                style={{
                  padding: "8px 12px",
                  borderRadius: 8,
                  cursor: atCap ? "not-allowed" : "pointer",
                  opacity: atCap ? 0.45 : 1,
                  background: on ? "var(--cp-accent, #6aa0ff)" : "transparent",
                  color: on ? "#0b0c0e" : "inherit",
                  border: `1px solid ${on ? "var(--cp-accent, #6aa0ff)" : "var(--cp-border, rgba(255,255,255,0.14))"}`,
                  fontWeight: on ? 600 : 400,
                  fontSize: 13,
                }}
              >
                {movementLabel(mv)}
              </button>
            );
          })}
          {template.allowsBodyweightFourth && (() => {
            const on = cluster.some((c) => c.kind === "bodyweight");
            return (
              <button
                type="button"
                onClick={toggleBodyweightFourth}
                style={{
                  padding: "8px 12px",
                  borderRadius: 8,
                  cursor: "pointer",
                  background: on ? "var(--cp-accent, #6aa0ff)" : "transparent",
                  color: on ? "#0b0c0e" : "inherit",
                  border: `1px solid ${on ? "var(--cp-accent, #6aa0ff)" : "var(--cp-border, rgba(255,255,255,0.14))"}`,
                  fontWeight: on ? 600 : 400,
                  fontSize: 13,
                }}
                title="Optional bodyweight movement (does not count toward the lift cap)"
              >
                Pull-ups (bodyweight)
              </button>
            );
          })()}
        </div>
      )}

      <div
        style={{
          fontSize: 11,
          color: ok ? "var(--cp-success, #6dbf7b)" : "var(--cp-danger, #e06c75)",
        }}
      >
        {ok ? `✓ ${summaryLine}` : validation?.errors[0] ?? summaryLine}
      </div>
    </section>
  );
}

function SplitChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: "4px 10px",
        borderRadius: 6,
        cursor: "pointer",
        background: active ? "var(--cp-accent, #6aa0ff)" : "transparent",
        color: active ? "#0b0c0e" : "inherit",
        border: `1px solid ${active ? "var(--cp-accent, #6aa0ff)" : "var(--cp-border, rgba(255,255,255,0.14))"}`,
        fontWeight: active ? 600 : 400,
        fontSize: 12,
        minWidth: 36,
      }}
    >
      {label}
    </button>
  );
}

function SetupFieldControl({
  field,
  value,
  onChange,
}: {
  field: PickerField;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const labelEl = (
    <span style={{ fontSize: 12, color: "var(--cp-text-muted, #999)" }}>
      {field.label}
      {field.help ? <span style={{ display: "block", fontSize: 11, opacity: 0.8, marginTop: 2 }}>{field.help}</span> : null}
    </span>
  );
  const inputStyle: React.CSSProperties = {
    padding: "8px 10px",
    borderRadius: 8,
    background: "transparent",
    border: "1px solid var(--cp-border, rgba(255,255,255,0.14))",
    color: "inherit",
  };

  if (field.type === "select") {
    return (
      <label style={{ display: "grid", gap: 6 }}>
        {labelEl}
        <select value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} style={inputStyle}>
          {(field.options ?? []).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
    );
  }
  if (field.type === "multi-select") {
    const selected: string[] = Array.isArray(value) ? (value as string[]) : [];
    const max = field.maxSelections;
    const atMax = max != null && selected.length >= max;
    return (
      <div style={{ display: "grid", gap: 6 }}>
        {labelEl}
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {(field.options ?? []).map((o) => {
            const on = selected.includes(o.value);
            const disabled = !on && atMax;
            return (
              <button
                key={o.value}
                type="button"
                aria-pressed={on}
                disabled={disabled}
                onClick={() => onChange(toggleMultiSelect(selected, o.value, max))}
                style={{
                  padding: "6px 12px",
                  borderRadius: 999,
                  cursor: disabled ? "not-allowed" : "pointer",
                  background: on ? "var(--cp-accent, #6aa0ff)" : "transparent",
                  color: on ? "#0b0c0e" : "inherit",
                  border: `1px solid ${on ? "var(--cp-accent, #6aa0ff)" : "var(--cp-border, rgba(255,255,255,0.14))"}`,
                  fontWeight: on ? 600 : 400,
                  fontSize: 12,
                  opacity: disabled ? 0.45 : 1,
                }}
              >
                {o.label}
              </button>
            );
          })}
        </div>
        {max != null ? (
          <span style={{ fontSize: 11, color: "var(--cp-text-muted, #999)" }}>
            {selected.length}/{max} selected
          </span>
        ) : null}
      </div>
    );
  }
  if (field.type === "boolean") {
    return (
      <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
        <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} />
        {labelEl}
      </label>
    );
  }
  // number (and any future numeric-ish field) — text fields fall through to here too.
  return (
    <label style={{ display: "grid", gap: 6 }}>
      {labelEl}
      <input
        type="number"
        step="any"
        value={value === undefined || value === null || value === "" ? "" : String(value)}
        onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))}
        style={inputStyle}
      />
    </label>
  );
}
