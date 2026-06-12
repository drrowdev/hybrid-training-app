/**
 * Green Protocol — ProgramEngine over @hta/program-core.
 *
 * Green Protocol is a CONCURRENT strength + conditioning system. This engine
 * COMPOSES the Tactical Barbell strength engine (it delegates every strength day
 * to `@hta/tacticalbarbell` rather than re-encoding Operator/Fighter) and adds a
 * conditioning layer scheduled on a 7-day week grid.
 *
 * The platform seam is unchanged:
 *   - PROGRAM-OWNED: the phase grid, the conditioning prescriptions, deload
 *     placement, and the phase/benchmark recommendations.
 *   - PLATFORM-OWNED: the canonical 1RM strength state (ctx.oneRepMaxes, consumed
 *     by the delegated TB engine) and the logged cardio (Strava etc.) that
 *     fulfils conditioning prescriptions. Nothing is auto-applied.
 */
import type {
  ProgramEngine,
  ProgramMeta,
  SetupSchema,
  ProgramSetupInput,
  PlatformContext,
  PlannedSessionSpec,
  SessionPrescription,
  PrescribedItem,
  LoggedSession,
  ProgramRecommendation,
} from "@hta/program-core";
import {
  tacticalBarbellEngine,
  zuluHtEngine,
  type TbInstance,
  type TbClusterLift,
  type ZuluHtInstance,
} from "@hta/tacticalbarbell";
import {
  GREEN_PHASES,
  getGreenPhase,
  strengthTemplatesInPhase,
  type GreenPhase,
  type GreenStrength,
  type DayCell,
} from "./phases";
import { getConditioningSession } from "./conditioning";

const MILES_TO_M = 1609.34;
const DAY_LABELS = ["Day 1", "Day 2", "Day 3", "Day 4", "Day 5", "Day 6", "Day 7"];

/** Map a Green strength token to its strength-engine key. */
const STRENGTH_KEY: Record<GreenStrength, string> = {
  OP: "operator",
  FT: "fighter",
  ZULU_HT: "zulu-ht",
};

/** The wave length (weeks) each strength engine cycles over — drives the week wrap. */
const WAVE_WEEKS: Record<string, number> = {
  operator: 6,
  fighter: 6,
  "zulu-ht": 3,
};

// ─────────────────────────────────────────────────────────────────────────────
// Instance shape (serialisable — persisted by the platform)
// ─────────────────────────────────────────────────────────────────────────────

