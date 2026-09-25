import type { SupabaseClient } from "@supabase/supabase-js";
import type { Prescription } from "@hta/db";
import { z } from "zod";
import { STALE_PRESCRIPTION_MESSAGE } from "./prescription-revision";
import { isMissingRpc, RPC_SAVE_RETRY_MESSAGE } from "@/lib/supabase/rpc-errors";

export type PrescriptionSaveResult = {
  ok?: true;
  error?: string;
  prescription?: Prescription;
  currentPrescription?: Prescription;
};

export async function savePrescription(
  client: SupabaseClient, target: "planned_sessions" | "sessions", id: string,
  expectedRevision: FormDataEntryValue | null, prescription: Prescription, requireUnstarted = false,
): Promise<PrescriptionSaveResult> {
  const revision = z.union([z.literal("0"), z.string().uuid()]).safeParse(expectedRevision);
  if (!revision.success) return { error: "Reload this workout before editing." };
  const { data, error } = await client.rpc("save_prescription_if_current", {
    p_target: target, p_id: id, p_expected_revision: revision.data,
    p_prescription: prescription, p_require_unstarted: requireUnstarted,
  });
  if (error) return {
    error: isMissingRpc(error, "save_prescription_if_current") ? RPC_SAVE_RETRY_MESSAGE : error.message,
  };
  if (!data || typeof data.conflict !== "boolean" || !data.prescription || !Array.isArray(data.prescription.items)) {
    return { error: "The workout save could not be confirmed. Reload it before trying again." };
  }
  return data.conflict
    ? { error: STALE_PRESCRIPTION_MESSAGE, currentPrescription: data.prescription }
    : { ok: true, prescription: data.prescription };
}
