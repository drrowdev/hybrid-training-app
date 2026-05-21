"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const eventSchema = z.object({
  name: z.string().trim().min(1).max(120),
  eventDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD"),
  priority: z.enum(["A", "B", "C"]).default("A"),
  modality: z.string().trim().max(40).optional().nullable(),
  notes: z.string().trim().max(1000).optional().nullable(),
});

export async function createPriorityEvent(formData: FormData): Promise<void> {
  const parsed = eventSchema.safeParse({
    name: formData.get("name"),
    eventDate: formData.get("eventDate"),
    priority: formData.get("priority") || "A",
    modality: formData.get("modality") || undefined,
    notes: formData.get("notes") || undefined,
  });
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { error } = await supabase.from("priority_events").insert({
    user_id: user.id,
    name: parsed.data.name,
    event_date: parsed.data.eventDate,
    priority: parsed.data.priority,
    modality: parsed.data.modality ?? null,
    notes: parsed.data.notes ?? null,
  });
  if (error) throw new Error(error.message);

  revalidatePath("/app");
  revalidatePath("/app/settings/events");
  redirect("/app/settings/events");
}

export async function deletePriorityEvent(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  await supabase.from("priority_events").delete().eq("id", id).eq("user_id", user.id);
  revalidatePath("/app");
  revalidatePath("/app/settings/events");
  redirect("/app/settings/events");
}
