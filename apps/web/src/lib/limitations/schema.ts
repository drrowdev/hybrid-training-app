/**
 * Validation schema for the /app/recovery/injuries form.
 *
 * Lives in its own module (not actions.ts) because Next.js requires
 * `"use server"` files to export only async functions — a Zod schema
 * object would break the build there. Both the client modal and the
 * server actions import from here so the rules can't drift.
 *
 * v2 changes (PR `feat/limitations-v2-lifecycle`):
 *   - `expectedDurationDays` removed — the user explicitly rejected
 *     duration estimates as a concept.
 *   - `affectedSide` added — 'left' | 'right' | 'bilateral' | null
 *     for future trend data; engine ignores at this stage.
 *   - `allowedMovementIds` added — per-exercise allow-list, the
 *     user-asserted "I can still do this one without pain."
 */
import { z } from "zod";
import { ALL_MUSCLE_GROUPS } from "@/lib/muscle/muscle-groups";
import { REGIONS } from "@/lib/settings/limitations-constants";

export const AFFECTED_SIDES = ["left", "right", "bilateral"] as const;
export type AffectedSide = (typeof AFFECTED_SIDES)[number];

export const limitationFormSchema = z
  .object({
    kind: z
      .string()
      .trim()
      .min(1, "Kind is required")
      .max(80, "Keep it short"),
    severity: z.enum(["mild", "moderate", "severe"]),
    /**
     * Optional engine-facing region.
     *   - omitted (`undefined`) → "Auto": inferred from the muscles.
     *   - explicit `null` → "None": no region filter.
     *   - a region value → used verbatim.
     * Left optional so callers that never set it stay byte-identical.
     */
    region: z.enum(REGIONS).nullable().optional(),
    affectedMuscles: z
      .array(z.enum(ALL_MUSCLE_GROUPS as unknown as [string, ...string[]]))
      .max(16),
    affectedMovementIds: z.array(z.string().uuid()).max(40),
    allowedMovementIds: z.array(z.string().uuid()).max(80).default([]),
    affectedSide: z.enum(AFFECTED_SIDES).nullable().default(null),
    notes: z.string().trim().max(2000).optional().nullable(),
  })
  .refine(
    (v) => v.affectedMuscles.length > 0 || v.affectedMovementIds.length > 0,
    {
      message: "Pick at least one muscle or one movement",
      path: ["affectedMuscles"],
    },
  );

export type LimitationFormInput = z.infer<typeof limitationFormSchema>;

export type LimitationActionResult =
  | { ok: true; id: string }
  | { ok: false; error: string };
