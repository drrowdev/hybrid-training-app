/**
 * Validation schema for the /app/recovery/injuries form.
 *
 * Lives in its own module (not actions.ts) because Next.js requires
 * `"use server"` files to export only async functions — a Zod schema
 * object would break the build there. Both the client modal and the
 * server actions import from here so the rules can't drift.
 */
import { z } from "zod";
import { ALL_MUSCLE_GROUPS } from "@/lib/muscle/muscle-groups";

export const limitationFormSchema = z
  .object({
    kind: z
      .string()
      .trim()
      .min(1, "Kind is required")
      .max(80, "Keep it short"),
    severity: z.enum(["mild", "moderate", "severe"]),
    affectedMuscles: z
      .array(z.enum(ALL_MUSCLE_GROUPS as unknown as [string, ...string[]]))
      .max(16),
    affectedMovementIds: z.array(z.string().uuid()).max(40),
    notes: z.string().trim().max(2000).optional().nullable(),
    expectedDurationDays: z
      .number()
      .int()
      .min(0)
      .max(3650)
      .optional()
      .nullable(),
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
