/**
 * Visual tokens shared by the plan calendar views.
 *
 * Strength uses `--cp-accent` (lime); cardio uses `--cp-link` (cool
 * blue). Done = solid fill, planned = outline only. Past-unfulfilled
 * carries a dashed `--cp-warning` border so it reads as "needs your
 * attention". Priority events render as a coloured diamond instead of
 * a chip — they're not training, they're calendar pins.
 *
 * All three views import from this module so the legend, the month
 * grid, and the timeline read as one consistent system.
 */
import type { CalendarItemKind } from "@/lib/plan/calendar-data";

export type ChipPaint = {
  background: string;
  border: string;
  color: string;
  /** True for past-unfulfilled — the view layer adds the "tap to match" hint. */
  dashed?: boolean;
};

export function chipPaint(kind: CalendarItemKind, priority?: "A" | "B" | "C"): ChipPaint {
  switch (kind) {
    case "planned_strength":
      return {
        background: "transparent",
        border: "1px solid var(--cp-accent)",
        color: "var(--cp-accent)",
      };
    case "logged_strength":
      return {
        background: "var(--cp-accent)",
        border: "1px solid var(--cp-accent)",
        color: "var(--cp-on-accent, #000)",
      };
    case "planned_cardio":
      return {
        background: "transparent",
        border: "1px solid var(--cp-link)",
        color: "var(--cp-link)",
      };
    case "logged_cardio":
      return {
        background: "var(--cp-link)",
        border: "1px solid var(--cp-link)",
        color: "var(--cp-on-accent, #fff)",
      };
    case "past_unfulfilled":
      return {
        background: "transparent",
        border: "1px dashed var(--cp-warning)",
        color: "var(--cp-warning)",
        dashed: true,
      };
    case "event": {
      const c =
        priority === "A"
          ? "var(--cp-warning)"
          : priority === "B"
            ? "var(--cp-accent)"
            : "var(--cp-text-muted)";
      return {
        background: c,
        border: `1px solid ${c}`,
        color: "var(--cp-on-accent, #000)",
      };
    }
  }
}

export const LEGEND_ITEMS: Array<{
  id: string;
  label: string;
  kind: CalendarItemKind;
  priority?: "A" | "B" | "C";
  /** Diamond glyph for events (visually distinct from chips). */
  diamond?: boolean;
}> = [
  { id: "strength-planned", label: "Strength planned", kind: "planned_strength" },
  { id: "strength-done", label: "Strength done", kind: "logged_strength" },
  { id: "cardio-planned", label: "Cardio planned", kind: "planned_cardio" },
  { id: "cardio-done", label: "Cardio done", kind: "logged_cardio" },
  { id: "past-unfulfilled", label: "Past unfulfilled", kind: "past_unfulfilled" },
  { id: "event", label: "Priority event", kind: "event", priority: "A", diamond: true },
];
