/**
 * Validation for a library protocol.
 *
 * Item validation is shared with the wizard and rehab schedule so a protocol
 * authored in Settings can be deployed without changing its prescription.
 *
 * The database carries its own CHECK constraints on item count and name length
 * (migration 0134). RLS lets a user write these tables directly through
 * PostgREST, so this schema is the first line of defence, not the only one.
 */
import { z } from "zod";
import { rehabProtocolItemSchema } from "./item-schema";

export { rehabProtocolItemSchema } from "./item-schema";

export const REHAB_PROTOCOL_MAX_ITEMS = 20;
export const REHAB_PROTOCOL_MAX_NAME = 120;

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
  name: z
    .string({ required_error: "Enter a protocol name." })
    .trim()
    .min(1, "Enter a protocol name.")
    .max(
      REHAB_PROTOCOL_MAX_NAME,
      `Use ${REHAB_PROTOCOL_MAX_NAME} characters or fewer for the protocol name.`,
    ),
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
  const issue = parsed.error.issues[0];
  const itemIndex =
    issue?.path[0] === "definition" && issue.path[1] === "items"
      ? issue.path[2]
      : undefined;
  const message = issue?.message ?? "That protocol isn't valid.";
  return {
    ok: false,
    error: typeof itemIndex === "number" ? `Movement ${itemIndex + 1}: ${message}` : message,
  };
}
