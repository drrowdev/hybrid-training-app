"use client";

/**
 * Today banner for program-owned recommendations (platform cutover).
 *
 * Self-contained: rendered additively at the top of Today, mirroring the
 * existing OverdueNotice / RegionSpikeBanner pattern. Informational — each
 * recommendation has a "Got it" dismiss. Actual TM changes still flow through
 * the separate AMRAP→TM-bump banner; these are nudges (retest your maxes,
 * start your next block, 7th-week verdict, …).
 */
import { useState, useTransition } from "react";
import Link from "next/link";
import type { PendingProgramRecommendation } from "@/lib/platform/recommendations-queries";

type DismissAction = (id: string) => Promise<{ ok: true } | { ok: false; error: string }>;

/** A "set up the next phase" target derived from a next-block recommendation's data. */
function advanceTarget(
  r: PendingProgramRecommendation,
): { href: string; label: string } | null {
  const d = r.data;
  if (r.kind !== "next-block" || !d) return null;
  const programId = typeof d.programId === "string" ? d.programId : null;
  const nextPhaseId = typeof d.nextPhaseId === "string" ? d.nextPhaseId : null;
  const nextPhaseName = typeof d.nextPhaseName === "string" ? d.nextPhaseName : null;
  if (!programId || !nextPhaseId) return null;
  return {
    href: `/app/program?program=${encodeURIComponent(programId)}&phase=${encodeURIComponent(nextPhaseId)}`,
    label: nextPhaseName ? `Set up ${nextPhaseName} \u2192` : "Set up next phase \u2192",
  };
}

export function ProgramRecommendationsBanner({
  recommendations,
  dismissAction,
}: {
  recommendations: PendingProgramRecommendation[];
  dismissAction: DismissAction;
}) {
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [pending, startTransition] = useTransition();

  const visible = recommendations.filter((r) => !hidden.has(r.id));
  if (visible.length === 0) return null;

  function dismiss(id: string) {
    setHidden((prev) => new Set(prev).add(id));
    startTransition(async () => {
      await dismissAction(id);
    });
  }

  return (
    <div style={{ display: "grid", gap: 8, marginBottom: 16 }}>
      {visible.map((r) => {
        const advance = advanceTarget(r);
        return (
        <div
          key={r.id}
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 12,
            padding: "12px 14px",
            borderRadius: 10,
            border: "1px solid var(--cp-accent-dim, rgba(120,170,255,0.35))",
            background: "var(--cp-accent-soft, rgba(120,170,255,0.10))",
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: 14 }}>{r.title}</div>
            <div style={{ fontSize: 12.5, color: "var(--cp-text-muted, #999)", marginTop: 3, lineHeight: 1.45 }}>
              {r.detail}
            </div>
          </div>
          <div style={{ flex: "none", display: "flex", gap: 8 }}>
            {advance && (
              <Link
                href={advance.href}
                onClick={() => dismiss(r.id)}
                style={{
                  padding: "6px 12px",
                  borderRadius: 7,
                  textDecoration: "none",
                  background: "var(--cp-accent, #78aaff)",
                  border: "1px solid var(--cp-accent, #78aaff)",
                  color: "var(--cp-on-accent, #0b0b0b)",
                  fontSize: 12,
                  fontWeight: 600,
                  whiteSpace: "nowrap",
                }}
              >
                {advance.label}
              </Link>
            )}
            <button
              type="button"
              onClick={() => dismiss(r.id)}
              disabled={pending}
              style={{
                padding: "6px 12px",
                borderRadius: 7,
                cursor: pending ? "default" : "pointer",
                background: "transparent",
                border: "1px solid var(--cp-border, rgba(255,255,255,0.18))",
                color: "inherit",
                fontSize: 12,
                fontWeight: 500,
              }}
            >
              {advance ? "Not yet" : "Got it"}
            </button>
          </div>
        </div>
        );
      })}
    </div>
  );
}
