"use server";

/**
 * Server actions for the /app/profile page.
 *
 * All actions are thin wrappers around `profiles` upserts plus a
 * targeted `revalidatePath("/app/profile")` so inline edits feel
 * immediate. Larger fan-out revalidations (e.g. settings, today)
 * already happen in `@/lib/settings/actions::updateProfile`; this
 * module exists to keep the click-to-edit affordances narrow.
 */

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient, getAuthUser } from "@/lib/supabase/server";

const displayNameSchema = z.object({
  displayName: z.string().trim().max(60).nullable(),
});

export type ActionResult = { ok: true } | { ok: false; error: string };

async function getUserOrRedirect(): Promise<{
  supabase: Awaited<ReturnType<typeof createClient>>;
  userId: string;
}> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) redirect("/login");
  return { supabase, userId: user.id };
}

export async function updateDisplayName(
  formData: FormData,
): Promise<ActionResult> {
  const raw = formData.get("displayName");
  const parsed = displayNameSchema.safeParse({
    displayName: raw == null || raw === "" ? null : String(raw),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid name" };
  }

  const { supabase, userId } = await getUserOrRedirect();
  const { error } = await supabase
    .from("profiles")
    .update({ display_name: parsed.data.displayName || null })
    .eq("id", userId);

  if (error) return { ok: false, error: error.message };

  revalidatePath("/app/profile");
  revalidatePath("/app");
  return { ok: true };
}

const aiNotesSchema = z.object({
  aiNotes: z.string().trim().max(4000).nullable(),
});

export async function updateAiNotes(
  formData: FormData,
): Promise<ActionResult> {
  const raw = formData.get("aiNotes");
  const parsed = aiNotesSchema.safeParse({
    aiNotes: raw == null || raw === "" ? null : String(raw),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Notes too long" };
  }

  const { supabase, userId } = await getUserOrRedirect();
  const { error } = await supabase
    .from("profiles")
    .update({
      ai_notes: parsed.data.aiNotes,
      // bump updated_at so the "Last updated" hint stays accurate.
      updated_at: new Date().toISOString(),
    })
    .eq("id", userId);

  if (error) return { ok: false, error: error.message };

  revalidatePath("/app/profile");
  return { ok: true };
}

const HHMM = /^\d{2}:\d{2}$/;
const preferencesSchema = z.object({
  amWindowStart: z.string().regex(HHMM).optional(),
  pmWindowStart: z.string().regex(HHMM).optional(),
  units: z.enum(["metric", "imperial"]).optional(),
  gender: z.enum(["male", "female", ""]).optional(),
});

function addHours(hhmm: string, hours: number): string {
  const [h, m] = hhmm.split(":").map((s) => Number.parseInt(s, 10));
  const total = (h * 60 + m + hours * 60) % (24 * 60);
  const nh = Math.floor(total / 60);
  const nm = total % 60;
  return `${String(nh).padStart(2, "0")}:${String(nm).padStart(2, "0")}`;
}

export async function updatePreferences(
  formData: FormData,
): Promise<ActionResult> {
  const parsed = preferencesSchema.safeParse({
    amWindowStart: formData.get("amWindowStart") || undefined,
    pmWindowStart: formData.get("pmWindowStart") || undefined,
    units: formData.get("units") || undefined,
    gender: formData.get("gender") ?? undefined,
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const updates: Record<string, unknown> = {};
  if (parsed.data.amWindowStart) {
    updates.am_window_start = parsed.data.amWindowStart;
    updates.am_window_end = addHours(parsed.data.amWindowStart, 2);
  }
  if (parsed.data.pmWindowStart) {
    updates.pm_window_start = parsed.data.pmWindowStart;
    updates.pm_window_end = addHours(parsed.data.pmWindowStart, 2);
  }
  if (parsed.data.units) {
    updates.units = parsed.data.units;
  }
  // Competition weight category for HYROX station loads. "" clears it back to NULL.
  if (parsed.data.gender !== undefined) {
    updates.gender = parsed.data.gender === "" ? null : parsed.data.gender;
  }

  if (Object.keys(updates).length === 0) return { ok: true };

  const { supabase, userId } = await getUserOrRedirect();
  const { error } = await supabase
    .from("profiles")
    .update(updates)
    .eq("id", userId);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/app/profile");
  revalidatePath("/app");
  revalidatePath("/app/settings");
  return { ok: true };
}

// ─── Cross-device sync (PR Z1) ────────────────────────────────────
// User-meaningful state that previously lived only in localStorage.
// See `hybrid-sync-audit.md` §2a + §3 and migration 0055.

const isoTimestampSchema = z
  .string()
  .refine((v) => !Number.isNaN(Date.parse(v)), { message: "Invalid timestamp" });

/**
 * Snooze the Today-page bodyweight nudge until the given ISO timestamp.
 * Persists across devices via `profiles.bw_nudge_hidden_until`.
 */
export async function dismissBwNudge(
  snoozeUntil: string,
): Promise<ActionResult> {
  const parsed = isoTimestampSchema.safeParse(snoozeUntil);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid timestamp" };
  }

  const { supabase, userId } = await getUserOrRedirect();
  const iso = new Date(parsed.data).toISOString();
  const { error } = await supabase
    .from("profiles")
    .update({ bw_nudge_hidden_until: iso })
    .eq("id", userId);
  if (error) return { ok: false, error: error.message };

  return { ok: true };
}

/**
 * Permanently dismiss the bodyweight-only early-support banner.
 * Persists across devices via `profiles.bw_banner_dismissed_at`.
 */
export async function dismissBwBanner(): Promise<ActionResult> {
  const { supabase, userId } = await getUserOrRedirect();
  const { error } = await supabase
    .from("profiles")
    .update({ bw_banner_dismissed_at: new Date().toISOString() })
    .eq("id", userId);
  if (error) return { ok: false, error: error.message };

  return { ok: true };
}

/**
 * Mark all engine-override audit entries as read up to `now()`. Used by
 * the TopBar bell's "mark all read" button. The audit-count query in
 * the app layout filters `engine_override_events.occurred_at >
 * profiles.audit_last_read_at`, so the badge clears immediately on
 * the next render.
 */
export async function markAuditRead(): Promise<ActionResult> {
  const { supabase, userId } = await getUserOrRedirect();
  const { error } = await supabase
    .from("profiles")
    .update({ audit_last_read_at: new Date().toISOString() })
    .eq("id", userId);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/app");
  return { ok: true };
}
