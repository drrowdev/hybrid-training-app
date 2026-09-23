import Link from "next/link";
import type { ActiveBlockProgress } from "@/lib/stats/active-block-progress";
import type { Streak } from "@/lib/stats/streak";

const rowStyle = {
  display: "flex", alignItems: "center", flexWrap: "wrap", gap: 8,
  padding: "13px 20px", borderBottom: "1px solid var(--cp-border)",
  background: "var(--cp-surface-soft)", fontSize: 13,
} as const;
const linkStyle = {
  marginLeft: "auto", color: "var(--cp-text-muted)", fontSize: 12, textDecoration: "none",
  minHeight: 44, display: "inline-flex", alignItems: "center",
} as const;

export function ProgramProgress({ blocks, hasSwimming = false }: {
  blocks: ActiveBlockProgress[];
  hasSwimming?: boolean;
}) {
  if (blocks.length === 0 && !hasSwimming) {
    return <div data-testid="stats-card-active-block" data-empty="true" style={rowStyle}>
      <span style={{ color: "var(--cp-text-muted)" }}>No active program</span>
      <Link href="/app/programs" data-testid="stats-active-block-cta" style={linkStyle}>Choose a program</Link>
    </div>;
  }
  return <>
    {blocks.map((block) => <BlockProgress key={block.blockId} block={block} />)}
    {hasSwimming && <div style={rowStyle}>
      <span style={{ fontWeight: 600 }}>Swimming</span>
      <Link href="/app/swim" style={linkStyle}>View swimming progress</Link>
    </div>}
  </>;
}

function BlockProgress({ block }: { block: ActiveBlockProgress }) {
  const ratio = block.scheduledToDate === 0 ? 0 : block.logged / block.scheduledToDate;
  const pace = block.scheduledToDate === 0 ? null
    : ratio >= 0.8 ? { text: "On track", color: "var(--cp-success)" }
      : ratio >= 0.5 ? { text: "Catching up", color: "var(--cp-warning)" }
        : { text: "Behind pace", color: "var(--cp-danger)" };
  return <div data-testid="stats-card-active-block" data-block-id={block.blockId} style={rowStyle}>
    <span style={{ fontWeight: 600 }}>{block.archetypeName}</span>
    <span style={{ color: "var(--cp-text-muted)" }}>Week {block.currentWeek} of {block.weeks}</span>
    <span data-testid="stats-active-block-completion" style={{ color: "var(--cp-text-muted)" }}>
      {block.logged} of {block.scheduledToDate} workouts completed
      {block.skipped > 0 && <span style={{ color: "var(--cp-warning)" }}> · {block.skipped} skipped</span>}
    </span>
    {pace && <span style={{
      marginLeft: "auto", fontSize: 11.5, fontWeight: 600, color: pace.color,
      background: "var(--cp-surface)", border: "1px solid var(--cp-border)", padding: "3px 11px", borderRadius: 999,
    }}>{pace.text}</span>}
    <Link href={`/app/stats/blocks/${encodeURIComponent(block.blockId)}`} data-testid="stats-active-block-cta" style={linkStyle}>
      Program details
    </Link>
    <div style={{ width: "100%" }}><ProgramWeekProgress streak={block.streak} /></div>
  </div>;
}

export function ProgramWeekProgress({ streak }: { streak: Streak }) {
  if (!streak.hasActiveBlock || streak.thisWeekTarget === 0) return null;
  const done = streak.thisWeekCompleted;
  const target = streak.thisWeekTarget;
  return <div style={{
    marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--cp-border)",
    display: "flex", flexWrap: "wrap", alignItems: "center", gap: 16,
  }}>
    <div>
      <div style={{ fontSize: 12.5, fontWeight: 600 }}>This week · {done} of {target} done</div>
      {streak.currentStreakWeeks > 0 && <div style={{ fontSize: 11.5, color: "var(--cp-text-muted)", marginTop: 2 }}>
        {streak.currentStreakWeeks}-week streak
      </div>}
    </div>
    <div aria-hidden="true" style={{ display: "flex", flexWrap: "wrap", gap: 9, marginLeft: "auto" }}>
      {Array.from({ length: target }, (_, index) => <span key={index} style={{
        width: 22, height: 22, borderRadius: "50%", display: "grid", placeItems: "center", fontSize: 11,
        background: index < done ? "var(--cp-accent)" : "transparent",
        color: index < done ? "var(--cp-accent-fg)" : "var(--cp-text-muted)",
        border: index < done ? undefined : "1.5px dashed var(--cp-border)",
      }}>{index < done ? "\u2713" : ""}</span>)}
    </div>
  </div>;
}
