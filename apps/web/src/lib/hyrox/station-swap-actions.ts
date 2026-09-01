"use server";

/**
 * Per-session HYROX station swap (ADR 0064). Lets the plan-drawer edit mode replace
 * a prescribed station (e.g. SkiErg, Sled Push) with a curated equipment alternative
 * for THIS planned session only — never future weeks. The swap rewrites the stored
 * conditioning item's cardioPlan (segments + stations) and records the override map in
 * the item's `meta.stationOverrides`, which the completion path reads.
 *
 * Guardrails mirror `planned-movement-actions.ts`: explicit auth + user_id ownership
 * (RLS, never service role), Zod-validated input, the substitute must be in the
 * station's curated alternatives.
 */
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Prescription, PrescriptionItem } from "@hta/db";
import {
  parseHyroxRef,
  hyroxSessionIdForRef,
  getHyroxSession,
  stationBlocksForWeek,
  stationBlockPlanParts,
  findStationAlternative,
  type HyroxInstance,
  type StationOverrides,
} from "@hta/hyrox";
import { createClient, getAuthUser } from "@/lib/supabase/server";

export type StationSwapResult = { ok?: true; error?: string; prescription?: Prescription };

const schema = z.object({
  plannedSessionId: z.string().uuid(),
  stationKey: z.string().min(1),
  /** Empty string = reset this station back to the prescribed default. */
  substituteKey: z.string().default(""),
});

/** Read the stored station-override map off the conditioning item, if any. */
function readOverrides(item: PrescriptionItem | undefined): StationOverrides {
  const m = (item?.meta as Record<string, unknown> | undefined)?.stationOverrides;
  return m && typeof m === "object" ? ({ ...(m as StationOverrides) }) : {};
}

export async function setHyroxStationOverride(formData: FormData): Promise<StationSwapResult> {
  const parsed = schema.safeParse({
    plannedSessionId: formData.get("plannedSessionId"),
    stationKey: formData.get("stationKey"),
    substituteKey: formData.get("substituteKey") ?? "",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const { plannedSessionId, stationKey, substituteKey } = parsed.data;

  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) return { error: "Not signed in." };

  const { data: planned, error: pErr } = await supabase
    .from("planned_sessions")
    .select("id, user_id, prescription, block_id, completed_session_id")
    .eq("id", plannedSessionId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (pErr) return { error: pErr.message };
  if (!planned) return { error: "Planned session not found." };

  const prescription = (planned.prescription as Prescription | null) ?? { items: [] };
  const programRef = (prescription as Prescription & { programRef?: string }).programRef;
  if (!programRef) return { error: "This session isn't a structured HYROX workout." };

  const blockId = planned.block_id as string | null;
  if (!blockId) return { error: "This session isn't linked to a HYROX plan." };

  const [{ data: pi }, { data: prof }] = await Promise.all([
    supabase
      .from("program_instances")
      .select("program_id, instance")
      .eq("user_id", user.id)
      .eq("block_id", blockId)
      .eq("status", "active")
      .is("deleted_at", null)
      .maybeSingle(),
    supabase.from("profiles").select("gender").eq("id", user.id).maybeSingle(),
  ]);
  if (!pi || pi.program_id !== "hyrox") return { error: "Not an active HYROX block." };

  const instance = pi.instance as HyroxInstance;
  const hyroxSessionId = hyroxSessionIdForRef(instance, programRef);
  if (!hyroxSessionId) return { error: "Couldn't resolve the HYROX session." };
  const week = parseHyroxRef(programRef)?.week ?? 1;
  const gender = prof?.gender === "male" || prof?.gender === "female" ? prof.gender : undefined;

  const blocks = stationBlocksForWeek(
    hyroxSessionId,
    week,
    getHyroxSession(hyroxSessionId)?.movements ?? [],
  );
  const focusedKeys = new Set(blocks.flatMap((b) => [...b.movements]));
  if (!focusedKeys.has(stationKey)) {
    return { error: "That station isn't part of this workout." };
  }
  if (substituteKey && !findStationAlternative(stationKey, substituteKey)) {
    return { error: "That substitution isn't available for this station." };
  }

  const items = prescription.items ?? [];
  const idx = items.findIndex((it) => it.cardioPlan != null);
  if (idx < 0) return { error: "This session has no editable station block." };
  const item = items[idx]!;

  const overrides = readOverrides(item);
  if (substituteKey) overrides[stationKey] = substituteKey;
  else delete overrides[stationKey];

  const { segments, stations } = stationBlockPlanParts(
    blocks,
    instance.division,
    gender,
    overrides,
  );

  const nextMeta = { ...(item.meta as Record<string, unknown> | undefined) };
  if (Object.keys(overrides).length > 0) nextMeta.stationOverrides = overrides;
  else delete nextMeta.stationOverrides;

  const nextItem: PrescriptionItem = {
    ...item,
    cardioPlan: item.cardioPlan ? { ...item.cardioPlan, segments, stations } : item.cardioPlan,
    meta: nextMeta,
  };
  const nextItems = items.slice();
  nextItems[idx] = nextItem;
  const next: Prescription = { ...prescription, items: nextItems };

  const { error: uErr } = await supabase
    .from("planned_sessions")
    .update({ prescription: next })
    .eq("id", plannedSessionId)
    .eq("user_id", user.id);
  if (uErr) return { error: uErr.message };

  revalidatePath("/app");
  revalidatePath("/app/plan");
  const completedSessionId = planned.completed_session_id as string | null;
  if (completedSessionId) revalidatePath(`/app/sessions/${completedSessionId}`);
  return { ok: true, prescription: next };
}
