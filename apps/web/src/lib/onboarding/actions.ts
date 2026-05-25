"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createBlock, type CreateBlockResult } from "@/lib/planner/actions";
import { buildProfileUpdate } from "@/lib/onboarding/gate";

// ── Schemas ────────────────────────────────────────────────────────────────

const profileSchema = z.object({
  displayName: z.string().trim().max(60).optional().nullable(),
  units: z.enum(["metric", "imperial"]).optional(),
  trainingExperience: z
    .enum([
      "beginner_lt_6m",
      "novice_6m_2y",
      "intermediate_2y_5y",
      "advanced_5y_10y",
      "highly_advanced_10y_plus",
    ])
    .optional(),
  bodyweightKg: z.coerce.number().positive().lte(400).optional(),
});

const tmsSchema = z.object({
  oneRmBySlug: z.record(z.string(), z.coerce.number().positive().lte(1000)).optional(),
});

const finishSchema = z.object({
  archetype: z.enum([
    "strength_anchor",
    "endurance_anchor",
    "rebuild",
    "hypertrophy_anchor",
    "concurrent_hybrid",
    "maintenance",
  ]),
  startedOn: z.string().date(),
  daysPerWeek: z.coerce.number().int().min(1).max(7),
  dayIndexOverrides: z.string().optional(),
});

// ── Result types ───────────────────────────────────────────────────────────

export type OnboardingResult = { ok: true } | { ok: false; error: string };

// ── Helpers ────────────────────────────────────────────────────────────────

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return { supabase, user };
}

// ── Step 2: profile basics ────────────────────────────────────────────────

/**
 * Persist name + units + training-experience + (optional) bodyweight.
 * Idempotent — the user can go back and forward between onboarding steps
 * without each save tripping a unique constraint. Does NOT mark
 * `onboarded_at`.
 */
export async function saveOnboardingProfile(formData: FormData): Promise<OnboardingResult> {
  const raw = formData.get("payload");
  if (typeof raw !== "string") return { ok: false, error: "Missing payload" };
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch (e) {
    return { ok: false, error: `Invalid payload: ${e instanceof Error ? e.message : String(e)}` };
  }
  const parsed = profileSchema.safeParse(parsedJson);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const { supabase, user } = await requireUser();
  const update = buildProfileUpdate(parsed.data);
  if (Object.keys(update).length === 0) return { ok: true };

  const { error } = await supabase.from("profiles").update(update).eq("id", user.id);
  if (error) return { ok: false, error: `Profile save failed: ${error.message}` };
  return { ok: true };
}

// ── Step 3: training maxes ────────────────────────────────────────────────

/**
 * Upsert the user's main-lift 1RMs. Slugs whose value is non-positive or
 * missing are skipped. Movement IDs are looked up by slug against the
 * catalog (user_id NULL = shared). Does NOT mark `onboarded_at`.
 */
export async function saveOnboardingTms(formData: FormData): Promise<OnboardingResult> {
  const raw = formData.get("payload");
  if (typeof raw !== "string") return { ok: false, error: "Missing payload" };
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch (e) {
    return { ok: false, error: `Invalid payload: ${e instanceof Error ? e.message : String(e)}` };
  }
  const parsed = tmsSchema.safeParse(parsedJson);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const { supabase, user } = await requireUser();
  const entries = Object.entries(parsed.data.oneRmBySlug ?? {});
  if (entries.length === 0) return { ok: true };

  const slugs = entries.map(([s]) => s);
  const { data: movements } = await supabase
    .from("movements")
    .select("id, slug")
    .in("slug", slugs)
    .is("user_id", null);
  const bySlug = new Map((movements ?? []).map((m) => [m.slug, m.id]));
  const rows = entries
    .map(([slug, oneRm]) => {
      const mid = bySlug.get(slug);
      if (!mid) return null;
      return { user_id: user.id, movement_id: mid, one_rm_kg: oneRm, tm_percent: null };
    })
    .filter((r): r is { user_id: string; movement_id: string; one_rm_kg: number; tm_percent: null } => r != null);
  if (rows.length === 0) return { ok: true };

  const { error } = await supabase
    .from("training_maxes")
    .upsert(rows, { onConflict: "user_id,movement_id" });
  if (error) return { ok: false, error: `TM save failed: ${error.message}` };
  revalidatePath("/app/settings/training-maxes");
  return { ok: true };
}

// ── Step 5: finish & create the first block ──────────────────────────────

/**
 * Mark onboarding complete and create the user's first block. Delegates
 * block creation to the canonical `createBlock` server action so all the
 * planner invariants (DC-* gates, RLS, archetype validation) apply.
 */
export async function finishOnboarding(formData: FormData): Promise<CreateBlockResult> {
  const parsed = finishSchema.safeParse({
    archetype: formData.get("archetype"),
    startedOn: formData.get("startedOn"),
    daysPerWeek: formData.get("daysPerWeek"),
    dayIndexOverrides: formData.get("dayIndexOverrides") ?? undefined,
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  // Create the block first — if planner-side validation fails (e.g. min
  // days), surface the error before flipping the onboarded_at flag.
  const blockFd = new FormData();
  blockFd.set("archetype", parsed.data.archetype);
  blockFd.set("startedOn", parsed.data.startedOn);
  blockFd.set("daysPerWeek", String(parsed.data.daysPerWeek));
  if (parsed.data.dayIndexOverrides) {
    blockFd.set("dayIndexOverrides", parsed.data.dayIndexOverrides);
  }
  const blockResult = await createBlock(blockFd);
  if (!blockResult.ok) return blockResult;

  // Mark the user as onboarded only after the block exists.
  const { supabase, user } = await requireUser();
  const { error } = await supabase
    .from("profiles")
    .update({ onboarded_at: new Date().toISOString() })
    .eq("id", user.id);
  if (error) return { ok: false, error: `Onboarding save failed: ${error.message}` };

  revalidatePath("/app");
  return { ok: true };
}

// ── Skip (no completion marker — gate fires again next visit) ────────────

export async function skipOnboarding(): Promise<void> {
  // Intentionally a no-op on the server: we do NOT set onboarded_at, so
  // the gate in /app/layout.tsx will redirect the user back here on
  // their next visit. The client redirects to /app.
  await requireUser();
  redirect("/app");
}
