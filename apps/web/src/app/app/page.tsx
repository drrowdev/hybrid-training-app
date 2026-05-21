import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import {
  formatPrescriptionItem,
  summarisePrescription,
} from "@/lib/planner/archetypes";
import {
  getTodayPlannedSessions,
  getUpcomingPlannedSessions,
  type PlannedDay,
} from "@/lib/planner/queries";
import { effectiveTimeOfDay, gapHoursBetween } from "@/lib/planner/time-of-day";
import { getRegionFreshness, findHeavyOnRecoveringConflict, type RegionFreshnessRow, type FreshnessConflict } from "@/lib/stats/region-freshness-queries";
import { StravaStaleSyncTrigger } from "@/components/StravaStaleSyncTrigger";
import { StravaPoweredBadge } from "@/components/StravaPoweredBadge";

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function todayLabel(d = new Date()) {
  return `${DOW[d.getDay()]} · ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

function formatRecentDate(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const ms = now.getTime() - d.getTime();
  const days = Math.floor(ms / 86_400_000);
  if (days <= 0 && d.getDate() === now.getDate()) return "today";
  if (days <= 1) return "yesterday";
  if (days < 7) return DOW[d.getDay()];
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

export default async function TodayPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const userId = user!.id;

  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name, timezone, am_window_start, pm_window_start")
    .eq("id", userId)
    .maybeSingle();

  const todayIso = new Date().toISOString().slice(0, 10);

  const [{ data: todaySessions }, { data: recent }, plannedToday, upcoming, freshness] = await Promise.all([
    supabase
      .from("sessions")
      .select("id, title, slot, completed_at, performed_at")
      .gte("performed_at", `${todayIso}T00:00:00`)
      .lt("performed_at", `${todayIso}T23:59:59`)
      .order("performed_at", { ascending: false }),
    supabase
      .from("sessions")
      .select("id, title, performed_at, completed_at, session_rpe, duration_min")
      .order("performed_at", { ascending: false })
      .limit(6),
    getTodayPlannedSessions(),
    getUpcomingPlannedSessions(3),
    getRegionFreshness(supabase, userId),
  ]);

  // Strava integration state: do we have a connection (drives the
  // background stale-sync trigger) and have we ever imported anything
  // (drives the attribution badge)?
  const [{ data: stravaConn }, { count: stravaCardioCount }] = await Promise.all([
    supabase
      .from("strava_connections")
      .select("user_id")
      .eq("user_id", userId)
      .maybeSingle(),
    supabase
      .from("cardio_logs")
      .select("id", { count: "exact", head: true })
      .eq("external_source", "strava"),
  ]);
  const hasStravaConnection = Boolean(stravaConn);
  const hasStravaData = (stravaCardioCount ?? 0) > 0;

  // DC-V2 soft warning: fetch the regions of the movements planned today
  // so we can flag heavy work on a clearly recovering region.
  const plannedMovementIds = Array.from(
    new Set(plannedToday.flatMap((p) => p.prescription.items.map((i) => i.movementId))),
  );
  const movementRegionById = new Map<string, { primaryRegion: string; name: string }>();
  if (plannedMovementIds.length > 0) {
    const { data: movs } = await supabase
      .from("movements")
      .select("id, name, primary_region")
      .in("id", plannedMovementIds);
    for (const m of movs ?? []) {
      movementRegionById.set(m.id, {
        primaryRegion: m.primary_region as string,
        name: m.name as string,
      });
    }
  }
  const freshnessByRegion = new Map(
    freshness.map((r) => [r.region, { freshness: r.freshness, regionLabel: r.regionLabel }]),
  );
  const conflictsBySlot = new Map<string, FreshnessConflict>();
  for (const p of plannedToday) {
    const c = findHeavyOnRecoveringConflict(
      p.prescription.items,
      movementRegionById,
      freshnessByRegion,
    );
    if (c) conflictsBySlot.set(p.id, c);
  }

  const openSession = (todaySessions ?? []).find((s) => !s.completed_at) ?? null;
  const completedToday = (todaySessions ?? []).filter((s) => s.completed_at);
  const greeting = profile?.display_name ? `Hey ${profile.display_name}` : "Hey there";
  const isTwoADay = plannedToday.length > 1;
  const timezone = profile?.timezone ?? "UTC";
  const amWindowStart = profile?.am_window_start ?? "07:00:00";
  const pmWindowStart = profile?.pm_window_start ?? "17:00:00";

  return (
    <div style={{ display: "grid", gap: 18 }}>
      <header>
        <div style={{ fontSize: 12, color: "var(--cp-text-muted)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
          {todayLabel()}
        </div>
        <h1 style={{ fontSize: 28, margin: "4px 0 0", letterSpacing: "-0.01em" }}>{greeting}.</h1>
      </header>

      <TodaySessionCard
        openSession={openSession}
        completedToday={completedToday}
        plannedToday={plannedToday}
        isTwoADay={isTwoADay}
        timezone={timezone}
        amWindowStart={amWindowStart}
        pmWindowStart={pmWindowStart}
        conflictsBySlot={conflictsBySlot}
      />

      <RegionFreshnessCard rows={freshness} hasStravaData={hasStravaData} />
      {hasStravaConnection && <StravaStaleSyncTrigger />}

      <section className="cp-card" style={{ padding: 20 }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 12 }}>
          <h2 style={{ fontSize: 16, margin: 0 }}>Up next this week</h2>
          <Link href="/app/plan" style={{ fontSize: 12, color: "var(--cp-text-muted)" }}>full plan →</Link>
        </div>
        {upcoming.length === 0 ? (
          <p style={{ fontSize: 13, color: "var(--cp-text-muted)", margin: 0 }}>
            No upcoming sessions on the schedule.{" "}
            <Link href="/app/plan" style={{ color: "var(--cp-link)" }}>Start a block</Link> to populate this.
          </p>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fit, minmax(140px, 1fr))`, gap: 8 }}>
            {upcoming.map((u) => (
              <Link
                key={u.id}
                href={`/app/plan?week=${u.weekIndex}`}
                style={{
                  border: "1px solid var(--cp-border)",
                  borderRadius: 12,
                  padding: 12,
                  textDecoration: "none",
                  color: "inherit",
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                  minHeight: 110,
                }}
              >
                <div style={{ fontSize: 10, color: "var(--cp-text-muted)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                  {new Date(u.date + "T00:00:00").toLocaleDateString(undefined, { weekday: "short" })} ·{" "}
                  <span style={{ color: "var(--cp-text)" }}>
                    {new Date(u.date + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                  </span>
                </div>
                <div style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.25 }}>{u.title}</div>
                <div style={{ fontSize: 11, color: "var(--cp-text-muted)", marginTop: "auto" }}>
                  {summarisePrescription(u.prescription.items)}
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      <section className="cp-card" style={{ padding: 20 }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 8 }}>
          <h2 style={{ fontSize: 16, margin: 0 }}>Recent sessions</h2>
          <Link href="/app/stats" style={{ fontSize: 12, color: "var(--cp-text-muted)" }}>all stats →</Link>
        </div>
        {!recent || recent.length === 0 ? (
          <p style={{ fontSize: 13, color: "var(--cp-text-muted)", margin: 0 }}>
            Nothing logged yet. Your first session will appear here.
          </p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {recent.map((s, i) => (
              <li key={s.id} style={{ borderTop: i === 0 ? "none" : "1px solid var(--cp-border)", padding: "10px 0" }}>
                <Link
                  href={`/app/sessions/${s.id}`}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "baseline",
                    color: "inherit",
                    textDecoration: "none",
                    gap: 12,
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {s.title ?? "Untitled session"}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--cp-text-muted)", marginTop: 2 }}>
                      {s.completed_at ? "✓ complete" : "in progress"}
                      {s.session_rpe ? ` · sRPE ${s.session_rpe}` : ""}
                      {s.duration_min ? ` · ${s.duration_min} min` : ""}
                    </div>
                  </div>
                  <span className="mono" style={{ fontSize: 11, color: "var(--cp-text-muted)", flexShrink: 0 }}>
                    {formatRecentDate(s.performed_at)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function TodaySessionCard({
  openSession,
  completedToday,
  plannedToday,
  isTwoADay,
  timezone,
  amWindowStart,
  pmWindowStart,
  conflictsBySlot,
}: {
  openSession: { id: string; title: string | null } | null;
  completedToday: { id: string; title: string | null }[];
  plannedToday: PlannedDay[];
  isTwoADay: boolean;
  timezone: string;
  amWindowStart: string;
  pmWindowStart: string;
  conflictsBySlot: Map<string, FreshnessConflict>;
}) {
  if (openSession) {
    return (
      <section className="cp-card" style={{ padding: 20, display: "grid", gap: 12 }}>
        <div style={{ fontSize: 11, color: "var(--cp-text-muted)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
          Resume today&apos;s session
        </div>
        <h2 style={{ fontSize: 22, margin: 0 }}>{openSession.title ?? "In-progress session"}</h2>
        <p style={{ color: "var(--cp-text-muted)", margin: 0, fontSize: 14 }}>
          You started this earlier today. Pick up where you left off.
        </p>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Link href={`/app/sessions/${openSession.id}`} className="cp-btn primary big">
            ⚡ Resume session
          </Link>
          <Link href={`/app/sessions/${openSession.id}/complete`} className="cp-btn">
            Wrap up
          </Link>
        </div>
      </section>
    );
  }

  if (completedToday.length > 0 && plannedToday.length <= completedToday.length) {
    // All planned slots for today are logged.
    return (
      <section className="cp-card" style={{ padding: 20, display: "grid", gap: 12 }}>
        <div style={{ fontSize: 11, color: "var(--cp-text-muted)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
          Today, so far
        </div>
        <h2 style={{ fontSize: 22, margin: 0 }}>
          {completedToday.length === 1 ? "Session logged ✓" : `${completedToday.length} sessions logged ✓`}
        </h2>
        <p style={{ color: "var(--cp-text-muted)", margin: 0, fontSize: 14 }}>
          {completedToday[0]?.title ?? "Untitled session"} — rest and recover. Tomorrow is in the plan.
        </p>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Link href="/app/sessions/new" className="cp-btn">Add another session</Link>
          <Link href="/app/plan" className="cp-btn">See tomorrow →</Link>
        </div>
      </section>
    );
  }

  if (plannedToday.length === 0) {
    return (
      <section className="cp-card" style={{ padding: 20, display: "grid", gap: 12 }}>
        <div style={{ fontSize: 11, color: "var(--cp-text-muted)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
          Today
        </div>
        <h2 style={{ fontSize: 22, margin: 0 }}>Rest or freestyle</h2>
        <p style={{ color: "var(--cp-text-muted)", margin: 0, fontSize: 14 }}>
          Nothing on the schedule today. Take it as a rest day, or log a freestyle session.
        </p>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Link href="/app/sessions/new" className="cp-btn primary">
            ⚡ Log a session
          </Link>
          <Link href="/app/plan" className="cp-btn">View plan</Link>
        </div>
      </section>
    );
  }

  // 1 or 2 planned sessions today.
  // Compute effective times for AM and PM, then derive the actual gap for
  // the DC-D1 warning so it shows the real value, not a static reminder.
  const slotTimes = new Map<string, string>();
  for (const p of plannedToday) {
    const t = effectiveTimeOfDay({
      slot: p.slot,
      plannedAt: p.plannedAt,
      amWindowStart,
      pmWindowStart,
      timezone,
    });
    if (t) slotTimes.set(p.slot, t);
  }
  const amTime = slotTimes.get("am");
  const pmTime = slotTimes.get("pm");
  const gapH = isTwoADay && amTime && pmTime ? gapHoursBetween(amTime, pmTime) : null;
  const gapShort = gapH != null && gapH < 6;

  return (
    <div style={{ display: "grid", gap: 10 }}>
      {isTwoADay && (
        <div
          role="note"
          className="cp-card"
          style={{
            padding: "10px 14px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 12,
            background: "color-mix(in oklab, var(--cp-accent) 4%, transparent)",
            borderColor: "var(--cp-accent)",
            fontSize: 12,
          }}
        >
          <span style={{ color: "var(--cp-text)" }}>
            <strong>
              Two-a-day{gapH != null ? ` · ${gapH.toFixed(0)}h gap` : ""}.
            </strong>
            <span style={{ color: "var(--cp-text-muted)", marginLeft: 4 }}>
              {gapShort
                ? `Sessions are ${gapH!.toFixed(1)}h apart — research recommends ≥6h between AM lift and PM cardio to protect the strength signal.`
                : "AM lift + PM cardio with at least 6 hours between protects the strength signal."}
            </span>
          </span>
          <span
            className="mono"
            title="Robineau 2016 (HIGH) — recovery between concurrent sessions"
            style={{ fontSize: 10, color: "var(--cp-text-muted)", flexShrink: 0 }}
          >
            Robineau 2016
          </span>
        </div>
      )}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: isTwoADay ? "repeat(auto-fit, minmax(300px, 1fr))" : "1fr",
          gap: 12,
        }}
      >
        {plannedToday.map((p) => (
          <PlannedSessionCard
            key={p.id}
            planned={p}
            isTwoADay={isTwoADay}
            timeOfDay={slotTimes.get(p.slot) ?? null}
            conflict={conflictsBySlot.get(p.id) ?? null}
          />
        ))}
      </div>
    </div>
  );
}

function PlannedSessionCard({
  planned,
  isTwoADay,
  timeOfDay,
  conflict,
}: {
  planned: PlannedDay;
  isTwoADay: boolean;
  timeOfDay: string | null;
  conflict: FreshnessConflict | null;
}) {
  const slotLabel =
    planned.slot === "am" ? "Morning" : planned.slot === "pm" ? "Evening" : "Today's session";
  return (
    <section className="cp-card" style={{ padding: 20, display: "grid", gap: 12, borderColor: "var(--cp-accent)" }}>
      <div style={{ fontSize: 11, color: "var(--cp-accent)", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600 }}>
        {isTwoADay && planned.slot !== "single" ? (
          <span>
            {slotLabel} · <span className="mono">{planned.slot.toUpperCase()}</span>
            {timeOfDay && (
              <span className="mono" style={{ color: "var(--cp-text-muted)", marginLeft: 8 }}>
                {timeOfDay}
              </span>
            )}
          </span>
        ) : (
          slotLabel
        )}
      </div>
      <h2 style={{ fontSize: 20, margin: 0 }}>{planned.title}</h2>
      {conflict && (
        <div
          role="note"
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 8,
            padding: "8px 12px",
            borderRadius: 10,
            background: "color-mix(in oklab, var(--cp-warning) 12%, transparent)",
            border: "1px solid var(--cp-warning)",
            fontSize: 12,
            color: "var(--cp-text)",
            lineHeight: 1.4,
          }}
          title={`${conflict.regionLabel} freshness ${(conflict.freshness * 100).toFixed(0)}% — Gabbett 2016 (acute-to-chronic load injury risk)`}
        >
          <span aria-hidden style={{ fontSize: 14 }}>⚠</span>
          <span>
            <strong>{conflict.regionLabel}</strong> still recovering. Heavy {conflict.movementName} may need a lighter top set or a substitution.
          </span>
        </div>
      )}
      <div style={{ fontSize: 13, color: "var(--cp-text-muted)" }}>
        {summarisePrescription(planned.prescription.items)}
      </div>
      {planned.prescription.items.length > 0 && (
        <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 4 }}>
          {planned.prescription.items.map((item, i) => (
            <li
              key={i}
              style={{
                fontSize: 13,
                display: "flex",
                justifyContent: "space-between",
                padding: "6px 10px",
                background: "var(--cp-surface-soft)",
                borderRadius: 6,
              }}
            >
              <span>
                Set {i + 1}
                {item.notes ? (
                  <span style={{ color: "var(--cp-accent)", fontWeight: 600, marginLeft: 4 }}>· {item.notes}</span>
                ) : null}
              </span>
              <span className="mono" style={{ fontWeight: 600 }}>{formatPrescriptionItem(item)}</span>
            </li>
          ))}
        </ul>
      )}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        {planned.completedSessionId ? (
          <Link href={`/app/sessions/${planned.completedSessionId}`} className="cp-btn primary big">
            ⚡ Continue session
          </Link>
        ) : (
          <Link href={`/app/sessions/start/${planned.id}`} className="cp-btn primary big">
            ⚡ Start session
          </Link>
        )}
        <Link href="/app/plan" className="cp-btn">View plan</Link>
      </div>
    </section>
  );
}

function freshnessColor(tone: "ok" | "caution" | "warn") {
  if (tone === "ok") return "var(--cp-success)";
  if (tone === "caution") return "var(--cp-warning)";
  return "var(--cp-danger)";
}

function timeAgo(iso: string | null): string {
  if (!iso) return "";
  const days = Math.max(0, Math.floor((Date.now() - new Date(iso + "T00:00:00").getTime()) / 86_400_000));
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  if (days < 60) return `${Math.round(days / 7)}w ago`;
  return `${Math.round(days / 30)}mo ago`;
}

function RegionFreshnessCard({ rows, hasStravaData }: { rows: RegionFreshnessRow[]; hasStravaData: boolean }) {
  return (
    <section className="cp-card" style={{ padding: 20 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 12, gap: 12, flexWrap: "wrap" }}>
        <h2 style={{ fontSize: 16, margin: 0 }}>How recovered you are</h2>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {hasStravaData && <StravaPoweredBadge variant="compact" />}
          <Link href="/app/stats/engine" style={{ fontSize: 12, color: "var(--cp-text-muted)" }}>details →</Link>
        </div>
      </div>
      {rows.length === 0 ? (
        <p style={{ fontSize: 13, color: "var(--cp-text-muted)", margin: 0 }}>
          Log a session to start tracking how each region recovers.
        </p>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          {rows.map((r) => (
            <div
              key={r.region}
              title={`Freshness ${(r.freshness * 100).toFixed(0)}% · last load ${timeAgo(r.lastLoadDate) || "—"}`}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "8px 12px",
                border: "1px solid var(--cp-border)",
                borderRadius: 10,
                background: "var(--cp-surface)",
              }}
            >
              <span style={{ fontSize: 14, fontWeight: 500 }}>{r.regionLabel}</span>
              <span
                style={{
                  fontSize: 12,
                  color: freshnessColor(r.tone),
                  fontWeight: 600,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <span
                  aria-hidden
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 999,
                    background: freshnessColor(r.tone),
                    display: "inline-block",
                  }}
                />
                {r.label}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
