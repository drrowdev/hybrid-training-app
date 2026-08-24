/**
 * Where a weekly Tactical Barbell block runs its rehab protocols.
 *
 * ## Why this is not in the customization blob
 *
 * `tbCustomizationV1Schema` encodes rehab as a DAY TYPE — a weekday is strength
 * OR conditioning OR rehab OR rest — so "rehab as the warm-up section of a
 * strength day" is unrepresentable there, and it carries exactly one unnamed
 * item list. The engine has always supported the placement
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
 * ## Why a session is addressed by SERIES KEY, not by weekday
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
 * A protocol's `id` here is the LOCAL protocol id — what everything else keys
 * off: the `rehab.<localId>` link series, the `program_rehab_bindings` row, and
 * (for a named protocol) the `rehabSourceRef` that deleted-rehab tombstones
 * reference. It is the library row's uuid for a new attachment and `protocol-1`
 * for a block converted from the legacy shape, whose refs must not move
 * underneath its own tombstones.
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

const rehabScheduleProtocolSchema = z
  .object({
    /** LOCAL protocol id: a library uuid, or `protocol-1` for a converted block. */
    id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
    name: z.string().trim().min(1).max(120),
    items: z.array(rehabScheduleItemSchema).min(1).max(20),
  })
  .strict();

export const rehabScheduleSchema = z
  .object({
    version: z.literal(REHAB_SCHEDULE_VERSION),
    protocols: z.array(rehabScheduleProtocolSchema).min(1).max(8),
    /** Sessions that carry a protocol as their warm-up section. */
    series: z
      .array(
        z
          .object({
            key: z.string().trim().min(1).max(120),
            protocolId: z.string().min(1).max(64),
          })
          .strict(),
      )
      .max(14)
      .default([]),
    /** Weekdays (0 = Mon … 6 = Sun) that run a protocol as a session of their own. */
    days: z
      .array(
        z
          .object({
            day: z.number().int().min(0).max(6),
            protocolId: z.string().min(1).max(64),
          })
          .strict(),
      )
      .max(7)
      .default([]),
  })
  .strict()
  .superRefine((value, ctx) => {
    const ids = value.protocols.map((protocol) => protocol.id);
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["protocols"],
        message: "Rehab protocol ids must be unique.",
      });
    }
    const days = value.days.map((entry) => entry.day);
    if (new Set(days).size !== days.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["days"],
        message: "Each day can run at most one rehab protocol.",
      });
    }
    const keys = value.series.map((entry) => entry.key);
    if (new Set(keys).size !== keys.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["series"],
        message: "Each session can carry at most one rehab protocol.",
      });
    }
    if (value.days.length === 0 && value.series.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Choose where these rehab protocols run.",
      });
    }
    // A placement naming a protocol that isn't here resolves to nothing at
    // materialisation — silently, because the engine simply finds no items.
    const known = new Set(ids);
    for (const [index, entry] of value.series.entries()) {
      if (!known.has(entry.protocolId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["series", index],
          message: `Rehab protocol '${entry.protocolId}' does not exist.`,
        });
      }
    }
    for (const [index, entry] of value.days.entries()) {
      if (!known.has(entry.protocolId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["days", index],
          message: `Rehab protocol '${entry.protocolId}' does not exist.`,
        });
      }
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

export type WeeklyRehabProtocol = {
  localProtocolId: string;
  /**
   * Provenance stamped onto every materialised rehab item. `null` for a block
   * that predates the library — its `rehabSourceRef` values are already in the
   * user's tombstones and must not move.
   */
  protocolId: string | null;
  /** What the plan calls this rehab section. */
  protocolName: string;
  items: readonly RehabScheduleItem[];
};

/** Weekly-TB rehab as every reader needs it: what runs, and where. */
export type WeeklyRehabPlan = {
  /** Empty when the block has no rehab. */
  protocols: readonly WeeklyRehabProtocol[];
  /** Series key → local protocol id. */
  bySeries: ReadonlyMap<string, string>;
  /** Weekday → local protocol id. */
  byDay: ReadonlyMap<number, string>;
};

const EMPTY_PLAN: WeeklyRehabPlan = {
  protocols: [],
  bySeries: new Map(),
  byDay: new Map(),
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
    return {
      protocols: schedule.protocols.map((protocol) => {
        // Same rule the Activation path uses: the synthetic legacy id carries
        // no provenance, so a block converted from the old shape keeps emitting
        // `rehab-w<week>-d<day>` and its tombstones keep matching.
        const legacy = protocol.id === LEGACY_REHAB_PROTOCOL_ID;
        return {
          localProtocolId: protocol.id,
          protocolId: legacy ? null : protocol.id,
          protocolName: legacy ? "Rehab" : protocol.name,
          items: protocol.items,
        };
      }),
      bySeries: new Map(
        schedule.series.map((entry) => [entry.key, entry.protocolId]),
      ),
      byDay: new Map(schedule.days.map((entry) => [entry.day, entry.protocolId])),
    };
  }
  if (!customization || !isTbCustomizationV1(customization)) return EMPTY_PLAN;
  const items = customization.rehab?.items ?? [];
  if (items.length === 0) return EMPTY_PLAN;
  return {
    protocols: [
      {
        localProtocolId: LEGACY_REHAB_PROTOCOL_ID,
        protocolId: null,
        protocolName: "Rehab",
        items,
      },
    ],
    bySeries: new Map(),
    byDay: new Map(
      customization.dayTypes.flatMap((type, day) =>
        type === "rehab" ? [[day, LEGACY_REHAB_PROTOCOL_ID] as const] : [],
      ),
    ),
  };
}
