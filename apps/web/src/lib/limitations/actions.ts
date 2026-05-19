"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const REGIONS = [
  "foot_ankle_calf",
  "knee",
  "hamstring_posterior",
  "adductor_groin",
  "lumbar_trunk",
  "shoulder_scapular",
  "elbow_forearm",
] as const;

const limitationSchema = z.object({
  region: z.enum(REGIONS),
  severity: z.enum(["mild", "moderate", "severe"]),
  startedAt: z.string().date().optional().nullable(),
  notes: z.string().trim().max(1000).optional().nullable(),
});

export async function addLimitation(formData: FormData): Promise<void> {
  const parsed = limitationSchema.safeParse({
    region: formData.get("region"),
    severity: formData.get("severity"),
    startedAt: formData.get("startedAt") || undefined,
    notes: formData.get("notes") || undefined,
  });
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Invalid input");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { error } = await supabase.from("limitations").insert({
    user_id: user.id,
    region: parsed.data.region,
    severity: parsed.data.severity,
    started_at: parsed.data.startedAt || new Date().toISOString(),
    notes: parsed.data.notes ?? null,
  });
  if (error) throw new Error(error.message);

  revalidatePath("/app");
  revalidatePath("/app/settings/limitations");
}

const editSchema = z.object({
  id: z.string().uuid(),
  severity: z.enum(["mild", "moderate", "severe"]).optional(),
  notes: z.string().trim().max(1000).optional().nullable(),
});

export async function editLimitation(formData: FormData): Promise<void> {
  const parsed = editSchema.safeParse({
    id: formData.get("id"),
    severity: formData.get("severity") || undefined,
    notes: formData.get("notes") || undefined,
  });
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Invalid input");

  const supabase = await createClient();
  const updates: Record<string, unknown> = {};
  if (parsed.data.severity !== undefined) updates.severity = parsed.data.severity;
  if (parsed.data.notes !== undefined) updates.notes = parsed.data.notes;

  const { error } = await supabase
    .from("limitations")
    .update(updates)
    .eq("id", parsed.data.id);
  if (error) throw new Error(error.message);

  revalidatePath("/app/settings/limitations");
}

export async function resolveLimitation(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const supabase = await createClient();
  await supabase
    .from("limitations")
    .update({ resolved_at: new Date().toISOString() })
    .eq("id", id);
  revalidatePath("/app");
  revalidatePath("/app/settings/limitations");
}

export async function reopenLimitation(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const supabase = await createClient();
  await supabase
    .from("limitations")
    .update({ resolved_at: null })
    .eq("id", id);
  revalidatePath("/app");
  revalidatePath("/app/settings/limitations");
}

export async function deleteLimitation(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const supabase = await createClient();
  await supabase.from("limitations").delete().eq("id", id);
  revalidatePath("/app/settings/limitations");
}
