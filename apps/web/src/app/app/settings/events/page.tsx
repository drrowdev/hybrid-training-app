import { redirect } from "next/navigation";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import { createPriorityEvent, deletePriorityEvent } from "@/lib/planner/events-actions";
import { getUserTimezone } from "@/lib/planner/queries";
import { todayYmd } from "@/lib/dates";
import { PageHeader } from "@/components/ui/PageHeader";

type EventRow = {
  id: string;
  name: string;
  event_date: string;
  priority: "A" | "B" | "C";
  modality: string | null;
  notes: string | null;
};

function priorityColor(p: "A" | "B" | "C"): string {
  if (p === "A") return "var(--cp-danger)";
  if (p === "B") return "var(--cp-warning)";
  return "var(--cp-text-muted)";
}

function priorityLabel(p: "A" | "B" | "C"): string {
  if (p === "A") return "A — Peak it";
  if (p === "B") return "B — Important";
  return "C — Logged only";
}

export default async function EventsSettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) redirect("/login");

  const today = todayYmd(await getUserTimezone(user.id));
  const { data: upcoming } = await supabase
    .from("priority_events")
    .select("id, name, event_date, priority, modality, notes")
    .eq("user_id", user.id)
    .gte("event_date", today)
    .order("event_date", { ascending: true })
    .limit(50);
  const { data: past } = await supabase
    .from("priority_events")
    .select("id, name, event_date, priority, modality, notes")
    .eq("user_id", user.id)
    .lt("event_date", today)
    .order("event_date", { ascending: false })
    .limit(10);

  return (
    <div className="space-y-6">
      <PageHeader
        back={{ href: "/app/settings", label: "Settings" }}
        title="Events"
        subtitle="Races, comps, tests. A-priority events trigger a 14-day taper. B events get a 7-day mini-taper. C events are just logged."
      />

      <section className="cp-card" style={{ padding: 20, display: "grid", gap: 12 }}>
        <h2 style={{ margin: 0, fontSize: 16 }}>Add an event</h2>
        <form action={createPriorityEvent} style={{ display: "grid", gap: 10 }}>
          <div style={{ display: "grid", gap: 4 }}>
            <label style={{ fontSize: 12, color: "var(--cp-text-muted)" }} htmlFor="name">Name</label>
            <input id="name" name="name" type="text" required maxLength={120} placeholder="Half marathon / squat meet / fitness test" />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div style={{ display: "grid", gap: 4 }}>
              <label style={{ fontSize: 12, color: "var(--cp-text-muted)" }} htmlFor="eventDate">Date</label>
              <input id="eventDate" name="eventDate" type="date" required min={today} />
            </div>
            <div style={{ display: "grid", gap: 4 }}>
              <label style={{ fontSize: 12, color: "var(--cp-text-muted)" }} htmlFor="priority">Priority</label>
              <select id="priority" name="priority" defaultValue="A">
                <option value="A">A — Peak it</option>
                <option value="B">B — Important</option>
                <option value="C">C — Logged only</option>
              </select>
            </div>
          </div>
          <div style={{ display: "grid", gap: 4 }}>
            <label style={{ fontSize: 12, color: "var(--cp-text-muted)" }} htmlFor="modality">Modality (optional)</label>
            <input id="modality" name="modality" type="text" maxLength={40} placeholder="endurance, strength, hybrid" />
          </div>
          <div style={{ display: "grid", gap: 4 }}>
            <label style={{ fontSize: 12, color: "var(--cp-text-muted)" }} htmlFor="notes">Notes (optional)</label>
            <textarea id="notes" name="notes" rows={2} maxLength={1000} />
          </div>
          <button type="submit" className="cp-btn primary">Save event</button>
        </form>
      </section>

      <section className="cp-card" style={{ padding: 20 }}>
        <h2 style={{ margin: "0 0 8px", fontSize: 16 }}>Upcoming</h2>
        {(!upcoming || upcoming.length === 0) ? (
          <p style={{ margin: 0, fontSize: 13, color: "var(--cp-text-muted)" }}>Nothing scheduled.</p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 8 }}>
            {(upcoming as EventRow[]).map((e) => <EventRowView key={e.id} event={e} />)}
          </ul>
        )}
      </section>

      {past && past.length > 0 && (
        <section className="cp-card" style={{ padding: 20 }}>
          <h2 style={{ margin: "0 0 8px", fontSize: 16 }}>Past</h2>
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 8 }}>
            {(past as EventRow[]).map((e) => <EventRowView key={e.id} event={e} />)}
          </ul>
        </section>
      )}
    </div>
  );
}

function EventRowView({ event }: { event: EventRow }) {
  const color = priorityColor(event.priority);
  return (
    <li
      style={{
        padding: "10px 12px",
        borderRadius: 10,
        border: "1px solid var(--cp-border)",
        background: "var(--cp-surface)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 10,
      }}
    >
      <div style={{ minWidth: 0, display: "grid", gap: 2 }}>
        <div style={{ fontSize: 14, fontWeight: 600 }}>{event.name}</div>
        <div style={{ fontSize: 11, color: "var(--cp-text-muted)", display: "flex", gap: 8 }}>
          <span className="mono">{event.event_date}</span>
          <span style={{ color, fontWeight: 600 }}>{priorityLabel(event.priority)}</span>
          {event.modality && <span>· {event.modality}</span>}
        </div>
      </div>
      <form action={deletePriorityEvent}>
        <input type="hidden" name="id" value={event.id} />
        <button type="submit" className="cp-btn ghost" aria-label="Remove event">Remove</button>
      </form>
    </li>
  );
}
