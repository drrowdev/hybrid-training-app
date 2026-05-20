"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const profileSchema = z.object({
  displayName: z.string().trim().max(60).optional().nullable(),
  units: z.enum(["metric", "imperial"]).optional(),
  bodyCompPhase: z.enum(["gain", "maintain", "lean_out"]).optional(),
  phaseStartedAt: z.string().date().optional().nullable(),
  phaseTargetWeeks: z.coerce.number().int().min(1).max(52).optional().nullable(),
});

export async function updateProfile(formData: FormData): Promise<void> {
  const parsed = profileSchema.safeParse({
    displayName: formData.get("displayName") || undefined,
    units: formData.get("units") || undefined,
    bodyCompPhase: formData.get("bodyCompPhase") || undefined,
    phaseStartedAt: formData.get("phaseStartedAt") || undefined,
    phaseTargetWeeks: formData.get("phaseTargetWeeks") || undefined,
  });
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Invalid input");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const updates: Record<string, unknown> = {};
  if (parsed.data.displayName !== undefined) updates.display_name = parsed.data.displayName || null;
  if (parsed.data.units !== undefined) updates.units = parsed.data.units;
  if (parsed.data.bodyCompPhase !== undefined) updates.body_comp_phase = parsed.data.bodyCompPhase;
  if (parsed.data.phaseStartedAt !== undefined) updates.phase_started_at = parsed.data.phaseStartedAt || null;
  if (parsed.data.phaseTargetWeeks !== undefined) updates.phase_target_weeks = parsed.data.phaseTargetWeeks ?? null;

  const { error } = await supabase
    .from("profiles")
    .update(updates)
    .eq("id", user.id);

  if (error) throw new Error(error.message);

  revalidatePath("/app");
  revalidatePath("/app/settings");
}

const bodyweightSchema = z.object({
  date: z.string().date(),
  bodyweightKg: z.coerce.number().min(20).max(400),
  notes: z.string().trim().max(400).optional().nullable(),
});

export async function logBodyweight(formData: FormData): Promise<void> {
  const parsed = bodyweightSchema.safeParse({
    date: formData.get("date") || new Date().toISOString().slice(0, 10),
    bodyweightKg: formData.get("bodyweightKg"),
    notes: formData.get("notes") || undefined,
  });
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Invalid input");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { error: weError } = await supabase
    .from("wellness")
    .upsert(
      {
        user_id: user.id,
        date: parsed.data.date,
        bodyweight_kg: parsed.data.bodyweightKg,
        notes: parsed.data.notes ?? null,
      },
      { onConflict: "user_id,date" },
    );
  if (weError) throw new Error(weError.message);

  await supabase
    .from("profiles")
    .update({ bodyweight_kg: parsed.data.bodyweightKg })
    .eq("id", user.id);

  revalidatePath("/app");
  revalidatePath("/app/settings");
}
