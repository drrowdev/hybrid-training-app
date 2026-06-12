/**
 * 5/3/1 as a platform ProgramEngine.
 *
 * Wraps the pure 5/3/1 rules (waves / warmup / supplemental / e1RM) in the
 * `@hta/program-core` contract so the platform can drive it polymorphically.
 *
 * Division of ownership (per the platform architecture):
 *   - This engine OWNS the methodology: the Leader/Anchor timeline, the
 *     per-session prescription, and the program-owned recommendations (7th-week
 *     TM test result + AMRAP-driven TM bumps).
 *   - The platform OWNS the canonical strength state: one-rep maxes arrive via
 *     `ctx.oneRepMaxes` (shared across programs). At setup this engine derives
 *     each lift's Training Max (TM = round(1RM × tmPercent)) and stores it on
 *     the instance, where it is then owned + advanced by the program. The shared
 *     1RM is never mutated here — TM changes are SURFACED as recommendations.
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
  PrescribedItemKind,
  LoggedSession,
  ProgramRecommendation,
} from "@hta/program-core";
import type { MainLift, SeventhWeekKind, WendlerWeek } from "./types";
import type { MainScheme } from "./waves";
import { buildMainSets } from "./waves";
import { buildWarmupSets } from "./warmup";
import { buildSupplementalSets, type SupplementalTemplateId } from "./supplemental";
import { suggestNewTrainingMax } from "./e1rm";
import { computeTrainingMax } from "./training-max";
import { roundToIncrement } from "./rounding";
import { getTemplateById } from "./wendler-templates";
import { groupDays } from "./blocks";

const LIFT_DISPLAY: Record<MainLift, string> = {
  squat: "Squat",
  bench: "Bench Press",
  deadlift: "Deadlift",
  press: "Overhead Press",
};

const DEFAULT_DAY_ORDER: MainLift[] = ["press", "deadlift", "bench", "squat"];

// ─────────────────────────────────────────────────────────────────────────────
// Instance shape (serialisable — persisted by the platform)
// ─────────────────────────────────────────────────────────────────────────────

export interface WendlerPhase {
  type: "phase";
  kind: "leader" | "anchor";
  cycles: 1 | 2;
  mainScheme: MainScheme;
  supplemental: SupplementalTemplateId;
}

export interface WendlerSeventhWeek {
  type: "seventh-week";
  mode: SeventhWeekKind;
}

export type WendlerSegment = WendlerPhase | WendlerSeventhWeek;

export interface WendlerInstance {
  /** Optional named template this instance was seeded from. */
  templateId?: string;
  /** Ordered Leader/Anchor/7th-week segments. */
  segments: WendlerSegment[];
  /** Which main lift is trained on each day of the rotation. */
  dayOrder: MainLift[];
  /** TM% used to derive the Training Maxes from the shared 1RMs. */
  tmPercent: number;
  /**
   * Per-lift Training Max (kg), DERIVED from the shared 1RMs at setup and then
   * OWNED by this instance (advanced by 5/3/1's own rules — the 7th-week test /
   * AMRAP bump). The platform's canonical strength state stays the 1RM; this is
   * 5/3/1's working number.
   */
  trainingMaxes: Partial<Record<MainLift, number>>;
  /**
   * Strength days per week. Determines how many main lifts share a session:
   * 4 (default) = one lift per day; 2 = two lifts per day. Optional for
   * back-compat — instances stored before this field default to 4 (1 lift/day),
   * preserving their original per-lift session layout.
   */
  daysPerWeek?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Ref encoding — a stable id for each planned session
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `s{seg}-c{cycle}-w{week}-d{group}` for training; `s{seg}-7w-d{group}` for the
 * 7th week. `group` is the day-group index (which main lifts are trained that
 * session). LEGACY refs encoded a single lift (`…-{lift}`); parseRef still reads
 * those so instances created before variable frequency keep resolving.
 */