export interface GreenInstance {
  phaseId: string;
  /** How many times the phase repeats. */
  blocks: number;
  /** The shared strength cluster passed through to the TB engine. */
  cluster: TbClusterLift[];
  /**
   * Embedded strength-program instances, keyed by strength-engine key
   * ("operator"/"fighter" → Tactical Barbell engine; "zulu-ht" → Zulu/HT engine).
   * Seeded at setup from the shared 1RMs; the GP engine delegates strength days
   * to these.
   */
  strength: Record<string, TbInstance | ZuluHtInstance>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Ref encoding — `gp-b{block}-w{week}-d{day}` (one ref per non-rest day)
// ─────────────────────────────────────────────────────────────────────────────

function greenRef(block: number, week: number, day: number): string {
  return `gp-b${block}-w${week}-d${day}`;
}

interface ParsedRef {
  block: number;
  week: number;
  day: number;
}

function parseRef(ref: string): ParsedRef | null {
  const m = ref.match(/^gp-b(\d+)-w(\d+)-d(\d+)$/);
  if (!m) return null;
  return { block: Number(m[1]), week: Number(m[2]), day: Number(m[3]) };
}

// ─────────────────────────────────────────────────────────────────────────────
// Plan building — the single source of truth for timeline() and prescribe()
// ─────────────────────────────────────────────────────────────────────────────

interface PlanEntry {
  spec: PlannedSessionSpec;
  cell: DayCell;
  /** For strength cells: the TB template id + the TB ref to delegate to. */
  tbTemplateId?: string;
  tbRef?: string;
}

function buildPlan(instance: GreenInstance): PlanEntry[] {
  const phase = getGreenPhase(instance.phaseId);
  if (!phase) return [];

  const entries: PlanEntry[] = [];
  let index = 0;
  // How many weeks so far have used each strength template (1-based counter).
  const tmplWeekCounter: Record<string, number> = {};

  for (let block = 0; block < instance.blocks; block++) {
    for (let wi = 0; wi < phase.weeks.length; wi++) {
      const week = phase.weeks[wi]!;

      // Bump the per-template week counter for every strength template present.
      const templatesThisWeek = new Set<GreenStrength>();
      for (const c of week.days) if (c.kind === "strength") templatesThisWeek.add(c.strength);
      for (const t of templatesThisWeek) {
        const key = STRENGTH_KEY[t];
        tmplWeekCounter[key] = (tmplWeekCounter[key] ?? 0) + 1;
      }

      // Per-template session index within this week (→ TB session s1, s2, …).
      const sessionInWeek: Record<string, number> = {};

      for (let di = 0; di < week.days.length; di++) {
        const cell = week.days[di]!;
        if (cell.kind === "rest") continue;

        const ref = greenRef(block, wi + 1, di);
        const weekLabel = `${phase.name} · Block ${block + 1} · Wk ${wi + 1}`;
        const sessionKind: PlannedSessionSpec["kind"] =
          cell.kind === "deload" ? "deload" : cell.kind === "test" ? "test" : "training";
        const tags = [
          `phase:${phase.id}`,
          `block:${block + 1}`,
          `week:${wi + 1}`,
          `day:${di + 1}`,
        ];

        let label = `${weekLabel} · ${DAY_LABELS[di]}`;
        let tbTemplateId: string | undefined;
        let tbRef: string | undefined;

        if (cell.kind === "strength") {
          const key = STRENGTH_KEY[cell.strength];
          const n = (sessionInWeek[key] = (sessionInWeek[key] ?? 0) + 1);
          const counter = tmplWeekCounter[key] ?? 1;
          // Each strength engine is block-agnostic in prescribe; the week wraps
          // onto its own wave length (TB = 6, Zulu/HT = 3).
          const waveWeeks = WAVE_WEEKS[key] ?? 6;
          const tbWeek = ((counter - 1) % waveWeeks) + 1;
          tbTemplateId = key;
          tbRef = `b0-w${tbWeek}-s${n}`;
          tags.push("modality:strength", `session:${cell.strength}`);
          label = `${weekLabel} · ${DAY_LABELS[di]} · ${cell.strength}`;
        } else if (cell.kind === "conditioning" || cell.kind === "test") {
          const sess = getConditioningSession(cell.session);
          tags.push("modality:conditioning", `session:${cell.session}`);
          if (sess) tags.push(`zone:${sess.zone}`);
          if (cell.kind === "test") tags.push("benchmark");
          if (cell.kind === "conditioning" && cell.plus) tags.push("two-a-day");
          const prefix = cell.kind === "test" ? "Benchmark: " : "";
          const suffix = cell.kind === "conditioning" && cell.plus ? " (two-a-day)" : "";
          label = `${weekLabel} · ${DAY_LABELS[di]} · ${prefix}${sess?.name ?? cell.session}${suffix}`;
        } else {
          tags.push("deload");
        }

        const spec: PlannedSessionSpec = {
          ref,
          index: index++,
          label,
          kind: sessionKind,
          weekLabel,
          weekday: di,
          tags,
        };
        entries.push({
          spec,
          cell,
          ...(tbTemplateId ? { tbTemplateId } : {}),
          ...(tbRef ? { tbRef } : {}),
        });
      }
    }
  }
  return entries;
}

// ─────────────────────────────────────────────────────────────────────────────
// The engine
// ─────────────────────────────────────────────────────────────────────────────

const META: ProgramMeta = {
  id: "green-protocol",
  name: "Green Protocol",
  family: "tactical-barbell-green",
  summary:
    "Tactical Barbell's Green Protocol — a concurrent strength + endurance system that pairs the TB strength templates with structured conditioning on a weekly grid.",
};

const DEFAULT_CLUSTER: TbClusterLift[] = [
  { movement: "squat" },
  { movement: "bench" },
  { movement: "deadlift" },
];

function asMovementList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string" && x.length > 0);
}

