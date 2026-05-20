import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  endBlock,
  skipPlannedSession,
  startSessionFromPlan,
  unskipPlannedSession,
} from "@/lib/planner/actions";
import { ARCHETYPES, formatPrescriptionItem, summarisePrescription } from "@/lib/planner/archetypes";
import { getActiveBlock, getPlannedDays, todayYmd } from "@/lib/planner/queries";
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
    return (
      <div style={{ display: "grid", gap: 20 }}>
        <header>
          <h1 style={{ fontSize: 28, margin: 0, letterSpacing: "-0.01em" }}>Plan</h1>
          <p style={{ margin: "6px 0 0", color: "var(--cp-text-muted)", fontSize: 14 }}>
            No active block. Start one to get a forward-looking calendar with prescribed sets per session.
          </p>
        </header>
        <section className="cp-card" style={{ padding: 24, display: "grid", gap: 12, justifyItems: "start" }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>Start your first block</h2>
          <p style={{ margin: 0, color: "var(--cp-text-muted)", fontSize: 13 }}>
            The planner picks the days, weights, and weekly intensity wave. You log what actually happens.
          </p>
          <Link href="/app/plan/new" className="cp-btn primary">
            Start a block
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

  const sp = await searchParams;
  const today = todayYmd();
  const todayWeek = all.find((d) => d.date === today)?.weekIndex;
  const initialWeek =
    sp?.week != null && !Number.isNaN(Number(sp.week))
      ? Math.max(0, Math.min(block.weeks - 1, Number(sp.week)))
      : todayWeek ?? 0;

  const weekDays = all.filter((d) => d.weekIndex === initialWeek);
  const cells = Array.from({ length: 7 }, (_, dayIndex) => {
    const planned = weekDays.find((d) => d.dayIndex === dayIndex);
    return { dayIndex, planned };
  });

  const totalPlanned = all.length;
  const completed = all.filter((d) => d.completedSessionId).length;
  const skipped = all.filter((d) => d.skippedAt).length;

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
      </header>

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
        {cells.map(({ dayIndex, planned }) => (
          <DayCard key={dayIndex} dayName={DOW[dayIndex]!} planned={planned} />
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
            <button type="submit" className="cp-btn danger">End block</button>
          </form>
        </div>
      </section>
    </div>
  );
}

type PlannedCell = {
  id: string;
  date: string;
  title: string;
  role: string;
  prescription: Prescription;
  completedSessionId: string | null;
  skippedAt: string | null;
};

function DayCard({ dayName, planned }: { dayName: string; planned?: PlannedCell }) {
  const today = todayYmd();
  if (!planned) {
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

  const isToday = planned.date === today;
  const isPast = planned.date < today;
  const done = !!planned.completedSessionId;
  const skipped = !!planned.skippedAt;

  return (
    <div
      className="cp-card"
      style={{
        padding: 16,
        borderColor: isToday ? "var(--cp-accent)" : undefined,
        background: isToday ? "var(--cp-accent-soft)" : undefined,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
        <div>
          <div style={{ fontSize: 11, color: "var(--cp-text-muted)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
            {dayName} · {new Date(planned.date + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" })}
            {isToday && <span style={{ color: "var(--cp-accent)", marginLeft: 6 }}>· today</span>}
          </div>
          <div style={{ fontSize: 16, fontWeight: 600, marginTop: 2 }}>{planned.title}</div>
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

      {!done && !skipped && (
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <form action={startSessionFromPlan} style={{ flex: 1 }}>
            <input type="hidden" name="id" value={planned.id} />
            <button type="submit" className="cp-btn primary" style={{ width: "100%" }}>
              {isToday ? "⚡ Start now" : "Start session"}
            </button>
          </form>
          <form action={skipPlannedSession}>
            <input type="hidden" name="id" value={planned.id} />
            <button type="submit" className="cp-btn ghost">Skip</button>
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
