/**
 * Validation for a library protocol.
 *
 * Deliberately identical to the wizard's `rehabItemSchema` in
 * `platform/tb-customization.ts` — same bounds, same "reps or a hold time"
 * refine. A protocol authored in Settings has to satisfy exactly what the
 * wizard used to enforce, or it could not be deployed into a program.
 *
 * The database carries its own CHECK constraints on item count and name length
 * (migration 0134). RLS lets a user write these tables directly through
 * PostgREST, so this schema is the first line of defence, not the only one.
 */
import { z } from "zod";

export const REHAB_PROTOCOL_MAX_ITEMS = 20;
export const REHAB_PROTOCOL_MAX_NAME = 120;

export const rehabProtocolItemSchema = z
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
    message: "Each movement needs reps or a hold time.",
  });

const rehabProtocolLinkSchema = z
  .object({
    id: z.string().trim().min(1).max(40),
    name: z.string().trim().min(1).max(40),
    members: z.array(z.string().trim().min(1)).min(2).max(8),
  })
  .strict();

export const rehabProtocolDefinitionSchema = z
  .object({
    items: z.array(rehabProtocolItemSchema).min(1).max(REHAB_PROTOCOL_MAX_ITEMS),
    links: z.array(rehabProtocolLinkSchema).max(8).default([]),
  })
  .strict()
  .superRefine((value, ctx) => {
    // A link may only group movements the protocol actually contains. The
    // deploy path already rejects an orphaned rehab link
    // (`findOrphanedLinkMembers` in platform/actions.ts); moving authoring here
    // must not weaken that, or a protocol could only fail at deploy time.
    const known = new Set(value.items.map((item) => item.movementId));
    for (const [index, link] of value.links.entries()) {
      const missing = link.members.filter((member) => !known.has(member));
      if (missing.length > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["links", index],
          message:
            "A superset references a movement that isn't in this protocol. Remove the link or add the movement back.",
        });
      }
    }

    // `PrescriptionItem.circuit` is singular, so a movement in two links is
    // unrepresentable downstream and `sessionLinksSchema` rejects it at deploy.
    // The picker won't offer an overlapping selection, but the library is
    // writable directly through PostgREST — catching it here fails at save,
    // where the user can act on it, rather than at deploy.
    const seen = new Set<string>();
    for (const [index, link] of value.links.entries()) {
      for (const member of link.members) {
        if (seen.has(member)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["links", index],
            message: "A movement can only belong to one superset.",
          });
        }
        seen.add(member);
      }
    }

    const ids = value.links.map((link) => link.id);
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["links"],
        message: "Superset ids must be unique.",
      });
    }
  });

export const rehabProtocolInputSchema = z.object({
  name: z.string().trim().min(1).max(REHAB_PROTOCOL_MAX_NAME),
  definition: rehabProtocolDefinitionSchema,
});

export type RehabProtocolInput = z.infer<typeof rehabProtocolInputSchema>;
export type RehabProtocolDefinitionInput = z.infer<typeof rehabProtocolDefinitionSchema>;

/**
 * Parse the JSON the editor posts. Returns the first message rather than a
 * ZodError so callers can hand it straight to the user.
 */
export function parseRehabProtocolInput(
  raw: unknown,
): { ok: true; value: RehabProtocolInput } | { ok: false; error: string } {
  const parsed = rehabProtocolInputSchema.safeParse(raw);
  if (parsed.success) return { ok: true, value: parsed.data };
  return {
    ok: false,
    error: parsed.error.issues[0]?.message ?? "That protocol isn't valid.",
  };
}
