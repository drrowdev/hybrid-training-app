"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import { isMissingScheduleFunction } from "@/lib/schedule/storage";
import type { UpsertResult } from "./actions";

function refreshMaxes() {
  revalidatePath("/app");
  revalidatePath("/app/settings/training-maxes");
  revalidatePath("/app/plan");
}

async function decide(form: FormData, accept: boolean): Promise<UpsertResult> {
  const parsed = z.array(z.string().uuid()).min(1).max(500).refine((ids) => new Set(ids).size === ids.length)
    .safeParse(form.getAll("suggestionId"));
  if (!parsed.success) return { ok: false, error: "Choose a suggestion." };
  const { data: { user } } = await getAuthUser();
  if (!user) redirect("/login");
  const client = await createClient();
  const result = await client.rpc("decide_max_suggestions", { p_ids: parsed.data, p_accept: accept });
  if (isMissingScheduleFunction(result.error, "decide_max_suggestions")) {
    return { ok: false, error: "1RM increases are temporarily unavailable. Try again later." };
  }
  if (result.error) return { ok: false, error: result.error.message };
  if (!Number.isInteger(result.data) || result.data < 0) return { ok: false, error: "Couldn't save your choices. Try again." };
  refreshMaxes();
  return { ok: true };
}

export async function acceptMaxSuggestions(form: FormData): Promise<UpsertResult> { return decide(form, true); }
export async function declineMaxSuggestions(form: FormData): Promise<UpsertResult> { return decide(form, false); }

export async function setScheduledMaxProgression(form: FormData): Promise<UpsertResult> {
  const parsed = z.enum(["true", "false"]).safeParse(form.get("enabled"));
  if (!parsed.success) return { ok: false, error: "Choose a setting." };
  const { data: { user } } = await getAuthUser();
  if (!user) redirect("/login");
  const client = await createClient();
  const result = await client.rpc("set_scheduled_max_progression", { p_enabled: parsed.data === "true" });
  if (isMissingScheduleFunction(result.error, "set_scheduled_max_progression")) {
    return { ok: false, error: "1RM increases are temporarily unavailable. Try again later." };
  }
  if (result.error) return { ok: false, error: result.error.message };
  refreshMaxes();
  return { ok: true };
}
