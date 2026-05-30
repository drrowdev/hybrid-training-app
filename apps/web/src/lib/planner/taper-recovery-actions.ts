"use server";

/**
 * Server actions powering the Taper banner, Recovery banner, and
 * Race Check-In card on Today.
 *
 * All actions:
 *   - validate input with zod .strict()
 *   - use the user-scoped Supabase client (RLS enforced)
 *   - revalidate /app on success
 *
 * Snapshot rule: Apply takes the full day-by-day taper window (or
 * full recovery window) and stores it in the row's `payload`. Undo
 * marks the most recent applied row for that (event, kind) as
 * reverted. Decline writes an audit-only row with no engine effect.
 */

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import { computeTaperRecommendation, taperModalityForEvent } from "./taper";
import { computeRecoveryWindow } from "./recovery";

const eventIdSchema = z
  .object({ eventId: z.string().uuid() })
  .strict();

const resultSchema = z
  .object({
    eventId: z.string().uuid(),
    status: z.enum(["raced", "partial", "skipped"]),
  })
  .strict();

type ActionResult = { ok: true } | { ok: false; error: string };

async function requireUser(): Promise<
  { ok: true; userId: string } | { ok: false; error: string }
> {
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) return { ok: false, error: "Not authenticated" };
  return { ok: true, userId: user.id };
}

function parseIdForm(formData: FormData): string | null {
  const parsed = eventIdSchema.safeParse({
    eventId: String(formData.get("eventId") ?? ""),
  });
  return parsed.success ? parsed.data.eventId : null;
}

function ymd(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addDaysIso(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return ymd(d);
}

/** Build the full day-by-day taper window snapshot from `taper.ts`. */
function buildTaperWindow(args: {
  eventName: string;
  eventDate: string;
  priority: "A" | "B" | "C";
  modality: string | null;
  fromDate: Date;
}): {
  window: { date: string; volumeScale: number; intensityAction: "hold" | "hold_then_taper" | "minimal" }[];
  startDate: string;
  endDate: string;
  triggered: { daysOut: number; phase: "approach" | "deep" | "polish" | "event_day" };
} | null {
  const event = {
    name: args.eventName,
    date: args.eventDate,
    priority: args.priority,
    modality: taperModalityForEvent(args.modality),
  };
  const today = new Date(
    Date.UTC(
      args.fromDate.getUTCFullYear(),
      args.fromDate.getUTCMonth(),
      args.fromDate.getUTCDate(),
    ),
  );
  const trig = computeTaperRecommendation(event, today);
  if (!trig) return null;

  const window: {
    date: string;
    volumeScale: number;
    intensityAction: "hold" | "hold_then_taper" | "minimal";
  }[] = [];
  const startDate = ymd(today);
  for (let off = 0; off <= trig.daysOut; off++) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() + off);
    const rec = computeTaperRecommendation(event, d);
    if (!rec) break;
    window.push({
      date: ymd(d),
      volumeScale: rec.volumeScale,
      intensityAction: rec.intensityAction,
    });
  }
  if (window.length === 0) return null;
  const endDate = window[window.length - 1]!.date;
  return {
    window,
    startDate,
    endDate,
    triggered: {
      daysOut: trig.daysOut,
      phase: trig.phase === "none" ? "approach" : trig.phase,
    },
  };
}

async function fetchEvent(supabase: Awaited<ReturnType<typeof createClient>>, userId: string, eventId: string) {
  const { data, error } = await supabase
    .from("priority_events")
    .select("id,user_id,name,event_date,priority,modality,target_performance,result")
    .eq("id", eventId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error || !data) return null;
  return data as {
    id: string;
    user_id: string;
    name: string;
    event_date: string;
    priority: "A" | "B" | "C";
    modality: string | null;
    target_performance: Record<string, unknown> | null;
    result: Record<string, unknown> | null;
  };
}

