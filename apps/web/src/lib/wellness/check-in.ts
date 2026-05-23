/**
 * Daily check-in helpers.
 *
 * The "daily check-in" surface (bodyweight + motivation + notes) is
 * keyed `(user_id, date)` and stored in the existing `wellness` table.
 * The functions here own (a) parsing the inbound payload and (b) the
 * upsert shape used by the Today-page bodyweight nudge.
 *
 * Sleep is intentionally NOT collected by any manual path — the
 * `wellness.sleep_hours` column is reserved for a future health-app
 * integration (Apple Health / Google Fit) that will back-fill it.
 * No DB I/O happens in this module — actions.ts wires it up. Keeps
 * the mapping pure-testable.
 */

import { z } from "zod";

export const dailyCheckInSchema = z.object({
  date: z.string().date(),
  bodyweightKg: z.coerce.number().min(20).max(400).optional().nullable(),
  motivation: z.coerce.number().int().min(1).max(5).optional().nullable(),
  notes: z.string().trim().max(400).optional().nullable(),
});

export type DailyCheckInInput = z.infer<typeof dailyCheckInSchema>;

/**
 * Normalise a parsed payload into the upsert shape written to
 * `public.wellness`. Returns only the keys the caller supplied so the
 * upsert leaves prior values untouched (the caller is expected to
 * filter undefined keys).
 */
export function dailyCheckInUpsertColumns(
  input: DailyCheckInInput,
): {
  date: string;
  bodyweight_kg?: number | null;
  motivation?: number | null;
  notes?: string | null;
} {
  const out: ReturnType<typeof dailyCheckInUpsertColumns> = { date: input.date };
  if (input.bodyweightKg !== undefined)
    out.bodyweight_kg = input.bodyweightKg ?? null;
  if (input.motivation !== undefined) out.motivation = input.motivation ?? null;
  if (input.notes !== undefined) out.notes = input.notes ?? null;
  return out;
}
