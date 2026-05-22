/**
 * Shared style helpers + constants for the wizard goal cards (Step 2 + Step 3).
 * Kept in one place so the visual contract stays in sync.
 */
import type { Goal } from "@/lib/planner/wizard/wizard-mapping";

export type GoalCardData = {
  icon: string;
  name: string;
  short: string;
  outcome: string;
};

export const GOALS: Record<Goal, GoalCardData> = {
  strength: {
    icon: "🏋️",
    name: "Get stronger",
    short: "stronger",
    outcome: "Heavier top sets. Lifting harder weight than last month.",
  },
  muscle: {
    icon: "💪",
    name: "Build muscle",
    short: "muscle",
    outcome: "Add visible size where you want it — shoulders, arms, calves.",
  },
  cardio: {
    icon: "🏃",
    name: "Build cardio",
    short: "cardio",
    outcome: "Push the aerobic ceiling. Move farther at lower effort.",
  },
  resilience: {
    icon: "🦴",
    name: "Build resilience",
    short: "resilience",
    outcome: "Tendons and joints that handle real load. Foundation for everything else.",
  },
};

export const pillStyle: React.CSSProperties = {
  display: "inline-block",
  fontSize: 11,
  color: "var(--cp-text-muted)",
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  fontWeight: 600,
  marginBottom: 4,
};

export const titleStyle: React.CSSProperties = {
  fontSize: 28,
  margin: 0,
  letterSpacing: "-0.01em",
  fontWeight: 700,
};

export const subStyle: React.CSSProperties = {
  color: "var(--cp-text-muted)",
  fontSize: 14,
  margin: "8px 0 24px",
  maxWidth: 560,
};

export const cardGridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(2, 1fr)",
  gap: 12,
};

export function goalCardStyle(selected: boolean): React.CSSProperties {
  return {
    position: "relative",
    background: selected ? "var(--cp-accent-soft)" : "var(--cp-surface)",
    border: `1.5px solid ${selected ? "var(--cp-accent)" : "var(--cp-border)"}`,
    borderRadius: 14,
    padding: 18,
    cursor: "pointer",
    textAlign: "left",
    fontFamily: "inherit",
    color: "inherit",
    display: "grid",
    gap: 6,
    minHeight: 124,
  };
}

export function goalCardTick(selected: boolean): React.CSSProperties {
  return {
    position: "absolute",
    top: 12,
    right: 12,
    width: 20,
    height: 20,
    borderRadius: 999,
    background: "var(--cp-accent)",
    color: "var(--cp-accent-fg)",
    display: selected ? "flex" : "none",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 12,
    fontWeight: 700,
  };
}