export const greenProtocolEngine: ProgramEngine<GreenInstance> = {
  meta: META,

  describeSetup(): SetupSchema {
    return {
      fields: [
        {
          key: "phaseId",
          label: "Program",
          type: "select",
          options: GREEN_PHASES.map((p) => ({ value: p.id, label: p.name })),
          defaultValue: "hybrid",
          help: "Hybrid (Operator half → Fighter half) or Hybrid/Op (50/50, no Fighter half).",
        },
        { key: "blocks", label: "Repeats", type: "number", defaultValue: 1, help: "How many times to repeat the phase." },
        {
          key: "useTrainingMax",
          label: "Load strength off a Training Max",
          type: "boolean",
          defaultValue: false,
          help: "Passed through to the Tactical Barbell strength engine.",
        },
        { key: "tmPercent", label: "Training Max %", type: "number", defaultValue: 0.9 },
      ],
    };
  },

  setup(input: ProgramSetupInput, ctx: PlatformContext): GreenInstance {
    const v = input.values;
    const phaseId = typeof v.phaseId === "string" ? v.phaseId : "hybrid";
    const phase = getGreenPhase(phaseId) ?? GREEN_PHASES[0]!;
    const blocks = Math.max(1, Math.floor(Number(v.blocks ?? 1)) || 1);

    const picked = asMovementList(v.cluster);
    const cluster = picked.length > 0 ? picked.map((movement) => ({ movement })) : DEFAULT_CLUSTER.map((c) => ({ ...c }));

    const strength: Record<string, TbInstance | ZuluHtInstance> = {};
    const useTrainingMax = v.useTrainingMax === true;
    const tmPercent = Number(v.tmPercent ?? 0.9) || 0.9;
    for (const t of strengthTemplatesInPhase(phase)) {
      const key = STRENGTH_KEY[t];
      if (key === "zulu-ht") {
        // Zulu/HT uses its own standard 4-lift cluster (Press/Squat/Bench/Deadlift).
        strength[key] = zuluHtEngine.setup({ values: { blocks: 1, useTrainingMax, tmPercent } }, ctx);
      } else {
        strength[key] = tacticalBarbellEngine.setup(
          {
            values: {
              templateId: key,
              blocks: 1,
              cluster: cluster.map((c) => c.movement),
              useTrainingMax,
              tmPercent,
            },
          },
          ctx,
        );
      }
    }

    return { phaseId: phase.id, blocks, cluster, strength };
  },

  timeline(instance: GreenInstance): PlannedSessionSpec[] {
    return buildPlan(instance).map((e) => e.spec);
  },

  prescribe(instance: GreenInstance, ref: string, ctx: PlatformContext): SessionPrescription {
    const parsed = parseRef(ref);
    if (!parsed) return { items: [] };
    const entry = buildPlan(instance).find((e) => e.spec.ref === ref);
    if (!entry) return { items: [] };
    const cell = entry.cell;

    if (cell.kind === "deload") {
      return {
        items: [
          {
            kind: "note",
            name: "Deload",
            note: "Reduce volume and intensity. Light optional aerobic work only — recover and rebuild.",
          },
        ],
      };
    }

    if (cell.kind === "strength") {
      if (!entry.tbTemplateId || !entry.tbRef) return { items: [] };
      const inst = instance.strength[entry.tbTemplateId];
      if (!inst) return { items: [] };
      // Compose: delegate to the owning strength engine (TB cluster or Zulu/HT).
      return entry.tbTemplateId === "zulu-ht"
        ? zuluHtEngine.prescribe(inst as ZuluHtInstance, entry.tbRef, ctx)
        : tacticalBarbellEngine.prescribe(inst as TbInstance, entry.tbRef, ctx);
    }

    if (cell.kind === "conditioning" || cell.kind === "test") {
      const sess = getConditioningSession(cell.session);
      if (!sess) return { items: [] };
      const phase = getGreenPhase(instance.phaseId);
      const isBenchmark = cell.kind === "test" && !!phase?.benchmark;
      const primaryName = isBenchmark ? phase!.benchmark!.name : sess.name;
      const primaryBaseNote = isBenchmark
        ? `Benchmark field test — ${phase!.benchmark!.target}. ${sess.note}`
        : sess.note;
      const items: PrescribedItem[] = [
        buildCardioItem(sess.id, primaryName, primaryBaseNote, cell.min, cell.max, cell.unit ?? sess.unit),
      ];
      // Two-a-day: a second session performed the same day.
      if (cell.kind === "conditioning" && cell.plus) {
        const plusSess = getConditioningSession(cell.plus.session);
        if (plusSess) {
          items.push(
            buildCardioItem(
              plusSess.id,
              plusSess.name,
              `Two-a-day (with ${sess.name}) — ${plusSess.note}`,
              cell.plus.min,
              cell.plus.max,
              cell.plus.unit ?? plusSess.unit,
            ),
          );
        }
      }
      return { items };
    }

    return { items: [] };
  },

  onSessionLogged(
    instance: GreenInstance,
    log: LoggedSession,
    _ctx: PlatformContext,
  ): { instance: GreenInstance; recommendations: ProgramRecommendation[] } {
    const phase = getGreenPhase(instance.phaseId);
    const parsed = parseRef(log.ref);
    if (!phase || !parsed) return { instance, recommendations: [] };

    const plan = buildPlan(instance);
    const pos = plan.findIndex((e) => e.spec.ref === log.ref);
    if (pos < 0) return { instance, recommendations: [] };

    const recommendations: ProgramRecommendation[] = [];

    // Entering a deload week: surface it when the next training entry is a deload
    // and this one isn't.
    const next = plan[pos + 1];
    const thisIsDeload = plan[pos]!.spec.kind === "deload";
    if (!thisIsDeload && next && next.spec.kind === "deload") {
      recommendations.push({
        kind: "deload",
        title: "Deload week ahead",
        detail: "Your next training week is a deload — back off volume and intensity to recover and rebuild.",
      });
    }

    // Phase complete: last entry of the whole plan.
    if (pos === plan.length - 1) {
      recommendations.push(
        ...phaseCompleteRecommendations(phase),
      );
    }

    return { instance, recommendations };
  },
};

