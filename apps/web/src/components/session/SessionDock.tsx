"use client";

/**
 * The single owner of the bottom region while a session is in progress.
 *
 * Before this existed the primary "Log set" button sat at the end of a
 * scrolling card, so its position depended on how tall the card happened
 * to be. Measured on the pre-dock build: the CTA fell **below the fold on
 * every section at 375×667**, and on 390×844 the accessory section pushed
 * it underneath the fixed tab bar. Docking it makes the primary action
 * land in the same thumb-reachable band on every movement and every
 * viewport.
 *
 * Layout contract:
 *   - fixed, directly above the mobile tab bar (`--cp-bottomnav-h`)
 *   - stacks the rest countdown above the action row, so the two can
 *     never fight for the same pixels (they previously did — the rest
 *     timer is also `position: fixed`)
 *   - publishes its measured height as `--cp-session-dock-h` so the
 *     scroll container can reserve exactly the right amount of space
 *   - static (inline) on desktop, where there is no thumb-zone problem
 */

import { useEffect, useRef } from "react";

export function SessionDock({
  rest,
  primary,
  accessory,
  editing = false,
  undo,
  testId = "session-dock",
}: {
  /** Rest countdown row. Rendered above the action row when present. */
  rest?: React.ReactNode;
  /** The primary action — "Log set" / "Save". */
  primary: React.ReactNode;
  /** Secondary control to the right of the primary action (the navigator). */
  accessory?: React.ReactNode;
  /** Editing a logged set is a distinct mode and is coloured as one. */
  editing?: boolean;
  /**
   * Transient "Logged X · Undo" row. Lives inside the dock rather than
   * floating, so it stacks with the rest row instead of covering the CTA the
   * way an independently-positioned toast would.
   */
  undo?: React.ReactNode;
  testId?: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  // Publish the dock's real height so `.cp-main` can reserve space for it, and
  // claim the bottom region for the duration of the session.
  //
  // The global tab bar is hidden while the dock is mounted: two stacked fixed
  // bars cost 133px of a 667px screen, and a mis-tap on "Plan" mid-set drops
  // you out of a live workout. The navigator sheet carries an explicit "Leave
  // workout" row so this is a deliberate exit, not a trap.
  //
  // `--cp-bottomnav-h` is zeroed rather than the tab bar merely being hidden,
  // because the dock and the rest timer both offset themselves by it.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const root = document.documentElement;
    root.classList.add("cp-session-live");
    root.style.setProperty("--cp-bottomnav-h", "0px");
    const publish = () => {
      root.style.setProperty("--cp-session-dock-h", `${Math.round(el.offsetHeight)}px`);
    };
    publish();
    const ro = new ResizeObserver(publish);
    ro.observe(el);
    return () => {
      ro.disconnect();
      root.classList.remove("cp-session-live");
      root.style.removeProperty("--cp-bottomnav-h");
      root.style.removeProperty("--cp-session-dock-h");
    };
  }, []);

  return (
    <div
      ref={ref}
      className={`cp-session-dock${editing ? " cp-session-dock--editing" : ""}`}
      data-testid={testId}
    >
      {undo}
      {rest}
      <div className="cp-session-dock-row">
        {primary}
        {accessory}
      </div>
    </div>
  );
}
