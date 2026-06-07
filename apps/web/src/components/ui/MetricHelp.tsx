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
import { createPortal } from "react-dom";
import type { CSSProperties, ReactElement } from "react";
import { getGlossaryEntry } from "@/lib/glossary";

export type MetricHelpProps = {
  /** Glossary term id (see `GLOSSARY` keys), e.g. "ceiling" or "tsb". */
  term?: string;
  /**
   * Inline content override. When `body` is provided the popover renders this
   * text directly instead of looking `term` up in the glossary — used for
   * dynamic, per-instance explanations (e.g. an accessory's specific "why").
   * `title` defaults to a sensible label per variant when omitted.
   */
  title?: string;
  body?: string;
  /** Where the popover anchors relative to the trigger. Defaults to "top". */
  placement?: "top" | "bottom" | "left" | "right";
  /**
   * Affordance style. `"info"` (default) is the neutral muted `ⓘ` dot used for
   * metric definitions. `"why"` is an accent-green spark (✦) used where the
   * engine PROGRAMMED or PROPOSED something and the user might wonder why — it
   * reads as "there's reasoning behind this" (the engine is deterministic +
   * science-grounded, NOT AI; the popover copy reflects that).
   */
  variant?: "info" | "why";
};

const POPOVER_WIDTH = 280;
const VIEWPORT_MARGIN = 12;

/**
 * Compute fixed-position coordinates for the popover from the trigger's
 * viewport rect. Fixed positioning (in a portal) escapes any scroll/overflow
 * ancestor, so the popover is never clipped by — nor extends the scroll area
 * of — a container like the plan timeline. Horizontal placement is clamped to
 * the viewport so an edge-anchored trigger doesn't push the popover off-screen.
 */
function popoverFixedPosition(
  placement: NonNullable<MetricHelpProps["placement"]>,
  rect: DOMRect,
): CSSProperties {
  const vw = typeof window !== "undefined" ? window.innerWidth : 0;
  const vh = typeof window !== "undefined" ? window.innerHeight : 0;
  const centerX = rect.left + rect.width / 2;
  const clampedLeft = Math.max(
    VIEWPORT_MARGIN,
    Math.min(centerX - POPOVER_WIDTH / 2, vw - POPOVER_WIDTH - VIEWPORT_MARGIN),
  );
  switch (placement) {
    case "bottom":
      return { position: "fixed", top: rect.bottom + 6, left: clampedLeft };
    case "left":
      return {
        position: "fixed",
        right: vw - rect.left + 6,
        top: rect.top + rect.height / 2,
        transform: "translateY(-50%)",
      };
    case "right":
      return {
        position: "fixed",
        left: rect.right + 6,
        top: rect.top + rect.height / 2,
        transform: "translateY(-50%)",
      };
    case "top":
    default:
      return { position: "fixed", bottom: vh - rect.top + 6, left: clampedLeft };
  }
}

export function MetricHelp({
  term,
  title,
  body,
  placement = "top",
  variant = "info",
}: MetricHelpProps): ReactElement | null {
  const entry = term ? getGlossaryEntry(term) : null;
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const wrapperRef = useRef<HTMLSpanElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popoverId = useId();

  // Measure the trigger when the popover opens so the portaled (fixed)
  // popover can be positioned relative to the viewport. Re-measure on
  // scroll/resize while open so it tracks the trigger. The initial measure is
  // deferred to a rAF so we don't call setState synchronously inside the
  // effect (which trips the cascading-render lint rule).
  useEffect(() => {
    if (!open) return;
    const measure = () => {
      const el = triggerRef.current;
      if (el) setRect(el.getBoundingClientRect());
    };
    const raf = requestAnimationFrame(measure);
    window.addEventListener("scroll", measure, true);
    window.addEventListener("resize", measure);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", measure, true);
      window.removeEventListener("resize", measure);
    };
  }, [open]);

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

  if (entry == null && body == null) return null;

  const isWhy = variant === "why";
  const resolvedBody = body ?? entry?.body ?? null;
  if (resolvedBody == null) return null;
  const resolvedTitle =
    title ?? entry?.title ?? (isWhy ? "Why this" : "Details");

  const triggerStyle: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 14,
    height: 14,
    padding: 0,
    marginLeft: 4,
    borderRadius: "50%",
    background: isWhy ? "var(--cp-accent-soft)" : "var(--cp-surface-soft)",
    border: isWhy
      ? "1px solid color-mix(in oklab, var(--cp-accent) 40%, transparent)"
      : "1px solid var(--cp-border)",
    color: isWhy ? "var(--cp-accent)" : "var(--cp-text-muted)",
    fontSize: 10,
    fontWeight: 600,
    lineHeight: 1,
    cursor: "help",
    verticalAlign: "middle",
    fontFamily: "inherit",
    fontStyle: "normal",
  };

  const popoverBaseStyle: CSSProperties = {
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
    // Reset inherited typographic transforms — the popover is often nested
    // inside an uppercased, letter-spaced section divider, and we don't want
    // the explanatory copy rendered in all-caps.
    textTransform: "none",
    letterSpacing: "normal",
    boxShadow: "var(--cp-shadow, 0 8px 24px rgba(0, 0, 0, 0.18))",
    zIndex: 1000,
  };

  // Closed: render inline but `display:none`. It stays in the DOM/markup (so
  // SSR + ARIA wiring hold) yet contributes ZERO layout — crucially it no
  // longer extends the scroll height of an `overflow:auto` ancestor like the
  // plan timeline (the prior absolutely-positioned-at-opacity-0 popover did,
  // which produced the excess blank scroll space).
  // Open: portal to <body> with FIXED coords measured from the trigger, so it
  // escapes the scroll container and is never clipped.
  const popoverStyle: CSSProperties = open
    ? {
        ...popoverBaseStyle,
        pointerEvents: "auto",
        opacity: 1,
        transition: "opacity 0.12s ease",
        ...(rect
          ? popoverFixedPosition(placement, rect)
          : { position: "fixed", top: -9999, left: -9999 }),
      }
    : { ...popoverBaseStyle, display: "none" };

  const popover = (
    <span
      id={popoverId}
      role="tooltip"
      data-testid="metric-help-popover"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      style={popoverStyle}
    >
      <strong
        data-testid="metric-help-title"
        style={{ display: "block", fontSize: 12, fontWeight: 700, color: "var(--cp-text)" }}
      >
        {resolvedTitle}
      </strong>
      <span
        data-testid="metric-help-body"
        style={{ display: "block", marginTop: 4, color: "var(--cp-text-muted)" }}
      >
        {resolvedBody}
      </span>
    </span>
  );

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
        ref={triggerRef}
        type="button"
        data-testid="metric-help-trigger"
        data-variant={variant}
        aria-label={isWhy ? `Why: ${resolvedTitle}` : `What is ${resolvedTitle}?`}
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
        <span aria-hidden="true">{isWhy ? "✦" : "ⓘ"}</span>
      </button>
      {open && typeof document !== "undefined"
        ? createPortal(popover, document.body)
        : popover}
    </span>
  );
}
