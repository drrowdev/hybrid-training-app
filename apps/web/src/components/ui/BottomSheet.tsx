"use client";

/**
 * Generic bottom-sheet primitive — backdrop + slide-up panel + mobile
 * swipe-down-to-dismiss.
 *
 * Extracted partial of the `SessionDrawer` UX from `PlanRedesign.tsx`
 * (PR #202). The swipe threshold helper `shouldDismissSwipe` is reused
 * verbatim from PlanRedesign so the two surfaces never drift apart;
 * the rest is duplicated-by-design because the plan-drawer carries a
 * lot of session-specific markup that doesn't generalise cleanly.
 *
 * Behaviour:
 *   - Mobile (<=768px): full-width bottom sheet with a visible grab
 *     handle. Pointer-drag the handle downward → either snap back or
 *     dismiss (>100px pull OR >0.5 px/ms fling, last 100 ms).
 *   - Desktop (>768px): right-side panel slide-in. Same backdrop +
 *     Escape-to-close.
 *   - Closing fires `onClose` once the dismiss transition has played.
 *
 * Body scroll is locked while open (matches PlanRedesign's drawer).
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { shouldDismissSwipe } from "@/components/plan/PlanRedesign";

export function BottomSheet({
  open,
  onClose,
  title,
  ariaLabelledById,
  children,
  testId,
}: {
  open: boolean;
  onClose: () => void;
  /** Visible heading rendered inside the sheet header. */
  title?: ReactNode;
  /** id of the element acting as aria-labelledby (overrides `title`). */
  ariaLabelledById?: string;
  children: ReactNode;
  testId?: string;
}) {
  const [dragY, setDragY] = useState(0);
  const [dragging, setDragging] = useState(false);
  const dragStateRef = useRef<{
    startY: number;
    pointerId: number;
    samples: Array<{ t: number; y: number }>;
  } | null>(null);

  // Body scroll lock — mirror of PlanRedesign's drawer behaviour so
  // background content can't scroll behind the sheet on iOS/Android.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  // Escape to close.
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  const onDragPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    dragStateRef.current = {
      startY: e.clientY,
      pointerId: e.pointerId,
      samples: [{ t: performance.now(), y: e.clientY }],
    };
    setDragging(true);
    setDragY(0);
    e.currentTarget.setPointerCapture(e.pointerId);
  }, []);
  const onDragPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const s = dragStateRef.current;
    if (!s || s.pointerId !== e.pointerId) return;
    const dy = Math.max(0, e.clientY - s.startY);
    setDragY(dy);
    s.samples.push({ t: performance.now(), y: e.clientY });
    if (s.samples.length > 10) s.samples.shift();
  }, []);
  const finishDrag = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const s = dragStateRef.current;
      if (!s || s.pointerId !== e.pointerId) return;
      const finalDy = Math.max(0, e.clientY - s.startY);
      const now = performance.now();
      const recent = s.samples.filter((p) => now - p.t <= 100);
      let velocity = 0;
      if (recent.length >= 2) {
        const first = recent[0]!;
        const last = recent[recent.length - 1]!;
        const dt = last.t - first.t;
        if (dt > 0) velocity = (last.y - first.y) / dt;
      }
      dragStateRef.current = null;
      setDragging(false);
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        /* capture may already be released */
      }
      if (shouldDismissSwipe({ finalDy, velocity })) {
        setDragY(window.innerHeight);
        setTimeout(() => {
          setDragY(0);
          onClose();
        }, 180);
        return;
      }
      setDragY(0);
    },
    [onClose],
  );

  useEffect(() => {
    return () => {
      dragStateRef.current = null;
    };
  }, []);

  if (!open) return null;

  return (
    <>
      <div
        className="cp-bottom-sheet-backdrop"
        onClick={onClose}
        aria-hidden
        data-testid={testId ? `${testId}-backdrop` : "bottom-sheet-backdrop"}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={ariaLabelledById}
        data-testid={testId ?? "bottom-sheet"}
        className={`cp-bottom-sheet${dragging ? " dragging" : ""}`}
        style={dragY > 0 ? { transform: `translateY(${dragY}px)` } : undefined}
      >
        <div
          className="cp-bottom-sheet-grab"
          data-testid={testId ? `${testId}-grab` : "bottom-sheet-grab"}
          onPointerDown={onDragPointerDown}
          onPointerMove={onDragPointerMove}
          onPointerUp={finishDrag}
          onPointerCancel={finishDrag}
        >
          <span className="grip" />
        </div>
        {title && (
          <div className="cp-bottom-sheet-head">
            {title}
            <button
              type="button"
              className="cp-bottom-sheet-close"
              aria-label="Close"
              onClick={onClose}
              data-testid={testId ? `${testId}-close` : "bottom-sheet-close"}
            >
              ✕
            </button>
          </div>
        )}
        <div className="cp-bottom-sheet-body">{children}</div>

        <style jsx>{`
          .cp-bottom-sheet-backdrop {
            position: fixed;
            inset: 0;
            background: rgba(0, 0, 0, 0.45);
            z-index: 60;
          }
          .cp-bottom-sheet {
            position: fixed;
            right: 0;
            top: 0;
            bottom: 0;
            width: min(440px, 100vw);
            background: var(--cp-surface);
            border-left: 1px solid var(--cp-border);
            z-index: 61;
            display: flex;
            flex-direction: column;
            transition: transform 200ms ease-out;
          }
          .cp-bottom-sheet.dragging {
            transition: none;
          }
          .cp-bottom-sheet-grab {
            display: none;
          }
          @media (max-width: 768px) {
            .cp-bottom-sheet {
              top: auto;
              left: 0;
              right: 0;
              width: 100%;
              max-height: 90vh;
              border-left: none;
              border-top: 1px solid var(--cp-border);
              border-radius: 16px 16px 0 0;
              animation: cp-bottom-sheet-slide-up 240ms ease-out;
            }
            .cp-bottom-sheet-grab {
              display: flex;
              justify-content: center;
              align-items: center;
              padding: 10px 0 4px;
              touch-action: none;
              cursor: grab;
            }
            .cp-bottom-sheet-grab .grip {
              width: 40px;
              height: 4px;
              border-radius: 2px;
              background: var(--cp-border-strong);
            }
          }
          @keyframes cp-bottom-sheet-slide-up {
            from { transform: translateY(100%); }
            to { transform: translateY(0); }
          }
          @media (prefers-reduced-motion: reduce) {
            .cp-bottom-sheet { animation: none; transition: none; }
          }
          .cp-bottom-sheet-head {
            display: flex;
            align-items: flex-start;
            justify-content: space-between;
            gap: 8px;
            padding: 14px 20px 8px;
            border-bottom: 1px solid var(--cp-border);
          }
          .cp-bottom-sheet-close {
            background: transparent;
            border: 0;
            color: var(--cp-text-muted);
            font-size: 18px;
            cursor: pointer;
            padding: 4px 8px;
            border-radius: 6px;
          }
          .cp-bottom-sheet-close:hover {
            background: var(--cp-bg);
            color: var(--cp-text);
          }
          .cp-bottom-sheet-body {
            padding: 16px 20px 28px;
            overflow-y: auto;
            flex: 1;
          }
        `}</style>
      </div>
    </>
  );
}
