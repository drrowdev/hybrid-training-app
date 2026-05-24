/**
 * Shared data layer for the /app/plan view modes (Month / Timeline / List).
 *
 * Everything is shaped into a single flat `CalendarItem[]` so the three
 * view components can render from the exact same input. The pure
 * `buildCalendarItems` function holds the classification logic
 * (planned vs logged, past-unfulfilled detection) so the unit tests
 * can drive it deterministically without Supabase mocks.
 *
 * The Supabase fetcher is a mechanical pass-through over four
 * read-only queries (planned_sessions, sessions, cardio_logs,
 * priority_events) all bounded by the [startDate, endDate] window.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { ymdInTimezone } from "@/lib/dates";

/**
 * One renderable item on the plan calendar. The shape is intentionally
 * flat — the view components only need to read `kind`, `date`, and the
 * display fields. Modality and `stravaId` are carried for chip-color
 * decisions + the past-unfulfilled match modal.
 */
export type CalendarItemKind =
  | "planned_strength"
  | "planned_cardio"
  | "logged_strength"
  | "logged_cardio"
  | "event"
  | "past_unfulfilled";

export type CalendarItem = {
  kind: CalendarItemKind;
  /** YYYY-MM-DD in the user's timezone. */
  date: string;
  title: string;
  /** Short tail blurb shown beneath the title in the timeline/list. */
  meta?: string;
  href: string;
  /** Source row id for planned/logged session items. */
  sessionId?: string;
  /** Source row id for priority events. */
  eventId?: string;
  /** For cardio: "run" | "bike" | "swim" | "row" | "ski" | "padel" | "other". */
  modality?: string;
  /** When sourced from Strava (cardio_logs.external_source = "strava"). */
  stravaId?: string | null;
  /** A/B/C priority for `kind === "event"`. */
  priority?: "A" | "B" | "C";
};

export type RawPlannedRow = {
  id: string;
  date: string;
  title: string;
  /** "strength" if the prescription contains non-cardio items, else "cardio". */
  isCardio: boolean;
  cardioModality?: string | null;
  completedSessionId: string | null;
  skippedAt: string | null;
  summary?: string;
};

export type RawSessionRow = {
  id: string;
  performedYmd: string;
  title: string | null;
  isCardio: boolean;
  isStrength: boolean;
  modality?: string | null;
  durationMin?: number | null;
  stravaActivityId?: string | null;
};

export type RawEventRow = {
  id: string;
  date: string;
  name: string;
  priority: "A" | "B" | "C";
  modality: string | null;
};

export type BuildCalendarInput = {
  today: string;
  planned: RawPlannedRow[];
  sessions: RawSessionRow[];
  events: RawEventRow[];
};

function plannedKind(row: RawPlannedRow): "planned_strength" | "planned_cardio" {
  return row.isCardio ? "planned_cardio" : "planned_strength";
}

/**
 * Classifies and flattens raw rows into a single ordered list of
 * `CalendarItem`s. Sorted by `date` ascending, then by `kind` so the
 * order is stable for tests. Past-unfulfilled is computed as: a
 * planned row whose `date < today` AND has no `completedSessionId`
 * AND is not `skippedAt`. Skipped planned rows are dropped from the
 * surface entirely (they're not rendered as planned-strength chips
 * either — the calendar shows them as a gap so the user can still
 * un-skip from the existing list view).
 */
