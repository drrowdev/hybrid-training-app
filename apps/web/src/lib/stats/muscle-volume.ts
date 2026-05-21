/**
 * Weekly per-muscle volume — Stats page chart.
 *
 * Source numbers from the per-muscle volume landmarks used by Renaissance
 * Periodization-style programming. The internal mapping uses the DC-T1
 * taxonomy but every label that ships to the user is plain English:
 * "Building" instead of "MEV–MAV", "Maintaining" instead of "MV–MEV".
 *
 * Concurrent training modifier: when the same 7-day window carries heavy
 * cardio (>=3 cardio sessions or >=4h endurance), volume ceilings move down
 * roughly 30% because cardio uses recovery budget. The chart reads this
 * automatically — no toggle needed.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

/** One row in the chart. */
export type MuscleVolumeRow = {
  /** Internal slug (matches `movements.primary_muscle`). */
  muscle: string;
  /** Plain-English label shown on the chart. */
  label: string;
  /** Working sets logged this week. */
  sets: number;
  /** Plain-English band label — what state this muscle is in. */
  band: VolumeBand;
  /** Numeric thresholds (scaled by concurrent modifier when active). */
  thresholds: { maintenance: number; building: number; productive: number; limit: number };
};

export type VolumeBand =
  | "untouched" // 0 sets — muscle hasn't been hit at all
  | "below-maintenance"
  | "maintaining"
  | "building"
  | "high-volume" // above MAV but below MRV — diminishing returns
  | "overreaching"; // above MRV

/** User-facing label per band. */
export const BAND_LABEL: Record<VolumeBand, string> = {
  "untouched": "Untouched",
  "below-maintenance": "Below maintenance",
  "maintaining": "Maintaining",
  "building": "Building",
  "high-volume": "High volume",
  "overreaching": "Too much",
};

/** Accent color per band, drawn from the existing palette tokens. */
export const BAND_COLOR: Record<VolumeBand, string> = {
  "untouched": "var(--cp-border)",
  "below-maintenance": "var(--cp-danger)",
  "maintaining": "var(--cp-warning)",
  "building": "var(--cp-success)",
  "high-volume": "var(--cp-warning)",
  "overreaching": "var(--cp-danger)",
};

/**
 * Per-muscle landmarks (working sets / week).
 *
 *   maintenance = lowest dose that prevents detraining
 *   building    = lowest dose that drives adaptation
 *   productive  = upper bound of the productive zone (above this = diminishing returns)
 *   limit       = absolute weekly ceiling (above this = overreaching)
 *
 * Numbers are practitioner consensus (Renaissance Periodization / Israetel
 * / Helms) tagged [DEF→cal] in the design-constraints wiki. They'll be
 * calibrated once we have real per-user data.
 */
const LANDMARKS: Record<string, { label: string; maintenance: number; building: number; productive: number; limit: number }> = {
  // Upper body — push
  chest: { label: "Chest", maintenance: 8, building: 10, productive: 16, limit: 22 },
  upper_chest: { label: "Upper chest", maintenance: 4, building: 6, productive: 12, limit: 18 },
  front_delts: { label: "Front delts", maintenance: 0, building: 6, productive: 12, limit: 18 },
  side_delts: { label: "Side delts", maintenance: 6, building: 8, productive: 20, limit: 26 },
  rear_delts: { label: "Rear delts", maintenance: 6, building: 8, productive: 18, limit: 24 },
  triceps: { label: "Triceps", maintenance: 5, building: 8, productive: 14, limit: 20 },
  // Upper body — pull
  lats: { label: "Lats", maintenance: 8, building: 10, productive: 18, limit: 24 },
  mid_back: { label: "Mid-back", maintenance: 6, building: 10, productive: 18, limit: 24 },
  traps: { label: "Traps", maintenance: 0, building: 6, productive: 12, limit: 20 },
  biceps: { label: "Biceps", maintenance: 5, building: 8, productive: 14, limit: 20 },
  forearms: { label: "Forearms", maintenance: 0, building: 4, productive: 10, limit: 16 },
  // Lower body
  quads: { label: "Quads", maintenance: 6, building: 8, productive: 16, limit: 22 },
  hamstrings: { label: "Hamstrings", maintenance: 6, building: 8, productive: 14, limit: 20 },
  glutes: { label: "Glutes", maintenance: 4, building: 6, productive: 12, limit: 18 },
  calves: { label: "Calves", maintenance: 6, building: 8, productive: 14, limit: 20 },
  soleus: { label: "Soleus", maintenance: 0, building: 4, productive: 10, limit: 16 },
  tibialis: { label: "Tibialis", maintenance: 0, building: 4, productive: 8, limit: 14 },
  adductors: { label: "Adductors", maintenance: 0, building: 4, productive: 10, limit: 16 },
  abductors: { label: "Abductors", maintenance: 0, building: 4, productive: 10, limit: 16 },
  // Core
  abs: { label: "Abs", maintenance: 0, building: 6, productive: 16, limit: 24 },
  obliques: { label: "Obliques", maintenance: 0, building: 4, productive: 12, limit: 20 },
  lower_back: { label: "Lower back", maintenance: 4, building: 6, productive: 12, limit: 18 },
};

