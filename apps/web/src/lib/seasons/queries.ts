/**
 * Season read queries (ADR 0051 Phase 0). User-scoped (RLS) reads of the active
 * Season + its blocks, in position order. Returns null when the user has no
 * active Season (the common case — the feature is opt-in).
 */
import { createClient, getAuthUser } from "@/lib/supabase/server";

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
  const { data: season } = await supabase
    .from("training_seasons")
    .select("id, name, goal_type, target_event_id, target_date")
    .eq("user_id", user.id)
    .eq("status", "active")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!season) return null;

  const { data: rows } = await supabase
    .from("season_blocks")
    .select("id, position, program_id, template_ref, emphasis, intent_note, planned_weeks, status, block_id")
    .eq("season_id", season.id as string)
    .eq("user_id", user.id)
    .order("position", { ascending: true });

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
      const { data: evt } = await supabase
        .from("events")
        .select("name")
        .eq("id", eventId)
        .eq("user_id", user.id)
        .maybeSingle();
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
