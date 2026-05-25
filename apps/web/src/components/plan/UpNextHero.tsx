/**
 * UpNextHero — top-of-/plan card emphasising the next thing to do.
 *
 * Three modes:
 *   1) Today has session(s)  → one large card per session (AM first,
 *      then single/PM). Only the first card gets the primary CTA;
 *      additional same-day sessions render with a secondary Start so
 *      there's still a single primary action on the page.
 *   2) Today has no session  → muted "Rest day" card + a peek at the
 *      next planned session date/title (or "no upcoming" when the
 *      block has nothing future).
 *   3) No active session and no upcoming → just the rest-day card.
 *
 * Server-rendered; SkipSessionForm is the only client island here.
 */
import Link from "next/link";
import { SkipSessionForm } from "./SkipSessionForm";
import type { skipPlannedSession } from "@/lib/planner/actions";
import type { UpNextSession, UpNextSelection } from "@/lib/plan/up-next";
import { formatDate, type ProfileForFormat } from "@/lib/format/datetime";

const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function weekdayFromYmd(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const jsDow = new Date(Date.UTC(y!, (m ?? 1) - 1, d!)).getUTCDay();
  // JS: Sun=0, Mon=1 … Sat=6. Project order is Mon=0 … Sun=6.
  return DOW[(jsDow + 6) % 7]!;
}

export function UpNextHero({
  selection,
  skipAction,
  formatProfile,
}: {
  selection: UpNextSelection;
  skipAction: typeof skipPlannedSession;
  formatProfile: ProfileForFormat;
}) {
  if (selection.today.length === 0) {
    return (
      <RestDayCard next={selection.upcoming[0] ?? null} formatProfile={formatProfile} />
    );
  }

  return (
    <section data-testid="plan-up-next-hero" style={{ display: "grid", gap: 10 }}>
      {selection.today.map((s, i) => (
        <TodayCard
          key={s.id}
          session={s}
          primary={i === 0}
          isTwoADay={selection.today.length > 1}
          skipAction={skipAction}
        />
      ))}
    </section>
  );
}

function TodayCard({
  session,
  primary,
  isTwoADay,
  skipAction,
}: {
  session: UpNextSession;
  primary: boolean;
  isTwoADay: boolean;
  skipAction: typeof skipPlannedSession;
}) {
  const slotBadge =
    isTwoADay && session.slot !== "single"
      ? session.slot === "am"
        ? "AM"
        : "PM"
      : null;
  return (
    <div
      className="cp-card"
      data-testid={`plan-up-next-today-${session.id}`}
      data-primary={primary ? "true" : "false"}
      style={{
        padding: 18,
        display: "grid",
        gap: 12,
        borderColor: primary ? "var(--cp-accent)" : undefined,
        background: primary ? "var(--cp-accent-soft)" : undefined,
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
        <span
          style={{
            fontSize: 11,
            color: primary ? "var(--cp-accent)" : "var(--cp-text-muted)",
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            fontWeight: 700,
          }}
        >
          {primary ? "Up next · today" : "Also today"}
        </span>
        {slotBadge && (
          <span
            className="mono"
            style={{
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: "0.08em",
              color: "var(--cp-accent)",
            }}
          >
            {slotBadge}
          </span>
        )}
      </div>
      <div style={{ display: "grid", gap: 4 }}>
        <h2 style={{ margin: 0, fontSize: 20, letterSpacing: "-0.01em" }}>{session.title}</h2>
        <div style={{ fontSize: 13, color: "var(--cp-text-muted)" }}>{session.summary}</div>
      </div>
      <ShapeStrip session={session} />
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <Link
          href={`/app/sessions/start/${session.id}`}
          data-testid={`plan-up-next-start-${session.id}`}
          className={primary ? "cp-btn primary" : "cp-btn"}
          style={{
            flex: "1 1 200px",
            textAlign: "center",
            fontSize: primary ? 15 : 13,
            padding: primary ? "12px 18px" : "8px 14px",
            fontWeight: 600,
          }}
        >
          {primary ? "⚡ Start session" : "Start session"}
        </Link>
        <SkipSessionForm
          plannedId={session.id}
          title={session.title}
          action={skipAction}
        />
      </div>
    </div>
  );
}

function RestDayCard({
  next,
  formatProfile,
}: {
  next: UpNextSession | null;
  formatProfile: ProfileForFormat;
}) {
  return (
    <section
      className="cp-card"
      data-testid="plan-up-next-rest"
      style={{
        padding: 18,
        display: "grid",
        gap: 8,
        background: "var(--cp-surface-soft)",
      }}
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
        Rest day
      </div>
      {next ? (
        <>
          <div style={{ fontSize: 15, color: "var(--cp-text)" }}>
            Next session:{" "}
            <strong>
              {weekdayFromYmd(next.date)} ·{" "}
              {formatDate(next.date + "T00:00:00Z", { ...(formatProfile ?? {}), timezone: "UTC" }, "short_date")}
            </strong>{" "}
            — {next.title}
          </div>
          <div style={{ fontSize: 12, color: "var(--cp-text-muted)" }}>{next.summary}</div>
          <Link
            href={`/app/sessions/start/${next.id}`}
            data-testid={`plan-up-next-peek-${next.id}`}
            className="cp-btn"
            style={{
              alignSelf: "start",
              fontSize: 12,
              padding: "6px 12px",
              marginTop: 4,
            }}
          >
            View next session ▾
          </Link>
        </>
      ) : (
        <div style={{ fontSize: 13, color: "var(--cp-text-muted)" }}>
          Nothing scheduled. Take it easy.
        </div>
      )}
    </section>
  );
}

/**
 * Tiny visual "shape" strip — warm-up / main / accessory / cardio
 * counts as chips. Purely a glance — no per-set detail.
 */
function ShapeStrip({ session }: { session: UpNextSession }) {
  const segments: { label: string; count: number; color: string }[] = [];
  if (session.warmupCount > 0)
    segments.push({ label: "warm-up", count: session.warmupCount, color: "var(--cp-text-muted)" });
  if (session.mainCount > 0)
    segments.push({ label: "main", count: session.mainCount, color: "var(--cp-accent)" });
  if (session.accessoryCount > 0)
    segments.push({ label: "accessory", count: session.accessoryCount, color: "var(--cp-text)" });
  if (session.cardioCount > 0)
    segments.push({ label: "cardio", count: session.cardioCount, color: "var(--cp-success)" });
  if (segments.length === 0) return null;
  return (
    <div
      data-testid="plan-up-next-shape"
      aria-hidden
      style={{ display: "flex", gap: 4, flexWrap: "wrap" }}
    >
      {segments.map((seg) => (
        <span
          key={seg.label}
          title={`${seg.count} ${seg.label}${seg.count === 1 ? "" : "s"}`}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            padding: "2px 8px",
            fontSize: 11,
            borderRadius: 999,
            border: `1px solid ${seg.color}`,
            color: seg.color,
            background: "transparent",
          }}
        >
          <span className="mono" style={{ fontWeight: 700 }}>
            {seg.count}
          </span>
          <span style={{ textTransform: "lowercase" }}>{seg.label}</span>
        </span>
      ))}
    </div>
  );
}
