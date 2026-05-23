/**
 * /app/stats/blocks — Phase 2 block-outcomes index.
 *
 * Lists every non-deleted training block for the current user, most-
 * recent first. Each card is its own link into the deep-dive surface
 * (`/app/stats/blocks/[id]`).
 *
 * Cards surface two KPI tiles inline:
 *   - **e1RM delta**: averaged % delta across the block's main lifts
 *     (uses the canonical `bestEstimateOneRm` so the number matches
 *     the in-session PR pop). Green when positive, red when negative.
 *   - **PRs hit**: count of e1RM PRs on the block's main lifts.
 *
 * The "Avg sleep" KPI was removed in fix/sleep-walkback — manual
 * sleep entry is deferred to the future health-app integration.
 *
 * Deleted blocks live on the Trash page (`/app/trash`) — every query
 * here filters `deleted_at IS NULL`.
 */
import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactElement } from "react";
import { createClient } from "@/lib/supabase/server";
import { getUserTimezone } from "@/lib/planner/queries";
import { todayYmd } from "@/lib/dates";
import { getBlockIndex, type BlockIndexRow } from "@/lib/stats/blocks";
import { StatusBadge } from "@/components/blocks/StatusBadge";
import { EmptyState } from "@/components/ui/EmptyState";

export const dynamic = "force-dynamic";

export default async function StatsBlocksIndexPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("timezone")
    .eq("id", user.id)
    .maybeSingle();
  const tz = profile?.timezone ?? (await getUserTimezone(user.id));
  const today = todayYmd(tz);

  const blocks = await getBlockIndex(supabase, user.id, today);

  return (
    <div style={{ display: "grid", gap: 18 }}>
      <header>
        <Link
          href="/app/stats"
          style={{ fontSize: 12, color: "var(--cp-text-muted)", textDecoration: "none" }}
        >
          ← stats
        </Link>
        <h1 style={{ fontSize: 28, margin: "8px 0 0", letterSpacing: "-0.01em" }}>
          Block outcomes
        </h1>
        <p style={{ margin: "6px 0 0", color: "var(--cp-text-muted)", fontSize: 14 }}>
          Every block you&apos;ve run — open one to see e1RM progression, adherence, RPE creep,
          power emphasis outcomes, and wellness during the block.
        </p>
      </header>

      {blocks.length === 0 ? (
        <BlocksEmpty />
      ) : (
        <ul
          data-testid="stats-blocks-list"
          style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 12 }}
        >
          {blocks.map((b) => (
            <li key={b.id}>
              <BlockCard block={b} today={today} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function BlocksEmpty(): ReactElement {
  return (
    <section
      data-testid="stats-blocks-empty"
      style={{ display: "grid", gap: 10 }}
    >
      <EmptyState
        title="No blocks finished yet"
        body="Once you complete a block it'll appear here with summary stats — e1RM delta, PRs hit, adherence, and wellness during the block."
        action={{ label: "Start your first →", href: "/app/plan/new" }}
      />
    </section>
  );
}

function BlockCard({ block, today }: { block: BlockIndexRow; today: string }): ReactElement {
  const adherencePct =
    block.totalSessions === 0
      ? null
      : Math.round((block.loggedSessions / block.totalSessions) * 100);
  const dateRange = formatDateRange(block.startedOn, block.endedOn, block.weeks, block.status, today);

  const deltaAccent: "success" | "danger" | "muted" =
    block.avgE1RmDeltaPct == null
      ? "muted"
      : block.avgE1RmDeltaPct > 0
      ? "success"
      : block.avgE1RmDeltaPct < 0
      ? "danger"
      : "muted";

  return (
    <Link
      href={`/app/stats/blocks/${block.id}`}
      data-testid="stats-block-card"
      data-block-id={block.id}
      data-archetype={block.archetype}
      style={{
        display: "block",
        padding: 16,
        background: "var(--cp-surface)",
        border: "1px solid var(--cp-border)",
        borderRadius: 12,
        color: "inherit",
        textDecoration: "none",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontWeight: 600, fontSize: 15 }}>{block.archetypeName}</span>
        <StatusBadge status={block.status} />
      </div>
      <div
        style={{
          fontSize: 12,
          color: "var(--cp-text-muted)",
          marginTop: 4,
          display: "flex",
          flexWrap: "wrap",
          gap: 12,
        }}
      >
        <span data-testid="stats-block-card-range">{dateRange}</span>
        {adherencePct != null && (
          <span data-testid="stats-block-card-adherence">
            Adherence: {block.loggedSessions} of {block.totalSessions} · {adherencePct}%
          </span>
        )}
      </div>
      <div
        style={{
          marginTop: 12,
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
          gap: 8,
        }}
      >
        <Kpi
          testid="stats-block-card-delta"
          label="e1RM delta"
          value={
            block.avgE1RmDeltaPct == null
              ? "—"
              : `${block.avgE1RmDeltaPct > 0 ? "+" : ""}${block.avgE1RmDeltaPct.toFixed(1)}% avg`
          }
          accent={deltaAccent}
        />
        <Kpi
          testid="stats-block-card-prs"
          label="PRs hit"
          value={`${block.prCount}`}
          accent={block.prCount > 0 ? "success" : "muted"}
        />
      </div>
    </Link>
  );
}

function Kpi({
  testid,
  label,
  value,
  accent,
}: {
  testid: string;
  label: string;
  value: string;
  accent: "success" | "danger" | "muted";
}): ReactElement {
  const color =
    accent === "success"
      ? "var(--cp-success)"
      : accent === "danger"
      ? "var(--cp-danger)"
      : "var(--cp-text-muted)";
  return (
    <div
      data-testid={testid}
      style={{
        padding: "8px 10px",
        background: "var(--cp-surface-soft)",
        borderRadius: 8,
        border: "1px solid var(--cp-border)",
      }}
    >
      <div
        style={{
          fontSize: 10,
          color: "var(--cp-text-muted)",
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          fontWeight: 600,
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: 15, fontWeight: 600, color, marginTop: 2 }}>{value}</div>
    </div>
  );
}

function formatDateRange(
  startedOn: string,
  endedOn: string | null,
  weeks: number,
  status: BlockIndexRow["status"],
  today: string,
): string {
  const startLabel = formatYmd(startedOn);
  // For active blocks: show "ongoing"; for ended blocks: show actual end.
  let endLabel: string;
  if (status === "active") {
    endLabel = "ongoing";
  } else if (endedOn) {
    endLabel = formatYmd(endedOn.slice(0, 10));
  } else {
    endLabel = formatYmd(today);
  }
  return `${startLabel} – ${endLabel} · ${weeks} ${weeks === 1 ? "week" : "weeks"}`;
}

function formatYmd(ymd: string): string {
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  const y = ymd.slice(0, 4);
  const m = Number(ymd.slice(5, 7));
  const d = Number(ymd.slice(8, 10));
  return `${months[m - 1]} ${d}, ${y}`;
}
