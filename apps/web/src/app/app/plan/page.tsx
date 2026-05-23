import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { acceptTmBump, declineTmBump } from "@/lib/engine/tm-bump-actions";
import { findBlockCompleteBump } from "@/lib/engine/block-complete";
import {
  endBlock,
  setPlannedTime,
  skipPlannedSession,
  unskipPlannedSession,
} from "@/lib/planner/actions";
import { ARCHETYPES, formatPrescriptionItem, summarisePrescription } from "@/lib/planner/archetypes";
import { getActiveBlock, getPlannedDays, todayYmd } from "@/lib/planner/queries";
import { effectiveTimeOfDay, gapHoursBetween } from "@/lib/planner/time-of-day";
import { getCurrentWeekTissueStackGaps, type TissueStackGap } from "@/lib/stats/tissue-stack-queries";
import type { Prescription } from "@hta/db";

const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export default async function PlanPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const block = await getActiveBlock();

  if (!block) {
    const blockBump = await findBlockCompleteBump(supabase, user.id);
    return (
      <div style={{ display: "grid", gap: 20 }}>
        <header>
          <h1 style={{ fontSize: 28, margin: 0, letterSpacing: "-0.01em" }}>Plan</h1>
          <p style={{ margin: "6px 0 0", color: "var(--cp-text-muted)", fontSize: 14 }}>
            No active block. Start one to get a forward-looking calendar with prescribed sets per session.
          </p>
        </header>
        {blockBump && <BlockCompleteCard bump={blockBump} />}
        <section className="cp-card" style={{ padding: 24, display: "grid", gap: 12, justifyItems: "start" }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>Start your first block</h2>
          <p style={{ margin: 0, color: "var(--cp-text-muted)", fontSize: 13 }}>
            The planner picks the days, weights, and weekly intensity wave. You log what actually happens.
          </p>
          <Link href="/app/plan/new" className="cp-btn primary">
            Start a block
          </Link>
          <Link
            href="/app/plan/history"
            style={{ fontSize: 12, color: "var(--cp-text-muted)", textDecoration: "none" }}
          >
            View history →
          </Link>
        </section>
      </div>
    );
  }

  const archetype = ARCHETYPES[block.archetype as keyof typeof ARCHETYPES];
  const isCustom = block.archetype === "custom";
  const archetypeName = isCustom
    ? block.notes?.trim() || "Custom block"
    : archetype?.name ?? block.archetype;
  const archetypeKicker = isCustom ? "Custom · " : "";
  const all = await getPlannedDays(block.id, block.startedOn);

  const { data: profile } = await supabase
    .from("profiles")
    .select("timezone, am_window_start, pm_window_start")
    .eq("id", user.id)
    .maybeSingle();
  const timezone = profile?.timezone ?? "UTC";
  const amWindowStart = profile?.am_window_start ?? "07:00:00";
  const pmWindowStart = profile?.pm_window_start ?? "17:00:00";

  const sp = await searchParams;
  const today = todayYmd(timezone);
  const todayWeek = all.find((d) => d.date === today)?.weekIndex;
  const initialWeek =
    sp?.week != null && !Number.isNaN(Number(sp.week))
      ? Math.max(0, Math.min(block.weeks - 1, Number(sp.week)))
      : todayWeek ?? 0;

  const weekDays = all.filter((d) => d.weekIndex === initialWeek);
  const cells = Array.from({ length: 7 }, (_, dayIndex) => {
    const plans = weekDays
      .filter((d) => d.dayIndex === dayIndex)
      .sort((a, b) => slotOrder(a.slot) - slotOrder(b.slot));
    return { dayIndex, plans };
  });

  const totalPlanned = all.length;
  const completed = all.filter((d) => d.completedSessionId).length;
  const skipped = all.filter((d) => d.skippedAt).length;

  const tissueGaps = await getCurrentWeekTissueStackGaps(supabase, user.id);

  return (
    <div style={{ display: "grid", gap: 18 }}>
      <header>
        <div style={{ fontSize: 12, color: "var(--cp-text-muted)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
          {archetypeKicker}{archetypeName} · started {new Date(block.startedOn).toLocaleDateString()}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
          <h1 style={{ fontSize: 28, margin: "4px 0 0", letterSpacing: "-0.01em" }}>Plan</h1>
          <span className="mono" style={{ fontSize: 12, color: "var(--cp-text-muted)" }}>
            {completed}/{totalPlanned} done · {skipped} skipped
          </span>
        </div>
        <div style={{ marginTop: 6 }}>
          <Link
            href="/app/plan/history"
            style={{ fontSize: 12, color: "var(--cp-text-muted)", textDecoration: "none" }}
          >
            View history →
          </Link>
        </div>
      </header>

      {tissueGaps.length > 0 && <TissueStackCard gaps={tissueGaps} />}

      <BlockCalendar
        all={all}
        weeks={block.weeks}
        currentWeek={initialWeek}
        today={today}
      />

      <nav style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }} aria-label="Block weeks">
        <Link
          href={`/app/plan?week=${Math.max(0, initialWeek - 1)}`}
          className="cp-btn"
          style={{ pointerEvents: initialWeek === 0 ? "none" : undefined, opacity: initialWeek === 0 ? 0.4 : 1 }}
          aria-disabled={initialWeek === 0}
        >
          ← prev
        </Link>
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap", justifyContent: "center" }}>
          {Array.from({ length: block.weeks }, (_, i) => (
            <Link
              key={i}
              href={`/app/plan?week=${i}`}
              style={{
                padding: "6px 12px",
                borderRadius: 999,
                fontSize: 12,
                fontWeight: i === initialWeek ? 700 : 500,
                background: i === initialWeek ? "var(--cp-accent-soft)" : "transparent",
                color: i === initialWeek ? "var(--cp-accent)" : "var(--cp-text-muted)",
                border: `1px solid ${i === initialWeek ? "var(--cp-accent)" : "var(--cp-border)"}`,
                textDecoration: "none",
              }}
            >
              Week {i + 1}
              {archetype?.weekProfiles[i]?.intensityLabel === "Deload" && (
                <span style={{ fontSize: 9, marginLeft: 4, opacity: 0.7 }}>· deload</span>
              )}
            </Link>
          ))}
        </div>
        <Link
          href={`/app/plan?week=${Math.min(block.weeks - 1, initialWeek + 1)}`}
          className="cp-btn"
          style={{ pointerEvents: initialWeek === block.weeks - 1 ? "none" : undefined, opacity: initialWeek === block.weeks - 1 ? 0.4 : 1 }}
          aria-disabled={initialWeek === block.weeks - 1}
        >
          next →
        </Link>
      </nav>

      <section style={{ display: "grid", gap: 10 }}>
        {cells.map(({ dayIndex, plans }) => (
          <DayCard
            key={dayIndex}
            dayName={DOW[dayIndex]!}
            plans={plans}
            today={today}
            timezone={timezone}
            amWindowStart={amWindowStart}
            pmWindowStart={pmWindowStart}
          />
        ))}
      </section>

      <section className="cp-card" style={{ padding: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 500 }}>Done with this block?</div>
            <div style={{ fontSize: 11, color: "var(--cp-text-muted)" }}>
              Archives the schedule. You keep all logged sessions.
            </div>
          </div>
          <form action={endBlock}>
            <input type="hidden" name="id" value={block.id} />
            <button
              type="submit"
              className="cp-btn danger"
              data-testid="end-block-button"
            >
              End block
            </button>
          </form>
        </div>
      </section>
    </div>
  );
}

