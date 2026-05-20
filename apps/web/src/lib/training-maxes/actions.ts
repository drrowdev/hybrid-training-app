"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const upsertSchema = z.object({
  movementId: z.string().uuid(),
  oneRmKg: z.coerce.number().positive().lte(1000),
  tmPercent: z.coerce.number().positive().lte(100).optional().nullable(),
});

export type UpsertResult = { ok: true } | { ok: false; error: string };

export async function upsertTrainingMax(formData: FormData): Promise<UpsertResult> {
  const tmPercentRaw = formData.get("tmPercent");
  const tmPercentInput =
    tmPercentRaw == null || String(tmPercentRaw).trim() === "" ? null : tmPercentRaw;

  const parsed = upsertSchema.safeParse({
    movementId: formData.get("movementId"),
    oneRmKg: formData.get("oneRmKg"),
    tmPercent: tmPercentInput,
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { error } = await supabase.from("training_maxes").upsert(
    {
      user_id: user.id,
      movement_id: parsed.data.movementId,
      one_rm_kg: parsed.data.oneRmKg,
      tm_percent: parsed.data.tmPercent ?? null,
    },
    { onConflict: "user_id,movement_id" },
  );
  if (error) {
    return { ok: false, error: error.message };
  }

  revalidatePath("/app/settings/training-maxes");
  revalidatePath("/app");
  revalidatePath("/app/plan");
  return { ok: true };
}

export async function deleteTrainingMax(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const supabase = await createClient();
  await supabase.from("training_maxes").delete().eq("id", id);
  revalidatePath("/app/settings/training-maxes");
}

const defaultPercentSchema = z.object({
  percent: z.coerce.number().positive().lte(100),
});

export async function setDefaultTmPercent(formData: FormData): Promise<void> {
  const parsed = defaultPercentSchema.safeParse({ percent: formData.get("percent") });
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Invalid percent");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { error } = await supabase
    .from("profiles")
    .update({ tm_percent_default: parsed.data.percent })
    .eq("id", user.id);
  if (error) throw new Error(error.message);

  revalidatePath("/app/settings/training-maxes");
  revalidatePath("/app");
  revalidatePath("/app/plan");
}

