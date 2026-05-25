/**
 * UpNextHero — top-of-/plan card emphasising the next thing to do.
 *
 * Hero mode is decided upstream by `selectBlockState`; this component
 * just branches on `state.kind`:
 *   - 'active'           → one large card per today session (AM first,
 *                          then single/PM). Only the first card gets
 *                          the primary CTA so the page keeps a single
 *                          primary action.
 *   - 'no-session-today' → muted "Rest day · Next session …" card.
 *   - 'future'           → calm countdown card with an optional
 *                          "Preview week 1" disclosure.
 *   - 'completed'        → celebratory "Block complete" card; consumes
 *                          a slot (`completedActions`) so the page can
 *                          inject the existing EndBlockForm CTA.
 *
 * Server-rendered; SkipSessionForm is the only client island here.
 */
import type { ReactNode } from "react";
import Link from "next/link";
import { SkipSessionForm } from "./SkipSessionForm";
import type { skipPlannedSession } from "@/lib/planner/actions";
import type { UpNextSession, UpNextSelection } from "@/lib/plan/up-next";
import type { BlockState } from "@/lib/plan/block-state";
import { formatDate, type ProfileForFormat } from "@/lib/format/datetime";

const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function weekdayFromYmd(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const jsDow = new Date(Date.UTC(y!, (m ?? 1) - 1, d!)).getUTCDay();
  // JS: Sun=0, Mon=1 … Sat=6. Project order is Mon=0 … Sun=6.
  return DOW[(jsDow + 6) % 7]!;
}

export type WeekOnePreviewItem = {
  id: string;
  date: string;
  title: string;
  summary?: string;
};

