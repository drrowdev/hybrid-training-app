"use client";

/**
 * TmSourceDetail — collapsed expander next to a derived TM row.
 *
 * Shows the source set (date + weight × reps + RPE), the formula, and a
 * "Lock as entered 1RM" button that calls a server action to clear the
 * derived columns. The user owns their TM — they can convert any estimate
 * into a deliberate value with one click.
 */
import { useState, useTransition } from "react";
import Link from "next/link";
import type { TmRow, TmSourceSet } from "@/lib/training-maxes/queries";
import { formatDate, type ProfileForFormat } from "@/lib/format/datetime";

function fmtNum(n: number | null): string {
  if (n == null) return "—";
  return Number.isInteger(n) ? n.toString() : n.toFixed(1).replace(/\.0$/, "");
}

export function TmSourceDetail({
  row,
  sourceSet,
  lockAction,
  formatProfile,
}: {
  row: TmRow;
  sourceSet: TmSourceSet | null;
  lockAction: (fd: FormData) => Promise<unknown>;
  formatProfile?: ProfileForFormat;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  if (row.source === "entered") return null;

  const onLock = () => {
    const fd = new FormData();
    fd.set("id", row.id);
    startTransition(async () => {
      await lockAction(fd);
    });
  };

  return (
    <div
      data-testid="tm-source-detail"
      style={{
        marginTop: 6,
        fontSize: 12,
        color: "var(--cp-text-muted)",
        lineHeight: 1.5,
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={`tm-source-detail-body-${row.id}`}
        className="cp-link"
        style={{
          background: "transparent",
          border: "none",
          padding: 0,
          fontSize: 12,
          fontWeight: 500,
        }}
      >
        {open ? "Hide source" : "Where did this come from?"}
      </button>
      {open && (
        <div
          id={`tm-source-detail-body-${row.id}`}
          style={{
            marginTop: 8,
            padding: 10,
            background: "var(--cp-surface-soft, var(--cp-surface))",
            border: "1px solid var(--cp-border)",
            borderRadius: 8,
            display: "grid",
            gap: 6,
          }}
        >
          <div>
            <span style={{ color: "var(--cp-text-muted)" }}>Source · </span>
            <span style={{ color: "var(--cp-text)" }}>
              Estimated from your top set
            </span>
          </div>
          {sourceSet ? (
            <div>
              <span style={{ color: "var(--cp-text-muted)" }}>Source set · </span>
              <Link
                href={`/app/sessions/${sourceSet.sessionId}`}
                className="cp-link"
              >
                <span className="mono" style={{ color: "var(--cp-text)" }}>
                  {fmtNum(sourceSet.weightKg)} kg × {fmtNum(sourceSet.reps)}
                  {sourceSet.rpe != null ? ` @ RPE ${fmtNum(sourceSet.rpe)}` : ""}
                </span>{" "}
                <span style={{ color: "var(--cp-text-muted)" }}>
                  · {formatDate(sourceSet.performedAt, formatProfile ?? null)}
                </span>
              </Link>
            </div>
          ) : (
            <div style={{ color: "var(--cp-text-muted)" }}>Source set no longer available.</div>
          )}
          <div>
            <button
              type="button"
              onClick={onLock}
              disabled={pending}
              data-testid="tm-lock-as-entered"
              className="cp-btn ghost"
              style={{
                marginTop: 4,
                fontSize: 11,
                padding: "5px 10px",
                color: pending ? "var(--cp-text-muted)" : "var(--cp-text)",
              }}
            >
              {pending ? "Locking…" : "Lock as entered 1RM"}
            </button>
            <span
              style={{
                marginLeft: 10,
                fontSize: 11,
                color: "var(--cp-text-muted)",
              }}
            >
              Treats this number as your deliberate entry. The link to the
              source set is cleared.
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
