"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { endBlock } from "@/lib/planner/actions";
import { EndBlockForm } from "./EndBlockForm";

export function PlanProgramActions({
  blockId,
  canEdit,
  editHref,
  startNewHref,
  endAction,
  recoveryControl,
}: {
  blockId: string;
  canEdit: boolean;
  editHref: string;
  startNewHref: string;
  endAction: typeof endBlock;
  recoveryControl?: ReactNode;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [panel, setPanel] = useState<"recovery" | "end" | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const moreRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
        setPanel(null);
      }
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", key);
    };
  }, []);

  useEffect(() => {
    if (!panel || !panelRef.current) return;
    const panelElement = panelRef.current;
    const triggerElement = moreRef.current;
    const focusables = () =>
      Array.from(
        panelElement.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
    focusables()[0]?.focus();
    const trap = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const items = focusables();
      if (items.length === 0) {
        event.preventDefault();
        return;
      }
      const first = items[0]!;
      const last = items[items.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", trap);
    return () => {
      document.removeEventListener("keydown", trap);
      requestAnimationFrame(() => triggerElement?.focus());
    };
  }, [panel]);

  return (
    <div className="plan-program-actions" ref={rootRef}>
      {canEdit && (
        <Link
          href={editHref}
          className="cp-btn primary"
          data-testid="edit-plan"
        >
          Edit program
        </Link>
      )}
      <Link
        href="/app/plan/history"
        className="cp-btn"
        data-testid="plan-history"
      >
        History
      </Link>
      <button
        ref={moreRef}
        type="button"
        className="cp-btn plan-program-more"
        aria-label="More program actions"
        aria-expanded={menuOpen}
        data-testid="program-actions-more"
        onClick={() => setMenuOpen((open) => !open)}
      >
        ⋯
      </button>
      {menuOpen && (
        <div
          className="plan-program-menu"
          role="menu"
          data-testid="program-actions-menu"
        >
          {recoveryControl && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setPanel("recovery");
                setMenuOpen(false);
              }}
            >
              Add recovery week
            </button>
          )}
          <Link
            href="/app/plan/history"
            role="menuitem"
            className="plan-program-mobile-history"
          >
            History
          </Link>
          <Link href={startNewHref} role="menuitem" data-testid="start-new-block">
            Start a new program
          </Link>
          <div className="plan-program-menu-separator" />
          <button
            type="button"
            role="menuitem"
            className="danger"
            data-testid="program-actions-end"
            onClick={() => {
              setPanel("end");
              setMenuOpen(false);
            }}
          >
            End program
          </button>
        </div>
      )}
      {panel && (
        <div
          className="plan-program-panel-backdrop"
          onClick={(event) => {
            if (event.target === event.currentTarget) setPanel(null);
          }}
        >
          <div
            ref={panelRef}
            className="plan-program-panel cp-card"
            role="dialog"
            aria-modal="true"
            aria-label={
              panel === "recovery" ? "Add recovery week" : "End program"
            }
          >
            <div className="plan-program-panel-head">
              <strong>
                {panel === "recovery" ? "Add recovery week" : "End program"}
              </strong>
              <button
                type="button"
                aria-label="Close"
                data-testid="program-panel-close"
                onClick={() => setPanel(null)}
              >
                ×
              </button>
            </div>
            {panel === "recovery" ? (
              recoveryControl
            ) : (
              <EndBlockForm
                blockId={blockId}
                action={endAction}
                initiallyOpen
                onClose={() => setPanel(null)}
              />
            )}
          </div>
        </div>
      )}
      <style>{`
        .plan-program-actions {
          position: relative;
          display: flex;
          align-items: center;
          gap: 8px;
          flex: 0 0 auto;
        }
        .plan-program-actions .cp-btn {
          min-height: 44px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          text-decoration: none;
        }
        .plan-program-more {
          width: 44px;
          padding-inline: 0;
          font-size: 19px;
        }
        .plan-program-menu {
          position: absolute;
          z-index: 30;
          top: calc(100% + 6px);
          right: 0;
          width: 224px;
          display: grid;
          padding: 6px;
          border: 1px solid var(--cp-border);
          border-radius: 10px;
          background: var(--cp-surface);
          box-shadow: var(--cp-shadow);
        }
        .plan-program-menu > button,
        .plan-program-menu > a {
          min-height: 42px;
          display: flex;
          align-items: center;
          padding: 8px 10px;
          border: 0;
          border-radius: 8px;
          background: transparent;
          color: var(--cp-text);
          text-decoration: none;
          text-align: left;
          cursor: pointer;
        }
        .plan-program-menu > button:hover,
        .plan-program-menu > a:hover {
          background: var(--cp-surface-soft);
        }
        .plan-program-menu > .danger { color: var(--cp-danger); }
        .plan-program-mobile-history { display: none !important; }
        .plan-program-menu-separator {
          height: 1px;
          margin: 5px 4px;
          background: var(--cp-border);
        }
        .plan-program-panel-backdrop {
          position: fixed;
          z-index: 70;
          inset: 0;
          display: grid;
          place-items: center;
          padding: 16px;
          background: var(--cp-overlay);
        }
        .plan-program-panel {
          width: min(560px, 100%);
          max-height: min(80vh, 720px);
          overflow: auto;
          padding: 18px;
          background: var(--cp-surface);
          box-shadow: var(--cp-shadow);
        }
        .plan-program-panel-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          margin-bottom: 14px;
        }
        .plan-program-panel-head strong { font-size: 16px; }
        .plan-program-panel-head button {
          width: 44px;
          height: 44px;
          border: 0;
          background: transparent;
          color: var(--cp-text-muted);
          font-size: 22px;
          cursor: pointer;
        }
        @media (max-width: 640px) {
          .plan-program-actions {
            width: 100%;
          }
          .plan-program-actions .cp-btn.primary { flex: 1; }
          .plan-program-actions > .cp-btn:not(.primary):not(.plan-program-more) {
            display: none;
          }
          .plan-program-menu { left: 0; right: auto; width: 100%; }
          .plan-program-mobile-history { display: flex !important; }
          .plan-program-panel-backdrop {
            align-items: end;
            padding: 0;
          }
          .plan-program-panel {
            width: 100%;
            max-height: 88vh;
            border-radius: 16px 16px 0 0;
            padding-bottom: 28px;
          }
        }
      `}</style>
    </div>
  );
}
