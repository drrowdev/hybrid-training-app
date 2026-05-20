"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const upsertSchema = z.object({
  movementId: z.string().uuid(),
  tmKg: z.coerce.number().positive().lte(1000),
  notes: z.string().trim().max(500).optional().nullable(),
});

export async function upsertTrainingMax(formData: FormData): Promise<void> {
  const parsed = upsertSchema.safeParse({
    movementId: formData.get("movementId"),
    tmKg: formData.get("tmKg"),
    notes: formData.get("notes") || undefined,
  });
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Invalid input");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { error } = await supabase.from("training_maxes").upsert(
    {
      user_id: user.id,
      movement_id: parsed.data.movementId,
      tm_kg: parsed.data.tmKg,
      notes: parsed.data.notes ?? null,
    },
    { onConflict: "user_id,movement_id" },
  );
  if (error) throw new Error(error.message);

  revalidatePath("/app/settings/training-maxes");
  revalidatePath("/app");
}

export async function deleteTrainingMax(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const supabase = await createClient();
  await supabase.from("training_maxes").delete().eq("id", id);
  revalidatePath("/app/settings/training-maxes");
}
