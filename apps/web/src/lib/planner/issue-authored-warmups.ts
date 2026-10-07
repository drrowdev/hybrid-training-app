import type { Prescription } from "@hta/db";
import type { createClient } from "@/lib/supabase/server";
import { resolveEquipment } from "@/lib/settings/equipment-presets";
import { resolveBarWeightKg } from "@/lib/sessions/bar-kind";
import { prepareAuthoredWarmups } from "./authored-warmups";
import { savePrescription } from "@/lib/sessions/save-prescription";
import { prescriptionRevision } from "@/lib/sessions/prescription-revision";
import { roundToPlate } from "./archetypes";
import { TM_RESOLUTION_SELECT } from "@/lib/training-maxes/columns";

/** The existing revision-checked save and atomic start share the deployment lock. */
export async function issueAuthoredWarmups(
  client: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  planned: { id: string; prescription: Prescription; completed_session_id: string | null },
): Promise<void> {
  const prescription = planned.prescription;
  if (planned.completed_session_id || prescription?.meta?.authoredWarmupsIssued === true ||
      !prescription?.items.some((item) => typeof item.meta?.authoredPartId === "string")) return;
  const ids = [...new Set(prescription.items.filter((item) => item.kind === "main").map((item) => item.movementId))];
  if (ids.length === 0) return;
  const [profile, catalog, maxes] = await Promise.all([
    client.from("profiles").select("warmup_scheme,bodyweight_kg,tm_percent_default,equipment,barbell_kg,trap_bar_kg,plate_inventory_kg")
      .eq("id", userId).maybeSingle(),
    client.from("movements").select("id,slug,equipment").in("id", ids),
    client.from("training_maxes").select(TM_RESOLUTION_SELECT).eq("user_id", userId).in("movement_id", ids),
  ]);
  if (profile.error || catalog.error || maxes.error) throw new Error("Could not prepare your warm-ups. Try again.");
  const equipment = resolveEquipment(profile.data);
  const next = prepareAuthoredWarmups(prescription, (catalog.data ?? []).map((movement) => {
    const max = maxes.data?.find((entry) => entry.movement_id === movement.id);
    const oneRmKg = Number(max?.one_rm_kg) || null;
    return {
      ...movement, oneRmKg,
      tmKg: oneRmKg == null ? null : roundToPlate(oneRmKg * Number(max?.tm_percent ?? profile.data?.tm_percent_default ?? 90) / 100),
      loadOptions: { barWeightKg: resolveBarWeightKg(movement.slug, equipment.bars) ?? undefined, availablePlateWeightsKg: equipment.plates },
    };
  }), profile.data?.warmup_scheme, Number(profile.data?.bodyweight_kg) || null);
  if (next === prescription) return;
  const updated = await savePrescription(client, "planned_sessions", planned.id, prescriptionRevision(prescription), next, true);
  if (updated.error || !updated.prescription) throw new Error(updated.error ?? "Could not prepare your warm-ups. Try again.");
  planned.prescription = updated.prescription;
}
