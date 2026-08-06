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
  ProgramSegment,
} from "@hta/program-core";
import { buildGlobalWarmupItems } from "@hta/program-core";
import {
  TB_TEMPLATES,
  TB_MOVEMENT_LABEL,
  getTbTemplate,
  type TbTemplate,
  type TbLiftKind,
  type TbClusterEntry,
  activationCustomizationKey,
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
  /** Canonical Activation slot whose prescription rules this replacement inherits. */
  sourceMovement?: string;
}

export interface TbActivationSessionOverride {
  movementOverrides: Record<string, TbClusterLift | null>;
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
  /**
   * Direct Tactical Barbell programs use the template's prescribed TB3 loadout.
   * Composite engines (Green Protocol) set this false because they own the
   * strength cluster while reusing TB's loading wave.
   */
  useTemplateDefaults: boolean;
  /** Activation Armor Supp A choice, selected once for all Armor sessions. */
  armorSupplementalA: "back-extension" | "reverse-hyper";
  /** Activation Armor Supp B choice, selected once for all Armor sessions. */
  armorSupplementalB: "pullup" | "inverted-row";
  /** Customized template: exact engine movements assigned to each weekly slot. */
  customSessionMovements?: Record<string, TbClusterLift[]>;
  /** Activation v2: canonical-slot overrides keyed by phase-qualified session key. */
  activationSessionOverrides?: Record<string, TbActivationSessionOverride>;
  /** Activation v2: derived source-slot overrides for protected milestone weeks. */
  activationMilestoneOverrides?: Record<string, TbActivationSessionOverride>;
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
  const m = ref.match(/^b(\d+)-w(\d+)-([a-z0-9-]+)$/);
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
    "K. Black's Tactical Barbell — TB3 Operator, Fighter, Zulu and the 25-week Activation on-ramp, plus established strength templates built to coexist with conditioning.",
};

// Warm-up ramp is the shared global routine (see buildGlobalWarmupItems in
// @hta/program-core): 40/60/80% of the work set × 5/5/3, floored.

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

function sessionLifts(
  template: TbTemplate,
  instance: TbInstance,
  session: TbTemplate["weeklySessions"][number],
  week?: number,
): TbClusterLift[] {
  const seriesKey = sessionSeriesKey(template, session);
  const customized = instance.customSessionMovements?.[seriesKey];
  const workSession = workSessionForSeries(template, seriesKey);
  const canonicalWorkSelection =
    workSession?.fixedMovements ?? template.defaultCluster;
  const usesCustomizedSelection =
    customized != null &&
    customized.length > 0 &&
    !sameMovementSelection(customized, canonicalWorkSelection);
  const translatedTest = usesCustomizedSelection && customized
    ? translateTestSelection(
        template,
        session,
        customized,
        canonicalWorkSelection,
      )
    : null;
  let lifts =
    translatedTest
      ? translatedTest.lifts
      : usesCustomizedSelection
        ? customized.map((entry) => ({ ...entry }))
      : instance.useTemplateDefaults && session.fixedMovements
        ? session.fixedMovements.map((entry) => cloneEntry(entry))
        : instance.cluster.filter((c) =>
            session.split ? c.split === session.split : true,
          );
  if (template.id === "activation") {
    const activationKey = activationCustomizationKey(session);
    const activationOverride = activationKey
      ? instance.activationSessionOverrides?.[activationKey]
      : week != null
        ? instance.activationMilestoneOverrides?.[
            `activation.milestone.w${week}.${session.id}`
          ]
        : undefined;
    lifts = lifts.flatMap((lift): TbClusterLift[] => {
      const sourceMovement = lift.movement;
      let resolvedDefault = cloneEntry(lift);
      if (
        session.id.startsWith("armor-a") &&
        sourceMovement === "back-extension"
      ) {
        resolvedDefault = {
          movement:
            instance.armorSupplementalA === "reverse-hyper"
              ? "reverse-hyper"
              : "back-extension",
        };
      }
      if (
        session.id.startsWith("armor-b") &&
        sourceMovement === "pullup"
      ) {
        resolvedDefault = {
          movement:
            instance.armorSupplementalB === "inverted-row"
              ? "inverted-row"
              : "pullup",
          kind: "unanchored",
        };
      }
      if (!activationOverride) return [resolvedDefault];
      const replacement =
        activationOverride.movementOverrides[sourceMovement];
      if (replacement === null) return [];
      if (!replacement) return [resolvedDefault];
      return [
        {
          ...cloneEntry(replacement),
          sourceMovement,
        },
      ];
    });
  }
  const excluded = new Set(session.excludeMovements ?? []);
  lifts = lifts.filter((lift) => !excluded.has(lift.movement));
  for (const entry of session.includeMovements ?? []) {
    if (!lifts.some((lift) => lift.movement === entry.movement)) {
      lifts.push(cloneEntry(entry));
    }
  }
  return lifts;
}

