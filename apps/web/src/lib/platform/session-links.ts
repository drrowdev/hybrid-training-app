/**
 * User-authored session links (supersets / tri-sets / giant sets).
 *
 * Replaces the block-level `superset_accessories` toggle, which auto-paired
 * anatomical antagonists at read time. Instead of the engine guessing, the user
 * explicitly links two or more lifts in a strength slot and the engine emits the
 * existing `circuit` metadata for them — so the logger's round-major navigation,
 * the preview bracket, and the duration estimate all come for free.
 *
 * ## Why this lives OUTSIDE the TB customization blob
 *
 * The obvious home was `tbCustomizationV1Schema.sessionMovements`'s sibling. It
 * is deliberately NOT there:
 *
 *   - The wizard only builds a `customization` when the user ticks "Customize
 *     this template". Links must work on canonical Operator / Fighter / Zulu and
 *     on Activation too, so binding them to the customization would gate the
 *     feature behind an unrelated opt-in.
 *   - `tbCustomizationSchema` is a `.strict()` union whose `version` literals
 *     (1 = weekly, 2/3 = Activation) form one shared sequence. Adding a field
 *     would force either a version bump plus a capability-predicate refactor of
 *     every `isTbCustomizationV1()` gate, or an un-versioned strict-schema change
 *     that an older build would reject — silently dropping the whole
 *     customization, because `edit-context` `safeParse`s it as one unit.
 *
 * Keeping links in their own independently-versioned envelope means a parse
 * failure on one never destroys the other, and the customization schemas are
 * untouched.
 *
 * ## Identity
 *
 * Members are `sourceMovement ?? movement` keys — the SAME identity the engine
 * already uses for AB Triad detection and `session.peakMovements`. That matters
 * for Activation, where `movementOverrides` swap which movement fills a
 * canonical slot: a link stored against the slot survives the swap.
 */
import { z } from "zod";

/** Envelope version. Bumped only on an incompatible shape change. */
export const SESSION_LINKS_VERSION = 1 as const;

/**
 * Circuit ids the ENGINE owns. A user link may never claim one, or it would
 * collide with built-in circuit metadata in the materialised prescription.
 */
export const RESERVED_LINK_IDS: readonly string[] = ["tb-ab-triad"];

/** Upper bound on members in one link — a giant set beyond this is a workout. */
export const MAX_LINK_MEMBERS = 8;
/** Upper bound on links within one strength slot. */
export const MAX_LINKS_PER_SERIES = 6;

/**
 * Milestone/test sessions are NOT linkable in v1.
 *
 * `sessionSeriesKey()` falls back to `activation.milestone.${session.id}` for
 * Activation sessions with no phase, but that key is unreachable and unsafe:
 * the wizard's Activation projection filters to sessions where
 * `activationPhaseForSession(session) === phase`, so it never produces a
 * milestone key at all; and the unqualified id collapses repeats (`operator-test`
 * runs in two different weeks that derive from different predecessor phases).
 * Rejecting the prefix keeps the ambiguity unrepresentable rather than storing a
 * link that silently applies to the wrong week.
 */
export const MILESTONE_SERIES_PREFIX = "activation.milestone.";

/**
 * Default human name for a link of `n` STATIONS.
 *
 * Stations, not members: the AB Triad is three movements the lifter thinks of as
 * one thing, so linking a lift to it is a superset of two stations, not a giant
 * set of four. Required by the logger, which rejects circuit metadata carrying
 * an empty name.
 */
export function defaultLinkName(stationCount: number): string {
  if (stationCount <= 2) return "Superset";
  if (stationCount === 3) return "Tri-set";
  return "Giant set";
}

const linkIdSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{0,31}$/, "Link id must be lowercase kebab-case.");

/**
 * A movement key, matching the vocabulary of `sessionMovements` / the TB
 * cluster: either a plain template movement (`squat`) or a catalog reference
 * (`catalog:<uuid>`).
 */
const memberSchema = z.string().trim().min(1).max(80);

/**
 * Series keys are validated permissively rather than against an allowlist:
 * `sessionSeriesKey()` emits `slot-N` for weekly templates,
 * `activation.<phase>.<id>` for Activation, and falls back to a bare
 * `session.id`. An allowlist would silently reject legitimate keys as templates
 * evolve. The one thing we DO reject is the milestone prefix (see above).
 * Member existence is checked server-side against the resolved session, which is
 * the real integrity gate.
 */
const seriesKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(96)
  .regex(/^[a-z0-9][a-z0-9.\-]*$/, "Invalid session series key.")
  .refine((key) => !key.startsWith(MILESTONE_SERIES_PREFIX), {
    message: "Milestone and test sessions can't be linked.",
  });

