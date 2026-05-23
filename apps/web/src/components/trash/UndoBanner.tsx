"use client";

/**
 * UndoBanner — bottom-of-viewport (mobile) / top-right toast (desktop)
 * banner that appears after any soft-delete and offers an Undo
 * affordance.
 *
 * AGENTS.md DC-K4 ("override-and-warn, never silent overrule") — for
 * destructive but reversible actions, a one-tap Undo banner is the
 * canonical safety net. We deliberately do NOT show a confirmation
 * modal before the delete fires: the banner IS the confirmation, and
 * the soft-delete itself is reversible for 30 days via the Trash
 * page even after the banner dismisses.
 *
 * Wiring:
 *   - Mounted once in the app shell (AppShell.tsx).
 *   - Listens for the global `hta-undo-banner` CustomEvent —
 *     `dispatchUndoBanner({ kind, id, label })` from any client
 *     component or button after a successful soft-delete.
 *   - On Undo, POSTs to the matching restore API route, dismisses,
 *     then refreshes the route so the restored item reappears in
 *     lists.
 *
 * Lifecycle:
 *   - Auto-dismisses after 10 s.
 *   - Auto-dismisses on the next route change (pathname watcher).
 *   - Manual close button always available.
 *
 * Mobile vs desktop placement is handled with a media query inline so
 * the component stays self-contained and doesn't need a global stylesheet
 * change.
 */
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

export type UndoTarget = {
  kind: "session" | "block";
  id: string;
  /** Human label like "Session" or "Strength Focus block" — shown in the banner. */
  label: string;
};

const EVENT_NAME = "hta-undo-banner";
const AUTO_DISMISS_MS = 10_000;

/** Dispatch from any client component after a successful soft-delete. */
export function dispatchUndoBanner(target: UndoTarget): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<UndoTarget>(EVENT_NAME, { detail: target }));
}

export function UndoBanner(): React.ReactElement | null {
  const router = useRouter();
  const pathname = usePathname();
  const [target, setTarget] = useState<UndoTarget | null>(null);
  const [restoring, setRestoring] = useState(false);
  const timerRef = useRef<number | null>(null);
  const lastPathRef = useRef<string | null>(pathname);

  const dismiss = useCallback(() => {
    setTarget(null);
    if (timerRef.current != null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // Subscribe to the global event.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<UndoTarget>).detail;
      if (!detail || !detail.id || !detail.kind) return;
      setTarget(detail);
      if (timerRef.current != null) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => {
        setTarget(null);
        timerRef.current = null;
      }, AUTO_DISMISS_MS);
    };
    window.addEventListener(EVENT_NAME, handler);
    return () => {
      window.removeEventListener(EVENT_NAME, handler);
      if (timerRef.current != null) window.clearTimeout(timerRef.current);
    };
  }, []);

  // Auto-dismiss on route change. The shell stays mounted across routes
  // so we watch pathname rather than relying on remount.
  useEffect(() => {
    if (lastPathRef.current !== pathname) {
      lastPathRef.current = pathname;
      dismiss();
    }
  }, [pathname, dismiss]);

  const onUndo = useCallback(async () => {
    if (!target || restoring) return;
    setRestoring(true);
    try {
      const url =
        target.kind === "session"
          ? `/api/sessions/${target.id}/restore`
          : `/api/blocks/${target.id}/restore`;
      await fetch(url, { method: "POST" });
    } finally {
      setRestoring(false);
      dismiss();
      router.refresh();
    }
  }, [target, restoring, dismiss, router]);

  if (!target) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="undo-banner"
      data-kind={target.kind}
      data-id={target.id}
      className="hta-undo-banner"
    >
      <span className="hta-undo-banner-label">{target.label} deleted</span>
      <button
        type="button"
        onClick={onUndo}
        disabled={restoring}
        data-testid="undo-banner-undo"
        className="hta-undo-banner-action"
      >
        {restoring ? "Restoring…" : "Undo"}
      </button>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss"
        className="hta-undo-banner-close"
      >
        ×
      </button>
      <style jsx>{`
        .hta-undo-banner {
          position: fixed;
          z-index: 60;
          display: flex;
          align-items: center;
          gap: 14px;
          padding: 12px 16px;
          background: var(--cp-panel-strong, rgba(15, 18, 24, 0.95));
          color: var(--cp-text-on-strong, #fff);
          border-radius: 10px;
          box-shadow: var(--cp-shadow, 0 8px 24px rgba(0, 0, 0, 0.18));
          font-size: 14px;
          animation: hta-undo-slide-in 180ms ease-out;
        }
        .hta-undo-banner-label {
          font-weight: 500;
        }
        .hta-undo-banner-action {
          appearance: none;
          background: transparent;
          color: var(--cp-accent, #f4c95d);
          border: 1px solid currentColor;
          border-radius: 6px;
          padding: 6px 12px;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          min-height: 32px;
        }
        .hta-undo-banner-action:disabled {
          opacity: 0.6;
          cursor: progress;
        }
        .hta-undo-banner-close {
          appearance: none;
          background: transparent;
          color: inherit;
          border: none;
          font-size: 22px;
          line-height: 1;
          cursor: pointer;
          padding: 0 4px;
          opacity: 0.6;
        }
        .hta-undo-banner-close:hover {
          opacity: 1;
        }

        /* Desktop: top-right toast. */
        @media (min-width: 641px) {
          .hta-undo-banner {
            top: 18px;
            right: 18px;
          }
        }
        /* Mobile: full-width sticky at bottom, above the tab bar. */
        @media (max-width: 640px) {
          .hta-undo-banner {
            left: 12px;
            right: 12px;
            bottom: calc(86px + env(safe-area-inset-bottom));
            justify-content: space-between;
            animation: hta-undo-slide-up 180ms ease-out;
          }
        }
        @keyframes hta-undo-slide-in {
          from { transform: translateY(-12px); opacity: 0; }
          to   { transform: translateY(0);     opacity: 1; }
        }
        @keyframes hta-undo-slide-up {
          from { transform: translateY(20px); opacity: 0; }
          to   { transform: translateY(0);    opacity: 1; }
        }
      `}</style>
    </div>
  );
}
