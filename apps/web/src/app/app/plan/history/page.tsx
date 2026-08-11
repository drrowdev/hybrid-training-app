/**
 * /app/plan/history — read-only browse of past + present blocks.
 *
 * Lists the current user's training blocks (active + completed +
 * archived), most recent first, paginated 20-per-page. Each row
 * expands inline to show that block's planned_sessions grouped by
 * week + day; logged sessions link to the session detail page.
 *
 * Pagination is offset-based via `?page=N` (1-indexed). Server
 * component — no client JS for the list itself; expansion is a
 * native `<details>` for zero-JS mobile friendliness.
 */
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import {
  getAllBlocksWithCompletionStats,
  type BlockWithCompletionStats,
} from "@/lib/planner/queries";
import { DeleteBlockMenu } from "@/components/trash/DeleteBlockMenu";
import { StatusBadge } from "@/components/blocks/StatusBadge";
import { PageHeader } from "@/components/ui/PageHeader";
import { groupBlocksByMonth } from "@/lib/plan/history-grouping";
import { resolveLinkedSession } from "@/lib/sessions/linked-session-state";
import {
  hasTwoADaySlotPair,
  type PlannedSlot,
} from "@/lib/planner/slot";

const PAGE_SIZE = 20;
const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

type PlannedRow = {
  id: string;
  week_index: number;
  day_index: number;
  slot: PlannedSlot | null;
  title: string;
  completed_session_id: string | null;
  skipped_at: string | null;
};

