"use client";

/**
 * DeloadWeekCard — user-initiated recovery week (ADR 0049).
 *
 * Always available on an active block (not an auto-surfaced offer): the user
 * decides when they need a deload. Pressing "Take a recovery week" opens a
 * PREVIEW of the exact light week that will be inserted; on Accept it calls the
 * insert action, which renumbers later weeks and drops in a standalone deload
 * week — no programmed training week is lost. Mirrors the DeloadSkipCard /
 * VolumeAutoregCard confirm-modal pattern.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { DeloadWeekPreview } from "@/lib/planner/deload-week-preview";
import type { DeloadSessionSpec } from "@/lib/planner/deload-week";
import type { InsertDeloadResult } from "@/lib/planner/deload-week-actions";

/** One-line plain-English summary of a deload session's content. */
function summariseSession(s: DeloadSessionSpec): string {
  const items = s.prescription.items;
  const mains = new Map<string, string>();
  let easyCardio = false;
  for (const it of items) {
    if (it.kind === "main") {
      mains.set(it.movementId, it.movementName ?? it.movementSlug ?? "Main lift");
    } else if (it.kind.startsWith("cardio")) {
      easyCardio = true;
    }
  }
  const parts: string[] = [];
  for (const name of mains.values()) parts.push(`${name} 3×5 light`);
  if (easyCardio) parts.push("easy Z2 cardio");
  return parts.length ? parts.join(" · ") : "Recovery";
}

export function DeloadWeekCard({
  preview,
  insertAction,
  autoOpen = false,
  variant = "banner",
}: {
  preview: DeloadWeekPreview;
  insertAction: () => Promise<InsertDeloadResult>;
  /** Open the preview modal on mount (e.g. deep-linked from the TB deload banner). */
  autoOpen?: boolean;
  /**
   * "banner" — prominent fatigue nudge (shown only when fatigue signals fire).
   * "quiet" — always-available compact control in the program-controls section.
   */
  variant?: "banner" | "quiet";
}) {
  const router = useRouter();
  const [open, setOpen] = useState(autoOpen);
  const [done, setDone] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const apply = () => {
    setError(null);
    startTransition(async () => {
      const res = await insertAction();
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setDone(true);
      setOpen(false);
      router.refresh();
    });
  };

  if (dismissed) return null;

  const quiet = variant === "quiet";

  return (
    <section
      className="cp-card"
      role="status"
      data-testid={quiet ? "deload-week-quiet" : "deload-week-card"}
      style={
        quiet
          ? {
              padding: "12px 16px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
            }
          : {
              padding: "14px 18px",
              display: "grid",
              gap: 8,
              borderColor: "var(--cp-accent)",
              background: "color-mix(in oklab, var(--cp-accent) 6%, transparent)",
            }
      }
    >
      {quiet ? (
        done ? (
          <div style={{ fontSize: 13, color: "var(--cp-text)" }} data-testid="deload-week-done">
            ✓ Recovery week added — it&apos;s next, then your block resumes.
          </div>
        ) : (
          <>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: "var(--cp-text)" }}>
                Take a recovery week
              </div>
              <div style={{ fontSize: 12, color: "var(--cp-text-muted)", marginTop: 2 }}>
                Insert a lighter week whenever you need to back off — nothing is skipped.
              </div>
            </div>
            <button
              type="button"
              className="cp-btn"
              data-testid="deload-week-review"
              onClick={() => setOpen(true)}
              style={{ fontSize: 13, padding: "7px 14px", flex: "none" }}
            >
              Review…
            </button>
          </>
        )
      ) : (
        <>
          <div
            style={{
              fontSize: 11,
              color: "var(--cp-accent)",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              fontWeight: 600,
            }}
          >
            Recovery — your call
          </div>

      {done ? (
        <div style={{ fontSize: 13, color: "var(--cp-text)" }} data-testid="deload-week-done">
          ✓ Recovery week added. Take it easy this week — your next planned week
          picks up right after it.
        </div>
      ) : (
        <>
          <div style={{ fontSize: 13, color: "var(--cp-text)", lineHeight: 1.5 }}>
            Insert a <strong>recovery week</strong> — a lighter week
            now (mains at 40/50/60&nbsp;%, easy conditioning, no accessories), then
            resume <strong>exactly</strong> the week you were about to do. Nothing is
            skipped; your block just runs a week longer.
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              className="cp-btn"
              data-testid="deload-week-review"
              onClick={() => setOpen(true)}
              style={{ fontSize: 13, padding: "7px 14px" }}
            >
              Take a recovery week…
            </button>
            <button
              type="button"
              className="cp-btn ghost"
              data-testid="deload-week-dismiss"
              onClick={() => setDismissed(true)}
              style={{ fontSize: 13, padding: "7px 14px" }}
            >
              Not now
            </button>
          </div>
        </>
      )}
        </>
      )}

      {open && !done && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Confirm recovery week"
          data-testid="deload-week-modal"
          onClick={() => !pending && setOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.5)",
            display: "grid",
            placeItems: "center",
            zIndex: 60,
            padding: 16,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="cp-card"
            style={{ maxWidth: 480, width: "100%", padding: 20, display: "grid", gap: 14 }}
          >
            <div style={{ display: "grid", gap: 4 }}>
              <h2 style={{ margin: 0, fontSize: 18, letterSpacing: "-0.01em" }}>
                Your recovery week
              </h2>
              <p style={{ margin: 0, fontSize: 13, color: "var(--cp-text-muted)", lineHeight: 1.5 }}>
                This light week is inserted next; every later week shifts back one,
                so you resume exactly where you left off.
              </p>
            </div>

            <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: 6 }}>
              {preview.sessions.map((s) => (
                <li
                  key={`${s.dayIndex}-${s.slot}`}
                  style={{
                    fontSize: 13,
                    color: "var(--cp-text)",
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 12,
                    borderBottom: "1px solid var(--cp-border)",
                    paddingBottom: 4,
                  }}
                >
                  <span style={{ fontWeight: 600 }}>{s.title}</span>
                  <span style={{ color: "var(--cp-text-muted)", textAlign: "right" }}>
                    {summariseSession(s)}
                  </span>
                </li>
              ))}
            </ul>

            {preview.eventWarning && (
              <div
                role="note"
                data-testid="deload-week-event-warning"
                style={{ fontSize: 12, color: "var(--cp-text-muted)", lineHeight: 1.5 }}
              >
                ⚠️ You have an upcoming A-priority event — adding a week pushes the
                rest of your block (and any peak) back by a week. Check it still lines
                up with your event.
              </div>
            )}

            {error && (
              <div role="alert" style={{ fontSize: 12, color: "var(--cp-danger)" }}>
                {error}
              </div>
            )}

            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button
                type="button"
                className="cp-btn ghost"
                data-testid="deload-week-cancel"
                onClick={() => setOpen(false)}
                disabled={pending}
              >
                Cancel
              </button>
              <button
                type="button"
                className="cp-btn primary"
                data-testid="deload-week-accept"
                onClick={apply}
                disabled={pending}
              >
                {pending ? "Adding…" : "Add recovery week"}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