export async function applyTaperPlan(formData: FormData): Promise<ActionResult> {
  const auth = await requireUser();
  if (!auth.ok) return auth;
  const eventId = parseIdForm(formData);
  if (!eventId) return { ok: false, error: "Invalid eventId" };

  const supabase = await createClient();
  const evt = await fetchEvent(supabase, auth.userId, eventId);
  if (!evt) return { ok: false, error: "Event not found" };
  if (evt.priority === "C") return { ok: false, error: "C-priority events do not taper" };

  const built = buildTaperWindow({
    eventName: evt.name,
    eventDate: evt.event_date,
    priority: evt.priority,
    modality: evt.modality,
    fromDate: new Date(),
  });
  if (!built) return { ok: false, error: "No active taper window" };

  const payload = {
    eventId: evt.id,
    eventName: evt.name,
    eventDate: evt.event_date,
    window: built.window,
    triggeredAtDaysOut: built.triggered.daysOut,
    triggeredPhase: built.triggered.phase,
  };

  // Idempotency: same event+kind+startDate+endDate already applied? update payload.
  const { data: existing } = await supabase
    .from("prescription_modifications")
    .select("id")
    .eq("user_id", auth.userId)
    .eq("event_id", evt.id)
    .eq("kind", "taper")
    .eq("status", "applied")
    .eq("start_date", built.startDate)
    .eq("end_date", built.endDate)
    .maybeSingle();

  if (existing?.id) {
    const { error } = await supabase
      .from("prescription_modifications")
      .update({ payload })
      .eq("id", existing.id);
    if (error) return { ok: false, error: error.message };
  } else {
    const { error } = await supabase.from("prescription_modifications").insert({
      user_id: auth.userId,
      event_id: evt.id,
      kind: "taper",
      start_date: built.startDate,
      end_date: built.endDate,
      ramp_end_date: null,
      payload,
      status: "applied",
    });
    if (error) return { ok: false, error: error.message };
  }

  revalidatePath("/app");
  return { ok: true };
}

export async function declineTaperPlan(formData: FormData): Promise<ActionResult> {
  const auth = await requireUser();
  if (!auth.ok) return auth;
  const eventId = parseIdForm(formData);
  if (!eventId) return { ok: false, error: "Invalid eventId" };

  const supabase = await createClient();
  const evt = await fetchEvent(supabase, auth.userId, eventId);
  if (!evt) return { ok: false, error: "Event not found" };

  const built = buildTaperWindow({
    eventName: evt.name,
    eventDate: evt.event_date,
    priority: evt.priority,
    modality: evt.modality,
    fromDate: new Date(),
  });
  if (!built) return { ok: false, error: "No active taper window" };

  // Record the user's dismissal so the banner stays hidden for this window.
  const { error } = await supabase.from("prescription_modifications").insert({
    user_id: auth.userId,
    event_id: evt.id,
    kind: "taper",
    start_date: built.startDate,
    end_date: built.endDate,
    ramp_end_date: null,
    payload: {
      eventId: evt.id,
      eventName: evt.name,
      eventDate: evt.event_date,
      window: built.window,
      triggeredAtDaysOut: built.triggered.daysOut,
      triggeredPhase: built.triggered.phase,
    },
    status: "declined",
  });
  if (error) return { ok: false, error: error.message };

  revalidatePath("/app");
  return { ok: true };
}

export async function undoTaperPlan(formData: FormData): Promise<ActionResult> {
  return undoMostRecentApplied(formData, "taper");
}

async function undoMostRecentApplied(
  formData: FormData,
  kind: "taper" | "recovery",
): Promise<ActionResult> {
  const auth = await requireUser();
  if (!auth.ok) return auth;
  const eventId = parseIdForm(formData);
  if (!eventId) return { ok: false, error: "Invalid eventId" };

  const supabase = await createClient();
  const { data: rows, error: selErr } = await supabase
    .from("prescription_modifications")
    .select("id")
    .eq("user_id", auth.userId)
    .eq("event_id", eventId)
    .eq("kind", kind)
    .eq("status", "applied")
    .order("applied_at", { ascending: false })
    .limit(1);
  if (selErr) return { ok: false, error: selErr.message };
  if (!rows || rows.length === 0) return { ok: false, error: "Nothing to undo" };

  const { error } = await supabase
    .from("prescription_modifications")
    .update({ status: "reverted", reverted_at: new Date().toISOString() })
    .eq("id", rows[0]!.id);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/app");
  return { ok: true };
}