function sameMovementSelection(
  left: readonly TbClusterEntry[],
  right: readonly TbClusterEntry[] | undefined,
): boolean {
  if (!right || left.length !== right.length) return false;
  const normalize = (entry: TbClusterEntry) =>
    `${entry.movement}:${entry.kind ?? ""}`;
  return [...left].map(normalize).sort().join("|") ===
    [...right].map(normalize).sort().join("|");
}

function sessionSeriesKey(
  template: TbTemplate,
  session: TbTemplate["weeklySessions"][number],
): string {
  if (template.id === "activation") {
    return (
      activationCustomizationKey(session) ??
      `activation.milestone.${session.id}`
    );
  }
  const workSessions = template.weeklySessions.filter(
    (candidate) =>
      candidate.conditioning == null &&
      candidate.kind !== "test" &&
      candidate.kind !== "rest" &&
      (!candidate.activeWeeks || candidate.activeWeeks.includes(1)),
  );
  const workIndex = workSessions.findIndex(
    (candidate) => candidate.id === session.id,
  );
  if (workIndex >= 0) return `slot-${workIndex + 1}`;
  const peakIndex = template.weeklySessions
    .filter((candidate) => candidate.id.startsWith("peak-"))
    .findIndex((candidate) => candidate.id === session.id);
  if (peakIndex >= 0) return `slot-${peakIndex + 1}`;
  return session.id;
}

function workSessionForSeries(
  template: TbTemplate,
  seriesKey: string,
): TbTemplate["weeklySessions"][number] | undefined {
  return template.weeklySessions.find(
    (candidate) =>
      sessionSeriesKey(template, candidate) === seriesKey &&
      candidate.kind !== "test" &&
      candidate.conditioning == null &&
      (!candidate.activeWeeks || candidate.activeWeeks.includes(1)),
  );
}

function translateTestSelection(
  template: TbTemplate,
  session: TbTemplate["weeklySessions"][number],
  customized: readonly TbClusterEntry[],
  canonicalWorkSelection: readonly TbClusterEntry[],
): { lifts: TbClusterLift[]; movementMap: Map<string, string> } | null {
  if (session.kind !== "test" || !session.fixedMovements) return null;
  const baseNames = new Set(
    canonicalWorkSelection.map((entry) => entry.movement),
  );
  const used = new Set<string>();
  const movementMap = new Map<string, string>();
  const lifts: TbClusterLift[] = [];

  for (const fixed of session.fixedMovements) {
    const exact = customized.find(
      (entry) => entry.movement === fixed.movement && !used.has(entry.movement),
    );
    const added = customized.find(
      (entry) => !baseNames.has(entry.movement) && !used.has(entry.movement),
    );
    const fallback = customized.find(
      (entry) => !used.has(entry.movement),
    );
    const replacement = exact ?? added ?? fallback;
    if (!replacement) continue;
    used.add(replacement.movement);
    movementMap.set(fixed.movement, replacement.movement);
    lifts.push(cloneEntry(replacement));
  }

  return lifts.length > 0 ? { lifts, movementMap } : null;
}