export function UpNextHero({
  state,
  selection,
  skipAction,
  formatProfile,
  weekOnePreview,
  completedActions,
  blockName,
  blockSessionCount,
  blockWeeks,
}: {
  state: BlockState;
  selection: UpNextSelection;
  skipAction: typeof skipPlannedSession;
  formatProfile: ProfileForFormat;
  /** First week's planned sessions, only consumed when state is 'future'. */
  weekOnePreview?: WeekOnePreviewItem[];
  /** Slot the page passes when state is 'completed' (e.g. EndBlockForm). */
  completedActions?: ReactNode;
  /** Display name for the active block (used by future + completed cards). */
  blockName?: string;
  blockSessionCount?: number;
  blockWeeks?: number;
}) {
  if (state.kind === "future") {
    return (
      <FutureBlockCard
        startsOn={state.startsOn}
        daysUntil={state.daysUntil}
        blockName={blockName}
        blockSessionCount={blockSessionCount}
        blockWeeks={blockWeeks}
        preview={weekOnePreview ?? []}
        formatProfile={formatProfile}
      />
    );
  }

  if (state.kind === "completed") {
    return (
      <CompletedBlockCard
        blockName={blockName}
        actions={completedActions}
      />
    );
  }

  if (state.kind === "no-session-today" || selection.today.length === 0) {
    return (
      <RestDayCard
        next={selection.upcoming[0] ?? null}
        formatProfile={formatProfile}
      />
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

function relativeDayLabel(targetYmd: string, todayYmd?: string): string {
  // Best-effort relative phrasing without pulling in a date lib. The
  // hero only ever asks for "tomorrow" / "in N days" so we keep it
  // small and locale-agnostic.
  const today = todayYmd ?? new Date().toISOString().slice(0, 10);
  const [ty, tm, td] = today.split("-").map(Number);
  const [yy, ym, yd] = targetYmd.split("-").map(Number);
  const days = Math.round(
    (Date.UTC(yy!, (ym ?? 1) - 1, yd!) - Date.UTC(ty!, (tm ?? 1) - 1, td!)) /
      86_400_000,
  );
  if (days <= 0) return "today";
  if (days === 1) return "tomorrow";
  return `in ${days} days`;
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
            Next session{" "}
            <strong>{relativeDayLabel(next.date)}</strong>{" "}
            ·{" "}
            <span style={{ color: "var(--cp-text-muted)" }}>
              {weekdayFromYmd(next.date)},{" "}
              {formatDate(
                next.date + "T00:00:00Z",
                { ...(formatProfile ?? {}), timezone: "UTC" },
                "short_date",
              )}
            </span>{" "}
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

function FutureBlockCard({
  startsOn,
  daysUntil,
  blockName,
  blockSessionCount,
  blockWeeks,
  preview,
  formatProfile,
}: {
  startsOn: string;
  daysUntil: number;
  blockName?: string;
  blockSessionCount?: number;
  blockWeeks?: number;
  preview: WeekOnePreviewItem[];
  formatProfile: ProfileForFormat;
}) {
  const startLabel = formatDate(
    startsOn + "T00:00:00Z",
    { ...(formatProfile ?? {}), timezone: "UTC" },
    "short_date",
  );
  const countdown =
    daysUntil === 1 ? "starts tomorrow" : `starts in ${daysUntil} days`;
  const summaryBits: string[] = [];
  if (blockSessionCount != null) {
    summaryBits.push(`${blockSessionCount} sessions`);
  }
  if (blockWeeks != null) {
    summaryBits.push(`${blockWeeks} weeks`);
  }
  return (
    <section
      className="cp-card"
      data-testid="plan-up-next-future"
      style={{
        padding: 18,
        display: "grid",
        gap: 10,
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
        Block {countdown}
      </div>
      <div style={{ display: "grid", gap: 4 }}>
        <h2 style={{ margin: 0, fontSize: 20, letterSpacing: "-0.01em" }}>
          {blockName ?? "Your block"}
        </h2>
        <div style={{ fontSize: 13, color: "var(--cp-text-muted)" }}>
          Starts {weekdayFromYmd(startsOn)}, {startLabel}
          {summaryBits.length > 0 ? ` · ${summaryBits.join(" · ")}` : ""}
        </div>
      </div>
      {preview.length > 0 && (
        <details
          data-testid="plan-up-next-future-preview"
          style={{ marginTop: 2 }}
        >
          <summary
            style={{
              fontSize: 12,
              color: "var(--cp-accent)",
              cursor: "pointer",
              listStyle: "none",
              fontWeight: 600,
              padding: "2px 0",
            }}
          >
            Preview week 1 ▾
          </summary>
          <ul
            style={{
              listStyle: "none",
              padding: 0,
              margin: "8px 0 0",
              display: "grid",
              gap: 6,
            }}
          >
            {preview.map((p) => (
              <li
                key={p.id}
                style={{
                  display: "grid",
                  gap: 2,
                  padding: "8px 10px",
                  border: "1px solid var(--cp-border)",
                  borderRadius: 8,
                  background: "var(--cp-surface)",
                }}
              >
                <div
                  style={{
                    fontSize: 11,
                    color: "var(--cp-text-muted)",
                    textTransform: "uppercase",
                    letterSpacing: "0.08em",
                    fontWeight: 600,
                  }}
                >
                  {weekdayFromYmd(p.date)} ·{" "}
                  {formatDate(
                    p.date + "T00:00:00Z",
                    { ...(formatProfile ?? {}), timezone: "UTC" },
                    "short_date",
                  )}
                </div>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{p.title}</div>
                {p.summary && (
                  <div style={{ fontSize: 11, color: "var(--cp-text-muted)" }}>
                    {p.summary}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

function CompletedBlockCard({
  blockName,
  actions,
}: {
  blockName?: string;
  actions?: ReactNode;
}) {
  return (
    <section
      className="cp-card"
      data-testid="plan-up-next-completed"
      style={{
        padding: 20,
        display: "grid",
        gap: 12,
        borderColor: "var(--cp-success)",
        background: "color-mix(in oklab, var(--cp-success) 6%, transparent)",
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
        <div style={{ fontSize: 22, lineHeight: 1 }} aria-hidden="true">
          ✓
        </div>
        <div style={{ display: "grid", gap: 4, flex: 1 }}>
          <div
            style={{
              fontSize: 11,
              color: "var(--cp-success)",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              fontWeight: 700,
            }}
          >
            Block complete
          </div>
          <h2 style={{ margin: 0, fontSize: 20, letterSpacing: "-0.01em" }}>
            Nice work on {blockName ?? "this block"}.
          </h2>
          <p
            style={{
              margin: 0,
              color: "var(--cp-text-muted)",
              fontSize: 13,
              lineHeight: 1.5,
            }}
          >
            All planned sessions are accounted for. Wrap it up to start a
            new one — your logged sessions stay put.
          </p>
        </div>
      </div>
      {actions && (
        <div
          data-testid="plan-up-next-completed-actions"
          style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}
        >
          {actions}
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
  const a11ySummary = segments
    .map((seg) => `${seg.count} ${seg.label}${seg.count === 1 ? "" : "s"}`)
    .join(", ");
  return (
    <div
      data-testid="plan-up-next-shape"
      role="img"
      aria-label={`Session shape: ${a11ySummary}`}
      style={{ display: "flex", gap: 4, flexWrap: "wrap" }}
    >
      {segments.map((seg) => (
        <span
          key={seg.label}
          aria-hidden="true"
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