export default async function PlanHistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const params = await searchParams;
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  const offset = (page - 1) * PAGE_SIZE;

  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) redirect("/login");

  const blocks = await getAllBlocksWithCompletionStats({
    limit: PAGE_SIZE + 1,
    offset,
  });
  const hasNext = blocks.length > PAGE_SIZE;
  const pageBlocks = blocks.slice(0, PAGE_SIZE);

  // Pull all planned_sessions for the visible blocks in a single round
  // trip. Cheaper than N+1 expand-on-click + plays nicely with the
  // native <details> markup below.
  const blockIds = pageBlocks.map((b) => b.id);
  const sessionsByBlock = new Map<string, PlannedRow[]>();
  const customizedBlockIds = new Set<string>();
  if (blockIds.length > 0) {
    const [{ data: planned }, { data: instances }] = await Promise.all([
      supabase
        .from("planned_sessions")
        .select("id, block_id, week_index, day_index, slot, title, completed_session_id, skipped_at, sessions(deleted_at)")
        .in("block_id", blockIds)
        .order("week_index", { ascending: true })
        .order("day_index", { ascending: true })
        .order("slot", { ascending: true }),
      supabase
        .from("program_instances")
        .select("block_id, customization_version")
        .in("block_id", blockIds)
        .not("customization_version", "is", null),
    ]);
    for (const instance of instances ?? []) {
      if (instance.block_id) customizedBlockIds.add(instance.block_id as string);
    }
    for (const row of planned ?? []) {
      const blockId = (row as { block_id: string }).block_id;
      const list = sessionsByBlock.get(blockId) ?? [];
      const session = Array.isArray(row.sessions)
        ? row.sessions[0]
        : row.sessions;
      const linked = resolveLinkedSession(
        row.completed_session_id,
        session && row.completed_session_id
          ? {
              id: row.completed_session_id,
              completedAt: null,
              deletedAt: session.deleted_at,
            }
          : null,
      );
      list.push({
        id: row.id,
        week_index: row.week_index,
        day_index: row.day_index,
        slot: row.slot ?? null,
        title: row.title,
        completed_session_id: linked.completedSessionId,
        skipped_at: row.skipped_at,
      });
      sessionsByBlock.set(blockId, list);
    }
  }

  return (
    <div style={{ display: "grid", gap: 20 }}>
      <PageHeader
        back={{ href: "/app/plan", label: "Plan" }}
        title="Program history"
        subtitle="Every program you've run — most recent first. Expand a row to see the planned sessions and jump into anything you logged."
      />

      {pageBlocks.length === 0 ? (
        <section
          className="cp-card"
          style={{ padding: 24, display: "grid", gap: 10, justifyItems: "start" }}
        >
          <h2 style={{ margin: 0, fontSize: 16 }}>No programs yet</h2>
          <p style={{ margin: 0, color: "var(--cp-text-muted)", fontSize: 13 }}>
            Once you start your first program, it&apos;ll show up here with a per-session completion
            ratio.
          </p>
          <Link href="/app/plan/new" className="cp-btn primary">
            Start your first program →
          </Link>
        </section>
      ) : (
        <div
          data-testid="plan-history-list"
          style={{ display: "grid", gap: 14 }}
        >
          {groupBlocksByMonth(pageBlocks).map((group) => (
            <section key={group.key} data-testid="plan-history-month-group" data-month={group.key}>
              <h2
                data-testid="plan-history-month-header"
                style={{
                  position: "sticky",
                  top: 0,
                  zIndex: 1,
                  margin: 0,
                  padding: "8px 4px",
                  fontSize: 12,
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                  color: "var(--cp-text-muted)",
                  background: "var(--cp-bg)",
                  borderBottom: "1px solid var(--cp-border)",
                }}
              >
                {group.label}
              </h2>
              <ul style={{ listStyle: "none", padding: 0, margin: "8px 0 0", display: "grid", gap: 10 }}>
                {group.blocks.map((b) => (
                  <BlockHistoryRow
                    key={b.id}
                    block={b}
                    sessions={sessionsByBlock.get(b.id) ?? []}
                    customized={customizedBlockIds.has(b.id)}
                  />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      <Pagination page={page} hasNext={hasNext} />
    </div>
  );
}

function BlockHistoryRow({
  block,
  sessions,
  customized,
}: {
  block: BlockWithCompletionStats;
  sessions: PlannedRow[];
  customized: boolean;
}): React.ReactElement {
  const ratio =
    block.totalSessions > 0
      ? `${block.loggedSessions} of ${block.totalSessions} sessions logged`
      : "No planned sessions";
  const skipBlurb =
    block.skippedSessions > 0 ? ` · ${block.skippedSessions} skipped` : "";

  // Group by week for the expanded view. `weeks` from the block row
  // gives the canonical count even if some weeks have zero sessions.
  // Also collect slots per (week, day) so the AM/PM slot label only
  // renders when a calendar day genuinely pairs AM + PM
  // (Stage C/D in feat/slot-semantics).
  const byWeek = new Map<number, PlannedRow[]>();
  const daySlots = new Map<string, PlannedSlot[]>();
  for (const s of sessions) {
    const list = byWeek.get(s.week_index) ?? [];
    list.push(s);
    byWeek.set(s.week_index, list);
    const key = `${s.week_index}-${s.day_index}`;
    daySlots.set(key, [
      ...(daySlots.get(key) ?? []),
      s.slot ?? "single",
    ]);
  }
  const weekIndices = Array.from(byWeek.keys()).sort((a, b) => a - b);

  return (
    <li>
      <details
        data-testid="block-history-row"
        data-block-id={block.id}
        data-archetype={block.archetype}
        style={{
          background: "var(--cp-surface)",
          border: "1px solid var(--cp-border)",
          borderRadius: 12,
          overflow: "hidden",
        }}
      >
        <summary style={summaryStyle}>
          <div style={summaryHeadStyle}>
            <span style={{ fontWeight: 600, fontSize: 14 }}>{block.archetypeName}</span>
            {customized ? (
              <span
                data-testid="customized-program-badge"
                style={{
                  border: "1px solid var(--cp-accent)",
                  borderRadius: 999,
                  padding: "2px 7px",
                  color: "var(--cp-accent)",
                  fontSize: 9,
                  fontWeight: 700,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                }}
              >
                Customized
              </span>
            ) : null}
            <StatusBadge status={block.status} />
            <span style={{ marginLeft: "auto" }}>
              <DeleteBlockMenu blockId={block.id} archetypeName={block.archetypeName} />
            </span>
          </div>
          <div style={summaryMetaStyle}>
            <span>
              {block.daysPerWeek != null
                ? `${block.daysPerWeek} d/wk`
                : "Unknown frequency"}{" "}
              · {block.weeks}w · started {block.startedOn}
              {block.endedOn ? ` · ended ${block.endedOn.slice(0, 10)}` : ""}
            </span>
            <span style={{ fontSize: 12, color: "var(--cp-text-muted)" }}>
              {ratio}
              {skipBlurb}
            </span>
          </div>
        </summary>

        {sessions.length === 0 ? (
          <div style={{ padding: "12px 18px", fontSize: 13, color: "var(--cp-text-muted)" }}>
            No planned sessions recorded for this program.
          </div>
        ) : (
          <div data-testid="block-history-sessions" style={{ padding: "4px 0 12px" }}>
            {weekIndices.map((w) => (
              <WeekGroup
                key={w}
                weekIndex={w}
                sessions={byWeek.get(w) ?? []}
                daySlots={daySlots}
              />
            ))}
          </div>
        )}
      </details>
    </li>
  );
}

function WeekGroup({
  weekIndex,
  sessions,
  daySlots,
}: {
  weekIndex: number;
  sessions: PlannedRow[];
  daySlots: Map<string, PlannedSlot[]>;
}): React.ReactElement {
  return (
    <div style={{ padding: "8px 18px", borderTop: "1px solid var(--cp-border)" }}>
      <div
        style={{
          fontSize: 11,
          color: "var(--cp-text-muted)",
          textTransform: "uppercase",
          letterSpacing: "0.04em",
          fontWeight: 600,
          marginBottom: 6,
        }}
      >
        Week {weekIndex + 1}
      </div>
      <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 4 }}>
        {sessions.map((s) => {
          const isTwoADay = hasTwoADaySlotPair(
            daySlots.get(`${s.week_index}-${s.day_index}`) ?? [],
          );
          return <SessionRow key={s.id} session={s} isTwoADay={isTwoADay} />;
        })}
      </ul>
    </div>
  );
}

function SessionRow({
  session,
  isTwoADay,
}: {
  session: PlannedRow;
  isTwoADay: boolean;
}): React.ReactElement {
  const dayLabel = DAY_LABELS[session.day_index] ?? `D${session.day_index}`;
  // Only surface the AM/PM badge when the day actually pairs two
  // sessions. See Stage C in feat/slot-semantics.
  const slotLabel = isTwoADay
    ? session.slot === "am"
      ? "AM"
      : session.slot === "pm"
        ? "PM"
        : null
    : null;
  const status: "logged" | "skipped" | "pending" = session.completed_session_id
    ? "logged"
    : session.skipped_at
      ? "skipped"
      : "pending";

  const inner = (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 10,
        padding: "8px 10px",
        borderRadius: 8,
        background:
          status === "logged"
            ? "color-mix(in oklab, var(--cp-accent) 8%, transparent)"
            : "transparent",
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, minWidth: 0 }}>
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: "var(--cp-text-muted)",
            minWidth: 50,
          }}
        >
          {dayLabel}
          {slotLabel ? ` ${slotLabel}` : ""}
        </span>
        <span
          style={{
            fontSize: 13,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {session.title}
        </span>
      </div>
      <SessionStatusChip status={status} />
    </div>
  );

  if (status === "logged" && session.completed_session_id) {
    return (
      <li>
        <Link
          href={`/app/sessions/${session.completed_session_id}`}
          data-testid="block-history-session-link"
          style={{ color: "inherit", textDecoration: "none", display: "block" }}
        >
          {inner}
        </Link>
      </li>
    );
  }
  return <li>{inner}</li>;
}

function SessionStatusChip({
  status,
}: {
  status: "logged" | "skipped" | "pending";
}): React.ReactElement {
  if (status === "logged") {
    return (
      <span
        data-testid="session-status-icon"
        data-status="logged"
        aria-label="logged"
        style={{
          fontSize: 14,
          fontWeight: 700,
          color: "var(--cp-success)",
          minWidth: 14,
          textAlign: "center",
        }}
      >
        ✓
      </span>
    );
  }
  if (status === "skipped") {
    return (
      <span
        data-testid="session-status-icon"
        data-status="skipped"
        aria-label="skipped"
        style={{
          fontSize: 14,
          fontWeight: 700,
          color: "var(--cp-text-muted)",
          minWidth: 14,
          textAlign: "center",
        }}
      >
        ✗
      </span>
    );
  }
  return (
    <span
      data-testid="session-status-icon"
      data-status="pending"
      aria-label="not logged"
      style={{
        fontSize: 14,
        fontWeight: 700,
        color: "var(--cp-text-muted)",
        minWidth: 14,
        textAlign: "center",
      }}
    >
      —
    </span>
  );
}

function Pagination({
  page,
  hasNext,
}: {
  page: number;
  hasNext: boolean;
}): React.ReactElement | null {
  if (page === 1 && !hasNext) return null;
  return (
    <nav
      aria-label="Program history pagination"
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: 10,
        marginTop: 4,
      }}
    >
      {page > 1 ? (
        <Link href={`/app/plan/history?page=${page - 1}`} className="cp-btn">
          ← Newer
        </Link>
      ) : (
        <span />
      )}
      <span style={{ fontSize: 12, color: "var(--cp-text-muted)" }}>Page {page}</span>
      {hasNext ? (
        <Link href={`/app/plan/history?page=${page + 1}`} className="cp-btn">
          Older →
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}

const summaryStyle: React.CSSProperties = {
  display: "grid",
  gap: 4,
  padding: "14px 18px",
  cursor: "pointer",
  listStyle: "none",
};

const summaryHeadStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  flexWrap: "wrap",
};

const summaryMetaStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 2,
  fontSize: 12,
  color: "var(--cp-text-muted)",
};