function phaseCompleteRecommendations(phase: GreenPhase): ProgramRecommendation[] {
  const recs: ProgramRecommendation[] = [];
  if (phase.benchmark) {
    recs.push({
      kind: "tm-test",
      title: `Benchmark: ${phase.benchmark.name}`,
      detail: `${phase.name} is complete. Did you pass the field test (${phase.benchmark.target})? Pass → advance to the next phase. If not, repeat from an earlier week before re-testing.`,
      data: { benchmark: phase.benchmark.id, target: phase.benchmark.target },
    });
  }
  const next = nextFoundationPhase(phase.id);
  recs.push({
    kind: "next-block",
    title: phase.category === "continuation" ? "Continue or take a detour" : "Advance to the next phase",
    detail:
      phase.category === "continuation"
        ? `${phase.name} is your baseline. Repeat it, or take a training detour (mass block, event prep, PFT peak) and return to baseline after.`
        : phase.id === "capacity"
          ? "Capacity is complete — progress to Velocity."
          : `${phase.name} is complete — move on to the next Foundation phase.`,
    ...(next
      ? { data: { programId: "green-protocol", nextPhaseId: next.id, nextPhaseName: next.name } }
      : {}),
  });
  return recs;
}

/**
 * The next Foundation phase in the canonical Capacity → Velocity → Outcome
 * sequence (TB Green Protocol, §Foundation: "Each has a recommended benchmark to
 * meet before proceeding to the next"). Returns undefined after Outcome (the
 * athlete graduates to a Continuation model of their choosing) and for any
 * Continuation phase.
 */
const FOUNDATION_ORDER = ["capacity", "velocity", "outcome"] as const;
function nextFoundationPhase(phaseId: string): GreenPhase | undefined {
  const i = FOUNDATION_ORDER.indexOf(phaseId as (typeof FOUNDATION_ORDER)[number]);
  if (i < 0 || i + 1 >= FOUNDATION_ORDER.length) return undefined;
  return getGreenPhase(FOUNDATION_ORDER[i + 1]!);
}

function buildConditioningNote(base: string, min: number | undefined, max: number | undefined, unit: string): string {
  if (min === undefined) return base;
  const unitLabel = unit === "minutes" ? "min" : unit === "miles" ? "mi" : unit;
  const range = max !== undefined && max !== min ? `${min}–${max} ${unitLabel}` : `${min} ${unitLabel}`;
  return `Target ${range}. ${base}`;
}

function buildCardioItem(
  movementId: string,
  name: string,
  baseNote: string,
  min: number | undefined,
  max: number | undefined,
  unit: string,
): PrescribedItem {
  const item: PrescribedItem = {
    kind: "cardio",
    name,
    movementId,
    note: buildConditioningNote(baseNote, min, max, unit),
  };
  if (unit === "minutes" && min !== undefined) {
    item.durationSec = Math.round(min * 60);
  } else if (unit === "miles" && min !== undefined) {
    item.distanceM = Math.round(min * MILES_TO_M);
  }
  return item;
}
