/**
 * /app/recovery/injuries — self-serve limitations management.
 *
 * Replaces the older settings-page form (which is still wired at
 * /app/settings/limitations for back compat). Three sections:
 *
 *   1. Active limitations  — one card per row, inline resolve / edit.
 *   2. History             — collapsed accordion of resolved rows.
 *   3. Recent adjustments  — engine override events in the last 14
 *                            days that the engine made because of
 *                            limitations.
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
import { createClient } from "@/lib/supabase/server";
import { EmptyState } from "@/components/ui/EmptyState";
import { ALL_MUSCLE_GROUPS, type MuscleGroup } from "@/lib/muscle/muscle-groups";
import { ActiveLimitationCard } from "@/components/limitations/ActiveLimitationCard";
import { AddLimitationButton } from "@/components/limitations/AddLimitationButton";
import { EngineResponseSection } from "@/components/limitations/EngineResponseSection";
import { HistorySection } from "@/components/limitations/HistorySection";
import { getFormatProfile } from "@/lib/format/profile";
import type {
  EngineEventRow,
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
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const fourteenDaysAgoIso = new Date(
    // Server Component: rendered per request, not subject to the React
    // purity rule for hooks/components. Same exception applied in
    // /app/settings/limitations/page.tsx for the 90-day check.
    // eslint-disable-next-line react-hooks/purity
    Date.now() - 14 * 86_400_000,
  ).toISOString();

  const [limRes, eventsRes, formatProfile] = await Promise.all([
    supabase
      .from("limitations")
      .select(
        "id, kind, severity, region, affected_muscles, affected_movement_ids, notes, expected_duration_days, started_at, resolved_at, engine_action",
      )
      .order("started_at", { ascending: false }),
    supabase
      .from("engine_override_events")
      .select(
        "id, occurred_at, event_type, original_movement_slug, new_movement_slug, reason",
      )
      .gte("occurred_at", fourteenDaysAgoIso)
      .order("occurred_at", { ascending: false })
      .limit(20),
    getFormatProfile(supabase, user.id),
  ]);

  const rows: LimitationRow[] = (limRes.data ?? []).map((r) =>
    normaliseRow(r as RawRow),
  );
  const active = rows.filter((r) => r.resolvedAt == null);
  const resolved = rows
    .filter((r) => r.resolvedAt != null)
    .sort((a, b) => (b.resolvedAt ?? "").localeCompare(a.resolvedAt ?? ""));

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

  const events: EngineEventRow[] = (eventsRes.data ?? []).map((e) => ({
    id: e.id as string,
    occurredAt: e.occurred_at as string,
    eventType: e.event_type as EngineEventRow["eventType"],
    originalMovementSlug: (e.original_movement_slug as string | null) ?? null,
    newMovementSlug: (e.new_movement_slug as string | null) ?? null,
    reason: (e.reason as string | null) ?? null,
  }));

  const hasAny = rows.length > 0;

  return (
    <main
      data-testid="injuries-page"
      style={{ display: "grid", gap: 24, maxWidth: 880, margin: "0 auto" }}
    >
      <header style={{ display: "grid", gap: 6 }}>
        <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700 }}>
          Limitations
        </h1>
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

      <EngineResponseSection
        events={events}
        hasActiveLimitation={active.length > 0}
        formatProfile={formatProfile}
      />
    </main>
  );
}
