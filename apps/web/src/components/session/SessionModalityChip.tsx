/**
 * Small chip badge that surfaces the planned-session modality next to
 * the session date in the page header.
 *
 * Phase 5 of the bodyweight progression plan. The chip is intentionally
 * tiny — modality is a meta-fact about the day's stimulus, not the
 * primary identity of the session. Brand-purity: pure descriptors,
 * no methodology names.
 *
 * Color rules (per the Phase 5 spec):
 *   - mixed_modal  → var(--cp-warning)  (signals "plan recovery")
 *   - skill_focused → var(--cp-link)    (CNS-heavy day)
 *   - everything else → var(--cp-text-muted)
 *
 * Tooltip body is rendered via the native `title` attribute so the
 * component stays a tiny dependency-free server-render-safe pill.
 */
import {
  MODALITY_LABEL,
  MODALITY_TOOLTIP,
  type SessionModality,
} from "@/lib/planner/session-modality";

export function SessionModalityChip({
  modality,
}: {
  modality: SessionModality | null | undefined;
}) {
  if (!modality) return null;
  const label = MODALITY_LABEL[modality];
  const tooltip = MODALITY_TOOLTIP[modality];
  const color =
    modality === "mixed_modal"
      ? "var(--cp-warning)"
      : modality === "skill_focused"
        ? "var(--cp-link)"
        : "var(--cp-text-muted)";
  return (
    <span
      data-testid="session-modality-chip"
      data-modality={modality}
      title={tooltip}
      aria-label={`Session modality: ${label}. ${tooltip}`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        fontSize: 10,
        padding: "2px 8px",
        borderRadius: 999,
        border: `1px solid ${color}`,
        color,
        background:
          "color-mix(in oklab, var(--cp-surface) 80%, transparent)",
        textTransform: "uppercase",
        letterSpacing: "0.06em",
        fontWeight: 600,
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </span>
  );
}
