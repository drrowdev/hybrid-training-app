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
import type { PrescriptionItem } from "@hta/db";
import type { InsertDeloadResult } from "@/lib/planner/deload-week-actions";
import {
  RECOVERY_PERCENT_MAX,
  RECOVERY_PERCENT_MIN,
} from "@/lib/planner/recovery-week-bounds";

/** One-line plain-English summary of a recovery session's content. */
function summariseSession(s: DeloadSessionSpec): string {
  const items = s.prescription.items;
  const mains = new Map<string, { name: string; sets: number; item: PrescriptionItem }>();
  let easyCardio = false;
  for (const it of items) {
    if (it.kind === "main") {
      const name = it.movementName ?? it.movementSlug ?? "Main lift";
      const seen = mains.get(it.movementId);
      mains.set(it.movementId, {
        name,
        sets: (seen?.sets ?? 0) + 1,
        item: seen?.item ?? it,
      });
    } else if (it.kind.startsWith("cardio")) {
      easyCardio = true;
    }
  }
  const parts: string[] = [];
  for (const main of mains.values()) {
    const reps = main.item.repRange
      ? `${main.item.repRange.min}–${main.item.repRange.max}`
      : String(main.item.reps ?? "");
    const load = main.item.percentTm != null ? ` @ ${main.item.percentTm}%` : "";
    parts.push(`${main.name} ${main.sets}×${reps}${load}`);
  }
  if (easyCardio) parts.push("easy cardio");
  return parts.length ? parts.join(" · ") : "Recovery";
}

export function DeloadWeekCard({
  preview,
  insertAction,
  previewAction,
  autoOpen = false,
  variant = "banner",
  resolveRecommendationId,
  resolveAction,
}: {
  preview: DeloadWeekPreview;
  insertAction: (
    percent?: number,
    boundaryKey?: string,
    recommendationId?: string,
  ) => Promise<InsertDeloadResult>;
  /** Rebuilds the preview when the lifter changes the working percentage. */
  previewAction?: (
    percent?: number,
    boundaryKey?: string,
    recommendationId?: string,
  ) => Promise<DeloadWeekPreview | null>;
  /** Open the preview modal on mount (e.g. deep-linked from the TB deload banner). */
  autoOpen?: boolean;
  /**
   * "banner" — prominent fatigue nudge (shown only when fatigue signals fire).
   * "quiet" — always-available compact control in the program-controls section.
   */
  variant?: "banner" | "quiet";
  /**
   * The nudge that sent the lifter here. Cleared once the week is actually in
   * the plan, so a failed insert leaves the nudge standing.
   */
  resolveRecommendationId?: string;
  resolveAction?: (id: string) => Promise<{ ok: true } | { ok: false; error: string }>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(autoOpen);
  const [done, setDone] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [live, setLive] = useState<DeloadWeekPreview>(preview);
  const [percent, setPercent] = useState<number>(preview.percent);
  const boundaryKey = preview.boundaryKey;

  const changePercent = (next: number) => {
    setPercent(next);
    if (!previewAction) return;
    startTransition(async () => {
      const rebuilt = await previewAction(next, boundaryKey, resolveRecommendationId);
      if (rebuilt) setLive(rebuilt);
    });
  };

  const apply = () => {
    setError(null);
    startTransition(async () => {
      const res = await insertAction(
        live.restOnly ? undefined : percent,
        boundaryKey,
        resolveRecommendationId,
      );
      if (!res.ok) {
        setError(res.error);
        return;
      }
      if (resolveRecommendationId && resolveAction) {
        await resolveAction(resolveRecommendationId);
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
            ✓ Recovery week added.
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
          ✓ Recovery week added.
        </div>
      ) : (
        <>
          <div style={{ fontSize: 13, color: "var(--cp-text)", lineHeight: 1.5 }}>
            Insert a <strong>recovery week</strong>{" "}
            {live.restOnly
              ? "— rest and easy conditioning"
              : `— mains at ${live.percent}\u00A0%, easy conditioning, no accessories`}
            {` — after week ${live.afterWeek + 1}. Every later week shifts back one.`}
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
                {`Goes in after week ${live.afterWeek + 1}. Every later week shifts back one.`}
              </p>
            </div>

            <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: 6 }}>
              {live.sessions.map((s) => (
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

            {!live.restOnly && (
              <div style={{ display: "grid", gap: 6 }} data-testid="deload-week-percent">
                <label
                  htmlFor="recovery-percent"
                  style={{ fontSize: 13, color: "var(--cp-text)", fontWeight: 600 }}
                >
                  Working weight
                </label>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <input
                    id="recovery-percent"
                    type="range"
                    min={RECOVERY_PERCENT_MIN}
                    max={RECOVERY_PERCENT_MAX}
                    step={1}
                    value={percent}
                    disabled={pending || !previewAction}
                    onChange={(e) => changePercent(Number(e.target.value))}
                    style={{ flex: 1 }}
                  />
                  <span
                    style={{ fontSize: 13, color: "var(--cp-text)", minWidth: 40, textAlign: "right" }}
                  >
                    {percent}%
                  </span>
                </div>
                {live.recommendedPercent && (
                  <div style={{ fontSize: 12, color: "var(--cp-text-muted)" }}>
                    {`Your program suggests ${live.recommendedPercent.min}–${live.recommendedPercent.max}%.`}
                  </div>
                )}
                {live.outsideRecommended && (
                  <div
                    role="note"
                    data-testid="deload-week-percent-warning"
                    style={{ fontSize: 12, color: "var(--cp-text-muted)" }}
                  >
                    {"That's outside what your program suggests for a recovery week."}
                  </div>
                )}
              </div>
            )}

            {live.eventWarning && (
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