function customizedPeakMovements(
  template: TbTemplate,
  session: TbTemplate["weeklySessions"][number],
  customized: readonly TbClusterEntry[],
): Set<string> | null {
  if (!session.peakMovements) return null;
  const workSession = workSessionForSeries(
    template,
    sessionSeriesKey(template, session),
  );
  const canonicalWorkSelection =
    workSession?.fixedMovements ?? template.defaultCluster;
  if (sameMovementSelection(customized, canonicalWorkSelection)) return null;
  const translated = translateTestSelection(
    template,
    session,
    customized,
    canonicalWorkSelection,
  );
  if (!translated) return null;
  return new Set(
    session.peakMovements.flatMap((movement) => {
      const replacement = translated.movementMap.get(movement);
      return replacement ? [replacement] : [];
    }),
  );
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
        if (
          o.kind === "barbell" ||
          o.kind === "weighted-bw" ||
          o.kind === "bodyweight" ||
          o.kind === "unanchored"
        ) {
          lift.kind = o.kind;
        }

        if (o.split === "A" || o.split === "B") lift.split = o.split;
        out.push(lift);
      }
    }
  }
  return out;
}

function activationSessionOverridesFromValue(
  value: unknown,
): Record<string, TbActivationSessionOverride> | undefined {
  if (!value || typeof value !== "object") return undefined;
  const out: Record<string, TbActivationSessionOverride> = {};
  for (const [sessionKey, rawSession] of Object.entries(
    value as Record<string, unknown>,
  )) {
    if (!rawSession || typeof rawSession !== "object") continue;
    const rawMovements = (rawSession as Record<string, unknown>)
      .movementOverrides;
    if (!rawMovements || typeof rawMovements !== "object") continue;
    const movementOverrides: Record<string, TbClusterLift | null> = {};
    for (const [sourceMovement, rawReplacement] of Object.entries(
      rawMovements as Record<string, unknown>,
    )) {
      if (rawReplacement === null) {
        movementOverrides[sourceMovement] = null;
        continue;
      }
      const [replacement] = entriesFromValue([rawReplacement]);
      if (replacement) movementOverrides[sourceMovement] = replacement;
    }
    out[sessionKey] = { movementOverrides };
  }
  return Object.keys(out).length > 0 ? out : undefined;
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
          help: "TB3 Operator (3×/wk), Fighter (2×/wk), Zulu (A/B split), Activation (25-week on-ramp), plus Zulu I/A, Gladiator, Mass and Grey Man.",
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
    const useTemplateDefaults = v.useTemplateDefaults !== false;
    const armorSupplementalA =
      v.armorSupplementalA === "reverse-hyper"
        ? "reverse-hyper"
        : "back-extension";
    const armorSupplementalB =
      v.armorSupplementalB === "inverted-row"
        ? "inverted-row"
        : "pullup";
    const customMovementsBySeries: Record<string, TbClusterLift[]> = {};
    if (
      v.customSessionMovements &&
      typeof v.customSessionMovements === "object"
    ) {
      for (const [key, value] of Object.entries(
        v.customSessionMovements as Record<string, unknown>,
      )) {
        const entries = entriesFromValue(value);
        if (entries.length > 0) customMovementsBySeries[key] = entries;
      }
    }
    const customSessionMovements =
      Object.keys(customMovementsBySeries).length > 0
        ? customMovementsBySeries
        : undefined;
    const activationSessionOverrides = activationSessionOverridesFromValue(
      v.activationSessionOverrides,
    );
    const activationMilestoneOverrides = activationSessionOverridesFromValue(
      v.activationMilestoneOverrides,
    );

    return {
      templateId: template.id,
      blocks,
      blockWeeks: template.blockWeeks,
      cluster: resolveCluster(template, v),
      useTrainingMax,
      tmPercent,
      useTemplateDefaults,
      armorSupplementalA,
      armorSupplementalB,
      ...(customSessionMovements
        ? { customSessionMovements }
        : {}),
      ...(activationSessionOverrides
        ? { activationSessionOverrides }
        : {}),
      ...(activationMilestoneOverrides
        ? { activationMilestoneOverrides }
        : {}),
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
          if (session.activeWeeks && !session.activeWeeks.includes(week)) continue;
          const tags = [
            `template:${template.id}`,
            `block:${block + 1}`,
            `week:${week}`,
            `wave:${session.waveId}`,
            ...(session.split ? [`split:${session.split}`] : []),
          ];
          specs.push({
            ref: sessionRef(block, week, session.id),
            seriesKey: sessionSeriesKey(template, session),
            index: index++,
            label: `${template.name} · Block ${block + 1} · Wk ${week} · ${session.label}`,
            kind: session.kindByWeek?.[week] ?? session.kind ?? "training",
            title: session.label,
            weekLabel: `Block ${block + 1} · Wk ${week}`,
            ...(session.weekday != null ? { weekday: session.weekday } : {}),
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
    if (session.conditioning) {
      return {
        items: [
          {
            kind: "cardio",
            name: session.conditioning.name,
            ...(session.conditioning.durationMin != null
              ? { durationSec: session.conditioning.durationMin * 60 }
              : {}),
            note: session.conditioning.note,
          },
        ],
      };
    }
    const waves =
      instance.useTemplateDefaults || !template.delegatedWaves
        ? template.waves
        : template.delegatedWaves;
    const schemes =
      instance.useTemplateDefaults || !template.delegatedSetsReps
        ? template.setsReps
        : template.delegatedSetsReps;
    const wave = waves.find((wv) => wv.id === session.waveId);
    if (!wave) return { items: [] };

    const scheme = schemes[parsed.week - 1];
    const pct = wave.percents[parsed.week - 1];
    if (!scheme || pct == null) return { items: [] };

    const lifts = sessionLifts(template, instance, session, parsed.week);

    const items: PrescribedItem[] = [];
    const customizedSeries =
      instance.customSessionMovements?.[sessionSeriesKey(template, session)];
    const customPeaks = customizedSeries
      ? customizedPeakMovements(template, session, customizedSeries)
      : null;
    for (const lift of lifts) {
      const sourceMovement = lift.sourceMovement ?? lift.movement;
      const anchor = ctx.oneRepMaxes[lift.movement];
      const movementRange = session.movementSetRanges?.[sourceMovement];
      const setsMin = movementRange?.min ?? scheme.setsMin;
      const setsMax = movementRange?.max ?? scheme.setsMax;
      const isPeak = customPeaks
        ? customPeaks.has(lift.movement)
        : (session.peakMovements?.includes(sourceMovement) ?? false);
      const support = session.peakMovements && !isPeak ? session.support : undefined;
      let prescribedPercent: number | null = support?.percent ?? pct;
      let prescribedSetsMin = support?.sets ?? setsMin;
      let prescribedSetsMax = support?.sets ?? setsMax;
      let prescribedReps = support?.reps ?? scheme.reps;
      let prescribedRepsMax = support ? undefined : scheme.repsMax;
      let prescribedRepsLabel = support ? String(support.reps) : scheme.repsLabel;
      let prescribedItemKind: PrescribedItem["kind"] = "main";
      let includeWarmup = true;
      let ruleNote: string | undefined;

      for (const rule of session.prescriptionRules ?? []) {
        if (rule.activeWeeks && !rule.activeWeeks.includes(parsed.week)) continue;
        if (rule.movements && !rule.movements.includes(sourceMovement)) continue;
        if (rule.percent !== undefined) prescribedPercent = rule.percent;
        if (rule.setsMin != null) prescribedSetsMin = rule.setsMin;
        if (rule.setsMax != null) prescribedSetsMax = rule.setsMax;
        if (rule.reps != null) prescribedReps = rule.reps;
        if (rule.repsMax !== undefined) prescribedRepsMax = rule.repsMax;
        if (rule.repsLabel != null) prescribedRepsLabel = rule.repsLabel;
        if (rule.itemKind != null) prescribedItemKind = rule.itemKind;
        if (rule.warmup != null) includeWarmup = rule.warmup;
        if (rule.note != null) ruleNote = rule.note;
      }

      const rangeNote =
        ruleNote ??
        (prescribedSetsMin !== prescribedSetsMax
          ? `${prescribedSetsMin}–${prescribedSetsMax} sets — submaximal, stop short of failure`
          : isPeak
            ? "peak attempt — stop if technique breaks down"
            : "submaximal, stop short of failure");

      if (lift.kind === "unanchored" || prescribedPercent == null) {
        items.push({
          kind: prescribedItemKind,
          name: movementLabel(lift.movement),
          movementId: lift.movement,
          sets: prescribedSetsMin,
          ...(prescribedSetsMax !== prescribedSetsMin ? { setsMax: prescribedSetsMax } : {}),
          reps: prescribedReps,
          ...(prescribedRepsMax != null ? { repsMax: prescribedRepsMax } : {}),
          repsLabel: prescribedRepsLabel,
          note: rangeNote,
        });
        continue;
      }

      if (anchor == null || anchor <= 0) {
        // Fixed-loadout templates may intentionally begin before every max is
        // known (Activation establishes several in its test weeks). Preserve the
        // percentage prescription so the platform can materialise the movement
        // now and resolve a load from the user's later 1RM update.
        if (instance.useTemplateDefaults && session.fixedMovements) {
          items.push({
            kind: prescribedItemKind,
            name: movementLabel(lift.movement),
            movementId: lift.movement,
            sets: prescribedSetsMin,
            ...(prescribedSetsMax !== prescribedSetsMin ? { setsMax: prescribedSetsMax } : {}),
            reps: prescribedReps,
            ...(prescribedRepsMax != null ? { repsMax: prescribedRepsMax } : {}),
            repsLabel: prescribedRepsLabel,
            percentOfTm: prescribedPercent,
            note: `${rangeNote} · set a 1RM before this session`,
          });
        }
        continue;
      }

      // Bodyweight movements (e.g. pull-ups) are anchored on MAX CLEAN REPS and
      // prescribed as a % of that rep ceiling — never a weight (TB1).
      if (lift.kind === "bodyweight") {
        const targetReps = Math.max(1, Math.round(anchor * prescribedPercent));
        items.push({
          kind: "main",
          name: movementLabel(lift.movement),
          movementId: lift.movement,
          sets: prescribedSetsMin,
          ...(prescribedSetsMax !== prescribedSetsMin ? { setsMax: prescribedSetsMax } : {}),
          reps: targetReps,
          repsLabel: `${targetReps}`,
          percentOfTm: prescribedPercent,
          note: `bodyweight — ${Math.round(prescribedPercent * 100)}% of max reps; ${rangeNote}`,
        });
        continue;
      }

      const basis = instance.useTrainingMax
        ? roundToIncrement(anchor * instance.tmPercent, ctx.roundingKg)
        : anchor;
      const weightKg = roundToIncrement(basis * prescribedPercent, ctx.roundingKg);
      // Warm-up ramp to the working weight — shared global routine (40/60/80% ×
      // 5/5/3, floored). Submaximal TB work still benefits from a couple of ramp
      // sets to groove the lift.
      if (includeWarmup) {
        items.push(
          ...buildGlobalWarmupItems({
            name: movementLabel(lift.movement),
            movementId: lift.movement,
            workingWeightKg: weightKg,
            roundingKg: ctx.roundingKg,
          }),
        );
      }
      items.push({
        kind: prescribedItemKind,
        name: movementLabel(lift.movement),
        movementId: lift.movement,
        sets: prescribedSetsMin,
        ...(prescribedSetsMax !== prescribedSetsMin ? { setsMax: prescribedSetsMax } : {}),
        reps: prescribedReps,
        ...(prescribedRepsMax != null ? { repsMax: prescribedRepsMax } : {}),
        repsLabel: prescribedRepsLabel,
        weightKg,
        percentOfTm: prescribedPercent,
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

    const finalWeekSessions = template.weeklySessions.filter(
      (session) => !session.activeWeeks || session.activeWeeks.includes(template.blockWeeks),
    );
    const lastSessionId = finalWeekSessions[finalWeekSessions.length - 1]?.id;
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

  segments(instance: TbInstance): ProgramSegment[] {
    const out: ProgramSegment[] = [];
    for (let block = 0; block < instance.blocks; block++) {
      const template = getTbTemplate(instance.templateId);
      if (template?.segments) {
        for (const segment of template.segments) {
          out.push({
            ...segment,
            startWeekIndex: block * instance.blockWeeks + segment.startWeekIndex,
          });
        }
      } else {
        out.push({
          startWeekIndex: block * instance.blockWeeks,
          label: `Block ${block + 1}`,
          kind: "block",
        });
      }
    }
    return out;
  },
};
