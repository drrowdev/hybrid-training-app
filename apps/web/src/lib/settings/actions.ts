"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getUserTimezone } from "@/lib/planner/queries";
import { todayYmd } from "@/lib/dates";

const profileSchema = z.object({
  displayName: z.string().trim().max(60).optional().nullable(),
  units: z.enum(["metric", "imperial"]).optional(),
  bodyCompPhase: z.enum(["gain", "maintain", "lean_out"]).optional(),
  phaseStartedAt: z.string().date().optional().nullable(),
  phaseTargetWeeks: z.coerce.number().int().min(1).max(52).optional().nullable(),
  trainingDaysPerWeek: z.coerce.number().int().min(2).max(7).optional(),
  allowsTwoADays: z.coerce.boolean().optional(),
  hapticsEnabled: z.coerce.boolean().optional(),
  timerSoundEnabled: z.coerce.boolean().optional(),
  amWindowStart: z
    .string()
    .regex(/^\d{2}:\d{2}(?::\d{2})?$/)
    .optional(),
  pmWindowStart: z
    .string()
    .regex(/^\d{2}:\d{2}(?::\d{2})?$/)
    .optional(),
});

export async function updateProfile(formData: FormData): Promise<void> {
  const parsed = profileSchema.safeParse({
    displayName: formData.get("displayName") || undefined,
    units: formData.get("units") || undefined,
    bodyCompPhase: formData.get("bodyCompPhase") || undefined,
    phaseStartedAt: formData.get("phaseStartedAt") || undefined,
    phaseTargetWeeks: formData.get("phaseTargetWeeks") || undefined,
    trainingDaysPerWeek: formData.get("trainingDaysPerWeek") || undefined,
    // Checkbox: present in FormData only when checked. Coerce explicitly.
    allowsTwoADays:
      formData.get("allowsTwoADaysPresent") === "1"
        ? formData.get("allowsTwoADays") === "on"
        : undefined,
    hapticsEnabled:
      formData.get("hapticsEnabledPresent") === "1"
        ? formData.get("hapticsEnabled") === "on"
        : undefined,
    timerSoundEnabled:
      formData.get("timerSoundEnabledPresent") === "1"
        ? formData.get("timerSoundEnabled") === "on"
        : undefined,
    amWindowStart: formData.get("amWindowStart") || undefined,
    pmWindowStart: formData.get("pmWindowStart") || undefined,
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
  if (parsed.data.trainingDaysPerWeek !== undefined) updates.training_days_per_week = parsed.data.trainingDaysPerWeek;
  if (parsed.data.allowsTwoADays !== undefined) updates.allows_two_a_days = parsed.data.allowsTwoADays;
  if (parsed.data.hapticsEnabled !== undefined) updates.haptics_enabled = parsed.data.hapticsEnabled;
  if (parsed.data.timerSoundEnabled !== undefined) updates.timer_sound_enabled = parsed.data.timerSoundEnabled;
  if (parsed.data.amWindowStart !== undefined) {
    const hhmm = parsed.data.amWindowStart.slice(0, 5);
    updates.am_window_start = hhmm;
    // Default the window end to +2h so the column stays in sync. Wrap at 24.
    updates.am_window_end = addHours(hhmm, 2);
  }
  if (parsed.data.pmWindowStart !== undefined) {
    const hhmm = parsed.data.pmWindowStart.slice(0, 5);
    updates.pm_window_start = hhmm;
    updates.pm_window_end = addHours(hhmm, 2);
  }

  const { error } = await supabase
    .from("profiles")
    .update(updates)
    .eq("id", user.id);

  if (error) throw new Error(error.message);

  revalidatePath("/app");
  revalidatePath("/app/settings");
}

function addHours(hhmm: string, hours: number): string {
  const [h, m] = hhmm.split(":").map((s) => Number.parseInt(s, 10));
  const total = (h * 60 + m + hours * 60) % (24 * 60);
  const nh = Math.floor(total / 60);
  const nm = total % 60;
  return `${String(nh).padStart(2, "0")}:${String(nm).padStart(2, "0")}`;
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
