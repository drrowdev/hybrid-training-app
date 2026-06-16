/**
 * Plain-language labels + one-line captions for `SetKind`.
 *
 * Internal slugs (`back_off`, `tendon`, …) are kept as-is for the DB and
 * server actions; this module is the single source of truth for how each
 * kind is presented in the UI. Update labels here, not at the call site.
 */

export type SetKind = "warmup" | "main" | "back_off" | "accessory" | "tendon";

export const SET_KINDS: readonly SetKind[] = [
  "warmup",
  "main",
  "back_off",
  "accessory",
  "tendon",
] as const;

export type SetKindLabel = {
  /** Short label rendered in the chip pill. Plain-language. */
  label: string;
  /** One-line caption explaining what this kind is for. */
  caption: string;
};

export const SET_KIND_LABELS: Record<SetKind, SetKindLabel> = {
  warmup: {
    label: "Warm-up",
    caption: "Ramp-up sets before working weight. Lighter load, short rest.",
  },
  main: {
    label: "Main",
    caption: "Your working sets at peak intensity. Top sets count for PRs.",
  },
  back_off: {
    label: "Supplemental",
    caption: "Volume sets after your main top set, at a lighter load.",
  },
  accessory: {
    label: "Accessory",
    caption: "Accessory work for supporting muscles (curls, RDLs, raises).",
  },
  tendon: {
    label: "Tendon",
    caption: "Connective-tissue work — isometric holds, heavy slow resistance.",
  },
};

/**
 * Resolve a raw set-kind string (e.g. from the DB) to its display label.
 * Falls back to a humanised slug for unknown values so the UI never
 * renders `back_off` literally.
 */
export function setKindLabel(kind: string): string {
  if (kind in SET_KIND_LABELS) {
    return SET_KIND_LABELS[kind as SetKind].label;
  }
  return kind.replace(/_/g, " ");
}
