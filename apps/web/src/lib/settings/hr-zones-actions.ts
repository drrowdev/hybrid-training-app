"use server";

/**
 * Heart-rate zone settings server action.
 *
 * Validates the user's chosen method + raw HR inputs, recomputes the
 * Z1–Z5 bands, and writes the whole bundle to `profiles.intake`. The
 * raw inputs for OTHER methods are preserved so the user can flip
 * methods in the settings panel without losing previously-entered
 * numbers. Computed bands are cached on `intake.hrZones` so the
 * downstream `readZoneConfig` reader doesn't re-derive on every read.
 *
 * Same RLS contract as the rest of settings — `.eq("id", user.id)`
 * with the cookie-bound Supabase client.
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import {
  computeZoneBandsSafe,
  HR_MAX_RANGE,
  HR_RESTING_RANGE,
  HR_LTHR_RANGE,
  validateZonePercents,
  type HrMethod,
  type ZoneBands,
  type ZonePercents,
} from "@/lib/stats/hr-zones";
import { mergeIntake, type HrPercents, type HrZoneIntake } from "@/lib/profile/intake";

const ZONE_PCTS_SCHEMA = z.object({
  z1: z.number(),
  z2: z.number(),
  z3: z.number(),
  z4: z.number(),
});

const HR_ZONES_SCHEMA = z.object({
  hrMethod: z.enum(["max", "hrr", "lthr"]),
  hrMax: z
    .number()
    .min(HR_MAX_RANGE.min)
    .max(HR_MAX_RANGE.max)
    .nullable()
    .optional(),
  hrResting: z
    .number()
    .min(HR_RESTING_RANGE.min)
    .max(HR_RESTING_RANGE.max)
    .nullable()
    .optional(),
  hrLthr: z
    .number()
    .min(HR_LTHR_RANGE.min)
    .max(HR_LTHR_RANGE.max)
    .nullable()
    .optional(),
  // Optional per-method breakpoint percentages for the currently
  // selected method. `null` (or omitted) explicitly clears the override
  // so the user can "reset to defaults" by submitting nothing.
  pcts: ZONE_PCTS_SCHEMA.nullable().optional(),
});

export type UpdateHrZonesInput = z.infer<typeof HR_ZONES_SCHEMA>;

export type UpdateHrZonesResult = {
  ok: true;
  hrZones: ZoneBands | null;
};

/**
 * Test-friendly core. Resolves the supabase client + auth via the
 * passed-in deps so `update-hr-zones.test.ts` doesn't need to stand
 * up next/headers. The exported `updateHrZones` wraps this with the
 * real server-action plumbing.
 */
export async function performUpdateHrZones(
  input: unknown,
  deps: {
    supabase: {
      from: (table: string) => {
        select: (cols: string) => {
          eq: (col: string, val: string) => {
            maybeSingle: () => Promise<{
              data: { intake: unknown } | null;
              error: { message: string } | null;
            }>;
          };
        };
        update: (row: Record<string, unknown>) => {
          eq: (col: string, val: string) => Promise<{ error: { message: string } | null }>;
        };
      };
    };
    userId: string;
  },
): Promise<UpdateHrZonesResult> {
  const parsed = HR_ZONES_SCHEMA.safeParse(input);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Invalid HR zones input");
  }
  const data = parsed.data;

  // If the client supplied `pcts`, validate it semantically (strict
  // ascent + range). An invalid payload is a hard error — we don't
  // want to silently persist garbage. `null`/undefined means "clear the
  // override for this method".
  let pctsForMethod: ZonePercents | undefined;
  if (data.pcts != null) {
    const validated = validateZonePercents(data.pcts);
    if (!validated) {
      throw new Error("Invalid HR zone percentages");
    }
    pctsForMethod = validated;
  }

  // Recompute bands server-side so the persisted cache always agrees
  // with the canonical formulas — never trust a client-supplied bands
  // payload.
  const bands = computeZoneBandsSafe({
    method: data.hrMethod,
    hrMax: data.hrMax ?? undefined,
    hrResting: data.hrResting ?? undefined,
    hrLthr: data.hrLthr ?? undefined,
    pcts: pctsForMethod,
  });

  const { data: profile, error: readError } = await deps.supabase
    .from("profiles")
    .select("intake")
    .eq("id", deps.userId)
    .maybeSingle();
  if (readError) throw new Error(readError.message);

  // Merge per-method pcts onto any existing overrides so saving one
  // method's overrides doesn't wipe out another's.
  const existingIntake = (profile?.intake ?? null) as
    | (Record<string, unknown> & { hrPercents?: HrPercents })
    | null;
  const existingPercents: HrPercents = { ...(existingIntake?.hrPercents ?? {}) };
  if (pctsForMethod) {
    existingPercents[data.hrMethod as HrMethod] = pctsForMethod;
  } else {
    // `pcts` was explicitly null OR omitted on this save → reset this
    // method's overrides to defaults by deleting the slot. Other
    // methods' overrides remain untouched.
    delete existingPercents[data.hrMethod as HrMethod];
  }
  const nextHrPercents: HrPercents | undefined =
    existingPercents.max || existingPercents.hrr || existingPercents.lthr
      ? existingPercents
      : undefined;

  const patch: HrZoneIntake = {
    hrMethod: data.hrMethod as HrMethod,
    hrMax: data.hrMax ?? null,
    hrResting: data.hrResting ?? null,
    hrLthr: data.hrLthr ?? null,
    hrZones: bands,
    hrPercents: nextHrPercents,
  };
  const nextIntake = mergeIntake(profile?.intake ?? null, patch);

  const { error: writeError } = await deps.supabase
    .from("profiles")
    .update({ intake: nextIntake })
    .eq("id", deps.userId);
  if (writeError) throw new Error(writeError.message);

  return { ok: true, hrZones: bands };
}

/**
 * Server-action entry point. Reads the cookie-bound supabase client +
 * authenticated user, then delegates to `performUpdateHrZones`.
 */
export async function updateHrZones(
  input: UpdateHrZonesInput,
): Promise<UpdateHrZonesResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) redirect("/login");

  const result = await performUpdateHrZones(input, {
    supabase: supabase as unknown as Parameters<typeof performUpdateHrZones>[1]["supabase"],
    userId: user.id,
  });

  revalidatePath("/app/settings");
  revalidatePath("/app/settings/hr-zones");
  revalidatePath("/app/stats/wellness");
  return result;
}
