"use client";

/**
 * MetricHelp — inline "what is this?" affordance.
 *
 * Renders a small `ⓘ` glyph next to a metric label or value. On
 * hover (desktop), focus (keyboard), or tap (touch) it surfaces a
 * small popover with the term's plain-language definition + optional
 * research citation. Pulls all copy from the central glossary so the
 * vocabulary stays in one place.
 *
 * Accessibility:
 *  - the trigger is a real `<button>` with `aria-describedby` pointing
 *    at the popover content, so screen readers announce the body when
 *    the trigger is focused;
 *  - keyboard users can Tab to it and press Enter / Space, and Esc
 *    closes the popover;
 *  - we never use the bare `title` attribute (which is unreliable for
 *    AT and impossible to style).
 *
 * Styling matches the existing `.cp-info` affordance on the Today
 * rest-day card — same 14×14 muted dot until you interact with it.
 *
 * Unknown terms render nothing (the icon is suppressed) so a typo or
 * a soon-to-be-added entry never breaks a page.
 */
import { useEffect, useId, useRef, useState } from "react";
import type { CSSProperties, ReactElement } from "react";
import { getGlossaryEntry } from "@/lib/glossary";

export type MetricHelpProps = {
  /** Glossary term id (see `GLOSSARY` keys), e.g. "ceiling" or "tsb". */
  term: string;
  /** Where the popover anchors relative to the trigger. Defaults to "top". */
  placement?: "top" | "bottom" | "left" | "right";
};

const POPOVER_WIDTH = 280;

function popoverPosition(
  placement: NonNullable<MetricHelpProps["placement"]>,
): CSSProperties {
  switch (placement) {
    case "bottom":
      return { top: "calc(100% + 6px)", left: "50%", transform: "translateX(-50%)" };
    case "left":
      return { right: "calc(100% + 6px)", top: "50%", transform: "translateY(-50%)" };
    case "right":
      return { left: "calc(100% + 6px)", top: "50%", transform: "translateY(-50%)" };
    case "top":
    default:
      return { bottom: "calc(100% + 6px)", left: "50%", transform: "translateX(-50%)" };
  }
}

export function MetricHelp({
  term,
  placement = "top",
}: MetricHelpProps): ReactElement | null {
  const entry = getGlossaryEntry(term);
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLSpanElement | null>(null);
  const popoverId = useId();

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
      }
    }
    function onPointer(e: MouseEvent | TouchEvent) {
      const node = wrapperRef.current;
      if (!node) return;
      const target = e.target as Node | null;
      if (target && !node.contains(target)) {
        setOpen(false);
      }
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("touchstart", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("touchstart", onPointer);
    };
  }, [open]);

  if (entry == null) return null;

  const triggerStyle: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 14,
    height: 14,
    padding: 0,
    marginLeft: 4,
    borderRadius: "50%",
    background: "var(--cp-surface-soft)",
    border: "1px solid var(--cp-border)",
    color: "var(--cp-text-muted)",
    fontSize: 10,
    fontWeight: 600,
    lineHeight: 1,
    cursor: "help",
    verticalAlign: "middle",
    fontFamily: "inherit",
    fontStyle: "normal",
  };

  const popoverStyle: CSSProperties = {
    position: "absolute",
    width: POPOVER_WIDTH,
    maxWidth: "calc(100vw - 24px)",
    padding: "10px 12px",
    background: "var(--cp-panel-strong, var(--cp-surface-raised, var(--cp-surface)))",
    border: "1px solid var(--cp-border)",
    borderRadius: 10,
    color: "var(--cp-text)",
    fontSize: 12,
    fontWeight: 400,
    lineHeight: 1.45,
    textAlign: "left",
    boxShadow: "var(--cp-shadow, 0 8px 24px rgba(0, 0, 0, 0.18))",
    zIndex: 50,
    pointerEvents: open ? "auto" : "none",
    opacity: open ? 1 : 0,
    transition: "opacity 0.12s ease",
    ...popoverPosition(placement),
  };

  return (
    <span
      ref={wrapperRef}
      data-testid="metric-help"
      data-term={term}
      data-open={open ? "true" : "false"}
      style={{ position: "relative", display: "inline-flex" }}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        data-testid="metric-help-trigger"
        aria-label={`What is ${entry.title}?`}
        aria-describedby={open ? popoverId : undefined}
        aria-expanded={open}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        style={triggerStyle}
      >
        <span aria-hidden="true">ⓘ</span>
      </button>
      <span
        id={popoverId}
        role="tooltip"
        data-testid="metric-help-popover"
        style={popoverStyle}
      >
        <strong
          data-testid="metric-help-title"
          style={{ display: "block", fontSize: 12, fontWeight: 700, color: "var(--cp-text)" }}
        >
          {entry.title}
        </strong>
        <span
          data-testid="metric-help-body"
          style={{ display: "block", marginTop: 4, color: "var(--cp-text-muted)" }}
        >
          {entry.body}
        </span>
      </span>
    </span>
  );
}
