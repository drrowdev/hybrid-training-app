/**
 * TmSourceBadge — provenance pill rendered next to every TM row.
 *
 * Visual language:
 *   - `entered` → muted, near-invisible. The default case shouldn't add noise.
 *   - `derived_*` → accent-colored. Calls out that this number is an estimate
 *     and not something the user typed.
 *
 * Pure render. The full source-set context (date, weight × reps, link) lives
 * in the expander rendered by the parent — this badge is just the label.
 */
import type { TmFormula, TmSource } from "@hta/db";

const FORMULA_LABEL: Record<TmFormula, string> = {
  epley: "Epley",
  brzycki: "Brzycki",
  rpe_zourdos: "RPE",
};

export function tmBadgeText(source: TmSource, formula: TmFormula | null): string {
  if (source === "entered") return "(entered)";
  const f = formula ? FORMULA_LABEL[formula] : "estimate";
  return `(e1RM · ${f})`;
}

export function TmSourceBadge({
  source,
  formula,
  compact = false,
}: {
  source: TmSource;
  formula: TmFormula | null;
  compact?: boolean;
}) {
  const isEntered = source === "entered";
  const text = tmBadgeText(source, formula);
  return (
    <span
      data-testid="tm-source-badge"
      data-source={source}
      data-formula={formula ?? "none"}
      style={{
        fontSize: compact ? 10 : 11,
        fontWeight: 600,
        letterSpacing: "0.02em",
        color: isEntered ? "var(--cp-text-muted)" : "var(--cp-accent)",
        fontVariantNumeric: "tabular-nums",
        whiteSpace: "nowrap",
      }}
    >
      {text}
    </span>
  );
}