type PlannedCell = {
  id: string;
  date: string;
  slot: "am" | "pm" | "single";
  plannedAt: string | null;
  title: string;
  role: string;
  prescription: Prescription;
  completedSessionId: string | null;
  skippedAt: string | null;
};

function slotOrder(s: "am" | "pm" | "single"): number {
  if (s === "am") return 0;
  if (s === "single") return 1;
  return 2;
}

function DayCard({
  dayName,
  plans,
  today,
  timezone,
  amWindowStart,
  pmWindowStart,
}: {
  dayName: string;
  plans: PlannedCell[];
  today: string;
  timezone: string;
  amWindowStart: string;
  pmWindowStart: string;
}) {
  if (plans.length === 0) {
    return (
      <div
        style={{
          padding: "12px 16px",
          border: "1px dashed var(--cp-border)",
          borderRadius: 12,
          color: "var(--cp-text-muted)",
          fontSize: 13,
          display: "flex",
          justifyContent: "space-between",
        }}
      >
        <span>{dayName}</span>
        <span>rest</span>
      </div>
    );
  }

  const dateStr = plans[0]!.date;
  const isToday = dateStr === today;
  const isPast = dateStr < today;
  const isTwoADay = plans.length > 1;

  // Compute the effective time-of-day per slot.
  const slotTimes = new Map<string, string>();
  for (const p of plans) {
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
    <div
      style={{
        display: "grid",
        gap: 8,
        padding: isToday ? 4 : 0,
        borderRadius: 14,
        background: isToday ? "color-mix(in oklab, var(--cp-accent) 6%, transparent)" : undefined,
        border: isToday ? "1px solid var(--cp-accent)" : undefined,
      }}
    >
      {isTwoADay && (
        <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 14px 0", alignItems: "baseline", gap: 8 }}>
          <div style={{ fontSize: 11, color: "var(--cp-text-muted)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
            {dayName} · {new Date(dateStr + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" })}
            {isToday && <span style={{ color: "var(--cp-accent)", marginLeft: 6 }}>· today</span>}
          </div>
          <span className="cp-pill" style={{ color: "var(--cp-accent)", borderColor: "var(--cp-accent)" }}>
            two-a-day{gapH != null ? ` · ${gapH.toFixed(0)}h gap` : ""}
          </span>
        </div>
      )}
      {isTwoADay && (
        <div
          role="note"
          style={{
            margin: "0 14px",
            padding: "8px 10px",
            border: "1px solid var(--cp-border)",
            borderRadius: 8,
            background: "var(--cp-surface-soft)",
            fontSize: 11,
            color: "var(--cp-text-muted)",
            lineHeight: 1.4,
          }}
          title="Robineau 2016 (HIGH) — recovery between concurrent sessions"
        >
          {gapShort ? (
            <strong style={{ color: "var(--cp-text)" }}>
              Sessions are {gapH!.toFixed(1)}h apart
            </strong>
          ) : (
            <strong style={{ color: "var(--cp-text)" }}>≥6 hours between sessions</strong>
          )}{" "}
          {gapShort
            ? "— research suggests ≥6h between AM lift and PM cardio so the strength signal isn't blunted by AMPK from the cardio."
            : "protects the strength signal — AMPK activation from cardio inhibits mTORC1 within shorter windows."}
          <span style={{ display: "block", marginTop: 2, fontStyle: "italic" }}>
            Robineau 2016.
          </span>
        </div>
      )}
      {plans.map((planned) => (
        <DaySessionCard
          key={planned.id}
          dayName={dayName}
          planned={planned}
          isToday={isToday}
          isPast={isPast}
          showHeader={!isTwoADay}
          isTwoADay={isTwoADay}
          timeOfDay={slotTimes.get(planned.slot) ?? null}
          isCustomTime={!!planned.plannedAt}
        />
      ))}
    </div>
  );
}

function DaySessionCard({
  dayName,
  planned,
  isToday,
  isPast,
  showHeader,
  isTwoADay,
  timeOfDay,
  isCustomTime,
}: {
  dayName: string;
  planned: PlannedCell;
  isToday: boolean;
  isPast: boolean;
  showHeader: boolean;
  isTwoADay: boolean;
  timeOfDay: string | null;
  isCustomTime: boolean;
}) {
  const done = !!planned.completedSessionId;
  const skipped = !!planned.skippedAt;
  const slotLabel = planned.slot === "am" ? "AM" : planned.slot === "pm" ? "PM" : null;

  return (
    <div
      className="cp-card"
      style={{
        padding: 16,
        borderColor: isToday && !isTwoADay ? "var(--cp-accent)" : undefined,
        background: isToday && !isTwoADay ? "var(--cp-accent-soft)" : undefined,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
        <div>
          {showHeader && (
            <div style={{ fontSize: 11, color: "var(--cp-text-muted)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
              {dayName} · {new Date(planned.date + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" })}
              {isToday && <span style={{ color: "var(--cp-accent)", marginLeft: 6 }}>· today</span>}
            </div>
          )}
          <div style={{ fontSize: 16, fontWeight: 600, marginTop: showHeader ? 2 : 0 }}>
            {slotLabel && (
              <span
                className="mono"
                style={{
                  fontSize: 10,
                  color: "var(--cp-accent)",
                  fontWeight: 700,
                  marginRight: 8,
                  letterSpacing: "0.08em",
                }}
              >
                {slotLabel}
              </span>
            )}
            {planned.title}
            {timeOfDay && (
              <span
                className="mono"
                style={{
                  fontSize: 11,
                  color: "var(--cp-text-muted)",
                  fontWeight: 500,
                  marginLeft: 8,
                }}
                title={isCustomTime ? "Custom time" : "Default from your AM/PM window"}
              >
                {timeOfDay}
              </span>
            )}
          </div>
          <div style={{ fontSize: 12, color: "var(--cp-text-muted)", marginTop: 4 }}>
            {summarisePrescription(planned.prescription.items)}
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-end" }}>
          {done && <span className="cp-pill" style={{ color: "var(--cp-success)", borderColor: "var(--cp-success)" }}>✓ done</span>}
          {skipped && <span className="cp-pill" style={{ color: "var(--cp-warning)", borderColor: "var(--cp-warning)" }}>skipped</span>}
          {!done && !skipped && isPast && <span className="cp-pill" style={{ color: "var(--cp-text-muted)" }}>missed</span>}
        </div>
      </div>

      {planned.prescription.items.length > 0 && (
        <ul style={{ listStyle: "none", padding: 0, margin: "10px 0 0", display: "grid", gap: 4 }}>
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
              <span className="mono" style={{ fontWeight: 600 }}>
                {formatPrescriptionItem(item)}
              </span>
            </li>
          ))}
        </ul>
      )}

      {!done && !skipped && isTwoADay && planned.slot !== "single" && (
        <form
          action={setPlannedTime}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            marginTop: 10,
            fontSize: 11,
            color: "var(--cp-text-muted)",
          }}
        >
          <input type="hidden" name="id" value={planned.id} />
          <label htmlFor={`time-${planned.id}`} style={{ flexShrink: 0 }}>
            {planned.slot === "am" ? "AM time" : "PM time"}
          </label>
          <input
            id={`time-${planned.id}`}
            type="time"
            name="hhmm"
            defaultValue={timeOfDay ?? ""}
            step={300}
            className="mono"
            style={{
              padding: "4px 8px",
              fontSize: 12,
              border: "1px solid var(--cp-border)",
              borderRadius: 6,
              background: "var(--cp-surface)",
              color: "var(--cp-text)",
              width: 100,
            }}
          />
          <button
            type="submit"
            className="cp-btn ghost"
            style={{ fontSize: 11, padding: "4px 10px" }}
          >
            Save
          </button>
          {isCustomTime && (
            <span style={{ fontStyle: "italic", marginLeft: 4 }}>· overrides default window</span>
          )}
        </form>
      )}

      {!done && !skipped && (
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <Link
            href={`/app/sessions/start/${planned.id}`}
            className="cp-btn primary"
            style={{ flex: 1, textAlign: "center" }}
            data-testid={`start-${planned.id}`}
          >
            {isToday ? "⚡ Start now" : "Start session"}
          </Link>
          <form action={skipPlannedSession}>
            <input type="hidden" name="id" value={planned.id} />
            <button
              type="submit"
              className="cp-btn ghost"
              data-testid={`skip-${planned.id}`}
            >
              Skip
            </button>
          </form>
        </div>
      )}

      {done && planned.completedSessionId && (
        <div style={{ marginTop: 12 }}>
          <Link href={`/app/sessions/${planned.completedSessionId}`} className="cp-btn" style={{ width: "100%" }}>
            View logged session →
          </Link>
        </div>
      )}

      {skipped && (
        <div style={{ marginTop: 12 }}>
          <form action={unskipPlannedSession}>
            <input type="hidden" name="id" value={planned.id} />
            <button type="submit" className="cp-btn ghost" style={{ width: "100%" }}>
              Un-skip
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

function BlockCompleteCard({
  bump,
}: {
  bump: Awaited<ReturnType<typeof findBlockCompleteBump>>;
}) {
  if (!bump) return null;
  return (
    <section
      className="cp-card"
      style={{
        padding: 20,
        display: "grid",
        gap: 12,
        borderColor: "var(--cp-success)",
        background: "color-mix(in oklab, var(--cp-success) 6%, transparent)",
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
        <div style={{ fontSize: 22, lineHeight: 1 }} aria-hidden="true">✓</div>
        <div style={{ display: "grid", gap: 4, flex: 1 }}>
          <div style={{ fontSize: 11, color: "var(--cp-success)", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600 }}>
            Last block ended clean
          </div>
          <h2 style={{ fontSize: 18, margin: 0, letterSpacing: "-0.01em" }}>
            Bump your TMs before the next block?
          </h2>
          <p style={{ margin: 0, color: "var(--cp-text-muted)", fontSize: 13, lineHeight: 1.5 }}>
            Standard small-progression defaults: <strong>+5 kg</strong> on squat / deadlift,{" "}
            <strong>+2.5 kg</strong> on bench / overhead. Accept any subset; the rest stay where
            they are.
          </p>
        </div>
      </div>
      <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 8 }}>
        {bump.lifts.map((lift) => (
          <li
            key={lift.movementId}
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "10px 12px",
              background: "var(--cp-surface)",
              border: "1px solid var(--cp-border)",
              borderRadius: 10,
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <div style={{ display: "grid", gap: 2, flex: 1, minWidth: 180 }}>
              <span style={{ fontSize: 14, fontWeight: 500 }}>{lift.movementDisplayName}</span>
              <span style={{ fontSize: 11, color: "var(--cp-text-muted)" }}>
                <span className="mono">{lift.currentTm.toFixed(1)} kg</span>{" "}
                →{" "}
                <span className="mono" style={{ color: "var(--cp-success)" }}>
                  {lift.proposedTm.toFixed(1)} kg
                </span>{" "}
                <span style={{ marginLeft: 4 }}>(+{lift.increment} kg)</span>
              </span>
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <form action={acceptTmBump}>
                <input type="hidden" name="movementId" value={lift.movementId} />
                <input type="hidden" name="newTmKg" value={String(lift.proposedTm)} />
                <input type="hidden" name="reason" value="block_complete" />
                <input type="hidden" name="triggerKey" value={lift.triggerKey} />
                <button type="submit" className="cp-btn primary" style={{ fontSize: 12 }}>
                  Accept
                </button>
              </form>
              <form action={declineTmBump}>
                <input type="hidden" name="movementId" value={lift.movementId} />
                <input type="hidden" name="triggerKey" value={lift.triggerKey} />
                <button type="submit" className="cp-btn ghost" style={{ fontSize: 12 }}>
                  Skip
                </button>
              </form>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function BlockCalendar({
  all,
  weeks,
  currentWeek,
  today,
}: {
  all: { weekIndex: number; dayIndex: number; date: string; completedSessionId: string | null; skippedAt: string | null }[];
  weeks: number;
  currentWeek: number;
  today: string;
}) {
  // Index by (week, day) for O(1) lookup.
  const byCell = new Map<string, { hasPlan: boolean; completed: boolean; skipped: boolean; date: string }>();
  for (const d of all) {
    const k = `${d.weekIndex}:${d.dayIndex}`;
    const prev = byCell.get(k) ?? { hasPlan: false, completed: false, skipped: false, date: d.date };
    byCell.set(k, {
      hasPlan: true,
      completed: prev.completed || !!d.completedSessionId,
      skipped: prev.skipped || !!d.skippedAt,
      date: d.date,
    });
  }
  return (
    <section className="cp-card" style={{ padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10, gap: 8 }}>
        <h2 style={{ margin: 0, fontSize: 14 }}>Block overview</h2>
        <div style={{ display: "flex", gap: 10, fontSize: 10, color: "var(--cp-text-muted)", flexWrap: "wrap" }}>
          <Legend color="var(--cp-success)" label="Done" />
          <Legend color="var(--cp-text-muted)" label="Skipped" />
          <Legend color="var(--cp-accent)" label="Planned" />
          <Legend color="var(--cp-surface-soft)" label="Rest" />
        </div>
      </div>
      <div
        role="grid"
        aria-label="Block calendar"
        style={{
          display: "grid",
          gridTemplateColumns: `40px repeat(7, 1fr)`,
          gap: 4,
        }}
      >
        <div />
        {DOW.map((d) => (
          <div key={d} style={{ fontSize: 10, color: "var(--cp-text-muted)", textAlign: "center", fontWeight: 600 }}>
            {d[0]}
          </div>
        ))}
        {Array.from({ length: weeks }, (_, w) => (
          <CalendarWeekRow
            key={w}
            weekIndex={w}
            isCurrent={w === currentWeek}
            byCell={byCell}
            today={today}
          />
        ))}
      </div>
    </section>
  );
}

function CalendarWeekRow({
  weekIndex,
  isCurrent,
  byCell,
  today,
}: {
  weekIndex: number;
  isCurrent: boolean;
  byCell: Map<string, { hasPlan: boolean; completed: boolean; skipped: boolean; date: string }>;
  today: string;
}) {
  return (
    <>
      <Link
        href={`/app/plan?week=${weekIndex}`}
        style={{
          fontSize: 10,
          color: isCurrent ? "var(--cp-accent)" : "var(--cp-text-muted)",
          fontWeight: isCurrent ? 700 : 500,
          textDecoration: "none",
          alignSelf: "center",
        }}
      >
        Wk{weekIndex + 1}
      </Link>
      {Array.from({ length: 7 }, (_, dayIndex) => {
        const cell = byCell.get(`${weekIndex}:${dayIndex}`);
        const isToday = cell?.date === today;
        const bg = !cell
          ? "var(--cp-surface-soft)"
          : cell.completed
            ? "var(--cp-success)"
            : cell.skipped
              ? "var(--cp-text-muted)"
              : "var(--cp-accent-soft)";
        return (
          <div
            key={dayIndex}
            title={cell ? `Wk${weekIndex + 1} ${DOW[dayIndex]} (${cell.date})` : `Wk${weekIndex + 1} ${DOW[dayIndex]} — rest`}
            style={{
              height: 18,
              borderRadius: 4,
              background: bg,
              border: isToday ? "1.5px solid var(--cp-accent)" : "1px solid transparent",
              opacity: cell?.completed ? 1 : cell?.skipped ? 0.5 : 1,
            }}
          />
        );
      })}
    </>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
      <span aria-hidden style={{ width: 10, height: 10, borderRadius: 3, background: color }} />
      <span>{label}</span>
    </span>
  );
}

function TissueStackCard({ gaps }: { gaps: TissueStackGap[] }) {
  return (
    <section
      className="cp-card"
      role="alert"
      style={{
        padding: "14px 18px",
        display: "grid",
        gap: 6,
        borderColor: "var(--cp-warning)",
        background: "color-mix(in oklab, var(--cp-warning) 6%, transparent)",
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
        <div style={{ fontSize: 11, color: "var(--cp-warning)", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600 }}>
          Tissue-stack deficit
        </div>
        <span style={{ fontSize: 10, color: "var(--cp-text-muted)" }} title="Baar 2017 HIGH; Magnusson & Kjaer 2019 HIGH">
          DC-O4
        </span>
      </div>
      <div style={{ fontSize: 13, color: "var(--cp-text)" }}>
        This week is missing tendon / connective-tissue work the research
        treats as a floor, not optional:
      </div>
      <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: "var(--cp-text-muted)" }}>
        {gaps.map((g) => (
          <li key={g.role}>
            <strong style={{ color: "var(--cp-text)" }}>{g.label}</strong>
            {" "}— logged {g.actual}/{g.required} this week
          </li>
        ))}
      </ul>
    </section>
  );
}
