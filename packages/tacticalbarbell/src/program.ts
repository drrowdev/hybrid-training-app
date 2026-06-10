/**
 * Tactical Barbell — ProgramEngine over the @hta/program-core contract.
 *
 * Proves a complete TB program with NO DB and NO UI:
 *   setup → timeline → prescribe (% of the shared 1RM, optionally off a derived
 *   Training Max) → onSessionLogged (block-end retest / next-block / CNS-deload
 *   recommendations, surfaced never auto-applied).
 *
 * The platform seam (same as 5/3/1):
 *   - PROGRAM-OWNED: the template's wave, set×rep scheme, block structure, and
 *     the retest/deload recommendations.
 *   - PLATFORM-OWNED: the canonical 1RM strength state (ctx.oneRepMaxes). TB
 *     loads a straight % of the 1RM by default; if `useTrainingMax` is set it
 *     derives a Training Max (= round(1RM × tmPercent)) and loads off that, per
 *     the optional-TM note in TB1. The shared 1RM is never mutated here — TB has
 *     no per-set AMRAP bump; strength only changes when the user retests.
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
  TB_TEMPLATES,
  TB_MOVEMENT_LABEL,
  getTbTemplate,
  type TbTemplate,
  type TbLiftKind,
  type TbClusterEntry,
} from "./templates";
import { roundToIncrement } from "./rounding";

// ─────────────────────────────────────────────────────────────────────────────
// Instance shape (serialisable — persisted by the platform)
// ─────────────────────────────────────────────────────────────────────────────

export interface TbClusterLift {
  movement: string;
  /** Zulu only: which split (A/B) this lift belongs to. */
  split?: "A" | "B";
  /** How the lift is loaded (default "barbell"). Bodyweight loads off max reps. */
  kind?: TbLiftKind;
}

