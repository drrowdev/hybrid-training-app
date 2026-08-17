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
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient, getAuthUser } from "@/lib/supabase/server";import {
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
import { zonesFromHistogram } from "@/lib/cardio/hr-histogram";
import { recomputeRegionState } from "@/lib/engine/region-ledger";
import { getUserTimezone } from "@/lib/planner/queries";

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
 * Re-bucket every stored cardio activity's `hr_zones` against fresh
 * bands, using the band-independent `hr_histogram` retained on the row.
 * This makes a zone-config change self-healing: past activities reflect
 * the new zones immediately, with no re-import of any kind.
 *
 * Best-effort and scoped to the user's own rows (RLS-safe via the
 * cookie-bound client). Rows without a histogram (legacy / manual) are
 * left untouched. Returns the number of rows updated.
 */
export async function recomputeStoredHrZones(
  supabase: SupabaseClient,
  userId: string,
  bands: ZoneBands | null,
): Promise<number> {
  if (!bands) return 0;
  const { data: rows, error } = await supabase
    .from("cardio_logs")
    .select("id, hr_histogram, sessions!inner(user_id)")
    .eq("sessions.user_id", userId)
    .not("hr_histogram", "is", null);
  if (error || !rows) return 0;

  let updated = 0;
  for (const row of rows as Array<{ id: string; hr_histogram: Record<string, number> | null }>) {
    const zones = zonesFromHistogram(row.hr_histogram, bands);
    if (!zones) continue;
    const { error: upErr } = await supabase
      .from("cardio_logs")
      .update({ hr_zones: zones })
      .eq("id", row.id);
    if (!upErr) updated++;
  }
  return updated;
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

  // Re-bucket past activities against the new bands from their stored
  // histograms (no re-import). When any zones actually changed,
  // refresh the cached region ledger too — cardio's contribution is
  // time-in-zone weighted (cardioIntensityScalar), so stale zones would
  // otherwise leave the region-freshness math reflecting the old bands.
  // Both best-effort — a failure here must not fail the settings save.
  try {
    const updated = await recomputeStoredHrZones(supabase, user.id, result.hrZones);
    if (updated > 0) {
      const tz = await getUserTimezone(user.id);
      await recomputeRegionState(supabase, user.id, tz);
    }
  } catch (e) {
    console.error("post-zone-save recompute failed:", e);
  }

  revalidatePath("/app/settings");
  revalidatePath("/app/settings/hr-zones");
  revalidatePath("/app/stats");
  revalidatePath("/app");
  return result;
}