function distanceFromEvent(evt: {
  modality: string | null;
  target_performance: Record<string, unknown> | null;
  result: Record<string, unknown> | null;
}): { distanceKm: number | null; durationMin: number | null } {
  const tp = evt.target_performance ?? {};
  const r = evt.result ?? {};
  const distanceKm =
    (typeof r["targetDistanceKm"] === "number" ? (r["targetDistanceKm"] as number) : null) ??
    (typeof tp["targetDistanceKm"] === "number" ? (tp["targetDistanceKm"] as number) : null);
  // duration parsing: "HH:MM:SS" or "MM:SS" → minutes
  const targetTime =
    (typeof r["targetTime"] === "string" ? (r["targetTime"] as string) : null) ??
    (typeof tp["targetTime"] === "string" ? (tp["targetTime"] as string) : null);
  let durationMin: number | null = null;
  if (targetTime) {
    const parts = targetTime.split(":").map((s) => Number(s));
    if (parts.every((n) => Number.isFinite(n))) {
      if (parts.length === 3)
        durationMin = parts[0]! * 60 + parts[1]! + parts[2]! / 60;
      else if (parts.length === 2) durationMin = parts[0]! + parts[1]! / 60;
    }
  }
  return { distanceKm, durationMin };
}

const recoveryApplySchema = z
  .object({
    eventId: z.string().uuid(),
    userTier: z.coerce.number().int().min(0).max(4).optional(),
  })
  .strict();

export async function applyRecoveryPlan(formData: FormData): Promise<ActionResult> {
  const auth = await requireUser();
  if (!auth.ok) return auth;
  const parsed = recoveryApplySchema.safeParse({
    eventId: String(formData.get("eventId") ?? ""),
    userTier: formData.get("userTier") ?? undefined,
  });
  if (!parsed.success) return { ok: false, error: "Invalid input" };

  const supabase = await createClient();
  const evt = await fetchEvent(supabase, auth.userId, parsed.data.eventId);
  if (!evt) return { ok: false, error: "Event not found" };
  if (evt.priority === "C") return { ok: false, error: "C-priority events do not recover" };

  const { data: prof } = await supabase
    .from("profiles")
    .select("training_experience")
    .eq("id", auth.userId)
    .maybeSingle();
  // Map declared experience to a numeric tier 0..4. profile.training_experience
  // is a string enum; we resolve via a small lookup.
  const tierMap: Record<string, number> = {
    untrained: 0,
    novice: 1,
    intermediate: 2,
    advanced: 3,
    elite: 4,
  };
  const profTier =
    typeof prof?.training_experience === "string"
      ? tierMap[prof.training_experience as string] ?? 2
      : 2;
  const userTier = parsed.data.userTier ?? profTier;

  const modality = (evt.modality ?? "other") as
    | "run"
    | "bike"
    | "swim"
    | "row"
    | "triathlon"
    | "other";
  const allowedModalities = new Set([
    "run",
    "bike",
    "swim",
    "row",
    "triathlon",
    "other",
  ]);
  const modalityResolved = allowedModalities.has(modality) ? modality : "other";

  const { distanceKm, durationMin } = distanceFromEvent(evt);
  const window = computeRecoveryWindow({
    distanceKm,
    durationMin,
    modality: modalityResolved,
    priority: evt.priority,
    userTier,
  });
  if (!window) return { ok: false, error: "No recovery window for event" };

  const startDate = addDaysIso(evt.event_date, 1);
  const endDate = addDaysIso(startDate, window.days - 1);
  const rampEndDate = endDate;

  const payload = {
    eventId: evt.id,
    eventName: evt.name,
    eventDate: evt.event_date,
    days: window.days,
    rampDays: window.rampDays,
    strengthLoadScale: window.strengthLoadScale,
    cardioLoadScale: window.cardioLoadScale,
    sourceWindow: window,
  };

  const { data: existing } = await supabase
    .from("prescription_modifications")
    .select("id")
    .eq("user_id", auth.userId)
    .eq("event_id", evt.id)
    .eq("kind", "recovery")
    .eq("status", "applied")
    .eq("start_date", startDate)
    .eq("end_date", endDate)
    .maybeSingle();

  if (existing?.id) {
    const { error } = await supabase
      .from("prescription_modifications")
      .update({ payload, ramp_end_date: rampEndDate })
      .eq("id", existing.id);
    if (error) return { ok: false, error: error.message };
  } else {
    const { error } = await supabase.from("prescription_modifications").insert({
      user_id: auth.userId,
      event_id: evt.id,
      kind: "recovery",
      start_date: startDate,
      end_date: endDate,
      ramp_end_date: rampEndDate,
      payload,
      status: "applied",
    });
    if (error) return { ok: false, error: error.message };
  }

  revalidatePath("/app");
  return { ok: true };
}