export const sessionLinkSchema = z
  .object({
    id: linkIdSchema,
    name: z.string().trim().min(1).max(40),
    members: z.array(memberSchema).min(2).max(MAX_LINK_MEMBERS),
  })
  .strict()
  .superRefine((link, ctx) => {
    if (RESERVED_LINK_IDS.includes(link.id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["id"],
        message: `'${link.id}' is reserved for a built-in circuit.`,
      });
    }
    if (new Set(link.members).size !== link.members.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["members"],
        message: "A lift can only appear once in a link.",
      });
    }
  });

export const sessionLinksSchema = z
  .object({
    version: z.literal(SESSION_LINKS_VERSION),
    bySeries: z.record(
      seriesKeySchema,
      z.array(sessionLinkSchema).min(1).max(MAX_LINKS_PER_SERIES),
    ),
  })
  .strict()
  .superRefine((value, ctx) => {
    for (const [seriesKey, links] of Object.entries(value.bySeries)) {
      const ids = links.map((link) => link.id);
      if (new Set(ids).size !== ids.length) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["bySeries", seriesKey],
          message: "Link ids must be unique within a session.",
        });
      }
      // `PrescriptionItem.circuit` is singular, so a movement can belong to at
      // most one link — two links sharing a member is unrepresentable downstream.
      const seen = new Set<string>();
      for (const link of links) {
        for (const member of link.members) {
          if (seen.has(member)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["bySeries", seriesKey],
              message: `'${member}' is already in another link for this session.`,
            });
          }
          seen.add(member);
        }
      }
    }
  });

export type SessionLink = z.infer<typeof sessionLinkSchema>;
export type SessionLinks = z.infer<typeof sessionLinksSchema>;

/** An empty, valid envelope — the canonical "no links" value. */
export function emptySessionLinks(): SessionLinks {
  return { version: SESSION_LINKS_VERSION, bySeries: {} };
}

/** True when the envelope carries no actual links (so callers can omit it). */
export function isEmptySessionLinks(links: SessionLinks | undefined): boolean {
  if (!links) return true;
  return Object.values(links.bySeries).every((list) => list.length === 0);
}

/**
 * Drop empty series entries and return `undefined` when nothing is left, so the
 * create/edit payload never persists `{ bySeries: { "slot-1": [] } }` noise.
 */
export function normalizeSessionLinks(
  links: SessionLinks | undefined,
): SessionLinks | undefined {
  if (!links) return undefined;
  const bySeries: Record<string, SessionLink[]> = {};
  for (const [key, list] of Object.entries(links.bySeries)) {
    if (list.length > 0) bySeries[key] = list;
  }
  return Object.keys(bySeries).length > 0
    ? { version: SESSION_LINKS_VERSION, bySeries }
    : undefined;
}

/** Flatten to the engine-facing map the TB instance carries. */
export function linksBySeries(
  links: SessionLinks | undefined,
): Record<string, SessionLink[]> {
  return links ? { ...links.bySeries } : {};
}

/**
 * Names the links that reference a movement the session no longer contains.
 *
 * The engine already refuses to realise a link with a missing member, but it
 * does so SILENTLY — the lifter would deploy and simply find the superset
 * absent. Callers that know the session's movement list (the wizard sends it
 * with the customization) can use this to say so instead.
 *
 * Returns the offending members grouped by series key; an empty array means
 * every link is satisfiable.
 */
export function findOrphanedLinkMembers(
  links: SessionLinks | undefined,
  movementsBySeries: Readonly<Record<string, readonly string[]>>,
): { seriesKey: string; linkId: string; missing: string[] }[] {
  if (!links) return [];
  const out: { seriesKey: string; linkId: string; missing: string[] }[] = [];
  for (const [seriesKey, list] of Object.entries(links.bySeries)) {
    const available = new Set(movementsBySeries[seriesKey] ?? []);
    for (const link of list) {
      const missing = link.members.filter((m) => !available.has(m));
      if (missing.length > 0) {
        out.push({ seriesKey, linkId: link.id, missing });
      }
    }
  }
  return out;
}

/** Parse a persisted `setup_input.sessionLinks` blob. Returns `undefined` for
 * anything unparseable so a malformed/legacy value degrades to "no links"
 * instead of throwing — the same posture `edit-context` takes for the
 * customization, and the reason the two are parsed independently.
 */
export function parseStoredSessionLinks(
  value: unknown,
): SessionLinks | undefined {
  if (value == null) return undefined;
  const result = sessionLinksSchema.safeParse(value);
  return result.success ? result.data : undefined;
}