function trainingRef(seg: number, cycle: number, week: 1 | 2 | 3, group: number): string {
  return `s${seg}-c${cycle}-w${week}-d${group}`;
}
function seventhRef(seg: number, group: number): string {
  return `s${seg}-7w-d${group}`;
}

/** Lifts trained per session, from the chosen weekly frequency (default 4 = 1/day). */
function liftsPerDay(instance: WendlerInstance): number {
  const days = instance.daysPerWeek ?? instance.dayOrder.length;
  return Math.max(1, Math.ceil(instance.dayOrder.length / Math.max(1, days)));
}

/** The day-groups (each a list of main lifts trained in one session). */
function liftGroups(instance: WendlerInstance): MainLift[][] {
  return groupDays(instance.dayOrder, liftsPerDay(instance));
}

interface ParsedRef {
  seg: number;
  /** Day-group index for new refs. */
  group?: number;
  /** Single lift for LEGACY refs (pre-variable-frequency instances). */
  lift?: MainLift;
  seventhWeek: boolean;
  cycle?: number;
  week?: 1 | 2 | 3;
}

function parseRef(ref: string): ParsedRef | null {
  // New day-group refs.
  const swG = ref.match(/^s(\d+)-7w-d(\d+)$/);
  if (swG) return { seg: Number(swG[1]), group: Number(swG[2]), seventhWeek: true };
  const trG = ref.match(/^s(\d+)-c(\d+)-w([123])-d(\d+)$/);
  if (trG) {
    return {
      seg: Number(trG[1]),
      cycle: Number(trG[2]),
      week: Number(trG[3]) as 1 | 2 | 3,
      group: Number(trG[4]),
      seventhWeek: false,
    };
  }
  // Legacy per-lift refs.
  const sw = ref.match(/^s(\d+)-7w-(squat|bench|deadlift|press)$/);
  if (sw) return { seg: Number(sw[1]), lift: sw[2] as MainLift, seventhWeek: true };
  const tr = ref.match(/^s(\d+)-c(\d+)-w([123])-(squat|bench|deadlift|press)$/);
  if (tr) {
    return {
      seg: Number(tr[1]),
      cycle: Number(tr[2]),
      week: Number(tr[3]) as 1 | 2 | 3,
      lift: tr[4] as MainLift,
      seventhWeek: false,
    };
  }
  return null;
}

/** Resolve a parsed ref to the lifts trained that session (legacy = single lift). */
function refLifts(instance: WendlerInstance, parsed: ParsedRef): MainLift[] {
  if (parsed.lift) return [parsed.lift];
  if (parsed.group != null) return liftGroups(instance)[parsed.group] ?? [];
  return [];
}

// ─────────────────────────────────────────────────────────────────────────────
// Prescription mapping (wendler PrescribedSet → program-core PrescribedItem)
// ─────────────────────────────────────────────────────────────────────────────

interface RawSet {
  kind: PrescribedItemKind;
  name: string;
  weightKg: number;
  reps: number;
  percentOfTm?: number;
  isAmrap?: boolean;
  repsLabel?: string;
}