export function buildCalendarItems(input: BuildCalendarInput): CalendarItem[] {
  const items: CalendarItem[] = [];

  for (const p of input.planned) {
    if (p.skippedAt) {
      // Skipped → gap on the calendar. The existing list view keeps
      // the un-skip affordance under the hood.
      continue;
    }
    if (p.completedSessionId) {
      // Planned → logged is rendered via the matching `sessions` row.
      continue;
    }
    if (p.date < input.today) {
      items.push({
        kind: "past_unfulfilled",
        date: p.date,
        title: p.title,
        meta: p.summary,
        href: `/app/plan?match=${p.id}`,
        sessionId: p.id,
        modality: p.cardioModality ?? undefined,
      });
    } else {
      items.push({
        kind: plannedKind(p),
        date: p.date,
        title: p.title,
        meta: p.summary,
        href: `/app/sessions/start/${p.id}`,
        sessionId: p.id,
        modality: p.cardioModality ?? undefined,
      });
    }
  }

  for (const s of input.sessions) {
    if (s.isStrength && s.isCardio) {
      // A "hybrid" session shows as two chips so a Mon AM lift + PM
      // ride still reads as two pieces on the day. Surfaced as the
      // strength chip first (the lift is the anchor signal).
      items.push({
        kind: "logged_strength",
        date: s.performedYmd,
        title: s.title?.trim() || "Session",
        meta: s.durationMin ? `${s.durationMin} min` : undefined,
        href: `/app/sessions/${s.id}`,
        sessionId: s.id,
      });
      items.push({
        kind: "logged_cardio",
        date: s.performedYmd,
        title: s.title?.trim() || "Cardio",
        meta: cardioMeta(s),
        href: `/app/sessions/${s.id}`,
        sessionId: s.id,
        modality: s.modality ?? undefined,
        stravaId: s.stravaActivityId ?? null,
      });
      continue;
    }
    if (s.isCardio) {
      items.push({
        kind: "logged_cardio",
        date: s.performedYmd,
        title: s.title?.trim() || "Cardio",
        meta: cardioMeta(s),
        href: `/app/sessions/${s.id}`,
        sessionId: s.id,
        modality: s.modality ?? undefined,
        stravaId: s.stravaActivityId ?? null,
      });
      continue;
    }
    // Pure strength (or unknown — heatmap falls back to strength too).
    items.push({
      kind: "logged_strength",
      date: s.performedYmd,
      title: s.title?.trim() || "Session",
      meta: s.durationMin ? `${s.durationMin} min` : undefined,
      href: `/app/sessions/${s.id}`,
      sessionId: s.id,
    });
  }

  for (const e of input.events) {
    items.push({
      kind: "event",
      date: e.date,
      title: e.name,
      meta:
        e.priority === "A"
          ? "A-event"
          : e.priority === "B"
            ? "B-event"
            : "C-event",
      href: `/app/races#event-${e.id}`,
      eventId: e.id,
      modality: e.modality ?? undefined,
      priority: e.priority,
    });
  }

  items.sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    return kindOrder(a.kind) - kindOrder(b.kind);
  });
  return items;
}

function cardioMeta(s: RawSessionRow): string | undefined {
  const parts: string[] = [];
  if (s.modality) parts.push(s.modality);
  if (s.durationMin) parts.push(`${s.durationMin} min`);
  return parts.length ? parts.join(" · ") : undefined;
}

function kindOrder(k: CalendarItemKind): number {
  switch (k) {
    case "event":
      return 0;
    case "logged_strength":
      return 1;
    case "logged_cardio":
      return 2;
    case "planned_strength":
      return 3;
    case "planned_cardio":
      return 4;
    case "past_unfulfilled":
      return 5;
  }
}

/**
 * Filter helper for the chip row. "all" is the identity. Events are
 * always shown regardless of filter so the user doesn't lose race
 * markers when toggling between strength and cardio.
 */
export type CalendarFilter = "all" | "strength" | "cardio";

export function filterCalendarItems(
  items: CalendarItem[],
  filter: CalendarFilter,
): CalendarItem[] {
  if (filter === "all") return items;
  return items.filter((it) => {
    if (it.kind === "event") return true;
    if (filter === "strength") {
      return (
        it.kind === "planned_strength" ||
        it.kind === "logged_strength" ||
        (it.kind === "past_unfulfilled" && !it.modality)
      );
    }
    // filter === "cardio"
    return (
      it.kind === "planned_cardio" ||
      it.kind === "logged_cardio" ||
      (it.kind === "past_unfulfilled" && !!it.modality)
    );
  });
}