export async function declineRecoveryPlan(formData: FormData): Promise<ActionResult> {
  const auth = await requireUser();
  if (!auth.ok) return auth;
  const eventId = parseIdForm(formData);
  if (!eventId) return { ok: false, error: "Invalid eventId" };

  const supabase = await createClient();
  const evt = await fetchEvent(supabase, auth.userId, eventId);
  if (!evt) return { ok: false, error: "Event not found" };

  // Compute window with sane defaults so the audit row is meaningful.
  const { distanceKm, durationMin } = distanceFromEvent(evt);
  const modalityResolved = ([
    "run",
    "bike",
    "swim",
    "row",
    "triathlon",
    "other",
  ].includes(evt.modality ?? "")
    ? (evt.modality as "run" | "bike" | "swim" | "row" | "triathlon" | "other")
    : "other") satisfies "run" | "bike" | "swim" | "row" | "triathlon" | "other";

  const window = computeRecoveryWindow({
    distanceKm,
    durationMin,
    modality: modalityResolved,
    priority: evt.priority,
    userTier: 2,
  });
  if (!window) return { ok: false, error: "No recovery window for event" };

  const startDate = addDaysIso(evt.event_date, 1);
  const endDate = addDaysIso(startDate, window.days - 1);

  const { error } = await supabase.from("prescription_modifications").insert({
    user_id: auth.userId,
    event_id: evt.id,
    kind: "recovery",
    start_date: startDate,
    end_date: endDate,
    ramp_end_date: endDate,
    payload: {
      eventId: evt.id,
      eventName: evt.name,
      eventDate: evt.event_date,
      days: window.days,
      rampDays: window.rampDays,
      strengthLoadScale: window.strengthLoadScale,
      cardioLoadScale: window.cardioLoadScale,
      sourceWindow: window,
    },
    status: "declined",
  });
  if (error) return { ok: false, error: error.message };

  revalidatePath("/app");
  return { ok: true };
}

export async function undoRecoveryPlan(formData: FormData): Promise<ActionResult> {
  return undoMostRecentApplied(formData, "recovery");
}

export async function setEventResult(formData: FormData): Promise<ActionResult> {
  const auth = await requireUser();
  if (!auth.ok) return auth;
  const parsed = resultSchema.safeParse({
    eventId: String(formData.get("eventId") ?? ""),
    status: String(formData.get("status") ?? ""),
  });
  if (!parsed.success) return { ok: false, error: "Invalid input" };

  const supabase = await createClient();
  // Preserve any existing target_performance-like fields, just record status.
  const { data: existing } = await supabase
    .from("priority_events")
    .select("result")
    .eq("id", parsed.data.eventId)
    .eq("user_id", auth.userId)
    .maybeSingle();
  const prior = (existing?.result as Record<string, unknown> | null) ?? {};
  const next = { ...prior, status: parsed.data.status };

  const { error } = await supabase
    .from("priority_events")
    .update({ result: next, completed: parsed.data.status !== "skipped" })
    .eq("id", parsed.data.eventId)
    .eq("user_id", auth.userId);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/app");
  return { ok: true };
}
