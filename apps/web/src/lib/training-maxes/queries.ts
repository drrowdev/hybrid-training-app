/**
 * Training-max queries — used by Settings (list + edit) and Log UI (TM% line).
 *
 * Model: the user stores their 1RM per movement. A profile-level default TM%
 * (typically 85-90) is applied unless a per-movement override is set. The
 * "training max" is the computed product, rounded to the plate increment.
 */
import { createClient } from "@/lib/supabase/server";

/** Round to the nearest plate increment (default 2.5 kg). */
export function roundToPlate(kg: number, increment = 2.5): number {
  return Math.round(kg / increment) * increment;
}

export type TmRow = {
  id: string;
  movementId: string;
  movementName: string;
  movementSlug: string;
  oneRmKg: number;
  tmPercentOverride: number | null;
  effectivePercent: number;
  tmKg: number;
  updatedAt: string;
};

export type TmContext = {
  defaultPercent: number;
  rows: TmRow[];
  bySlug: Map<string, number>;
  byMovementId: Map<string, number>;
};

export async function getTrainingMaxContext(): Promise<TmContext> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { defaultPercent: 90, rows: [], bySlug: new Map(), byMovementId: new Map() };
  }

  const [{ data: profile }, { data: tms }] = await Promise.all([
    supabase
      .from("profiles")
      .select("tm_percent_default")
      .eq("id", user.id)
      .maybeSingle(),
    supabase
      .from("training_maxes")
      .select(
        "id, movement_id, one_rm_kg, tm_percent, updated_at, movements(display_name, slug)",
      )
      .order("updated_at", { ascending: false }),
  ]);

  const defaultPercent = Number(profile?.tm_percent_default ?? 90);

  const rows: TmRow[] = (tms ?? []).map((r) => {
    const m = (Array.isArray(r.movements) ? r.movements[0] : r.movements) ?? {};
    const oneRm = Number(r.one_rm_kg);
    const override = r.tm_percent == null ? null : Number(r.tm_percent);
    const effective = override ?? defaultPercent;
    return {
      id: r.id,
      movementId: r.movement_id,
      movementName: (m as { display_name?: string }).display_name ?? "Unknown movement",
      movementSlug: (m as { slug?: string }).slug ?? "",
      oneRmKg: oneRm,
      tmPercentOverride: override,
      effectivePercent: effective,
      tmKg: roundToPlate((oneRm * effective) / 100),
      updatedAt: r.updated_at,
    };
  });

  const bySlug = new Map<string, number>();
  const byMovementId = new Map<string, number>();
  for (const r of rows) {
    byMovementId.set(r.movementId, r.tmKg);
    if (r.movementSlug) bySlug.set(r.movementSlug, r.tmKg);
  }

  return { defaultPercent, rows, bySlug, byMovementId };
}

export async function getTrainingMaxDict(): Promise<{
  byMovementId: Map<string, number>;
  bySlug: Map<string, number>;
}> {
  const ctx = await getTrainingMaxContext();
  return { byMovementId: ctx.byMovementId, bySlug: ctx.bySlug };
}

export async function listTrainingMaxes(): Promise<TmRow[]> {
  const ctx = await getTrainingMaxContext();
  return ctx.rows;
}
