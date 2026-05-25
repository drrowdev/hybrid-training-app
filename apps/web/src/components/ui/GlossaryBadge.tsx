"use client";

/**
 * GlossaryBadge — turns any visual element (e.g. an "AM" / "PM" pill)
 * into a focusable trigger that surfaces a glossary entry on hover,
 * focus, or tap. Same interaction model as `<MetricHelp />` but with a
 * caller-supplied visual instead of the small `ⓘ` glyph.
 *
 * If the glossary term doesn't exist, the children render as a plain
 * non-interactive span so a typo or in-flight entry never breaks a
 * page.
 */

import { useEffect, useId, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { getGlossaryEntry } from "@/lib/glossary";

export type GlossaryBadgeProps = {
  /** Glossary term id (see `GLOSSARY` keys). */
  term: string;
  /** Visible badge content (the existing pill / label). */
  children: ReactNode;
  /** Accessible label override; defaults to `What is <title>?`. */
  ariaLabel?: string;
  /** Where the popover anchors. Defaults to "bottom" for inline badges. */
  placement?: "top" | "bottom";
  /** Optional extra style merged onto the button. */
  buttonStyle?: CSSProperties;
  /** Optional data-testid on the button (preserves existing testids). */
  testId?: string;
  /** Optional data-* passthroughs preserved on the button element. */
  dataSlot?: string;
};

const POPOVER_WIDTH = 280;

export function GlossaryBadge({
  term,
  children,
  ariaLabel,
  placement = "bottom",
  buttonStyle,
  testId,
  dataSlot,
}: GlossaryBadgeProps) {
  const entry = getGlossaryEntry(term);
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLSpanElement | null>(null);
  const popoverId = useId();

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    function onPointer(e: MouseEvent | TouchEvent) {
      const node = wrapperRef.current;
      if (!node) return;
      const target = e.target as Node | null;
      if (target && !node.contains(target)) setOpen(false);
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

  if (entry == null) {
    return <span data-testid={testId} data-slot={dataSlot}>{children}</span>;
  }

  const popoverPos: CSSProperties =
    placement === "top"
      ? { bottom: "calc(100% + 6px)", left: "50%", transform: "translateX(-50%)" }
      : { top: "calc(100% + 6px)", left: "50%", transform: "translateX(-50%)" };

  const buttonReset: CSSProperties = {
    background: "transparent",
    border: 0,
    padding: 0,
    margin: 0,
    cursor: "help",
    color: "inherit",
    font: "inherit",
    lineHeight: "inherit",
    display: "inline-flex",
    alignItems: "center",
    ...buttonStyle,
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
    ...popoverPos,
  };

  return (
    <span
      ref={wrapperRef}
      data-testid="glossary-badge"
      data-term={term}
      data-open={open ? "true" : "false"}
      style={{ position: "relative", display: "inline-flex" }}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        data-testid={testId}
        data-slot={dataSlot}
        aria-label={ariaLabel ?? `What is ${entry.title}?`}
        aria-describedby={open ? popoverId : undefined}
        aria-expanded={open}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        style={buttonReset}
      >
        {children}
      </button>
      <span
        id={popoverId}
        role="tooltip"
        data-testid="glossary-badge-popover"
        style={popoverStyle}
      >
        <strong style={{ display: "block", fontSize: 12, fontWeight: 700, color: "var(--cp-text)" }}>
          {entry.title}
        </strong>
        <span style={{ display: "block", marginTop: 4, color: "var(--cp-text-muted)" }}>
          {entry.body}
        </span>
      </span>
    </span>
  );
}
