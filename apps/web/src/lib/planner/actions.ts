"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { NewPlannedSession, Prescription } from "@hta/db";
import { createClient } from "@/lib/supabase/server";
import {
  ARCHETYPES,
  type ArchetypeId,
  buildPrescription,
  requiredCardioSlugs,
  requiredLiftSlugs,
} from "./archetypes";

const createBlockSchema = z.object({
  archetype: z.enum(["strength_anchor", "endurance_anchor"] satisfies [ArchetypeId, ...ArchetypeId[]]),
  startedOn: z.string().date(),
});

/**
 * Create a new block from the wizard input.
 *
 * Validates the user has TMs for every main lift the archetype needs, then
 * generates the planned_sessions in one transaction.
 */
export async function createBlock(formData: FormData): Promise<void> {
  const parsed = createBlockSchema.safeParse({
    archetype: formData.get("archetype"),
    startedOn: formData.get("startedOn"),
  });
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Invalid input");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const archetype = ARCHETYPES[parsed.data.archetype];
  if (!archetype) throw new Error("Unknown archetype");

  // Resolve required movements: lifts (need TMs) + cardio (no TM check).
  const liftSlugs = requiredLiftSlugs(archetype);
  const cardioSlugs = requiredCardioSlugs(archetype);
  const allSlugs = Array.from(new Set([...liftSlugs, ...cardioSlugs]));

  const { data: movements } = await supabase
    .from("movements")
    .select("id, slug, display_name")
    .in("slug", allSlugs)
    .is("user_id", null);

  if (!movements || movements.length < allSlugs.length) {
    const found = new Set((movements ?? []).map((m) => m.slug));
    const missing = allSlugs.filter((s) => !found.has(s));
    throw new Error(
      `Catalog is missing required movements: ${missing.join(", ")}. Re-seed movements.`,
    );
  }
  const movementBySlug = new Map(movements.map((m) => [m.slug, m]));

  // TM check applies only to strength lifts.
  const liftMovementIds = liftSlugs
    .map((s) => movementBySlug.get(s)?.id)
    .filter((id): id is string => !!id);

  const { data: tms } = await supabase
    .from("training_maxes")
    .select("movement_id")
    .in("movement_id", liftMovementIds);

  const tmMovementIds = new Set((tms ?? []).map((r) => r.movement_id));

  const missingTm: string[] = [];
  for (const day of archetype.days) {
    if (day.kind !== "strength") continue;
    const mv = movementBySlug.get(day.movementSlug);
    if (!mv || !tmMovementIds.has(mv.id)) missingTm.push(mv?.display_name ?? day.movementSlug);
  }
  if (missingTm.length > 0) {
    throw new Error(
      `Set a training max for ${missingTm.join(", ")} in Settings → Training maxes first.`,
    );
  }

  // Archive any other active blocks before creating the new one.
  await supabase
    .from("training_blocks")
    .update({ status: "archived" })
    .eq("user_id", user.id)
    .eq("status", "active");

  const { data: block, error: blockErr } = await supabase
    .from("training_blocks")
    .insert({
      user_id: user.id,
      archetype: archetype.id,
      started_on: parsed.data.startedOn,
      weeks: archetype.weeks,
      status: "active",
    })
    .select("id")
    .single();

  if (blockErr || !block) throw new Error(blockErr?.message ?? "Failed to create block");

  // Generate planned sessions.
  const rows: NewPlannedSession[] = [];
  for (let week = 0; week < archetype.weeks; week++) {
    for (const day of archetype.days) {
      const movement = movementBySlug.get(day.movementSlug);
      if (!movement) continue;
      const finisherMovement =
        day.kind === "cardio" && day.finisher
          ? movementBySlug.get(day.finisher.movementSlug)
          : undefined;
      const items = buildPrescription(
        archetype,
        week,
        day,
        { id: movement.id, slug: movement.slug, displayName: movement.display_name },
        finisherMovement
          ? {
              id: finisherMovement.id,
              slug: finisherMovement.slug,
              displayName: finisherMovement.display_name,
            }
          : undefined,
      );
      const prescription: Prescription = { items };
      const isDeload = archetype.weekProfiles.find((w) => w.weekIndex === week)?.intensityLabel === "Deload";
      rows.push({
        blockId: block.id,
        userId: user.id,
        weekIndex: week,
        dayIndex: day.dayIndex,
        title: isDeload ? `${day.title} (deload)` : day.title,
        role: day.role,
        prescription,
      });
    }
  }

  const { error: psErr } = await supabase.from("planned_sessions").insert(rows);
  if (psErr) throw new Error(psErr.message);

  revalidatePath("/app");
  revalidatePath("/app/plan");
  redirect("/app/plan");
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
