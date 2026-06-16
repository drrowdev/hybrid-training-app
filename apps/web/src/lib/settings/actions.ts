"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import { getUserTimezone } from "@/lib/planner/queries";
import { todayYmd } from "@/lib/dates";
import { recordOverrideEvent } from "@/lib/engine/overrides";

const profileSchema = z.object({
  displayName: z.string().trim().max(60).optional().nullable(),
  units: z.enum(["metric", "imperial"]).optional(),
  bodyCompPhase: z.enum(["gain", "maintain", "lean_out"]).optional(),
  phaseStartedAt: z.string().date().optional().nullable(),
  phaseTargetWeeks: z.coerce.number().int().min(1).max(52).optional().nullable(),
  trainingDaysPerWeek: z.coerce.number().int().min(2).max(7).optional(),
  trainingExperience: z
    .enum([
      "beginner_lt_6m",
      "novice_6m_2y",
      "intermediate_2y_5y",
      "advanced_5y_10y",
      "highly_advanced_10y_plus",
    ])
    .optional(),
  effortPreference: z.enum(["low", "standard", "high"]).optional(),
  hapticsEnabled: z.coerce.boolean().optional(),
  timerSoundEnabled: z.coerce.boolean().optional(),
  showTodayRecoveryCard: z.coerce.boolean().optional(),
});

export async function updateProfile(formData: FormData): Promise<void> {
  const parsed = profileSchema.safeParse({
    displayName: formData.get("displayName") || undefined,
    units: formData.get("units") || undefined,
    bodyCompPhase: formData.get("bodyCompPhase") || undefined,
    phaseStartedAt: formData.get("phaseStartedAt") || undefined,
    phaseTargetWeeks: formData.get("phaseTargetWeeks") || undefined,
    trainingDaysPerWeek: formData.get("trainingDaysPerWeek") || undefined,
    trainingExperience: formData.get("trainingExperience") || undefined,
    effortPreference: formData.get("effortPreference") || undefined,
    hapticsEnabled:
      formData.get("hapticsEnabledPresent") === "1"
        ? formData.get("hapticsEnabled") === "on"
        : undefined,
    timerSoundEnabled:
      formData.get("timerSoundEnabledPresent") === "1"
        ? formData.get("timerSoundEnabled") === "on"
        : undefined,
    showTodayRecoveryCard:
      formData.get("showTodayRecoveryCardPresent") === "1"
        ? formData.get("showTodayRecoveryCard") === "on"
        : undefined,
  });
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Invalid input");

  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) redirect("/login");

  // For a training_experience change we read the prior value so we can
  // log an override event when it differs (DC-K4 — the user is
  // self-overriding the engine's tier-assertion default).
  let priorTrainingExperience: string | null = null;
  if (parsed.data.trainingExperience !== undefined) {
    const { data } = await supabase
      .from("profiles")
      .select("training_experience")
      .eq("id", user.id)
      .maybeSingle();
    priorTrainingExperience =
      (data?.training_experience as string | null | undefined) ?? null;
  }

  const updates: Record<string, unknown> = {};
  if (parsed.data.displayName !== undefined) updates.display_name = parsed.data.displayName || null;
  if (parsed.data.units !== undefined) updates.units = parsed.data.units;
  if (parsed.data.bodyCompPhase !== undefined) updates.body_comp_phase = parsed.data.bodyCompPhase;
  if (parsed.data.phaseStartedAt !== undefined) updates.phase_started_at = parsed.data.phaseStartedAt || null;
  if (parsed.data.phaseTargetWeeks !== undefined) updates.phase_target_weeks = parsed.data.phaseTargetWeeks ?? null;
  if (parsed.data.trainingDaysPerWeek !== undefined) updates.training_days_per_week = parsed.data.trainingDaysPerWeek;
  if (parsed.data.trainingExperience !== undefined) updates.training_experience = parsed.data.trainingExperience;
  if (parsed.data.effortPreference !== undefined) updates.effort_preference = parsed.data.effortPreference;
  if (parsed.data.hapticsEnabled !== undefined) updates.haptics_enabled = parsed.data.hapticsEnabled;
  if (parsed.data.timerSoundEnabled !== undefined) updates.timer_sound_enabled = parsed.data.timerSoundEnabled;
  if (parsed.data.showTodayRecoveryCard !== undefined)
    updates.show_today_recovery_card = parsed.data.showTodayRecoveryCard;

  const { error } = await supabase
    .from("profiles")
    .update(updates)
    .eq("id", user.id);

  if (error) throw new Error(error.message);

  // DC-K4 audit: when the user changes their declared training
  // experience mid-flow, record it as a custom override. We funnel
  // through `recordOverrideEvent` directly (rather than the
  // recordCustomOverride FormData wrapper) so the context blob is
  // strongly typed.
  if (
    parsed.data.trainingExperience !== undefined &&
    parsed.data.trainingExperience !== priorTrainingExperience
  ) {
    await recordOverrideEvent(supabase, {
      userId: user.id,
      eventType: "custom",
      reason: "Training experience updated in settings",
      context: {
        kind: "training_experience_change",
        from: priorTrainingExperience,
        to: parsed.data.trainingExperience,
      },
    });
  }

  revalidatePath("/app");
  revalidatePath("/app/settings");
  revalidatePath("/app/stats/engine");
}

const bodyweightSchema = z.object({
  date: z.string().date(),
  bodyweightKg: z.coerce.number().min(20).max(400),
  notes: z.string().trim().max(400).optional().nullable(),
});

export async function logBodyweight(formData: FormData): Promise<void> {
  const submittedDate = formData.get("date");
  // Fall back to the user's local "today" rather than UTC — a Helsinki
  // user logging at 00:30 local should land on the right calendar day.
  const dateDefault = submittedDate ? null : todayYmd(await getUserTimezone());
  const parsed = bodyweightSchema.safeParse({
    date: submittedDate || dateDefault,
    bodyweightKg: formData.get("bodyweightKg"),
    notes: formData.get("notes") || undefined,
  });
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Invalid input");

  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthUser();
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
