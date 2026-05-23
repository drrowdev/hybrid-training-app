/**
 * /app/races — self-serve priority event management.
 *
 * Server component: pulls the user's full event list once, then hands
 * a serialisable shape to the client wrapper. The route name uses the
 * conventional "races" term so the URL is short; the H1 says "Events"
 * because the surface supports any modality (run, bike, swim, row,
 * ski, strength, padel, other) — not just running.
 *
 * The legacy /app/settings/events form still works (back compat for
 * deep links) but the cmd-k palette and avatar dropdown now point
 * here.
 */
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getUserTimezone } from "@/lib/planner/queries";
import { todayYmd } from "@/lib/dates";
import { EmptyState } from "@/components/ui/EmptyState";
import { EventsClient } from "@/components/events/EventsClient";
import type { EventRowView } from "@/components/events/types";
import type {
  EventPerformance,
  EventPriority,
} from "@/lib/events/schema";

type RawRow = {
  id: string;
  name: string;
  event_date: string;
  priority: EventPriority;
  modality: string | null;
  notes: string | null;
  target_performance: EventPerformance | null;
  result: EventPerformance | null;
  completed: boolean;
};

function normalise(r: RawRow): EventRowView {
  return {
    id: r.id,
    name: r.name,
    eventDate: r.event_date,
    priority: r.priority,
    modality: r.modality,
    notes: r.notes,
    targetPerformance: r.target_performance,
    result: r.result,
    completed: r.completed,
  };
}

export const dynamic = "force-dynamic";

export default async function RacesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const today = todayYmd(await getUserTimezone(user.id));

  const { data } = await supabase
    .from("priority_events")
    .select(
      "id, name, event_date, priority, modality, notes, target_performance, result, completed",
    )
    .eq("user_id", user.id)
    .order("event_date", { ascending: true });

  const rows: EventRowView[] = (data ?? []).map((r) => normalise(r as RawRow));
  const upcoming = rows.filter((r) => r.eventDate >= today);
  const past = rows
    .filter((r) => r.eventDate < today)
    .sort((a, b) => b.eventDate.localeCompare(a.eventDate));

  const hasAny = rows.length > 0;

  return (
    <main
      data-testid="races-page"
      style={{ display: "grid", gap: 20, maxWidth: 880, margin: "0 auto" }}
    >
      <header style={{ display: "grid", gap: 6 }}>
        <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700 }}>Events</h1>
        <p style={{ margin: 0, fontSize: 13, color: "var(--cp-text-muted)" }}>
          Races, comps, meets and tests. The planner uses A and B priority
          events to suggest a taper in the final 14 days.
        </p>
      </header>

      {!hasAny ? (
        <EmptyState
          variant="card"
          title="No events yet"
          body="Mark a race, comp, meet or test and the planner will line up a rule-based taper inside the final two weeks."
          icon="◆"
        />
      ) : null}

      <EventsClient todayYmd={today} upcoming={upcoming} past={past} />
    </main>
  );
}
