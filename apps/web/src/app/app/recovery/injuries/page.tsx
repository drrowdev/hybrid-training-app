/**
 * /app/recovery/injuries — self-serve limitations management.
 *
 * Replaces the older settings-page form (which is still wired at
 * /app/settings/limitations for back compat). Two sections:
 *
 *   1. Active limitations  — one card per row, inline resolve / edit.
 *   2. History             — collapsed accordion of resolved rows.
 *
 * Server component: pulls the rows in parallel, hands plain
 * serialisable shapes to the client components.
 *
 * NOTE: the engine's planner currently reads `limitations.region` to
 * apply the DC-V safety ceilings. The new `affected_muscles` /
 * `affected_movement_ids` arrays added in 0033 are NOT yet consumed
 * by the planner — that's the obvious next step (issue follow-up:
 * wire muscle / movement arrays into the planner's ceiling
 * computation, so a row with no region but a muscle selection still
 * applies a ceiling).
 */
import { redirect } from "next/navigation";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import { EmptyState } from "@/components/ui/EmptyState";
import { ALL_MUSCLE_GROUPS, type MuscleGroup } from "@/lib/muscle/muscle-groups";
import { ActiveLimitationCard } from "@/components/limitations/ActiveLimitationCard";
import { AddLimitationButton } from "@/components/limitations/AddLimitationButton";
import { HistorySection } from "@/components/limitations/HistorySection";
import { getFormatProfile } from "@/lib/format/profile";
import type {
  LimitationRow,
  MovementRef,
} from "@/components/limitations/types";

const MUSCLE_SET = new Set<string>(ALL_MUSCLE_GROUPS);

type RawRow = {
  id: string;
  kind: string | null;
  severity: "mild" | "moderate" | "severe";
  region: string | null;
  affected_muscles: string[] | null;
  affected_movement_ids: string[] | null;
  notes: string | null;
  expected_duration_days: number | null;
  started_at: string;
  resolved_at: string | null;
  engine_action: Record<string, unknown> | null;
};

function normaliseRow(r: RawRow): LimitationRow {
  return {
    id: r.id,
    kind: r.kind,
    severity: r.severity,
    region: r.region,
    affectedMuscles: (r.affected_muscles ?? []).filter((m): m is MuscleGroup =>
      MUSCLE_SET.has(m),
    ),
    affectedMovementIds: r.affected_movement_ids ?? [],
    notes: r.notes,
    expectedDurationDays: r.expected_duration_days,
    startedAt: r.started_at,
    resolvedAt: r.resolved_at,
    engineAction: r.engine_action ?? {},
  };
}

export const dynamic = "force-dynamic";

export default async function InjuriesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) redirect("/login");

  const [activeRes, resolvedRes, formatProfile] = await Promise.all([
    supabase
      .from("limitations")
      .select(
        "id, kind, severity, region, affected_muscles, affected_movement_ids, notes, expected_duration_days, started_at, resolved_at, engine_action",
      )
      .is("resolved_at", null)
      .order("started_at", { ascending: false })
      .limit(100),
    supabase
      .from("limitations")
      .select(
        "id, kind, severity, region, affected_muscles, affected_movement_ids, notes, expected_duration_days, started_at, resolved_at, engine_action",
      )
      .not("resolved_at", "is", null)
      .order("resolved_at", { ascending: false })
      .limit(100),
    getFormatProfile(supabase, user.id),
  ]);

  const active: LimitationRow[] = (activeRes.data ?? []).map((r) =>
    normaliseRow(r as RawRow),
  );
  const resolved: LimitationRow[] = (resolvedRes.data ?? []).map((r) =>
    normaliseRow(r as RawRow),
  );
  const rows: LimitationRow[] = [...active, ...resolved];

  // Resolve referenced movement IDs to display refs in a single query.
  const movementIdSet = new Set<string>();
  for (const r of active) for (const id of r.affectedMovementIds) movementIdSet.add(id);
  const movementRefs = new Map<string, MovementRef>();
  if (movementIdSet.size > 0) {
    const { data: movementRows } = await supabase
      .from("movements")
      .select("id, slug, display_name")
      .in("id", Array.from(movementIdSet));
    for (const m of movementRows ?? []) {
      movementRefs.set(m.id as string, {
        id: m.id as string,
        slug: m.slug as string,
        displayName: m.display_name as string,
      });
    }
  }

  const hasAny = rows.length > 0;

  return (
    <main
      data-testid="injuries-page"
      style={{ display: "grid", gap: 24, maxWidth: 880, margin: "0 auto" }}
    >
      <header style={{ display: "grid", gap: 6 }}>
        <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700 }}>Injuries</h1>
        <p style={{ margin: 0, fontSize: 13, color: "var(--cp-text-muted)" }}>
          Flag an injury or restriction; the engine will cap or rotate around
          the affected muscles and movements so you can keep training around
          the issue.
        </p>
      </header>

      {!hasAny ? (
        <>
          <EmptyState
            variant="card"
            title="No limitations recorded"
            body="Limitations let the engine cap or rotate around an affected muscle or movement so you can keep training around an issue."
          />
          <div style={{ display: "flex", justifyContent: "center" }}>
            <AddLimitationButton />
          </div>
        </>
      ) : (
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <AddLimitationButton />
        </div>
      )}

      {active.length > 0 && (
        <section data-testid="active-section" style={{ display: "grid", gap: 12 }}>
          <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>
            Active{" "}
            <span
              style={{
                fontSize: 12,
                fontWeight: 500,
                color: "var(--cp-text-muted)",
              }}
            >
              ({active.length})
            </span>
          </h2>
          <div style={{ display: "grid", gap: 12 }}>
            {active.map((row) => (
              <ActiveLimitationCard
                key={row.id}
                row={row}
                movements={row.affectedMovementIds
                  .map((id) => movementRefs.get(id))
                  .filter((m): m is MovementRef => Boolean(m))}
                formatProfile={formatProfile}
              />
            ))}
          </div>
        </section>
      )}

      <HistorySection rows={resolved} />
    </main>
  );
}
