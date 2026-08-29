"use client";

/**
 * The number field inside a logger stepper.
 *
 * Holds the typed text while the field is focused and derives the number from
 * it, so an in-progress "27." or "27," survives long enough to become 27.5.
 * See `lib/sessions/numeric-entry` for why the obvious controlled-number
 * version cannot express a decimal at all.
 *
 * Shared by the focus logger and the off-plan card. They were separate copies
 * of the same input carrying the same defect; only the surrounding layout
 * differs, so the field is shared and the chrome is not.
 */

import { useState, type CSSProperties } from "react";
import { isPartialNumber, parsePartialNumber } from "@/lib/sessions/numeric-entry";

export function NumberEntryInput({
  label,
  value,
  integer = false,
  onSet,
  className,
  style,
  testId,
  scrollIntoViewOnFocus = false,
}: {
  label: string;
  value: number;
  integer?: boolean;
  onSet: (n: number) => void;
  className?: string;
  style?: CSSProperties;
  testId?: string;
  /**
   * Mobile: the on-screen keyboard covers the lower half of the viewport,
   * hiding the field and the "Log set" button under it.
   */
  scrollIntoViewOnFocus?: boolean;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const canonical = Number.isFinite(value) ? String(value) : "0";

  return (
    <input
      type="text"
      inputMode={integer ? "numeric" : "decimal"}
      // The draft wins while editing. Blur drops it, so the field goes back to
      // showing the stored value — which has been snapped to the nearest half
      // kilo and may not be character-for-character what was typed.
      value={draft ?? canonical}
      data-testid={testId}
      onChange={(e) => {
        const next = e.target.value;
        if (!isPartialNumber(next, integer)) return;
        setDraft(next);
        const parsed = parsePartialNumber(next, integer);
        if (parsed != null) onSet(parsed);
      }}
      onBlur={() => setDraft(null)}
      onFocus={(e) => {
        if (!scrollIntoViewOnFocus) return;
        const el = e.currentTarget;
        setTimeout(
          () => el.scrollIntoView({ block: "center", behavior: "smooth" }),
          50,
        );
      }}
      className={className}
      aria-label={label}
      style={style}
    />
  );
}
