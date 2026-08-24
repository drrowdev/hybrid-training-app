/**
 * Training-max queries — used by Settings (list + edit) and Log UI (TM% line).
 *
 * Model: the user stores their 1RM per movement. A profile-level default TM%
 * (typically 85-90) is applied unless a per-movement override is set. The
 * "training max" is the computed product, rounded to the plate increment.
 */
import { cache } from "react";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import type { TmFormula, TmSource } from "@hta/db";

/** Round to the nearest plate increment (default 2.5 kg). */
export function roundToPlate(kg: number, increment = 2.5): number {
  return Math.round(kg / increment) * increment;
}

/** Provenance metadata kept alongside derived TM rows for UI disclosure. */
export type TmProvenance = {
  source: TmSource;
  derivedFromSessionId: string | null;
  derivedFromSetLogId: string | null;
  derivedFormula: TmFormula | null;
  derivedAt: string | null;
};

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
  /**
   * This movement's max is a SYSTEM load — bodyweight plus whatever hangs off
   * the belt (weighted pull-ups / dips). What the lifter types is the total.
   */
  systemLoad: boolean;
} & TmProvenance;

export type TmContext = {
  defaultPercent: number;
  rows: TmRow[];
  bySlug: Map<string, number>;
  byMovementId: Map<string, number>;
};

export const getTrainingMaxContext = cache(async function getTrainingMaxContext(): Promise<TmContext> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthUser();
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
        "id, movement_id, one_rm_kg, tm_percent, updated_at, source, derived_from_session_id, derived_from_set_log_id, derived_formula, derived_at, movements(display_name, slug, body_weight_loaded)",
      )
      .order("updated_at", { ascending: false }),
  ]);

  const defaultPercent = Number(profile?.tm_percent_default ?? 90);

  const rows: TmRow[] = (tms ?? []).map((r) => {
    const m = (Array.isArray(r.movements) ? r.movements[0] : r.movements) ?? {};
    const oneRm = Number(r.one_rm_kg);
    const override = r.tm_percent == null ? null : Number(r.tm_percent);
    const effective = override ?? defaultPercent;
    const sourceRaw = (r as { source?: string }).source ?? "entered";
    const source: TmSource =
      sourceRaw === "derived_amrap" || sourceRaw === "derived_rpe"
        ? sourceRaw
        : "entered";
    const formulaRaw = (r as { derived_formula?: string | null }).derived_formula ?? null;
    const formula: TmFormula | null =
      formulaRaw === "epley" || formulaRaw === "brzycki" || formulaRaw === "rpe_zourdos"
        ? formulaRaw
        : null;
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
      systemLoad: (m as { body_weight_loaded?: boolean | null }).body_weight_loaded === true,
      source,
      derivedFromSessionId:
        (r as { derived_from_session_id?: string | null }).derived_from_session_id ?? null,
      derivedFromSetLogId:
        (r as { derived_from_set_log_id?: string | null }).derived_from_set_log_id ?? null,
      derivedFormula: formula,
      derivedAt: (r as { derived_at?: string | null }).derived_at ?? null,
    };
  });

  const bySlug = new Map<string, number>();
  const byMovementId = new Map<string, number>();
  for (const r of rows) {
    byMovementId.set(r.movementId, r.tmKg);
    if (r.movementSlug) bySlug.set(r.movementSlug, r.tmKg);
  }

  return { defaultPercent, rows, bySlug, byMovementId };
});

export async function getTrainingMaxDict(): Promise<{
  byMovementId: Map<string, number>;
  bySlug: Map<string, number>;
  /** Saved one-rep max per movement, slug-keyed. Used for TM-anchored PR detection. */
  oneRmBySlug: Map<string, number>;
  /** Saved one-rep max per movement, id-keyed. */
  oneRmByMovementId: Map<string, number>;
}> {
  const ctx = await getTrainingMaxContext();
  const oneRmBySlug = new Map<string, number>();
  const oneRmByMovementId = new Map<string, number>();
  for (const r of ctx.rows) {
    oneRmByMovementId.set(r.movementId, r.oneRmKg);
    if (r.movementSlug) oneRmBySlug.set(r.movementSlug, r.oneRmKg);
  }
  return {
    byMovementId: ctx.byMovementId,
    bySlug: ctx.bySlug,
    oneRmBySlug,
    oneRmByMovementId,
  };
}

export async function listTrainingMaxes(): Promise<TmRow[]> {
  const ctx = await getTrainingMaxContext();
  return ctx.rows;
}

/**
 * Source-set context for a derived TM — the set the e1RM was computed from.
 * Returns null when the row is `entered` or when the linked set/session has
 * been hard-deleted (FK SET NULL).
 */
export type TmSourceSet = {
  sessionId: string;
  setLogId: string | null;
  performedAt: string;
  weightKg: number | null;
  reps: number | null;
  rpe: number | null;
};

export async function getTmSourceSet(row: TmRow): Promise<TmSourceSet | null> {
  if (row.source === "entered" || !row.derivedFromSessionId) return null;
  const supabase = await createClient();
  const { data: session } = await supabase
    .from("sessions")
    .select("id, performed_at")
    .eq("id", row.derivedFromSessionId)
    .maybeSingle();
  if (!session) return null;

  let weightKg: number | null = null;
  let reps: number | null = null;
  let rpe: number | null = null;
  if (row.derivedFromSetLogId) {
    const { data: setLog } = await supabase
      .from("set_logs")
      .select("weight_kg, reps, rpe")
      .eq("id", row.derivedFromSetLogId)
      .maybeSingle();
    if (setLog) {
      weightKg = setLog.weight_kg == null ? null : Number(setLog.weight_kg);
      reps = setLog.reps == null ? null : Number(setLog.reps);
      rpe = setLog.rpe == null ? null : Number(setLog.rpe);
    }
  }

  return {
    sessionId: session.id,
    setLogId: row.derivedFromSetLogId,
    performedAt: session.performed_at,
    weightKg,
    reps,
    rpe,
  };
}
