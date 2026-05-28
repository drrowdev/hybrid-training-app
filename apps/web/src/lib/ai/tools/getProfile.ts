/**
 * getProfile — experience tier, archetype preferences, equipment, and
 * declared active limitations for the current user.
 *
 * Data source: `profiles` (one row) + `limitations WHERE resolved_at
 * IS NULL` (capped at 50 rows).
 *
 * RLS: the caller's Supabase client is bound to their user; every
 * query also pins `user_id = ctx.userId` for defense in depth.
 */
import { z } from "zod";
import type { Tool } from "./types";

const limitationSchema = z.object({
  region: z.string(),
  kind: z.string(),
  severity: z.string().nullable(),
});

const outputSchema = z.object({
  experience_tier: z.string().nullable(),
  archetype_preferences: z.array(z.string()),
  equipment: z.array(z.string()),
  active_limitations: z.array(limitationSchema),
});

const inputSchema = z.object({}).strict();

type Input = z.infer<typeof inputSchema>;
type Output = z.infer<typeof outputSchema>;

function extractEquipmentList(equipment: unknown): string[] {
  if (!equipment || typeof equipment !== "object") return [];
  const e = equipment as Record<string, unknown>;
  const out: string[] = [];
  if (typeof e.preset === "string") out.push(`preset:${e.preset}`);
  for (const key of [
    "bars",
    "plates",
    "dumbbells",
    "kettlebells",
    "machines",
    "cardio",
  ]) {
    const v = e[key];
    if (Array.isArray(v) && v.length > 0) out.push(`${key}:${v.length}`);
    else if (v && typeof v === "object") out.push(key);
  }
  return out;
}

function extractArchetypePrefs(wizardDayPref: unknown): string[] {
  if (!wizardDayPref || typeof wizardDayPref !== "object") return [];
  const w = wizardDayPref as { byArchetype?: Record<string, unknown> };
  if (!w.byArchetype) return [];
  return Object.keys(w.byArchetype);
}

export const getProfile: Tool<Input, Output> = {
  name: "getProfile",
  description:
    "Returns the user's training experience tier, preferred archetypes, available equipment, and currently active (unresolved) limitations.",
  inputSchema,
  outputSchema,
  async handler(_input, ctx) {
    const [profileRes, limitationsRes] = await Promise.all([
      ctx.supabase
        .from("profiles")
        .select("training_experience, equipment, wizard_day_pref")
        .eq("id", ctx.userId)
        .maybeSingle(),
      ctx.supabase
        .from("limitations")
        .select("region, kind, severity, resolved_at")
        .eq("user_id", ctx.userId)
        .is("resolved_at", null)
        .limit(50),
    ]);

    const profile = profileRes.data ?? null;
    const limitations = (limitationsRes.data ?? []) as Array<{
      region: string | null;
      kind: string | null;
      severity: string | null;
    }>;

    return {
      experience_tier:
        (profile?.training_experience as string | null) ?? null,
      archetype_preferences: extractArchetypePrefs(
        profile?.wizard_day_pref ?? null,
      ),
      equipment: extractEquipmentList(profile?.equipment ?? null),
      active_limitations: limitations
        .filter((r) => r.region && r.kind)
        .map((r) => ({
          region: r.region as string,
          kind: r.kind as string,
          severity: r.severity ?? null,
        })),
    };
  },
};
