/**
 * Daily bodyweight-log helpers.
 *
 * The Today-page bodyweight nudge writes `bodyweight_kg` keyed
 * `(user_id, date)` into the existing `wellness` table. The functions
 * here own (a) parsing the inbound payload and (b) the upsert shape.
 *
 * The daily wellness check-in (motivation / fatigue / soreness / notes)
 * was retired — no UI writes those columns anymore. They remain on the
 * `wellness` table so historical rows and the data export stay intact;
 * we simply never write them from here. Sleep is likewise reserved for a
 * future health-app integration (Apple Health / Google Fit).
 *
 * No DB I/O happens in this module — actions.ts wires it up. Keeps the
 * mapping pure-testable.
 */

import { z } from "zod";

export const dailyCheckInSchema = z.object({
  date: z.string().date(),
  bodyweightKg: z.coerce.number().min(20).max(400).optional().nullable(),
});

export type DailyCheckInInput = z.infer<typeof dailyCheckInSchema>;

/**
 * Normalise a parsed payload into the upsert shape written to
 * `public.wellness`. Returns only the keys the caller supplied so the
 * merge-on-conflict upsert leaves prior values (including the retained
 * legacy columns) untouched.
 */
export function dailyCheckInUpsertColumns(
  input: DailyCheckInInput,
): {
  date: string;
  bodyweight_kg?: number | null;
} {
  const out: ReturnType<typeof dailyCheckInUpsertColumns> = { date: input.date };
  if (input.bodyweightKg !== undefined)
    out.bodyweight_kg = input.bodyweightKg ?? null;
  return out;
}
