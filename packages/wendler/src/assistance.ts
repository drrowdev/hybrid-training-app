/**
 * Assistance model — the 5/3/1 "Periodization Bible" assistance categories
 * (Push / Pull / Single-leg & Core …) and the per-entry prescription
 * format/parse/label helpers.
 *
 * Ported from the wendler-app domain engine (originally co-located in
 * blocks.ts). `resolveAssistance` / `hasAssistanceOverride` are decoupled from
 * the block storage shape here — they take an `AssistancePlan` directly, so the
 * integration layer is free to decide where the plan lives. Source: 5/3/1
 * Forever (Wendler, 2017), assistance chapter.
 */
import type { Movement, WendlerWeek } from "./types";

export type AssistanceCategory =
  | "push"
  | "pull"
  | "single-leg"
  | "core"
  | "carry"
  | "accessory"
  | "other";

export const ASSISTANCE_CATEGORIES: { id: AssistanceCategory; label: string }[] = [
  { id: "push", label: "Push" },
  { id: "pull", label: "Pull" },
  { id: "single-leg", label: "Single-leg" },
  { id: "core", label: "Core" },
  { id: "carry", label: "Carry" },
  { id: "accessory", label: "Accessory" },
  { id: "other", label: "Other" },
];

export type AssistanceUnit = "reps" | "sec" | "each-side" | "each-arm" | "each-leg";

export interface AssistanceEntry {
  id: string;
  category: AssistanceCategory;
  /** Optional reference to a Movement; when unset, movementName stands alone. */
  movementId?: string;
  /** Display name; always required so we can render even when movementId is missing. */
  movementName: string;
  sets: number;
  /** Target reps (or seconds when unit==='sec'). For ranges, the minimum. */
  reps: number;
  /** Optional max reps for ranges like "3×8–10". */
  repsMax?: number;
  unit?: AssistanceUnit;
  /** AMRAP flag — rendered with a trailing "+" ("3×8+"). */
  isAmrap?: boolean;
  /** Free-text load hint ("heavy", "bodyweight", "light"). */
  loadHint?: string;
  notes?: string;
}

/**
 * Per-block assistance plan. `perDay` keys on the day-group index (0,1,2,…);
 * `perWeekDay` overrides a specific week+day keyed as `${week}|${dayGroupIndex}`.
 */
export interface AssistancePlan {
  perDay: Record<number, AssistanceEntry[]>;
  perWeekDay?: Record<string, AssistanceEntry[]>;
}

/**
 * Resolve the assistance entries for a (week, dayGroupIndex):
 * per-week override → per-day default → empty.
 */
export function resolveAssistance(
  plan: AssistancePlan | undefined,
  week: WendlerWeek,
  dayGroupIndex: number,
): AssistanceEntry[] {
  if (!plan) return [];
  const override = plan.perWeekDay?.[`${week}|${dayGroupIndex}`];
  if (override) return override;
  return plan.perDay?.[dayGroupIndex] ?? [];
}

/** Whether a (week, dayGroupIndex) cell has an explicit per-week override. */
export function hasAssistanceOverride(
  plan: AssistancePlan | undefined,
  week: WendlerWeek,
  dayGroupIndex: number,
): boolean {
  return !!plan?.perWeekDay?.[`${week}|${dayGroupIndex}`];
}

/**
 * Format a prescription as a compact, reversible string (inverse of
 * `parseAssistancePrescription`): "3×10", "3×8-10", "3×30 sec", "3×10 each leg".
 */
export function formatAssistancePrescription(
  entry: Pick<AssistanceEntry, "sets" | "reps" | "repsMax" | "unit" | "isAmrap">,
): string {
  const reps =
    entry.repsMax && entry.repsMax !== entry.reps
      ? `${entry.reps}-${entry.repsMax}`
      : String(entry.reps);
  let suffix = "";
  switch (entry.unit) {
    case "sec":
      suffix = " sec";
      break;
    case "each-side":
      suffix = " each side";
      break;
    case "each-arm":
      suffix = " each arm";
      break;
    case "each-leg":
      suffix = " each leg";
      break;
    default:
      suffix = "";
  }
  const amrap = entry.isAmrap ? "+" : "";
  return `${entry.sets}\u00d7${reps}${amrap}${suffix}`;
}

