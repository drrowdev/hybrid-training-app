/**
 * Typed shape for the `profiles.intake` JSONB blob.
 *
 * The column is intentionally unstructured at the DB layer — features
 * accumulate optional keys over time without schema migrations. This
 * module exists to give the *application* a single typed surface for
 * the keys we read/write, so callers don't re-do the narrowing dance
 * every time and so the heart-rate-zone settings panel has a
 * round-tripable schema.
 *
 * All keys are optional. `readIntake` narrows a raw JSONB record into
 * the typed shape, dropping anything that doesn't validate.
 * `mergeIntake` returns a new object that overlays a patch on top of
 * an existing intake — used by server actions to avoid clobbering
 * keys owned by sibling features.
 */
import { z } from "zod";
import type { ZoneBands, ZonePercents, HrMethod } from "@/lib/stats/hr-zones";

const ZONE_BANDS_SCHEMA = z.object({
  z1Max: z.number(),
  z2Max: z.number(),
  z3Max: z.number(),
  z4Max: z.number(),
});

/**
 * Schema for a single method's per-zone breakpoint percentages. Values
 * are validated more strictly (range + strict ascent) by
 * `validateZonePercents` at compute time — here we only check shape so
 * a partial / round-tripping JSONB blob doesn't get dropped wholesale.
 */
const ZONE_PERCENTS_SCHEMA = z.object({
  z1: z.number(),
  z2: z.number(),
  z3: z.number(),
  z4: z.number(),
});

/**
 * Optional per-method overrides for the Z1–Z4 breakpoint percentages.
 * Each method's pcts is independently optional — a user can override
 * just one method without affecting the others. Absent methods fall
 * through to `DEFAULT_ZONE_PCTS[method]`.
 */
export const HR_PERCENTS_SCHEMA = z.object({
  max: ZONE_PERCENTS_SCHEMA.optional(),
  hrr: ZONE_PERCENTS_SCHEMA.optional(),
  lthr: ZONE_PERCENTS_SCHEMA.optional(),
});

/**
 * Schema for the heart-rate-zone slice of intake. Each method's raw
 * inputs are stored alongside the computed bands so the user can
 * switch methods without losing previously-entered numbers.
 */
export const HR_ZONE_INTAKE_SCHEMA = z.object({
  hrMethod: z.enum(["max", "hrr", "lthr"]).optional(),
  hrMax: z.number().nullable().optional(),
  hrResting: z.number().nullable().optional(),
  hrLthr: z.number().nullable().optional(),
  hrZones: ZONE_BANDS_SCHEMA.nullable().optional(),
  hrPercents: HR_PERCENTS_SCHEMA.optional(),
});

export type HrPercents = {
  max?: ZonePercents;
  hrr?: ZonePercents;
  lthr?: ZonePercents;
};

export type HrZoneIntake = {
  hrMethod?: HrMethod;
  hrMax?: number | null;
  hrResting?: number | null;
  hrLthr?: number | null;
  hrZones?: ZoneBands | null;
  hrPercents?: HrPercents;
};

/**
 * Full typed surface for `profiles.intake`. New optional slices land
 * here as features add them; today only the HR-zone slice is typed.
 */
export const INTAKE_SCHEMA = HR_ZONE_INTAKE_SCHEMA.passthrough();

export type Intake = HrZoneIntake & Record<string, unknown>;

/**
 * Narrow a raw JSONB record into the typed `Intake` shape. Unknown
 * keys are preserved verbatim (passthrough) so other features that
 * stash data on intake aren't dropped. Returns an empty object when
 * the input is null/undefined or doesn't parse.
 */
export function readIntake(raw: unknown): Intake {
  if (raw == null || typeof raw !== "object") return {};
  const parsed = INTAKE_SCHEMA.safeParse(raw);
  return parsed.success ? (parsed.data as Intake) : { ...(raw as Record<string, unknown>) };
}

/**
 * Merge `patch` into an existing intake. Top-level keys in the patch
 * replace the existing values; unrelated keys on the original are
 * preserved. Used by server actions so writing one slice doesn't
 * clobber another.
 */
export function mergeIntake(existing: unknown, patch: Partial<Intake>): Intake {
  const base = readIntake(existing);
  return { ...base, ...patch };
}
