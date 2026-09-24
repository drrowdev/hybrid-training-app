"use client";

/**
 * Today banner for program-owned recommendations (platform cutover).
 *
 * Self-contained: rendered additively at the top of Today, mirroring the
 * existing OverdueNotice / RegionSpikeBanner pattern. Informational — each
 * recommendation has a dismiss action. Load advice links to the owning
 * program's supported controls rather than changing account measurements.
 */
import { useState, useTransition } from "react";
import Link from "next/link";
import type { PendingProgramRecommendation } from "@/lib/platform/recommendations-queries";

type DismissAction = (id: string) => Promise<{ ok: true } | { ok: false; error: string }>;

/**
 * A CTA target derived from a recommendation. `next-block` routes to the program
 * picker's next phase; `deload` routes to the Plan page's existing recovery-week
 * card (deep-linked to auto-open its preview) so the deload nudge reuses the one
 * deload workflow rather than spawning a parallel one. The deload link carries
 * the boundary the program named, so the week lands where the program advised
 * rather than wherever the lifter happens to be when they open it.
 */
function advanceTarget(
  r: PendingProgramRecommendation,
): { href: string; label: string } | null {
  if (r.reviewHref) {
    return {
      href: r.reviewHref,
      label: r.reviewHref.startsWith("/app/program?edit=") ? "Review loads" : "Open program",
    };
  }
  if (r.kind === "deload") {
    if (!r.blockId) return null;
    if (r.programStatus === "completed") {
      return r.sourceProgramId ? {
        href: `/app/program?program=${encodeURIComponent(r.sourceProgramId)}&recommendation=${encodeURIComponent(r.id)}`,
        label: "Plan a recovery week",
      } : { href: `/app/stats/blocks/${encodeURIComponent(r.blockId)}`, label: "Open program" };
    }
    const params = new URLSearchParams({ deload: "1", rec: r.id, block: r.blockId });
    if (r.occurrenceKey) params.set("boundary", r.occurrenceKey);
    return {
      href: `/app/plan?${params.toString()}`,
      label: "Take a recovery week \u2192",
    };
  }
  const d = r.data;
  if (r.kind !== "next-block" || !d) return null;
  const programId = typeof d.programId === "string" ? d.programId : null;
  const nextPhaseId = typeof d.nextPhaseId === "string" ? d.nextPhaseId : null;
  const nextPhaseName = typeof d.nextPhaseName === "string" ? d.nextPhaseName : null;
  if (!programId || !nextPhaseId) return null;
  return {
    href: `/app/program?program=${encodeURIComponent(programId)}&phase=${encodeURIComponent(nextPhaseId)}&recommendation=${encodeURIComponent(r.id)}`,
    label: nextPhaseName ? `Set up ${nextPhaseName} \u2192` : "Set up next phase \u2192",
  };
}

export function ProgramRecommendationsBanner({
  recommendations,
  dismissAction,
  programNames = {},
}: {
  recommendations: PendingProgramRecommendation[];
  dismissAction: DismissAction;
  programNames?: Readonly<Record<string, string>>;
}) {
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const visible = recommendations.filter((r) => !hidden.has(r.id));
  if (visible.length === 0 && !error) return null;

  function dismiss(id: string) {
    setError(null);
    setHidden((prev) => new Set(prev).add(id));
    startTransition(async () => {
      try {
        const result = await dismissAction(id);
        if (result.ok) return;
        setError(result.error);
      } catch {
        setError("Couldn't dismiss this recommendation. Try again.");
      }
      setHidden((previous) => {
        const next = new Set(previous);
        next.delete(id);
        return next;
      });
    });
  }

  return (
    <div style={{ display: "grid", gap: 8, marginBottom: 16 }}>
      {error && <p role="alert">{error}</p>}
      {visible.map((r) => {
        const advance = advanceTarget(r);
        const programName = (r.blockId ? programNames[r.blockId] : null) ?? r.programName;
        return (
        <div
          key={r.id}
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "flex-start",
            gap: 12,
            padding: "12px 14px",
            borderRadius: 10,
            border: "1px solid var(--cp-border)",
            background: "var(--cp-accent-soft)",
          }}
        >
          <div style={{ flex: "1 1 200px", minWidth: 0, overflowWrap: "anywhere" }}>
            <div style={{ fontWeight: 600, fontSize: 14 }}>{programName ? `${programName} · ${r.title}` : r.title}</div>
            <div style={{ fontSize: 12.5, color: "var(--cp-text-muted)", marginTop: 3, lineHeight: 1.45 }}>
              {r.detail}
            </div>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {advance && (
              <Link
                href={advance.href}
                style={{
                  padding: "6px 12px",
                  minHeight: 44,
                  display: "inline-flex",
                  alignItems: "center",
                  borderRadius: 7,
                  textDecoration: "none",
                  background: "var(--cp-accent)",
                  border: "1px solid var(--cp-accent)",
                  color: "var(--cp-accent-fg)",
                  fontSize: 12,
                  fontWeight: 600,
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
                minHeight: 44,
                borderRadius: 7,
                cursor: pending ? "default" : "pointer",
                background: "transparent",
                border: "1px solid var(--cp-border)",
                color: "inherit",
                fontSize: 12,
                fontWeight: 500,
              }}
            >
              Dismiss
            </button>
          </div>
        </div>
        );
      })}
    </div>
  );
}