/**
 * Server-side fetcher. Reads planned_sessions, sessions, cardio_logs
 * and priority_events for the user inside the given window, classifies
 * each session as strength/cardio via `set_logs` + `cardio_logs`
 * existence (same pattern as the training heatmap), and returns the
 * flat list.
 */
export async function getCalendarItems(
  supabase: SupabaseClient,
  userId: string,
  opts: { startDate: string; endDate: string; today: string; tz: string },
): Promise<CalendarItem[]> {
  const { startDate, endDate, today, tz } = opts;

  // Pull session rows inside [start, end] (one day of padding so TZ
  // drift at the edges still includes boundary days).
  const startIso = `${startDate}T00:00:00.000Z`;
  // End is exclusive in the lt clause → add one day.
  const endExclusiveYmd = addOneDay(endDate);
  const endIso = `${endExclusiveYmd}T00:00:00.000Z`;

  const [plannedRes, sessionsRes, eventsRes] = await Promise.all([
    // planned_sessions live behind the active block; the page already
    // resolves the active block and passes us its planned days, but the
    // fetcher accepts a raw read so callers without an active block
    // can still hit it. We filter by user_id directly (RLS also
    // enforces it).
    supabase
      .from("planned_sessions")
      .select(
        "id, week_index, day_index, title, role, prescription, completed_session_id, skipped_at, training_blocks!inner(id, user_id, started_on, status, deleted_at)",
      )
      .eq("training_blocks.user_id", userId)
      .is("training_blocks.deleted_at", null),
    supabase
      .from("sessions")
      .select("id, performed_at, title, duration_min, strava_activity_id")
      .eq("user_id", userId)
      .is("deleted_at", null)
      .not("completed_at", "is", null)
      .gte("performed_at", startIso)
      .lt("performed_at", endIso),
    supabase
      .from("priority_events")
      .select("id, name, event_date, priority, modality")
      .eq("user_id", userId)
      .gte("event_date", startDate)
      .lte("event_date", endDate),
  ]);

  if (plannedRes.error) throw new Error(plannedRes.error.message);
  if (sessionsRes.error) throw new Error(sessionsRes.error.message);
  if (eventsRes.error) throw new Error(eventsRes.error.message);

  const sessionRows = (sessionsRes.data ?? []) as Array<{
    id: string;
    performed_at: string;
    title: string | null;
    duration_min: number | null;
    strava_activity_id: number | string | null;
  }>;
  const sessionIds = sessionRows.map((r) => r.id);

  const cardioBySession = new Map<
    string,
    { modality: string | null; duration_sec: number | null }
  >();
  const strengthIds = new Set<string>();
  if (sessionIds.length > 0) {
    const [cardioRes, setRes] = await Promise.all([
      supabase
        .from("cardio_logs")
        .select("session_id, modality, duration_sec")
        .in("session_id", sessionIds),
      supabase
        .from("set_logs")
        .select("session_id")
        .in("session_id", sessionIds),
    ]);
    if (cardioRes.error) throw new Error(cardioRes.error.message);
    if (setRes.error) throw new Error(setRes.error.message);
    for (const c of cardioRes.data ?? []) {
      const row = c as { session_id: string; modality: string | null; duration_sec: number | null };
      if (!cardioBySession.has(row.session_id)) {
        cardioBySession.set(row.session_id, {
          modality: row.modality ?? null,
          duration_sec: row.duration_sec ?? null,
        });
      }
    }
    for (const r of setRes.data ?? []) {
      strengthIds.add((r as { session_id: string }).session_id);
    }
  }

  // Resolve planned-row dates from (started_on, week_index, day_index).
  type PlannedRaw = {
    id: string;
    week_index: number;
    day_index: number;
    title: string;
    role: string;
    prescription: { items?: Array<{ kind?: string }> } | null;
    completed_session_id: string | null;
    skipped_at: string | null;
    training_blocks: { started_on: string } | { started_on: string }[];
  };
  const plannedRaw = (plannedRes.data ?? []) as PlannedRaw[];
  const planned: RawPlannedRow[] = [];
  for (const p of plannedRaw) {
    const blockRow = Array.isArray(p.training_blocks)
      ? p.training_blocks[0]
      : p.training_blocks;
    if (!blockRow?.started_on) continue;
    const date = computePlannedDate(blockRow.started_on, p.week_index, p.day_index);
    if (date < startDate || date > endDate) continue;
    const items = p.prescription?.items ?? [];
    const isCardio =
      items.length > 0 && items.every((i) => (i.kind ?? "").startsWith("cardio_"));
    const firstCardio = items.find((i) => (i.kind ?? "").startsWith("cardio_"));
    const cardioModality = isCardio
      ? guessCardioModality(p.title, firstCardio?.kind)
      : null;
    planned.push({
      id: p.id,
      date,
      title: p.title,
      isCardio,
      cardioModality,
      completedSessionId: p.completed_session_id ?? null,
      skippedAt: p.skipped_at ?? null,
      summary: summarisePlanned(items),
    });
  }

  const sessions: RawSessionRow[] = sessionRows.map((s) => {
    const performedYmd = ymdInTimezone(new Date(s.performed_at), tz);
    const cardio = cardioBySession.get(s.id);
    const isCardio = cardio != null;
    const isStrength = strengthIds.has(s.id) || (!isCardio && !strengthIds.has(s.id));
    return {
      id: s.id,
      performedYmd,
      title: s.title,
      isCardio,
      isStrength: isCardio ? strengthIds.has(s.id) : isStrength,
      modality: cardio?.modality ?? null,
      durationMin: s.duration_min ?? (cardio?.duration_sec ? Math.round(cardio.duration_sec / 60) : null),
      stravaActivityId: s.strava_activity_id ? String(s.strava_activity_id) : null,
    };
  });

  const events: RawEventRow[] = ((eventsRes.data ?? []) as Array<{
    id: string;
    name: string;
    event_date: string;
    priority: "A" | "B" | "C";
    modality: string | null;
  }>).map((e) => ({
    id: e.id,
    name: e.name,
    date: e.event_date,
    priority: e.priority,
    modality: e.modality,
  }));

  return buildCalendarItems({ today, planned, sessions, events });
}

