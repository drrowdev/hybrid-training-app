/**
 * Phase 3 A1/B1 — daily check-in helpers.
 *
 * The "daily check-in" surface (bodyweight + sleep + motivation +
 * notes) is keyed `(user_id, date)` and stored in the existing
 * `wellness` table (see migration 0027 design note). The functions
 * here own (a) parsing the inbound payload, (b) mapping the
 * three-button sleep chip to an hours value, and (c) the upsert
 * shape used by both the Today-page bodyweight nudge and the
 * pre-session sleep affordance.
 *
 * No DB I/O happens in this module — actions.ts wires it up. Keeps
 * the mapping pure-testable.
 */

import { z } from "zod";

/** Three-button quick-tap sleep chip values (Phase 3 B1). */
export const SLEEP_CHIP_VALUES = ["lt6", "6to8", "gte8"] as const;
export type SleepChip = (typeof SLEEP_CHIP_VALUES)[number];

/**
 * Maps a sleep chip to a representative `sleep_hours` value.
 *
 *  `<6h`  → 5.5h (mid of the "noticeably short" bucket)
 *  `6-8h` → 7.0h (centre of the recommended range)
 *  `8h+`  → 8.5h (a tick above the lower bound so it's distinguishable
 *                 from 6-8h when aggregated)
 *
 * Quick-tap UX trades resolution for friction — users who want exact
 * hours can edit the wellness row in Settings.
 */
export function sleepHoursForChip(chip: SleepChip): number {
  switch (chip) {
    case "lt6":
      return 5.5;
    case "6to8":
      return 7.0;
    case "gte8":
      return 8.5;
  }
}

export const dailyCheckInSchema = z.object({
  date: z.string().date(),
  bodyweightKg: z.coerce.number().min(20).max(400).optional().nullable(),
  sleepHours: z.coerce.number().min(0).max(24).optional().nullable(),
  sleepChip: z.enum(SLEEP_CHIP_VALUES).optional().nullable(),
  motivation: z.coerce.number().int().min(1).max(5).optional().nullable(),
  notes: z.string().trim().max(400).optional().nullable(),
});

export type DailyCheckInInput = z.infer<typeof dailyCheckInSchema>;

/**
 * Normalise a parsed payload into the upsert shape written to
 * `public.wellness`. Resolves the chip → hours mapping. Returns null
 * for any field the caller didn't supply so the upsert leaves prior
 * values untouched (the caller is expected to filter undefined keys).
 */
export function dailyCheckInUpsertColumns(
  input: DailyCheckInInput,
): {
  date: string;
  bodyweight_kg?: number | null;
  sleep_hours?: number | null;
  motivation?: number | null;
  notes?: string | null;
} {
  const out: ReturnType<typeof dailyCheckInUpsertColumns> = { date: input.date };
  if (input.bodyweightKg !== undefined)
    out.bodyweight_kg = input.bodyweightKg ?? null;
  if (input.sleepChip != null) {
    out.sleep_hours = sleepHoursForChip(input.sleepChip);
  } else if (input.sleepHours !== undefined) {
    out.sleep_hours = input.sleepHours ?? null;
  }
  if (input.motivation !== undefined) out.motivation = input.motivation ?? null;
  if (input.notes !== undefined) out.notes = input.notes ?? null;
  return out;
}