export interface TbInstance {
  templateId: string;
  /** Number of blocks scheduled in the timeline. */
  blocks: number;
  /** Block length in weeks (copied from the template for self-containment). */
  blockWeeks: number;
  /** The lifter's chosen main lifts (with split letters for Zulu). */
  cluster: TbClusterLift[];
  /** When true, working weights load off a derived Training Max, not the raw 1RM. */
  useTrainingMax: boolean;
  /** TM fraction of 1RM when `useTrainingMax` is set (TB1 commonly uses 0.9). */
  tmPercent: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Ref encoding — `b{block}-w{week}-{sessionId}` (one ref per training session)
// ─────────────────────────────────────────────────────────────────────────────

function sessionRef(block: number, week: number, sessionId: string): string {
  return `b${block}-w${week}-${sessionId}`;
}

interface ParsedRef {
  block: number;
  week: number;
  sessionId: string;
}

function parseRef(ref: string): ParsedRef | null {
  const m = ref.match(/^b(\d+)-w(\d+)-([a-z0-9]+)$/);
  if (!m) return null;
  return { block: Number(m[1]), week: Number(m[2]), sessionId: m[3]! };
}

// ─────────────────────────────────────────────────────────────────────────────
// The engine
// ─────────────────────────────────────────────────────────────────────────────

const META: ProgramMeta = {
  id: "tactical-barbell",
  name: "Tactical Barbell",
  family: "tactical-barbell",
  summary:
    "K. Black's Tactical Barbell — submaximal, percentage-based strength run in 6-week blocks (Operator, Fighter, Zulu Standard/I/A, Gladiator, Mass, Grey Man), built to coexist with conditioning.",
};

function movementLabel(movement: string): string {
  return TB_MOVEMENT_LABEL[movement] ?? movement;
}

function resolveCluster(template: TbTemplate, values: Record<string, unknown>): TbClusterLift[] {
  if (template.structure === "split") {
    const splitA = entriesFromValue(values.splitA).map((l) => ({ ...l, split: "A" as const }));
    const splitB = entriesFromValue(values.splitB).map((l) => ({ ...l, split: "B" as const }));
    if (splitA.length > 0 || splitB.length > 0) {
      return [...splitA, ...splitB];
    }
    return template.defaultCluster.map((c) => cloneEntry(c));
  }
  const picked = entriesFromValue(values.cluster);
  if (picked.length === 0) {
    return template.defaultCluster.map((c) => cloneEntry(c));
  }
  return clampCluster(template, picked);
}

/** Copy a template cluster entry into an instance lift, omitting undefined optionals. */
function cloneEntry(c: TbClusterEntry): TbClusterLift {
  const lift: TbClusterLift = { movement: c.movement };
  if (c.split === "A" || c.split === "B") lift.split = c.split;
  if (c.kind) lift.kind = c.kind;
  return lift;
}

/**
 * Trim a user-supplied cluster to the template's ceiling. For Operator (and any
 * template allowing an optional bodyweight movement) a single bodyweight lift is
 * exempt from the count and preserved on top of the capped barbell lifts.
 */
function clampCluster(template: TbTemplate, lifts: TbClusterLift[]): TbClusterLift[] {
  if (template.allowsBodyweightFourth) {
    const counting = lifts.filter((l) => l.kind !== "bodyweight");
    const bodyweight = lifts.filter((l) => l.kind === "bodyweight");
    const kept = counting.slice(0, template.clusterMax);
    if (bodyweight.length > 0) kept.push(bodyweight[0]!);
    return kept;
  }
  const cap = template.maxMainLifts ?? template.clusterMax;
  return lifts.slice(0, cap);
}

/** Parse a setup value (string[] of movements, or richer {movement,kind,split}[]). */
function entriesFromValue(v: unknown): TbClusterLift[] {
  if (!Array.isArray(v)) return [];
  const out: TbClusterLift[] = [];
  for (const x of v) {
    if (typeof x === "string" && x.length > 0) {
      out.push({ movement: x });
    } else if (x && typeof x === "object") {
      const o = x as Record<string, unknown>;
      if (typeof o.movement === "string" && o.movement.length > 0) {
        const lift: TbClusterLift = { movement: o.movement };
        if (o.kind === "barbell" || o.kind === "weighted-bw" || o.kind === "bodyweight") {
          lift.kind = o.kind;
        }
        if (o.split === "A" || o.split === "B") lift.split = o.split;
        out.push(lift);
      }
    }
  }
  return out;
}

export const tacticalBarbellEngine: ProgramEngine<TbInstance> = {
  meta: META,

  describeSetup(): SetupSchema {
    return {
      fields: [
        {
          key: "templateId",
          label: "Template",
          type: "select",
          options: TB_TEMPLATES.map((t) => ({ value: t.id, label: t.name })),
          defaultValue: "operator",
          help: "Operator (3×/wk, ≤3 lifts), Fighter (2×/wk), Zulu (A/B split), Zulu I/A (3–5 sets, heavier), Gladiator (5×5), Mass (hypertrophy), Grey Man (12-wk).",
        },
        {
          key: "blocks",
          label: "Blocks",
          type: "number",
          defaultValue: 1,
          help: "How many consecutive blocks to schedule. Retest your 1RMs between blocks.",
        },
        {
          key: "useTrainingMax",
          label: "Load off a Training Max",
          type: "boolean",
          defaultValue: false,
          help: "Off = % of your true 1RM (TB default). On = derive a Training Max (round(1RM × TM%)) and load off that.",
        },
        {
          key: "tmPercent",
          label: "Training Max %",
          type: "number",
          defaultValue: 0.9,
          help: "Only used when loading off a Training Max.",
        },
      ],
    };
  },

  setup(input: ProgramSetupInput, _ctx: PlatformContext): TbInstance {
    const v = input.values;
    const templateId = typeof v.templateId === "string" ? v.templateId : "operator";
    const template = getTbTemplate(templateId) ?? getTbTemplate("operator")!;
    const blocks = Math.max(1, Math.floor(Number(v.blocks ?? 1)) || 1);
    const useTrainingMax = v.useTrainingMax === true;
    const tmPercent = Number(v.tmPercent ?? 0.9) || 0.9;

    return {
      templateId: template.id,
      blocks,
      blockWeeks: template.blockWeeks,
      cluster: resolveCluster(template, v),
      useTrainingMax,
      tmPercent,
    };
  },

  timeline(instance: TbInstance): PlannedSessionSpec[] {
    const template = getTbTemplate(instance.templateId);
    if (!template) return [];
    const specs: PlannedSessionSpec[] = [];
    let index = 0;
    for (let block = 0; block < instance.blocks; block++) {
      for (let week = 1; week <= template.blockWeeks; week++) {
        for (const session of template.weeklySessions) {
          const tags = [
            `template:${template.id}`,
            `block:${block + 1}`,
            `week:${week}`,
            `wave:${session.waveId}`,
            ...(session.split ? [`split:${session.split}`] : []),
          ];
          specs.push({
            ref: sessionRef(block, week, session.id),
            index: index++,
            label: `${template.name} · Block ${block + 1} · Wk ${week} · ${session.label}`,
            kind: "training",
            weekLabel: `Block ${block + 1} · Wk ${week}`,
            tags,
          });
        }
      }
    }
    return specs;
  },

  prescribe(instance: TbInstance, ref: string, ctx: PlatformContext): SessionPrescription {
    const parsed = parseRef(ref);
    if (!parsed) return { items: [] };
    const template = getTbTemplate(instance.templateId);
    if (!template) return { items: [] };
    if (parsed.week < 1 || parsed.week > template.blockWeeks) return { items: [] };

    const session = template.weeklySessions.find((s) => s.id === parsed.sessionId);
    if (!session) return { items: [] };
    const wave = template.waves.find((wv) => wv.id === session.waveId);
    if (!wave) return { items: [] };

    const scheme = template.setsReps[parsed.week - 1];
    const pct = wave.percents[parsed.week - 1];
    if (!scheme || pct == null) return { items: [] };

    const lifts = instance.cluster.filter((c) => (session.split ? c.split === session.split : true));

    const items: PrescribedItem[] = [];
    for (const lift of lifts) {
      const anchor = ctx.oneRepMaxes[lift.movement];
      if (anchor == null || anchor <= 0) continue;
      const rangeNote =
        scheme.setsMin !== scheme.setsMax
          ? `${scheme.setsMin}–${scheme.setsMax} sets — submaximal, stop short of failure`
          : "submaximal, stop short of failure";

      // Bodyweight movements (e.g. pull-ups) are anchored on MAX CLEAN REPS and
      // prescribed as a % of that rep ceiling — never a weight (TB1).
      if (lift.kind === "bodyweight") {
        const targetReps = Math.max(1, Math.round(anchor * pct));
        items.push({
          kind: "main",
          name: movementLabel(lift.movement),
          movementId: lift.movement,
          sets: scheme.setsMin,
          reps: targetReps,
          repsLabel: `${targetReps}`,
          percentOfTm: pct,
          note: `bodyweight — ${Math.round(pct * 100)}% of max reps; ${rangeNote}`,
        });
        continue;
      }

      const basis = instance.useTrainingMax
        ? roundToIncrement(anchor * instance.tmPercent, ctx.roundingKg)
        : anchor;
      const weightKg = roundToIncrement(basis * pct, ctx.roundingKg);
      items.push({
        kind: "main",
        name: movementLabel(lift.movement),
        movementId: lift.movement,
        sets: scheme.setsMin,
        reps: scheme.reps,
        repsLabel: scheme.repsLabel,
        weightKg,
        percentOfTm: pct,
        note: rangeNote,
      });
    }
    return { items };
  },

  onSessionLogged(
    instance: TbInstance,
    log: LoggedSession,
    _ctx: PlatformContext,
  ): { instance: TbInstance; recommendations: ProgramRecommendation[] } {
    const template = getTbTemplate(instance.templateId);
    const parsed = parseRef(log.ref);
    if (!template || !parsed) return { instance, recommendations: [] };

    const lastSessionId = template.weeklySessions[template.weeklySessions.length - 1]?.id;
    const isBlockEnd = parsed.week === template.blockWeeks && parsed.sessionId === lastSessionId;
    if (!isBlockEnd) return { instance, recommendations: [] };

    const blockNum = parsed.block + 1;
    const recommendations: ProgramRecommendation[] = [
      {
        kind: "tm-test",
        title: "Retest your maxes",
        detail: `You've finished a ${template.blockWeeks}-week ${template.name} block. Tactical Barbell: retest your 1RMs every 6–12 weeks before re-seeding the next block.`,
        data: { blockWeeks: template.blockWeeks, block: blockNum },
      },
    ];

    if (blockNum < instance.blocks) {
      recommendations.push({
        kind: "next-block",
        title: "Start your next block",
        detail: `Begin Block ${blockNum + 1} once you've retested and re-seeded your maxes.`,
        data: { nextBlock: blockNum + 1 },
      });
    }

    // CNS-recovery deload: TB1 advises a dephasing/recovery week roughly every
    // few months of hard training. Surface it on ~24-week boundaries (heuristic).
    const cumulativeWeeks = blockNum * template.blockWeeks;
    if (cumulativeWeeks % 24 === 0) {
      recommendations.push({
        kind: "deload",
        title: "Consider a CNS deload",
        detail: `You've logged ~${cumulativeWeeks} weeks of TB training. Tactical Barbell recommends a CNS-recovery deload every few months — take a lighter week if fatigue is accumulating.`,
        data: { cumulativeWeeks },
      });
    }

    return { instance, recommendations };
  },
};
