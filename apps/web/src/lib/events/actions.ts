"use server";

/**
 * Typed server actions for the /app/races page.
 *
 * Object-form actions (not FormData) so the client modals can pass
 * structured target/result payloads without re-encoding nested
 * objects. All actions are RLS-scoped via the Supabase server client
 * (`user_id = auth.uid()` is enforced by the 0017 policy).
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import {
  captureResultSchema,
  eventFormSchema,
  type CaptureResultInput,
  type EventActionResult,
  type EventFormInput,
} from "./schema";

const idSchema = z.string().uuid();

function revalidate() {
  revalidatePath("/app");
  revalidatePath("/app/races");
  revalidatePath("/app/settings/events");
}

export async function createEvent(
  input: EventFormInput,
): Promise<EventActionResult> {
  const parsed = eventFormSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data, error } = await supabase
    .from("priority_events")
    .insert({
      user_id: user.id,
      name: parsed.data.name,
      event_date: parsed.data.eventDate,
      priority: parsed.data.priority,
      modality: parsed.data.modality,
      notes: parsed.data.notes ?? null,
      target_performance: parsed.data.targetPerformance ?? null,
    })
    .select("id")
    .single();

  if (error || !data) {
    return { ok: false, error: error?.message ?? "Insert failed" };
  }
  revalidate();
  return { ok: true, id: data.id as string };
}

export async function updateEvent(
  id: string,
  input: EventFormInput,
): Promise<EventActionResult> {
  if (!idSchema.safeParse(id).success) {
    return { ok: false, error: "Invalid id" };
  }
  const parsed = eventFormSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("priority_events")
    .update({
      name: parsed.data.name,
      event_date: parsed.data.eventDate,
      priority: parsed.data.priority,
      modality: parsed.data.modality,
      notes: parsed.data.notes ?? null,
      target_performance: parsed.data.targetPerformance ?? null,
    })
    .eq("id", id);

  if (error) return { ok: false, error: error.message };
  revalidate();
  return { ok: true, id };
}

export async function deleteEvent(id: string): Promise<EventActionResult> {
  if (!idSchema.safeParse(id).success) {
    return { ok: false, error: "Invalid id" };
  }
  const supabase = await createClient();
  const { error } = await supabase.from("priority_events").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidate();
  return { ok: true, id };
}

export async function captureResult(
  id: string,
  input: CaptureResultInput,
): Promise<EventActionResult> {
  if (!idSchema.safeParse(id).success) {
    return { ok: false, error: "Invalid id" };
  }
  const parsed = captureResultSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("priority_events")
    .update({
      result: parsed.data.result ?? null,
      completed: parsed.data.completed,
    })
    .eq("id", id);

  if (error) return { ok: false, error: error.message };
  revalidate();
  return { ok: true, id };
}

export async function toggleCompleted(
  id: string,
  completed: boolean,
): Promise<EventActionResult> {
  if (!idSchema.safeParse(id).success) {
    return { ok: false, error: "Invalid id" };
  }
  const supabase = await createClient();
  const { error } = await supabase
    .from("priority_events")
    .update({ completed })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidate();
  return { ok: true, id };
}
