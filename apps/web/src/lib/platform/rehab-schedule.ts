/**
 * Where a weekly Tactical Barbell block runs its rehab protocol.
 *
 * ## Why this is not in the customization blob
 *
 * `tbCustomizationV1Schema` encodes rehab as a DAY TYPE — a weekday is strength
 * OR conditioning OR rehab OR rest — so "rehab as the warm-up section of a
 * strength day" is unrepresentable there. The engine has always supported it
 * (`materializeProgram` embeds a same-day rehab prescription into the strength
 * session, which is how Activation does it); only the weekly blob could not say
 * it.
 *
 * Extending that blob was rejected for the reason ADR 0071 gives: it is a
 * `.strict()` union that `edit-context` `safeParse`s as ONE unit, so an older
 * build meeting an unknown key — or a relaxed refinement — silently drops the
 * WHOLE customization and the wizard opens with the user's block missing. This
 * envelope is an independently-versioned SIBLING of `customization` in
 * `setup_input`, parsed on its own, exactly like `sessionLinks`. A build that
 * predates it ignores the key and the customization still parses; the worst
 * case is rehab missing, never a lost block.
 *
 * ## Why placement is a SERIES KEY, not a weekday
 *
 * The user attaches rehab to a SESSION ("Day 1 · A"), on the loadout step —
 * which runs before the schedule step, so its weekday is not settled yet.
 * Resolving it in the wizard would mean replaying the engine's own seating rule
 * (`weekdays[positionInWeek]`), and that rule counts every non-rest timeline
 * spec while the wizard's series list filters out conditioning, test and
 * out-of-week sessions — so the two indices diverge the moment a template has
 * either. `PlannedSessionSpec` already carries `seriesKey`, so materialisation
 * resolves it exactly, and rehab follows its session when the schedule moves.
 *
 * `days` stays weekday-indexed because a standalone rehab day has no session to
 * hang off.
 *
 * ## Identity
 *
 * `localProtocolId` is the id everything else keys off: `rehab.<localId>` link
 * series, the `program_rehab_bindings` row, and — for a named protocol — the
 * `rehabSourceRef` that deleted-rehab tombstones reference. It is the library
 * row's uuid for a new attachment and `protocol-1` for a block converted from
 * the legacy shape, whose refs must not move underneath its own tombstones.
 */
import { z } from "zod";

import {
  LEGACY_REHAB_PROTOCOL_ID,
  isTbCustomizationV1,
  type TbCustomization,
} from "./tb-customization";

/** Envelope version. Bumped only on an incompatible shape change. */
export const REHAB_SCHEDULE_VERSION = 1 as const;

const rehabScheduleItemSchema = z
  .object({
    movementId: z.string().uuid(),
    movementName: z.string().trim().min(1).max(120),
    side: z.enum(["both", "left", "right"]).optional(),
    sets: z.number().int().min(1).max(20),
    reps: z.number().int().min(1).max(500).optional(),
    holdSeconds: z.number().int().min(1).max(3600).optional(),
    targetWeightKg: z.number().min(0).max(1000).optional(),
    instructions: z.string().trim().max(500).optional(),
  })
  .strict()
  .refine((item) => item.reps != null || item.holdSeconds != null, {
    message: "Each rehab movement needs reps or a hold time.",
  });

export const rehabScheduleSchema = z
  .object({
    version: z.literal(REHAB_SCHEDULE_VERSION),
    localProtocolId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
    name: z.string().trim().min(1).max(120),
    items: z.array(rehabScheduleItemSchema).min(1).max(20),
    /** Series keys of the sessions that carry rehab as their warm-up section. */
    series: z.array(z.string().trim().min(1).max(120)).max(14).default([]),
    /** Weekdays (0 = Mon … 6 = Sun) that run rehab as a session of its own. */
    days: z.array(z.number().int().min(0).max(6)).max(7).default([]),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (new Set(value.days).size !== value.days.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["days"],
        message: "Rehab days must be distinct.",
      });
    }
    if (new Set(value.series).size !== value.series.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["series"],
        message: "Each session can carry rehab at most once.",
      });
    }
    if (value.days.length === 0 && value.series.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Choose where this rehab protocol runs.",
      });
    }
  });

export type RehabSchedule = z.infer<typeof rehabScheduleSchema>;
export type RehabScheduleItem = z.infer<typeof rehabScheduleItemSchema>;

/**
 * Parse a persisted `setup_input.rehabSchedule` blob. Returns `undefined` for
 * anything malformed rather than throwing: the block itself is still readable,
 * and taking it down over its rehab would lose far more than it saves.
 */
export function parseStoredRehabSchedule(
  value: unknown,
): RehabSchedule | undefined {
  if (value == null) return undefined;
  const result = rehabScheduleSchema.safeParse(value);
  return result.success ? result.data : undefined;
}

/** Weekly-TB rehab as every reader needs it: what runs, and where. */
export type WeeklyRehabPlan = {
  /** Empty when the block has no rehab. */
  items: readonly RehabScheduleItem[];
  /** Weekdays running rehab as a session of its own. */
  days: readonly number[];
  /** Series keys whose session carries rehab. */
  series: readonly string[];
  localProtocolId: string;
  /**
   * Provenance stamped onto every materialised rehab item. `null` for a block
   * that predates the library — its `rehabSourceRef` values are already in the
   * user's tombstones and must not move.
   */
  protocolId: string | null;
  /** What the plan calls this rehab section. */
  protocolName: string;
};

const EMPTY_PLAN: WeeklyRehabPlan = {
  items: [],
  days: [],
  series: [],
  localProtocolId: LEGACY_REHAB_PROTOCOL_ID,
  protocolId: null,
  protocolName: "Rehab",
};

/**
 * The single home for weekly-TB rehab placement and content (AGENTS.md §6.9).
 *
 * The envelope wins whenever it is present. Without one, a block resolves to
 * exactly what it did before the envelope existed — its own `rehab.items` on
 * the weekdays its `dayTypes` marks — so a deployed block is unaffected until
 * the wizard next writes it.
 */
export function weeklyRehabPlan(
  customization: TbCustomization | undefined,
  schedule: RehabSchedule | undefined,
): WeeklyRehabPlan {
  if (schedule) {
    const legacy = schedule.localProtocolId === LEGACY_REHAB_PROTOCOL_ID;
    return {
      items: schedule.items,
      days: schedule.days,
      series: schedule.series,
      localProtocolId: schedule.localProtocolId,
      // Same rule the Activation path uses: the synthetic legacy id carries no
      // provenance, so a block converted from the old shape keeps emitting
      // `rehab-w<week>-d<day>` and its tombstones keep matching.
      protocolId: legacy ? null : schedule.localProtocolId,
      protocolName: legacy ? "Rehab" : schedule.name,
    };
  }
  if (!customization || !isTbCustomizationV1(customization)) return EMPTY_PLAN;
  const items = customization.rehab?.items ?? [];
  if (items.length === 0) return EMPTY_PLAN;
  return {
    items,
    days: customization.dayTypes.flatMap((type, day) =>
      type === "rehab" ? [day] : [],
    ),
    series: [],
    localProtocolId: LEGACY_REHAB_PROTOCOL_ID,
    protocolId: null,
    protocolName: "Rehab",
  };
}
