"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { NewPlannedSession, Prescription } from "@hta/db";
import { createClient } from "@/lib/supabase/server";
import {
  ARCHETYPES,
  type ArchetypeId,
  allCandidateLiftSlugs,
  buildPrescription,
  daysForFrequency,
  minDaysForArchetype,
  requiredFixedSlugs,
  STRENGTH_ROLE_LABELS,
} from "./archetypes";

const createBlockSchema = z.object({
  archetype: z.enum([
    "strength_anchor",
    "endurance_anchor",
    "rebuild",
  ] satisfies [ArchetypeId, ...ArchetypeId[]]),
  startedOn: z.string().date(),
  daysPerWeek: z.coerce.number().int().min(2).max(7),
});

export type CreateBlockResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Create a new block from the wizard input. Returns a result object so the
 * client wizard can surface the failure reason inline instead of crashing
 * the whole page.
 */
export async function createBlock(formData: FormData): Promise<CreateBlockResult> {
  const parsed = createBlockSchema.safeParse({
    archetype: formData.get("archetype"),
    startedOn: formData.get("startedOn"),
    daysPerWeek: formData.get("daysPerWeek"),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const archetype = ARCHETYPES[parsed.data.archetype];
  if (!archetype) return { ok: false, error: "Unknown archetype" };

  const minDays = minDaysForArchetype(archetype);
  if (parsed.data.daysPerWeek < minDays) {
    return {
      ok: false,
      error: `${archetype.name} needs at least ${minDays} training days/week.`,
    };
  }
  const activeDays = daysForFrequency(archetype, parsed.data.daysPerWeek);

  const candidateSlugs = allCandidateLiftSlugs(archetype);
  const fixedSlugs = requiredFixedSlugs(archetype);
  const allSlugs = Array.from(new Set([...candidateSlugs, ...fixedSlugs]));

  const { data: movements, error: mvErr } = await supabase
    .from("movements")
    .select("id, slug, display_name")
    .in("slug", allSlugs)
    .is("user_id", null);

  if (mvErr) return { ok: false, error: `Movement lookup failed: ${mvErr.message}` };

  const movementBySlug = new Map((movements ?? []).map((m) => [m.slug, m]));

  const missingFixed = fixedSlugs.filter((s) => !movementBySlug.has(s));
  if (missingFixed.length > 0) {
    return {
      ok: false,
      error: `Catalog is missing required movements: ${missingFixed.join(", ")}. Re-seed movements.`,
    };
  }

  const candidateMovementIds = candidateSlugs
    .map((s) => movementBySlug.get(s)?.id)
    .filter((id): id is string => !!id);

  const { data: tms, error: tmErr } = await supabase
    .from("training_maxes")
    .select("movement_id, updated_at")
    .in("movement_id", candidateMovementIds);

  if (tmErr) return { ok: false, error: `TM lookup failed: ${tmErr.message}` };

  const tmByMovementId = new Map((tms ?? []).map((r) => [r.movement_id, r.updated_at]));

  const resolved = new Map<number, { movementId: string; slug: string; displayName: string }>();
  const missingRoles: string[] = [];

  for (const day of activeDays) {
    if (day.kind !== "strength") continue;
    let chosen: { movementId: string; slug: string; displayName: string } | null = null;
    for (const slug of day.candidateSlugs) {
      const mv = movementBySlug.get(slug);
      if (mv && tmByMovementId.has(mv.id)) {
        chosen = { movementId: mv.id, slug: mv.slug, displayName: mv.display_name };
        break;
      }
    }
    if (chosen) resolved.set(day.dayIndex, chosen);
    else missingRoles.push(STRENGTH_ROLE_LABELS[day.role]);
  }

  if (missingRoles.length > 0) {
    return {
      ok: false,
      error: `No TM set for: ${missingRoles.join(", ")}. Go to Settings → Training maxes and add one for each.`,
    };
  }

  const { error: archErr } = await supabase
    .from("training_blocks")
    .update({ status: "archived" })
    .eq("user_id", user.id)
    .eq("status", "active");
  if (archErr) return { ok: false, error: `Couldn't archive prior block: ${archErr.message}` };

  const { data: block, error: blockErr } = await supabase
    .from("training_blocks")
    .insert({
      user_id: user.id,
      archetype: archetype.id,
      started_on: parsed.data.startedOn,
      weeks: archetype.weeks,
      status: "active",
      days_per_week: parsed.data.daysPerWeek,
    })
    .select("id")
    .single();

  if (blockErr || !block) {
    return { ok: false, error: blockErr?.message ?? "Failed to create block" };
  }

  const rows: NewPlannedSession[] = [];
  for (let week = 0; week < archetype.weeks; week++) {
    for (const day of activeDays) {
      let movement: { id: string; slug: string; displayName: string };
      let finisherMovement: { id: string; slug: string; displayName: string } | undefined;

      if (day.kind === "strength") {
        const resolvedMv = resolved.get(day.dayIndex);
        if (!resolvedMv) continue;
        movement = { id: resolvedMv.movementId, slug: resolvedMv.slug, displayName: resolvedMv.displayName };
      } else if (day.kind === "cardio") {
        const mv = movementBySlug.get(day.movementSlug);
        if (!mv) continue;
        movement = { id: mv.id, slug: mv.slug, displayName: mv.display_name };
        if (day.finisher) {
          const fin = movementBySlug.get(day.finisher.movementSlug);
          if (fin) finisherMovement = { id: fin.id, slug: fin.slug, displayName: fin.display_name };
        }
      } else {
        // tendon
        const mv = movementBySlug.get(day.movementSlug);
        if (!mv) continue;
        movement = { id: mv.id, slug: mv.slug, displayName: mv.display_name };
      }

      const items = buildPrescription(archetype, week, day, movement, finisherMovement);
      const prescription: Prescription = { items };
      const isDeload = archetype.weekProfiles.find((w) => w.weekIndex === week)?.intensityLabel === "Deload";

      let title = day.title;
      if (day.kind === "strength") {
        title = `${movement.displayName}${isDeload ? " (deload)" : ""}`;
      } else if (isDeload) {
        title = `${day.title} (deload)`;
      }

      rows.push({
        blockId: block.id,
        userId: user.id,
        weekIndex: week,
        dayIndex: day.dayIndex,
        title,
        role: day.role,
        prescription,
      });
    }
  }

  const { error: psErr } = await supabase.from("planned_sessions").insert(rows);
  if (psErr) {
    // Roll back the block we just created so we don't leave a zombie.
    await supabase.from("training_blocks").delete().eq("id", block.id);
    return { ok: false, error: `Couldn't create planned sessions: ${psErr.message}` };
  }

  revalidatePath("/app");
  revalidatePath("/app/plan");
  return { ok: true };
}

const blockIdSchema = z.object({ id: z.string().uuid() });

export async function endBlock(formData: FormData): Promise<void> {
  const parsed = blockIdSchema.safeParse({ id: formData.get("id") });
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Invalid input");
  const supabase = await createClient();
  await supabase
    .from("training_blocks")
    .update({ status: "archived" })
    .eq("id", parsed.data.id);
  revalidatePath("/app");
  revalidatePath("/app/plan");
}

const skipSchema = z.object({ id: z.string().uuid() });

export async function skipPlannedSession(formData: FormData): Promise<void> {
  const parsed = skipSchema.safeParse({ id: formData.get("id") });
  if (!parsed.success) return;
  const supabase = await createClient();
  await supabase
    .from("planned_sessions")
    .update({ skipped_at: new Date().toISOString() })
    .eq("id", parsed.data.id);
  revalidatePath("/app");
  revalidatePath("/app/plan");
}

export async function unskipPlannedSession(formData: FormData): Promise<void> {
  const parsed = skipSchema.safeParse({ id: formData.get("id") });
  if (!parsed.success) return;
  const supabase = await createClient();
  await supabase
    .from("planned_sessions")
    .update({ skipped_at: null })
    .eq("id", parsed.data.id);
  revalidatePath("/app");
  revalidatePath("/app/plan");
}

const startPlannedSchema = z.object({ id: z.string().uuid() });

/**
 * Start a real session from a planned slot.
 *
 * Creates a sessions row pre-populated with the planned title + a set_log
 * stub per prescription item (no weights yet — user logs them as actual sets),
 * and links it back to the planned_session.
 */
export async function startSessionFromPlan(formData: FormData): Promise<void> {
  const parsed = startPlannedSchema.safeParse({ id: formData.get("id") });
  if (!parsed.success) throw new Error("Invalid planned session id");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: planned } = await supabase
    .from("planned_sessions")
    .select("id, title, prescription, completed_session_id")
    .eq("id", parsed.data.id)
    .maybeSingle();

  if (!planned) throw new Error("Planned session not found");

  // Reuse the existing linked session if any.
  if (planned.completed_session_id) {
    redirect(`/app/sessions/${planned.completed_session_id}`);
  }

  const { data: session, error: sessErr } = await supabase
    .from("sessions")
    .insert({
      user_id: user.id,
      title: planned.title,
    })
    .select("id")
    .single();

  if (sessErr || !session) throw new Error(sessErr?.message ?? "Failed to start session");

  await supabase
    .from("planned_sessions")
    .update({ completed_session_id: session.id })
    .eq("id", planned.id);

  revalidatePath("/app");
  revalidatePath("/app/plan");
  redirect(`/app/sessions/${session.id}`);
}
