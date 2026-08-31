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
import {
  addedLoadFromSystemLoad,
  buildGlobalWarmupItems,
  buildSystemLoadWarmupItems,
} from "@hta/program-core";
import { TB_MOVEMENT_LABEL, isSystemLoadMovement } from "./templates";
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

    /**
     * Emit one lift's warm-up ramp plus its working set.
     *
     * A cluster slot here is a bare movement key — Zulu/HT has no per-lift kind
     * to carry — so a belt-loaded movement is recognised by the movement
     * itself. Its 1RM counts bodyweight, which makes the percentage a TOTAL:
     * ramp on that total, then hand the lifter only what goes on the belt.
     */
    const emitLift = (args: {
      movement: string;
      name: string;
      kind: "main" | "supplemental";
      basisKg: number;
      percent: number;
      sets: number;
      reps: number;
      /** Extra cue for this lift, composed WITH any system-load note. */
      note?: string;
    }) => {
      const { movement, name, kind, basisKg, percent, sets, reps } = args;
      const targetKg = basisKg * percent;
      const systemLoad = isSystemLoadMovement(movement);
      // A system-load note states what the lifter must do or supply, so it
      // cannot be dropped in favour of an optional cue — both are kept.
      const composeNote = (required?: string) =>
        [required, args.note].filter(Boolean).join(" · ") || undefined;

      if (systemLoad && (ctx.bodyweightKg == null || ctx.bodyweightKg <= 0)) {
        // The total cannot be split without a bodyweight. Carry the percentage
        // so the session still materialises, rather than guessing a belt load.
        items.push({
          kind,
          name,
          movementId: movement,
          sets,
          reps,
          percentOfTm: percent,
          note: composeNote("set your bodyweight before this session")!,
        });
        return;
      }

      const workingKg = systemLoad
        ? addedLoadFromSystemLoad(targetKg, ctx.bodyweightKg!, (kg) =>
            roundToIncrement(kg, ctx.roundingKg),
          )
        : roundToIncrement(targetKg, ctx.roundingKg);

      items.push(
        ...(systemLoad
          ? buildSystemLoadWarmupItems({
              name,
              movementId: movement,
              workingSystemLoadKg: targetKg,
              bodyweightKg: ctx.bodyweightKg!,
              roundingKg: ctx.roundingKg,
              ...(ctx.warmupRamp ? { ramp: ctx.warmupRamp } : {}),
            })
          : buildGlobalWarmupItems({
              name,
              movementId: movement,
              workingWeightKg: workingKg,
              roundingKg: ctx.roundingKg,
              ...(ctx.warmupRamp ? { ramp: ctx.warmupRamp } : {}),
            })),
      );
      // Nothing left on the belt — the set is repped out rather than run at the
      // loaded rep scheme (TB3).
      const isMaxRepsSet = systemLoad && workingKg === 0;
      const note = composeNote(isMaxRepsSet ? "bodyweight — max clean reps" : undefined);
      items.push({
        kind,
        name,
        movementId: movement,
        sets,
        reps,
        weightKg: workingKg,
        percentOfTm: percent,
        ...(systemLoad ? { systemLoad: true } : {}),
        ...(isMaxRepsSet ? { isAmrap: true } : {}),
        ...(note ? { note } : {}),
      });
    };

    const heavyBasis = basisFor(heavyMv);
    if (heavyBasis != null) {
      emitLift({
        movement: heavyMv,
        name: `${label(heavyMv)} (heavy)`,
        kind: "main",
        basisKg: heavyBasis,
        percent: wave.heavyPct,
        sets: 4,
        reps: wave.heavyReps,
        ...(parsed.week === BLOCK_WEEKS
          ? {
              note: "Peaking (optional): work up to a heavy triple, then rep out singles/doubles, or AMRAP the last set.",
            }
          : {}),
      });
    }

    const suppBasis = basisFor(suppMv);
    if (suppBasis != null) {
      emitLift({
        movement: suppMv,
        name: `${label(suppMv)} (back-off)`,
        kind: "supplemental",
        basisKg: suppBasis,
        percent: wave.suppPct,
        sets: 4,
        reps: wave.suppReps,
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
