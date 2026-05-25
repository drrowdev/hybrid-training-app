/**
 * UpNextRail — right-column "next 3 upcoming sessions" list.
 *
 * Renders compact cards for future planned sessions (strictly after
 * today). Today's session lives in the hero — see UpNextHero. Each
 * card carries a secondary `Start session` link so users can jump
 * ahead without scrolling. Per the up-next CTA hierarchy rule, *no*
 * card here uses the `primary` button class — only the hero owns the
 * single primary action on the page.
 */
import Link from "next/link";
import type { UpNextSession } from "@/lib/plan/up-next";
import { formatDate, type ProfileForFormat } from "@/lib/format/datetime";

const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function weekdayFromYmd(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const jsDow = new Date(Date.UTC(y!, (m ?? 1) - 1, d!)).getUTCDay();
  return DOW[(jsDow + 6) % 7]!;
}

export function UpNextRail({
  sessions,
  formatProfile,
}: {
  sessions: UpNextSession[];
  formatProfile: ProfileForFormat;
}) {
  return (
    <aside
      data-testid="plan-up-next-rail"
      className="cp-card"
      style={{ padding: 12, display: "grid", gap: 10, alignSelf: "start" }}
    >
      <div
        style={{
          fontSize: 11,
          color: "var(--cp-text-muted)",
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          fontWeight: 700,
        }}
      >
        Coming up
      </div>
      {sessions.length === 0 ? (
        <div style={{ fontSize: 12, color: "var(--cp-text-muted)" }}>
          Nothing else scheduled.
        </div>
      ) : (
        sessions.map((s) => (
          <RailCard key={s.id} session={s} formatProfile={formatProfile} />
        ))
      )}
    </aside>
  );
}

function RailCard({
  session,
  formatProfile,
}: {
  session: UpNextSession;
  formatProfile: ProfileForFormat;
}) {
  return (
    <div
      data-testid={`plan-up-next-rail-${session.id}`}
      style={{
        display: "grid",
        gap: 6,
        padding: 10,
        borderRadius: 8,
        border: "1px solid var(--cp-border)",
        background: "var(--cp-surface)",
      }}
    >
      <div
        style={{
          fontSize: 10,
          color: "var(--cp-text-muted)",
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          fontWeight: 600,
        }}
      >
        {weekdayFromYmd(session.date)} ·{" "}
        {formatDate(session.date + "T00:00:00Z", { ...(formatProfile ?? {}), timezone: "UTC" }, "short_date")}
        {session.slot !== "single" && (
          <span className="mono" style={{ marginLeft: 6, color: "var(--cp-accent)" }}>
            {session.slot.toUpperCase()}
          </span>
        )}
      </div>
      <div style={{ fontSize: 14, fontWeight: 600 }}>{session.title}</div>
      <div style={{ fontSize: 11, color: "var(--cp-text-muted)" }}>{session.summary}</div>
      <Link
        href={`/app/sessions/start/${session.id}`}
        data-testid={`plan-up-next-rail-start-${session.id}`}
        className="cp-btn"
        style={{ textAlign: "center", fontSize: 12, padding: "6px 10px", marginTop: 2 }}
      >
        Start session
      </Link>
    </div>
  );
}
