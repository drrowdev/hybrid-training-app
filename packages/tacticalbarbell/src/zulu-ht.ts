/**
 * Tactical Barbell — Zulu/HT (hybrid mass/strength) as its own ProgramEngine.
 *
 * Zulu/HT is structurally distinct from the strength-book templates (Operator /
 * Fighter / Zulu, which run one set×rep + % scheme per lift). Each Zulu/HT
 * session pairs a HEAVY main lift with a higher-rep BACK-OFF supplemental of a
 * second lift, plus pull-up assistance — and the four weekly sessions rotate the
 * four lifts so each is trained heavy once and as a supplemental once. It runs as
 * a 3-week mass wave (optionally peaked on week 3) and can be repeated.
 *
 * Source: Green Protocol — Zulu/HT table + assistance/execution notes.
 *
 * Loads are a percentage of the shared 1RM (a Training Max can be derived
 * optionally, like the rest of the TB engine).
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
import { buildGlobalWarmupItems } from "@hta/program-core";
import { TB_MOVEMENT_LABEL } from "./templates";
import { roundToIncrement } from "./rounding";

const BLOCK_WEEKS = 3;

/** The four weekly sessions: a heavy main + a back-off supplemental (by cluster role) + an A/B assistance group. */
interface ZuluHtSession {
  id: string;
  /** Cluster index of the heavy main lift. */
  heavy: number;
  /** Cluster index of the back-off supplemental lift. */
  supp: number;
  /** Which assistance group's pull-ups/accessories are done. */
  assist: "A" | "B";
  /** Planned weekday (0 = Mon). Zulu/HT trains Mon/Tue/Thu/Fri. */
  weekday: number;
}

// Standard cluster roles: [0]=Press, [1]=Squat, [2]=Bench, [3]=Deadlift.
const SESSIONS: ZuluHtSession[] = [
  { id: "s1", heavy: 0, supp: 1, assist: "A", weekday: 0 },
  { id: "s2", heavy: 3, supp: 2, assist: "B", weekday: 1 },
  { id: "s3", heavy: 1, supp: 0, assist: "A", weekday: 3 },
  { id: "s4", heavy: 2, supp: 3, assist: "B", weekday: 4 },
];

interface ZuluHtWeek {
  heavyReps: number;
  heavyPct: number;
  suppReps: number;
  suppPct: number;
  assistReps: number;
  assistPct: number;
}

// The 3-week mass wave (heavy 4×, back-off 4×, assistance 3–5×).
const WAVE: ZuluHtWeek[] = [
  { heavyReps: 5, heavyPct: 0.75, suppReps: 10, suppPct: 0.65, assistReps: 12, assistPct: 0.6 },
  { heavyReps: 4, heavyPct: 0.8, suppReps: 8, suppPct: 0.7, assistReps: 10, assistPct: 0.65 },
  { heavyReps: 3, heavyPct: 0.85, suppReps: 6, suppPct: 0.75, assistReps: 8, assistPct: 0.7 },
];

const DEFAULT_CLUSTER = ["press", "squat", "bench", "deadlift"];

export interface ZuluHtInstance {
  /** How many 3-week blocks to schedule. */
  blocks: number;
  /** The four cluster roles in order: [Press, Squat, Bench, Deadlift] slots. */
  cluster: string[];
  /** When true, loads are computed off a derived Training Max instead of the raw 1RM. */
  useTrainingMax: boolean;
  tmPercent: number;
}

function zuluRef(block: number, week: number, sessionId: string): string {
  return `b${block}-w${week}-${sessionId}`;
}

function parseRef(ref: string): { block: number; week: number; sessionId: string } | null {
  const m = ref.match(/^b(\d+)-w(\d+)-(s[1-4])$/);
  if (!m) return null;
  return { block: Number(m[1]), week: Number(m[2]), sessionId: m[3]! };
}

function label(movement: string): string {
  return TB_MOVEMENT_LABEL[movement] ?? movement;
}

const META: ProgramMeta = {
  id: "tactical-barbell-zulu-ht",
  name: "Zulu/HT",
  family: "tactical-barbell",
  summary:
    "Tactical Barbell's Zulu/HT — a hybrid mass/strength block pairing a heavy main lift with a higher-rep back-off supplemental plus pull-up assistance, run as a 3-week wave.",
};

