/**
 * Season read queries (ADR 0051 Phase 0). User-scoped (RLS) reads of the active
 * Season + its blocks, in position order. Returns null when the user has no
 * active Season (the common case — the feature is opt-in).
 */
import { createClient, getAuthUser } from "@/lib/supabase/server";
import { currentBlockWeekIndexAt } from "@/lib/dates";
import { nextPlannedBlock } from "./season-logic";
import { z } from "zod";

export type SeasonBlock = {
  id: string;
  position: number;
  programId: string;
  templateRef: string | null;
  emphasis: string;
  intentNote: string | null;
  plannedWeeks: number | null;
  status: "planned" | "active" | "done" | "skipped";
  blockId: string | null;
};

export type SeasonGoal = {
  type: "event" | "theme";
  /** Denormalised target/peak date (YYYY-MM-DD), or null. */
  targetDate: string | null;
  /** Linked priority_events id when type='event'. */
  eventId: string | null;
  /** Event name for display, when resolvable. */
  eventName: string | null;
};

export type ActiveSeason = {
  id: string;
  name: string;
  goal: SeasonGoal | null;
  blocks: SeasonBlock[];
};

/** An upcoming A-priority event the user could anchor a Season to. */
export type UpcomingEvent = { id: string; name: string; eventDate: string };

export async function getActiveSeason(): Promise<ActiveSeason | null> {
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) return null;

  const supabase = await createClient();
  const { data: season, error: seasonError } = await supabase
    .from("training_seasons")
    .select("id, name, goal_type, target_event_id, target_date")
    .eq("user_id", user.id)
    .eq("status", "active")
    .is("deleted_at", null)
    .maybeSingle();
  if (seasonError) throw new Error("Couldn't read your season. Try again.");
  if (!season) return null;

  const { data: rows, error: blocksError } = await supabase
    .from("season_blocks")
    .select("id, position, program_id, template_ref, emphasis, intent_note, planned_weeks, status, block_id")
    .eq("season_id", season.id as string)
    .eq("user_id", user.id)
    .order("position", { ascending: true });
  if (blocksError) throw new Error("Couldn't read your roadmap. Try again.");

  const blocks: SeasonBlock[] = (rows ?? []).map((r) => ({
    id: r.id as string,
    position: r.position as number,
    programId: r.program_id as string,
    templateRef: (r.template_ref as string | null) ?? null,
    emphasis: (r.emphasis as string) ?? "base",
    intentNote: (r.intent_note as string | null) ?? null,
    plannedWeeks: (r.planned_weeks as number | null) ?? null,
    status: (r.status as SeasonBlock["status"]) ?? "planned",
    blockId: (r.block_id as string | null) ?? null,
  }));

  // Resolve the goal anchor (ADR 0051 Phase 1). For an event goal, pull the
  // event name for display; fall back to the denormalised date.
  let goal: SeasonGoal | null = null;
  const goalType = season.goal_type as "event" | "theme" | null;
  if (goalType) {
    let eventName: string | null = null;
    const eventId = (season.target_event_id as string | null) ?? null;
    if (eventId) {
      const { data: evt, error: eventError } = await supabase
        .from("events")
        .select("name")
        .eq("id", eventId)
        .eq("user_id", user.id)
        .maybeSingle();
      if (eventError) throw new Error("Couldn't read your season event. Try again.");
      eventName = (evt?.name as string | null) ?? null;
    }
    goal = {
      type: goalType,
      targetDate: (season.target_date as string | null) ?? null,
      eventId,
      eventName,
    };
  }

  return { id: season.id as string, name: season.name as string, goal, blocks };
}

export async function getSeasonContinuation(timezone: string, now = new Date()) {
  const season = await getActiveSeason();
  if (!season) return null;
  const active = season.blocks.filter((slot) => slot.status === "active");
  if (active.length > 1) throw new Error("The roadmap has more than one current program. Refresh it before continuing.");
  const sourceId = active[0]?.blockId, next = nextPlannedBlock(season.blocks);
  if (!sourceId || !next) return null;
  const { data: { user } } = await getAuthUser();
  if (!user) return null;
  const client = await createClient();
  const result = await client.from("training_blocks").select("status,started_on,weeks")
    .eq("id", sourceId).eq("user_id", user.id).is("deleted_at", null).maybeSingle();
  if (result.error) throw new Error("Couldn't read the current roadmap program. Try again.");
  const source = z.object({ status: z.enum(["active", "completed", "archived"]),
    started_on: z.string(), weeks: z.number().positive() }).nullable().parse(result.data);
  if (!source || (source.status === "active" &&
    currentBlockWeekIndexAt(source.started_on, source.weeks, timezone, now) < source.weeks - 1)) return null;
  return { seasonName: season.name, block: next };
}

/**
 * Upcoming A-priority events (future-dated), for the Season create builder's
 * "anchor to an event" picker. User-scoped (RLS). Empty when the user has none.
 */
export async function getUpcomingAEvents(todayYmd: string): Promise<UpcomingEvent[]> {
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) return [];
  const supabase = await createClient();
  const { data } = await supabase
    .from("events")
    .select("id, name, event_date")
    .eq("user_id", user.id)
    .eq("priority", "A")
    .gte("event_date", todayYmd)
    .order("event_date", { ascending: true })
    .limit(10);
  return (data ?? []).map((e) => ({
    id: e.id as string,
    name: e.name as string,
    eventDate: e.event_date as string,
  }));
}
