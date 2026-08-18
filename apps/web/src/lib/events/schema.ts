/**
 * Validation schemas + types for the /app/settings/events (priority events)
 * surface. Lives outside actions.ts because the "use server" file may
 * only export async functions.
 *
 * Modality vocab follows the existing `cardio_logs.modality` set
 * (`run | bike | swim | row | ski`) plus `strength` for lifting meets,
 * `padel` for racquet-sport priority dates, and `other` as the catch
 * all. The DB column is plain text so anything client-validated will
 * round-trip cleanly.
 */
import { z } from "zod";

export const EVENT_MODALITIES = [
  "run",
  "bike",
  "swim",
  "row",
  "ski",
  "strength",
  "padel",
  "other",
] as const;

export type EventModality = (typeof EVENT_MODALITIES)[number];

export const EVENT_PRIORITIES = ["A", "B", "C"] as const;
export type EventPriority = (typeof EVENT_PRIORITIES)[number];

/**
 * Loose per-modality performance payload. Authored by the modals,
 * stored as jsonb. Always optional fields — partial captures are fine.
 */
export const performanceSchema = z
  .object({
    targetTime: z.string().trim().max(16).optional().nullable(),
    targetDistanceKm: z.number().finite().min(0).max(1000).optional().nullable(),
    paceSecPerKm: z.number().int().min(60).max(3600).optional().nullable(),
    avgPowerW: z.number().int().min(0).max(2000).optional().nullable(),
    targetTotal: z.number().finite().min(0).max(2000).optional().nullable(),
    lifts: z
      .record(z.string().max(40), z.number().finite().min(0).max(2000))
      .optional()
      .nullable(),
    targetRank: z.string().trim().max(60).optional().nullable(),
    description: z.string().trim().max(500).optional().nullable(),
  })
  .strict();

export type EventPerformance = z.infer<typeof performanceSchema>;

export const eventFormSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  eventDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD"),
  priority: z.enum(EVENT_PRIORITIES),
  modality: z.enum(EVENT_MODALITIES),
  notes: z.string().trim().max(2000).optional().nullable(),
  targetPerformance: performanceSchema.optional().nullable(),
});

export type EventFormInput = z.infer<typeof eventFormSchema>;

export const captureResultSchema = z.object({
  result: performanceSchema.optional().nullable(),
  completed: z.boolean(),
});

export type CaptureResultInput = z.infer<typeof captureResultSchema>;

export type EventActionResult =
  | { ok: true; id: string }
  | { ok: false; error: string };