export const zuluHtEngine: ProgramEngine<ZuluHtInstance> = {
  meta: META,

  describeSetup(): SetupSchema {
    return {
      fields: [
        { key: "blocks", label: "Blocks (3-week)", type: "number", defaultValue: 1 },
        {
          key: "useTrainingMax",
          label: "Load off a Training Max",
          type: "boolean",
          defaultValue: false,
          help: "Off = % of true 1RM. On = derive a Training Max (round(1RM × TM%)) and load off that.",
        },
        { key: "tmPercent", label: "Training Max %", type: "number", defaultValue: 0.9 },
      ],
    };
  },

  setup(input: ProgramSetupInput, _ctx: PlatformContext): ZuluHtInstance {
    const v = input.values;
    const cluster = Array.isArray(v.cluster) && v.cluster.length === 4
      ? (v.cluster as string[])
      : [...DEFAULT_CLUSTER];
    return {
      blocks: Math.max(1, Math.floor(Number(v.blocks ?? 1)) || 1),
      cluster,
      useTrainingMax: v.useTrainingMax === true,
      tmPercent: Number(v.tmPercent ?? 0.9) || 0.9,
    };
  },

  timeline(instance: ZuluHtInstance): PlannedSessionSpec[] {
    const specs: PlannedSessionSpec[] = [];
    let index = 0;
    for (let block = 0; block < instance.blocks; block++) {
      for (let week = 1; week <= BLOCK_WEEKS; week++) {
        for (const s of SESSIONS) {
          const heavy = instance.cluster[s.heavy]!;
          const supp = instance.cluster[s.supp]!;
          specs.push({
            ref: zuluRef(block, week, s.id),
            index: index++,
            label: `Zulu/HT · Block ${block + 1} · Wk ${week} · ${label(heavy)} / ${label(supp)}`,
            kind: "training",
            weekLabel: `Block ${block + 1} · Wk ${week}`,
            weekday: s.weekday,
            tags: [`block:${block + 1}`, `week:${week}`, `lift:${heavy}`, `supp:${supp}`, `assist:${s.assist}`],
          });
        }
      }
    }
    return specs;
  },

  prescribe(instance: ZuluHtInstance, ref: string, ctx: PlatformContext): SessionPrescription {
    const parsed = parseRef(ref);
    if (!parsed) return { items: [] };
    if (parsed.week < 1 || parsed.week > BLOCK_WEEKS) return { items: [] };
    const session = SESSIONS.find((s) => s.id === parsed.sessionId);
    const wave = WAVE[parsed.week - 1];
    if (!session || !wave) return { items: [] };

    const basisFor = (movement: string): number | undefined => {
      const oneRm = ctx.oneRepMaxes[movement];
      if (oneRm == null || oneRm <= 0) return undefined;
      return instance.useTrainingMax
        ? roundToIncrement(oneRm * instance.tmPercent, ctx.roundingKg)
        : oneRm;
    };

    const items: PrescribedItem[] = [];
    const heavyMv = instance.cluster[session.heavy]!;
    const suppMv = instance.cluster[session.supp]!;

    const heavyBasis = basisFor(heavyMv);
    if (heavyBasis != null) {
      const heavyWeight = roundToIncrement(heavyBasis * wave.heavyPct, ctx.roundingKg);
      // Warm-up ramp to the heavy work weight — shared global routine, or the
      // lifter's own ladder when they have configured one (`ctx.warmupRamp`).
      items.push(
        ...buildGlobalWarmupItems({
          name: `${label(heavyMv)} (heavy)`,
          movementId: heavyMv,
          workingWeightKg: heavyWeight,
          roundingKg: ctx.roundingKg,
          ...(ctx.warmupRamp ? { ramp: ctx.warmupRamp } : {}),
        }),
      );
      items.push({
        kind: "main",
        name: `${label(heavyMv)} (heavy)`,
        movementId: heavyMv,
        sets: 4,
        reps: wave.heavyReps,
        weightKg: heavyWeight,
        percentOfTm: wave.heavyPct,
        ...(parsed.week === BLOCK_WEEKS
          ? { note: "Peaking (optional): work up to a heavy triple, then rep out singles/doubles, or AMRAP the last set." }
          : {}),
      });
    }

    const suppBasis = basisFor(suppMv);
    if (suppBasis != null) {
      const suppWeight = roundToIncrement(suppBasis * wave.suppPct, ctx.roundingKg);
      // Warm-up ramp for the back-off lift — it's a DIFFERENT movement from the
      // heavy main, so it gets its own ramp to the (lighter) work weight.
      items.push(
        ...buildGlobalWarmupItems({
          name: `${label(suppMv)} (back-off)`,
          movementId: suppMv,
          workingWeightKg: suppWeight,
          roundingKg: ctx.roundingKg,
          ...(ctx.warmupRamp ? { ramp: ctx.warmupRamp } : {}),
        }),
      );
      items.push({
        kind: "supplemental",
        name: `${label(suppMv)} (back-off)`,
        movementId: suppMv,
        sets: 4,
        reps: wave.suppReps,
        weightKg: suppWeight,
        percentOfTm: wave.suppPct,
      });
    }

    items.push({
      kind: "assistance",
      name: `Pull-Ups (Assistance ${session.assist})`,
      movementId: "pullup",
      sets: 3,
      reps: wave.assistReps,
      percentOfTm: wave.assistPct,
      note: `${wave.assistPct * 100}% = of max reps for bodyweight (or of 1RM if weighted). Add 2–3 optional accessories on the ${session.assist} list. 3–5 sets.`,
    });

    return { items };
  },

  onSessionLogged(
    instance: ZuluHtInstance,
    log: LoggedSession,
    _ctx: PlatformContext,
  ): { instance: ZuluHtInstance; recommendations: ProgramRecommendation[] } {
    const parsed = parseRef(log.ref);
    if (!parsed) return { instance, recommendations: [] };
    const lastSession = SESSIONS[SESSIONS.length - 1]!.id;
    const isBlockEnd = parsed.week === BLOCK_WEEKS && parsed.sessionId === lastSession;
    if (!isBlockEnd) return { instance, recommendations: [] };

    const blockNum = parsed.block + 1;
    const recommendations: ProgramRecommendation[] = [
      {
        kind: "tm-test",
        title: "Retest your maxes",
        detail: "You've finished a 3-week Zulu/HT mass block. Retest or re-estimate your 1RMs before re-seeding the next block.",
        data: { block: blockNum },
      },
    ];
    if (blockNum < instance.blocks) {
      recommendations.push({
        kind: "next-block",
        title: "Start your next Zulu/HT block",
        detail: `Begin block ${blockNum + 1}.`,
        data: { nextBlock: blockNum + 1 },
      });
    }
    return { instance, recommendations };
  },
};