/** Collapse consecutive identical sets into one item with a `sets` count. */
function collapse(raw: RawSet[]): PrescribedItem[] {
  const out: PrescribedItem[] = [];
  for (const s of raw) {
    const prev = out[out.length - 1];
    const same =
      prev &&
      prev.kind === s.kind &&
      prev.name === s.name &&
      prev.weightKg === s.weightKg &&
      prev.reps === s.reps &&
      prev.percentOfTm === s.percentOfTm &&
      !!prev.isAmrap === !!s.isAmrap &&
      prev.repsLabel === s.repsLabel;
    if (same) {
      prev!.sets = (prev!.sets ?? 1) + 1;
      continue;
    }
    out.push({
      kind: s.kind,
      name: s.name,
      sets: 1,
      reps: s.reps,
      weightKg: s.weightKg,
      ...(s.percentOfTm !== undefined ? { percentOfTm: s.percentOfTm } : {}),
      ...(s.isAmrap ? { isAmrap: true } : {}),
      ...(s.repsLabel ? { repsLabel: s.repsLabel } : {}),
    });
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// The engine
// ─────────────────────────────────────────────────────────────────────────────

const META: ProgramMeta = {
  id: "wendler-531",
  name: "5/3/1",
  family: "531",
  summary:
    "Jim Wendler's 5/3/1 — percentage-based, submaximal main work off a Training Max, run in Leader/Anchor cycles with the 7th-Week Protocol.",
};

function evaluateTmTest(repsAtTm: number): "lower" | "hold" | "raise" {
  if (repsAtTm < 3) return "lower";
  if (repsAtTm >= 5) return "raise";
  return "hold";
}

export const wendler531Engine: ProgramEngine<WendlerInstance> = {
  meta: META,

  describeSetup(): SetupSchema {
    return {
      fields: [
        {
          key: "templateId",
          label: "Template",
          type: "select",
          options: [
            { value: "5spro-fsl", label: "5's PRO + FSL (Leader → Anchor)" },
            { value: "bbb-leader", label: "Boring But Big (Leader → Anchor)" },
            { value: "original-531-fsl", label: "5/3/1 + FSL (Leader → Anchor)" },
          ],
          defaultValue: "5spro-fsl",
          help: "Seeds the Leader's main scheme + supplemental; the Anchor runs classic 5/3/1 + FSL.",
        },
        { key: "leaderCycles", label: "Leader cycles", type: "number", defaultValue: 2 },
        { key: "anchorCycles", label: "Anchor cycles", type: "number", defaultValue: 1 },
        { key: "tmPercent", label: "TM % of 1RM", type: "number", defaultValue: 0.85 },
      ],
    };
  },

  setup(input: ProgramSetupInput, ctx: PlatformContext): WendlerInstance {
    const v = input.values;
    const templateId = typeof v.templateId === "string" ? v.templateId : "5spro-fsl";
    const tpl = getTemplateById(templateId);
    const leaderScheme: MainScheme = tpl?.mainScheme ?? "5s-pro";
    const leaderSupp: SupplementalTemplateId =
      tpl && tpl.supplementalTemplate !== "unsupported"
        ? (tpl.supplementalTemplate as SupplementalTemplateId)
        : "fsl";
    const clampCycles = (n: unknown): 1 | 2 => (Number(n) >= 2 ? 2 : 1);
    const leaderCycles = clampCycles(v.leaderCycles ?? 2);
    const anchorCycles = clampCycles(v.anchorCycles ?? 1);
    const tmPercent = Number(v.tmPercent ?? 0.85);

    const segments: WendlerSegment[] = [
      { type: "phase", kind: "leader", cycles: leaderCycles, mainScheme: leaderScheme, supplemental: leaderSupp },
      { type: "seventh-week", mode: "deload" },
      { type: "phase", kind: "anchor", cycles: anchorCycles, mainScheme: "classic-531", supplemental: "fsl" },
      { type: "seventh-week", mode: "tm-test" },
    ];

    // Derive the per-lift Training Max from the shared 1RMs (canonical platform
    // strength state). The TM is then owned + advanced by this instance.
    const dayOrder: MainLift[] = [...DEFAULT_DAY_ORDER];
    const trainingMaxes: Partial<Record<MainLift, number>> = {};
    for (const lift of dayOrder) {
      const oneRm = ctx.oneRepMaxes[lift];
      if (oneRm != null && oneRm > 0) {
        trainingMaxes[lift] = computeTrainingMax(oneRm, { tmPercent, roundingKg: ctx.roundingKg });
      }
    }

    // Strength days per week: 4 (one lift/day) or 2 (two lifts/day). Clamp to a
    // value that divides the 4 main lifts so each session is balanced; anything
    // else falls back to 4. Existing instances without this field default to 4.
    const rawDays = Number(v.daysPerWeek ?? dayOrder.length);
    const daysPerWeek = rawDays === 2 ? 2 : dayOrder.length;

    return { templateId, segments, dayOrder, tmPercent, trainingMaxes, daysPerWeek };
  },

  timeline(instance: WendlerInstance): PlannedSessionSpec[] {
    const out: PlannedSessionSpec[] = [];
    const groups = liftGroups(instance);
    const groupLabel = (g: MainLift[]) => g.map((l) => LIFT_DISPLAY[l]).join(" + ");
    const liftTags = (g: MainLift[]) => g.map((l) => `lift:${l}`);
    instance.segments.forEach((seg, si) => {
      if (seg.type === "seventh-week") {
        const kind = seg.mode === "deload" ? ("deload" as const) : ("test" as const);
        const proto = seg.mode === "deload" ? "Deload" : seg.mode === "tm-test" ? "TM Test" : "PR Test";
        groups.forEach((g, gi) => {
          out.push({
            ref: seventhRef(si, gi),
            index: out.length,
            label: `7th Week · ${proto} · ${groupLabel(g)}`,
            kind,
            weekLabel: "7w",
            tags: [`7w:${seg.mode}`, ...liftTags(g)],
          });
        });
        return;
      }
      const phaseLabel = seg.kind === "leader" ? "Leader" : "Anchor";
      for (let cycle = 1; cycle <= seg.cycles; cycle++) {
        for (const week of [1, 2, 3] as const) {
          groups.forEach((g, gi) => {
            out.push({
              ref: trainingRef(si, cycle, week, gi),
              index: out.length,
              label: `${phaseLabel} ${cycle} · Wk ${week} · ${groupLabel(g)}`,
              kind: "training",
              weekLabel: `${phaseLabel.toLowerCase()}${cycle}-w${week}`,
              tags: [`phase:${seg.kind}`, `cycle:${cycle}`, `week:${week}`, ...liftTags(g), `scheme:${seg.mainScheme}`],
            });
          });
        }
      }
    });
    return out;
  },

  prescribe(instance: WendlerInstance, ref: string, ctx: PlatformContext): SessionPrescription {
    const parsed = parseRef(ref);
    if (!parsed) return { items: [] };
    const seg = instance.segments[parsed.seg];
    if (!seg) return { items: [] };
    const r = ctx.roundingKg;
    const week: WendlerWeek = parsed.seventhWeek ? "7w" : (parsed.week as 1 | 2 | 3);
    const seventhWeekKind: SeventhWeekKind | undefined =
      parsed.seventhWeek && seg.type === "seventh-week" ? seg.mode : undefined;

    // A session trains one or more main lifts (one per day when daysPerWeek=4,
    // two when =2). Build each lift's warmup → main → supplemental block and
    // concatenate; movementId is stamped per lift.
    const items: PrescribedItem[] = [];
    for (const lift of refLifts(instance, parsed)) {
      const tm = instance.trainingMaxes[lift];
      if (tm == null) continue;
      const name = LIFT_DISPLAY[lift];
      const mainSets = buildMainSets({
        trainingMaxKg: tm,
        week,
        roundingKg: r,
        scheme: seg.type === "phase" ? seg.mainScheme : "classic-531",
        ...(seventhWeekKind ? { seventhWeekKind } : {}),
      });

      const raw: RawSet[] = [];
      // Warm-up ramp to the top working weight.
      const topWorking = mainSets.reduce((m, s) => Math.max(m, s.weightKg), 0);
      for (const w of buildWarmupSets(topWorking, r)) {
        raw.push({ kind: "warmup", name, weightKg: w.weightKg, reps: w.reps });
      }
      // Main sets.
      for (const s of mainSets) {
        raw.push({
          kind: s.isAmrap ? "amrap" : "main",
          name,
          weightKg: s.weightKg,
          reps: s.reps,
          ...(s.percentOfTm !== undefined ? { percentOfTm: s.percentOfTm } : {}),
          ...(s.isAmrap ? { isAmrap: true } : {}),
          ...(s.repsLabelOverride ? { repsLabel: s.repsLabelOverride } : {}),
        });
      }
      // Supplemental (training weeks only; buildSupplementalSets skips deload/7w).
      if (seg.type === "phase") {
        for (const s of buildSupplementalSets({ templateId: seg.supplemental, trainingMaxKg: tm, week, roundingKg: r })) {
          raw.push({
            kind: "supplemental",
            name,
            weightKg: s.weightKg,
            reps: s.reps,
            ...(s.percentOfTm !== undefined ? { percentOfTm: s.percentOfTm } : {}),
            ...(s.isAmrap ? { isAmrap: true } : {}),
          });
        }
      }

      for (const it of collapse(raw)) items.push({ ...it, movementId: lift });
    }

    return { items };
  },

  onSessionLogged(
    instance: WendlerInstance,
    log: LoggedSession,
    ctx: PlatformContext,
  ): { instance: WendlerInstance; recommendations: ProgramRecommendation[] } {
    const recommendations: ProgramRecommendation[] = [];
    const parsed = parseRef(log.ref);
    if (!parsed) return { instance, recommendations };
    const seg = instance.segments[parsed.seg];

    const lifts = refLifts(instance, parsed);
    if (lifts.length === 0) return { instance, recommendations };

    // A session can train more than one main lift (low-frequency splits), so
    // evaluate progression PER LIFT. Each lift owns its decisive set and its own
    // TM-test / AMRAP-bump verdict.
    for (const lift of lifts) {
      let liftSets = log.sets.filter((s) => s.movement === lift);
      // Legacy/single-lift safety: if movements weren't tagged but the session
      // trains only this lift, fall back to all sets.
      if (liftSets.length === 0 && lifts.length === 1) liftSets = log.sets;
      if (liftSets.length === 0) continue;

      // The decisive set: the AMRAP/top set if flagged, else the heaviest.
      const top =
        liftSets.find((s) => s.isAmrap) ??
        liftSets.reduce<typeof liftSets[number] | undefined>(
          (best, s) => (!best || s.weightKg > best.weightKg ? s : best),
          undefined,
        );
      if (!top) continue;

      // 7th-week TM test → validate the training max.
      if (parsed.seventhWeek && seg?.type === "seventh-week" && seg.mode === "tm-test") {
        const verdict = evaluateTmTest(top.reps);
        if (verdict === "lower") {
          recommendations.push({
            kind: "tm-reset",
            title: `${LIFT_DISPLAY[lift]} TM is too heavy`,
            detail: `Only ${top.reps} rep(s) at your training max on the TM test — 5/3/1 says drop the TM before the next cycle.`,
            data: { movement: lift, repsAtTm: top.reps },
          });
        } else if (verdict === "raise") {
          recommendations.push({
            kind: "tm-bump",
            title: `${LIFT_DISPLAY[lift]} TM validated — room to grow`,
            detail: `${top.reps} strong reps at your training max — you can take the standard bump into the next cycle.`,
            data: { movement: lift, repsAtTm: top.reps },
          });
        }
        continue;
      }

      // Normal AMRAP top set: a strong PR set suggests a TM bump (surfaced, not applied).
      if (top.isAmrap && top.reps >= 8) {
        const currentTm = instance.trainingMaxes[lift];
        const suggested = roundToIncrement(suggestNewTrainingMax(top.weightKg, top.reps, instance.tmPercent), ctx.roundingKg);
        if (currentTm != null && suggested > currentTm) {
          recommendations.push({
            kind: "tm-bump",
            title: `Strong ${LIFT_DISPLAY[lift]} AMRAP — consider a TM bump`,
            detail: `${top.reps} reps @ ${top.weightKg} kg implies a higher training max.`,
            data: { movement: lift, fromTmKg: currentTm, suggestedTmKg: suggested, reps: top.reps },
          });
        }
      }
    }

    return { instance, recommendations };
  },
};