function addOneDay(ymd: string): string {
  const [y, m, d] = ymd.split("-").map((s) => Number.parseInt(s, 10));
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + 1);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function computePlannedDate(startedOn: string, weekIndex: number, dayIndex: number): string {
  // Same arithmetic as planner/queries.ts `dayDate`: snap block start
  // to its Monday, then add (weekIndex × 7 + dayIndex) days. We inline
  // it here so the lib has no cross-import on the planner package.
  const [y, m, d] = startedOn.split("-").map((s) => Number.parseInt(s, 10));
  const anchor = new Date(Date.UTC(y, m - 1, d));
  const startWeekday = (anchor.getUTCDay() + 6) % 7;
  anchor.setUTCDate(anchor.getUTCDate() - startWeekday + weekIndex * 7 + dayIndex);
  return `${anchor.getUTCFullYear()}-${String(anchor.getUTCMonth() + 1).padStart(2, "0")}-${String(anchor.getUTCDate()).padStart(2, "0")}`;
}

function summarisePlanned(items: Array<{ kind?: string }>): string | undefined {
  if (!items || items.length === 0) return undefined;
  const cardio = items.filter((i) => (i.kind ?? "").startsWith("cardio_")).length;
  const strength = items.length - cardio;
  if (cardio && strength) return `${strength} lifts · ${cardio} cardio`;
  if (cardio) return `${cardio} cardio block${cardio === 1 ? "" : "s"}`;
  return `${strength} set${strength === 1 ? "" : "s"}`;
}

function guessCardioModality(title: string, kind?: string): string | null {
  const t = title.toLowerCase();
  for (const m of ["run", "bike", "swim", "row", "ski", "padel"]) {
    if (t.includes(m)) return m;
  }
  if (kind === "cardio_z2") return "run";
  return null;
}
