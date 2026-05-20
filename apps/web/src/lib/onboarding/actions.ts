"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const onboardingPayloadSchema = z.object({
  displayName: z.string().trim().max(60).optional().nullable(),
  units: z.enum(["metric", "imperial"]).optional(),
  trainingDaysPerWeek: z.coerce.number().int().min(2).max(7).optional(),
  tmPercentDefault: z.coerce.number().positive().lte(100).optional(),
  oneRmBySlug: z
    .record(z.string(), z.coerce.number().positive().lte(1000))
    .optional(),
});

export type CompleteOnboardingResult =
  | { ok: true }
  | { ok: false; error: string };

export async function completeOnboarding(formData: FormData): Promise<CompleteOnboardingResult> {
  const raw = formData.get("payload");
  if (typeof raw !== "string") return { ok: false, error: "Missing payload" };
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch (e) {
    return { ok: false, error: `Invalid payload: ${e instanceof Error ? e.message : String(e)}` };
  }
  const parsed = onboardingPayloadSchema.safeParse(parsedJson);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const update: Record<string, unknown> = { onboarded_at: new Date().toISOString() };
  if (parsed.data.displayName !== undefined) update.display_name = parsed.data.displayName || null;
  if (parsed.data.units !== undefined) update.units = parsed.data.units;
  if (parsed.data.trainingDaysPerWeek !== undefined)
    update.training_days_per_week = parsed.data.trainingDaysPerWeek;
  if (parsed.data.tmPercentDefault !== undefined)
    update.tm_percent_default = parsed.data.tmPercentDefault;

  const { error: pErr } = await supabase.from("profiles").update(update).eq("id", user.id);
  if (pErr) return { ok: false, error: `Profile save failed: ${pErr.message}` };

  const oneRmEntries = Object.entries(parsed.data.oneRmBySlug ?? {});
  if (oneRmEntries.length > 0) {
    const slugs = oneRmEntries.map(([slug]) => slug);
    const { data: movements } = await supabase
      .from("movements")
      .select("id, slug")
      .in("slug", slugs)
      .is("user_id", null);
    const movementBySlug = new Map((movements ?? []).map((m) => [m.slug, m.id]));
    const rows = oneRmEntries
      .map(([slug, oneRm]) => {
        const mid = movementBySlug.get(slug);
        if (!mid) return null;
        return { user_id: user.id, movement_id: mid, one_rm_kg: oneRm, tm_percent: null };
      })
      .filter((r): r is { user_id: string; movement_id: string; one_rm_kg: number; tm_percent: null } => r != null);
    if (rows.length > 0) {
      const { error: tmErr } = await supabase
        .from("training_maxes")
        .upsert(rows, { onConflict: "user_id,movement_id" });
      if (tmErr) return { ok: false, error: `TM save failed: ${tmErr.message}` };
    }
  }

  revalidatePath("/app");
  return { ok: true };
}

export async function skipOnboarding(): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  await supabase
    .from("profiles")
    .update({ onboarded_at: new Date().toISOString() })
    .eq("id", user.id);
  revalidatePath("/app");
  redirect("/app");
}