/** Concurrent-training scalar applied when the week has heavy cardio. */
const CONCURRENT_SCALAR = 0.7;

/**
 * Decide which band a sets count lands in for a given muscle. Returns
 * "untouched" when sets is 0 to differentiate from real "below maintenance".
 */
function classifyBand(
  sets: number,
  thresholds: { maintenance: number; building: number; productive: number; limit: number },
): VolumeBand {
  if (sets === 0) return "untouched";
  if (sets < thresholds.maintenance) return "below-maintenance";
  if (sets < thresholds.building) return "maintaining";
  if (sets <= thresholds.productive) return "building";
  if (sets <= thresholds.limit) return "high-volume";
  return "overreaching";
}

function scaleThresholds(
  base: { maintenance: number; building: number; productive: number; limit: number },
  scalar: number,
) {
  return {
    maintenance: Math.round(base.maintenance * scalar),
    building: Math.max(1, Math.round(base.building * scalar)),
    productive: Math.round(base.productive * scalar),
    limit: Math.round(base.limit * scalar),
  };
}

/** True when the rolling 7-day window has enough cardio to trigger the
 *  concurrent-stress scaling. Heuristic per the design-constraints
 *  practitioner threshold (3 cardio sessions OR 4h of endurance). */
function isConcurrentWeek(cardioSessions: number, cardioMinutes: number): boolean {
  return cardioSessions >= 3 || cardioMinutes >= 240;
}

export type MuscleVolumeResult = {
  rows: MuscleVolumeRow[];
  /** True when the concurrent modifier is active. UI surfaces an info pill. */
  concurrentScaled: boolean;
  /** Total working sets across all muscles this week. */
  totalSets: number;
};

/**
 * Aggregate the last 7 days of strength volume by primary_muscle.
 * Counts only sets that landed (i.e. have reps > 0). Excludes warmup
 * sets and cardio.
 */
export async function getWeeklyMuscleVolume(
  supabase: SupabaseClient,
  userId: string,
): Promise<MuscleVolumeResult> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();

  // Step 1: find this user's sessions in the window.
  const { data: sessions } = await supabase
    .from("sessions")
    .select("id")
    .eq("user_id", userId)
    .gte("performed_at", sevenDaysAgo);

  const sessionIds = (sessions ?? []).map((s) => s.id);
  if (sessionIds.length === 0) {
    // Empty week — still render the chart so the user sees what's untouched.
    const rows: MuscleVolumeRow[] = Object.entries(LANDMARKS).map(([muscle, base]) => ({
      muscle,
      label: base.label,
      sets: 0,
      band: "untouched",
      thresholds: base,
    }));
    rows.sort((a, b) => a.label.localeCompare(b.label));
    return { rows, concurrentScaled: false, totalSets: 0 };
  }

  // Step 2: pull set logs + cardio logs in parallel for those sessions.
  const [{ data: sets }, { data: cardio }] = await Promise.all([
    supabase
      .from("set_logs")
      .select("id, set_kind, reps, movement:movements(primary_muscle)")
      .in("session_id", sessionIds)
      .not("reps", "is", null)
      .gt("reps", 0)
      .neq("set_kind", "warmup"),
    supabase
      .from("cardio_logs")
      .select("id, duration_sec")
      .in("session_id", sessionIds),
  ]);

  const cardioSessions = (cardio ?? []).length;
  const cardioMinutes = (cardio ?? []).reduce((acc, c) => acc + (c.duration_sec ?? 0) / 60, 0);
  const concurrentScaled = isConcurrentWeek(cardioSessions, cardioMinutes);
  const scalar = concurrentScaled ? CONCURRENT_SCALAR : 1.0;

  // Step 3: aggregate per primary_muscle.
  const setsByMuscle = new Map<string, number>();
  for (const row of (sets ?? []) as Array<{ movement: { primary_muscle: string } | { primary_muscle: string }[] | null }>) {
    const m = Array.isArray(row.movement) ? row.movement[0] : row.movement;
    const muscle = m?.primary_muscle;
    if (!muscle || !(muscle in LANDMARKS)) continue;
    setsByMuscle.set(muscle, (setsByMuscle.get(muscle) ?? 0) + 1);
  }

  // Step 4: build one row per muscle in the landmark table.
  const rows: MuscleVolumeRow[] = Object.entries(LANDMARKS).map(([muscle, base]) => {
    const thresholds = scaleThresholds(base, scalar);
    const sets = setsByMuscle.get(muscle) ?? 0;
    return {
      muscle,
      label: base.label,
      sets,
      band: classifyBand(sets, thresholds),
      thresholds,
    };
  });

  // Sort: most actionable first (below maintenance, untouched, overreaching),
  // then everything else alphabetically.
  const bandOrder: Record<VolumeBand, number> = {
    "below-maintenance": 0,
    "untouched": 1,
    "overreaching": 2,
    "maintaining": 3,
    "high-volume": 4,
    "building": 5,
  };
  rows.sort((a, b) => {
    const diff = bandOrder[a.band] - bandOrder[b.band];
    if (diff !== 0) return diff;
    return a.label.localeCompare(b.label);
  });

  const totalSets = Array.from(setsByMuscle.values()).reduce((a, b) => a + b, 0);
  return { rows, concurrentScaled, totalSets };
}
