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

export interface PickerField {
  key: string;
  label: string;
  type: "training-max" | "number" | "select" | "boolean" | "days";
  options?: { value: string; label: string }[];
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
    else out[f.key] = f.defaultValue ?? "";
  }
  return out;
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

  const firstEnabled = programs.find((p) => p.enabled) ?? programs[0];
  const [selectedId, setSelectedId] = useState<string>(firstEnabled?.id ?? "");
  const selected = programs.find((p) => p.id === selectedId) ?? null;

  const [values, setValues] = useState<Record<string, unknown>>(() =>
    defaultValuesFor(firstEnabled?.fields ?? []),
  );
  const [weekdays, setWeekdays] = useState<number[]>(() => defaultDaysFor(firstEnabled?.sessionsPerWeek));
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

  // The program dictates how many training days a week it needs. For TB the
  // active TEMPLATE owns the frequency (Operator 3, Fighter 2, Zulu 4, …);
  // otherwise it's the program-level default.
  const requiredDays = activeTbTemplate?.sessionsPerWeek ?? selected?.sessionsPerWeek;
  const daysMatch = requiredDays == null || weekdays.length === requiredDays;

  const clusterValidation = useMemo<ClusterValidationLite | null>(() => {
    if (!activeTbTemplate) return null;
    return validateClusterClient(activeTbTemplate, cluster);
  }, [activeTbTemplate, cluster]);

  const clusterOk = !activeTbTemplate || (clusterValidation?.ok ?? false);

  const canDeploy = useMemo(
    () => !!selected?.enabled && weekdays.length > 0 && daysMatch && !hasNoTms && clusterOk && !pending,
    [selected, weekdays, daysMatch, hasNoTms, clusterOk, pending],
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

  return (
    <div style={{ display: "grid", gap: 24 }}>
      {hasNoTms && (
        <p
          style={{
            margin: 0,
            padding: "10px 14px",
            borderRadius: 8,
            border: "1px solid var(--cp-border, rgba(255,255,255,0.12))",
            fontSize: 13,
            color: "var(--cp-text-muted, #999)",
          }}
        >
          Set your 1-rep maxes first (Settings → Training maxes) so the program can
          prescribe weights.
        </p>
      )}

      <section style={{ display: "grid", gap: 12 }}>
        <h2 style={{ fontSize: 13, textTransform: "uppercase", letterSpacing: "0.08em", margin: 0, color: "var(--cp-text-muted, #999)" }}>
          Program
        </h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 12 }}>
          {programs.map((p) => {
            const isSel = p.id === selectedId;
            return (
              <div
                key={p.id}
                style={{ position: "relative" }}
              >
                <button
                  type="button"
                  data-testid={`program-card-${p.id}`}
                  onClick={() => selectProgram(p)}
                  disabled={!p.enabled}
                  style={{
                    width: "100%",
                    textAlign: "left",
                    padding: 14,
                    paddingRight: 38,
                    borderRadius: 10,
                    cursor: p.enabled ? "pointer" : "not-allowed",
                    opacity: p.enabled ? 1 : 0.45,
                    background: isSel ? "var(--cp-accent-soft, rgba(120,170,255,0.12))" : "transparent",
                    border: `1px solid ${isSel ? "var(--cp-accent, #6aa0ff)" : "var(--cp-border, rgba(255,255,255,0.14))"}`,
                    color: "inherit",
                  }}
                >
                  <div style={{ fontWeight: 600, fontSize: 15 }}>{p.name}</div>
                  <div style={{ fontSize: 12, color: "var(--cp-text-muted, #999)", marginTop: 4, lineHeight: 1.4 }}>
                    {p.enabled ? p.summary : "Coming soon"}
                  </div>
                </button>
                <button
                  type="button"
                  aria-label={`About ${p.name}`}
                  title={`About ${p.name}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setInfoProgramId(p.id);
                  }}
                  style={{
                    position: "absolute",
                    top: 8,
                    right: 8,
                    width: 22,
                    height: 22,
                    borderRadius: "50%",
                    border: "1px solid var(--cp-border, rgba(255,255,255,0.24))",
                    background: "transparent",
                    color: "var(--cp-text-muted, #999)",
                    cursor: "pointer",
                    fontSize: 12,
                    fontStyle: "italic",
                    fontFamily: "serif",
                    lineHeight: 1,
                    padding: 0,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  i
                </button>
              </div>
            );
          })}
        </div>
      </section>

      {selected?.enabled && (
        <>
          <section style={{ display: "grid", gap: 12 }}>
            <h2 style={{ fontSize: 13, textTransform: "uppercase", letterSpacing: "0.08em", margin: 0, color: "var(--cp-text-muted, #999)" }}>
              Setup
            </h2>
            <div style={{ display: "grid", gap: 14, maxWidth: 420 }}>
              {selected.fields.map((f) => (
                <SetupFieldControl key={f.key} field={f} value={values[f.key]} onChange={(v) => setField(f.key, v)} />
              ))}
            </div>
          </section>

          {activeTbTemplate && (
            <ClusterEditor
              template={activeTbTemplate}
              anchoredKeys={anchoredKeys}
              cluster={cluster}
              onChange={setCluster}
              validation={clusterValidation}
            />
          )}

          <section style={{ display: "grid", gap: 12 }}>
            <h2 style={{ fontSize: 13, textTransform: "uppercase", letterSpacing: "0.08em", margin: 0, color: "var(--cp-text-muted, #999)" }}>
              Schedule
            </h2>
            <div>
              <div style={{ fontSize: 12, color: "var(--cp-text-muted, #999)", marginBottom: 6 }}>Training days</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {WD.map((label, i) => {
                  const on = weekdays.includes(i);
                  return (
                    <button
                      key={i}
                      type="button"
                      onClick={() => toggleDay(i)}
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
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
              <div style={{ fontSize: 11, color: daysMatch ? "var(--cp-text-muted, #999)" : "var(--cp-danger, #e06c75)", marginTop: 6 }}>
                {requiredDays != null
                  ? daysMatch
                    ? `${selected.name} trains ${requiredDays} day${requiredDays === 1 ? "" : "s"} a week — pick ${requiredDays}.`
                    : `${selected.name} needs exactly ${requiredDays} training day${requiredDays === 1 ? "" : "s"} a week — you have ${weekdays.length} selected.`
                  : "Pick one weekday per session in a program week."}
              </div>
            </div>
            <label style={{ display: "grid", gap: 6, maxWidth: 220 }}>
              <span style={{ fontSize: 12, color: "var(--cp-text-muted, #999)" }}>Start date</span>
              <input
                type="date"
                value={startedOn}
                onChange={(e) => setStartedOn(e.target.value)}
                style={{
                  padding: "8px 10px",
                  borderRadius: 8,
                  background: "transparent",
                  border: "1px solid var(--cp-border, rgba(255,255,255,0.14))",
                  color: "inherit",
                }}
              />
            </label>
          </section>

          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <button
              type="button"
              onClick={deploy}
              disabled={!canDeploy}
              style={{
                padding: "10px 20px",
                borderRadius: 8,
                border: "none",
                cursor: canDeploy ? "pointer" : "not-allowed",
                opacity: canDeploy ? 1 : 0.5,
                background: "var(--cp-accent, #6aa0ff)",
                color: "#0b0c0e",
                fontWeight: 600,
                fontSize: 14,
              }}
            >
              {pending ? "Deploying…" : "Deploy program"}
            </button>
            {result && !result.ok && (
              <span style={{ fontSize: 13, color: "var(--cp-danger, #e06c75)" }}>{result.error}</span>
            )}
          </div>
        </>
      )}

      {infoProgram && (
        <InfoModal
          title={infoProgram.name}
          body={infoText}
          onClose={() => setInfoProgramId(null)}
        />
      )}
    </div>
  );
}

function InfoModal({
  title,
  body,
  onClose,
}: {
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
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
        zIndex: 50,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: 480,
          width: "100%",
          background: "var(--cp-surface, #16181c)",
          border: "1px solid var(--cp-border, rgba(255,255,255,0.14))",
          borderRadius: 12,
          padding: 20,
          color: "inherit",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>{title}</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              background: "transparent",
              border: "none",
              color: "var(--cp-text-muted, #999)",
              fontSize: 20,
              cursor: "pointer",
              lineHeight: 1,
              padding: 4,
            }}
          >
            ×
          </button>
        </div>
        <p style={{ margin: 0, fontSize: 13, lineHeight: 1.55, color: "var(--cp-text, inherit)" }}>{body}</p>
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
