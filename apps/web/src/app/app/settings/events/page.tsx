/**
 * /app/settings/events — self-serve priority event management.
 *
 * Server component: pulls the user's full event list once, then hands
 * a serialisable shape to the client wrapper. The H1 says "Events"
 * because the surface supports any modality (run, bike, swim, row,
 * ski, strength, padel, other) — not just races.
 *
 * This route absorbed the former /app/races surface: there were two
 * competing Events pages (a plain add/remove form here, the richer
 * edit + result-capture + timeline client there). The rich one won;
 * the URL under Settings won, because that is where the Settings hub,
 * the avatar dropdown and the "More" tab all point.
 */
import { redirect } from "next/navigation";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import { getUserTimezone } from "@/lib/planner/queries";
import { todayYmd } from "@/lib/dates";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
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

export default async function EventsSettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthUser();
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
      data-testid="events-page"
      style={{ display: "grid", gap: 20, maxWidth: 880, margin: "0 auto" }}
    >
      <PageHeader
        back={{ href: "/app/settings", label: "Settings" }}
        title="Events"
        subtitle="Races, comps, meets and tests. The app uses A and B priority events to suggest a taper in the final 14 days."
      />

      {!hasAny ? (
        <EmptyState
          variant="card"
          title="No events yet"
          body="Mark a race, comp, meet or test and the app will line up a taper inside the final two weeks."
          icon="◆"
        />
      ) : null}

      <EventsClient todayYmd={today} upcoming={upcoming} past={past} />
    </main>
  );
}