export interface ParsedPrescription {
  sets: number;
  reps: number;
  repsMax?: number;
  unit?: "sec" | "each-side" | "each-arm" | "each-leg";
  isAmrap?: boolean;
}

/**
 * Parse a freeform prescription string ("3x10", "3 × 8-10+", "5x30 sec",
 * "3x10 each side") into structured fields. Returns null when unparseable.
 */
export function parseAssistancePrescription(input: string): ParsedPrescription | null {
  const s = input
    .toLowerCase()
    .replace(/[×✕✖]/g, "x")
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  const m = s.match(/^(\d+)\s*x\s*(\d+)(?:\s*-\s*(\d+))?\s*(\+)?\s*(.*)$/);
  if (!m) return null;
  const sets = parseInt(m[1]!, 10);
  const reps = parseInt(m[2]!, 10);
  const repsMaxRaw = m[3] ? parseInt(m[3], 10) : undefined;
  const isAmrap = !!m[4];
  const tail = (m[5] ?? "").trim();
  if (!Number.isFinite(sets) || !Number.isFinite(reps) || sets < 1 || reps < 1) return null;
  let unit: ParsedPrescription["unit"];
  if (tail) {
    if (/^(s|sec|secs|seconds?)$/.test(tail)) unit = "sec";
    else if (/each\s*-?\s*leg|\/leg|per\s*leg|ea\s*leg/.test(tail)) unit = "each-leg";
    else if (/each\s*-?\s*arm|\/arm|per\s*arm|ea\s*arm/.test(tail)) unit = "each-arm";
    else if (/each\s*-?\s*side|\/side|per\s*side|ea\s*side|^ea$|^each$/.test(tail)) unit = "each-side";
    else return null;
  }
  const out: ParsedPrescription = { sets, reps };
  if (repsMaxRaw && repsMaxRaw !== reps) out.repsMax = repsMaxRaw;
  if (unit) out.unit = unit;
  if (isAmrap) out.isAmrap = true;
  return out;
}

/** Format an entry as a full label: "3×8–10 Chinup", "3×30 sec Plank". */
export function assistanceLabel(entry: AssistanceEntry): string {
  const reps =
    entry.repsMax && entry.repsMax !== entry.reps
      ? `${entry.reps}\u2013${entry.repsMax}`
      : String(entry.reps);
  const unit = entry.unit;
  let qty: string;
  if (unit === "sec") {
    qty = `${reps} sec`;
  } else if (unit === "each-side" || unit === "each-arm" || unit === "each-leg") {
    const which = unit === "each-side" ? "each side" : unit === "each-arm" ? "each arm" : "each leg";
    qty = `${reps} ${which}`;
  } else {
    qty = reps;
  }
  const amrap = entry.isAmrap ? "+" : "";
  return `${entry.sets}\u00d7${qty}${amrap} ${entry.movementName}`.trim();
}

/**
 * Derive the most likely AssistanceCategory for a Movement, from its pattern
 * with name-keyword overrides for single-leg work (a single-leg RDL is still a
 * `hinge` by pattern).
 */
export function categoryFromMovement(
  movement: Pick<Movement, "name" | "pattern">,
): AssistanceCategory {
  const lower = movement.name.toLowerCase();
  const singleLegKeywords = [
    "lunge",
    "split squat",
    "bulgarian",
    "step-up",
    "step up",
    "pistol",
    "single-leg",
    "single leg",
    "one-leg",
    "one leg",
    "skater",
    "shrimp squat",
  ];
  if (singleLegKeywords.some((kw) => lower.includes(kw))) return "single-leg";

  switch (movement.pattern) {
    case "push-horizontal":
    case "push-vertical":
      return "push";
    case "pull-horizontal":
    case "pull-vertical":
      return "pull";
    case "core":
      return "core";
    case "squat":
    case "hinge":
      return "accessory";
    case "carry":
      return "carry";
    default:
      return "other";
  }
}
