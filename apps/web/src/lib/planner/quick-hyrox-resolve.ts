/**
 * Quick HYROX workout — resolver (DB-reading; pairs with the pure
 * `assembleQuickHyroxItems`).
 *
 * Responsibilities:
 *  - Resolve the user's HYROX `experience` + `division` from their active-or-most-
 *    recent HYROX program instance; default `intermediate` / `open` when none.
 *  - From the per-generation station checklist, compute the FEASIBLE formats.
 *  - Pick the format ADAPTIVELY: prefer the one most overdue *relative to how
 *    often the HYROX engine programs it* (compromised / circuit ~weekly; erg / run
 *    ~twice weekly). Grounded in `phases.ts` cadence, not an arbitrary window.
 *  - Assemble the items for the chosen format.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PrescriptionItem } from "@hta/db";
import type { HyroxExperience, HyroxDivision } from "@hta/hyrox";
import {
  assembleQuickHyroxItems,
  buildQuickHyroxView,
  feasibleFormats,
  type HyroxQuickStation,
  type HyroxQuickFormat,
  type HyroxQuickLength,
  type QuickHyroxView,
} from "./quick-hyrox";

/**
 * Target cadence (days) per format — how often the HYROX engine programs it
 * (`phases.ts PHASE_POOLS`): compromised runs + station circuits appear ~1×/week
 * in their phases; easy runs / ergs recur ~2×/week. The adaptive picker prefers
 * the format most overdue relative to this. `[DEF]`.
 */
const TARGET_CADENCE_DAYS: Record<HyroxQuickFormat, number> = {
  compromised: 7,
  circuit: 7,
  erg: 4,
  run: 4,
};

/** Tie-break priority when overdue ratios are equal (signature sessions first). */
const FORMAT_PRIORITY: Record<HyroxQuickFormat, number> = {
  compromised: 3,
  circuit: 2,
  erg: 1,
  run: 0,
};

const RECENCY_LOOKBACK_DAYS = 21;
const DAY_MS = 86_400_000;

export type QuickHyroxResult =
  | { ok: true; items: PrescriptionItem[]; title: string; format: HyroxQuickFormat; view: QuickHyroxView }
  | { ok: false; error: string };

const VALID_EXPERIENCE = new Set<HyroxExperience>(["beginner", "intermediate", "advanced"]);
const VALID_DIVISION = new Set<HyroxDivision>(["open", "pro", "doubles"]);

/** Read experience + division from the user's active-or-most-recent HYROX instance. */
async function resolveExperienceDivision(
  supabase: SupabaseClient,
  userId: string,
): Promise<{ experience: HyroxExperience; division: HyroxDivision }> {
  const { data: rows } = await supabase
    .from("program_instances")
    .select("instance, status, created_at")
    .eq("user_id", userId)
    .eq("program_id", "hyrox")
    .order("created_at", { ascending: false })
    .limit(10);

  const chosen =
    (rows ?? []).find((r) => r.status === "active") ?? (rows ?? [])[0];
  const inst = (chosen?.instance ?? {}) as { experience?: unknown; division?: unknown };
  const experience = VALID_EXPERIENCE.has(inst.experience as HyroxExperience)
    ? (inst.experience as HyroxExperience)
    : "intermediate";
  const division = VALID_DIVISION.has(inst.division as HyroxDivision)
    ? (inst.division as HyroxDivision)
    : "open";
  return { experience, division };
}

/** Classify a past session into a HYROX quick format (tag first, then title). */
function classifySessionFormat(
  title: string | null,
  prescription: unknown,
): HyroxQuickFormat | null {
  const meta = (prescription as { meta?: { hyroxQuickFormat?: unknown } } | null)?.meta;
  const tag = meta?.hyroxQuickFormat;
  if (tag === "compromised" || tag === "circuit" || tag === "erg" || tag === "run") return tag;
  const t = (title ?? "").toLowerCase();
  if (!t.includes("hyrox")) return null;
  if (t.includes("compromised")) return "compromised";
  if (t.includes("circuit")) return "circuit";
  if (t.includes("ski") || t.includes("row") || t.includes("erg")) return "erg";
  if (t.includes("run")) return "run";
  return null;
}

/** Days since the user last did each format (∞ if never within the window). */
async function recencyByFormat(
  supabase: SupabaseClient,
  userId: string,
): Promise<Record<HyroxQuickFormat, number>> {
  const since = new Date(Date.now() - RECENCY_LOOKBACK_DAYS * DAY_MS).toISOString();
  const { data: rows } = await supabase
    .from("sessions")
    .select("title, prescription, performed_at")
    .eq("user_id", userId)
    .not("completed_at", "is", null)
    .gte("performed_at", since)
    .order("performed_at", { ascending: false })
    .limit(60);

  const out: Record<HyroxQuickFormat, number> = {
    compromised: Infinity,
    circuit: Infinity,
    erg: Infinity,
    run: Infinity,
  };
  const now = Date.now();
  for (const r of rows ?? []) {
    const fmt = classifySessionFormat(r.title as string | null, r.prescription);
    if (!fmt) continue;
    const performed = r.performed_at ? new Date(r.performed_at as string).getTime() : now;
    const days = Math.max(0, (now - performed) / DAY_MS);
    if (days < out[fmt]) out[fmt] = days;
  }
  return out;
}

/**
 * Pick the format that is most overdue relative to its programmed cadence.
 * `daysSince / targetCadence` — higher = more overdue. Never-done formats
 * (Infinity) win outright. Ties resolve by `FORMAT_PRIORITY`.
 */
export function pickFormat(
  feasible: HyroxQuickFormat[],
  daysSince: Record<HyroxQuickFormat, number>,
): HyroxQuickFormat | null {
  let best: HyroxQuickFormat | null = null;
  let bestRatio = -Infinity;
  let bestPriority = -Infinity;
  for (const f of feasible) {
    const ratio = daysSince[f] / TARGET_CADENCE_DAYS[f];
    if (
      ratio > bestRatio ||
      (ratio === bestRatio && FORMAT_PRIORITY[f] > bestPriority)
    ) {
      best = f;
      bestRatio = ratio;
      bestPriority = FORMAT_PRIORITY[f];
    }
  }
  return best;
}

export async function resolveQuickHyroxPlan(
  supabase: SupabaseClient,
  userId: string,
  opts: { length: HyroxQuickLength; stations: HyroxQuickStation[] },
): Promise<QuickHyroxResult> {
  const stationSet = new Set<HyroxQuickStation>(opts.stations);
  const feasible = feasibleFormats(stationSet);
  if (feasible.length === 0) {
    return {
      ok: false,
      error:
        "Pick at least one erg or run, or two stations, so we can build a HYROX session.",
    };
  }

  const [{ experience, division }, daysSince] = await Promise.all([
    resolveExperienceDivision(supabase, userId),
    recencyByFormat(supabase, userId),
  ]);

  const format = pickFormat(feasible, daysSince) ?? feasible[0]!;
  const assembleArgs = {
    format,
    stations: stationSet,
    length: opts.length,
    experience,
    division,
  };
  const items = assembleQuickHyroxItems(assembleArgs);
  const view = buildQuickHyroxView(assembleArgs);
  return { ok: true, items, title: view.title, format, view };
}
