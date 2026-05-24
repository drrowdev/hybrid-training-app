/**
 * Settings → Bodyweight progression (read-only preview).
 *
 * Phase 2 stub for the bodyweight progression UI. Shows the user's
 * current node per family alongside a "Next:" preview derived from
 * the catalog's prerequisite DAG. Read-only for now — Phase 4 will
 * add manual node-pinning + level adjustments.
 *
 * Empty state copy points the user at the onboarding assessment when
 * `bw_progress` is empty (i.e. they reached this page without
 * completing the assessment, e.g. by skipping onboarding).
 */
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { MOVEMENT_FAMILIES, type MovementFamily } from "@hta/db";

/** Human-readable family labels — kept local because the catalog
 *  table doesn't carry one. Brand-purity: pure descriptors. */
const FAMILY_LABEL: Record<MovementFamily, string> = {
  push_h: "Horizontal push",
  push_v: "Vertical push",
  pull_h: "Horizontal pull",
  pull_v: "Vertical pull",
  squat_unilateral: "Unilateral squat",
  squat_bilateral: "Bilateral squat",
  hinge: "Hip hinge",
  core_anti_flexion: "Core (anti-flexion)",
  core_anti_rotation: "Core (anti-rotation)",
  planche: "Planche",
  lever_front: "Front lever",
  lever_back: "Back lever",
  muscle_up: "Muscle-up",
  handstand: "Handstand",
  human_flag: "Human flag",
};

type CatalogNode = {
  id: string;
  family: MovementFamily;
  node_key: string;
  display_name: string;
  prerequisites: string[];
  difficulty_anchor: number;
};

type ProgressRow = {
  family: MovementFamily;
  current_node_id: string;
};

export default async function BodyweightProgressionPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: progressRows }, { data: catalogRows }] = await Promise.all([
    supabase
      .from("bw_progress")
      .select("family, current_node_id")
      .eq("user_id", user.id),
    supabase
      .from("movement_nodes")
      .select("id, family, node_key, display_name, prerequisites, difficulty_anchor"),
  ]);

  const catalog: CatalogNode[] = (catalogRows ?? []) as CatalogNode[];
  const nodeById = new Map(catalog.map((n) => [n.id, n]));
  const nodesByFamily = new Map<MovementFamily, CatalogNode[]>();
  for (const n of catalog) {
    const arr = nodesByFamily.get(n.family) ?? [];
    arr.push(n);
    nodesByFamily.set(n.family, arr);
  }

  const progressByFamily = new Map<MovementFamily, ProgressRow>(
    ((progressRows ?? []) as ProgressRow[]).map((r) => [r.family, r]),
  );

  // For each family, surface (a) the user's current node and (b) the
  // lowest-anchor child that lists the current node as a prerequisite.
  // Falls back to "—" when the family is at a terminal node.
  const rows = MOVEMENT_FAMILIES.map((family) => {
    const progress = progressByFamily.get(family);
    const familyNodes = nodesByFamily.get(family) ?? [];
    if (!progress) {
      return { family, current: null, next: null };
    }
    const current = nodeById.get(progress.current_node_id) ?? null;
    const next =
      current == null
        ? null
        : familyNodes
            .filter((n) => n.prerequisites.includes(current.id))
            .sort((a, b) => a.difficulty_anchor - b.difficulty_anchor)[0] ??
          null;
    return { family, current, next };
  });

  const seeded = rows.some((r) => r.current != null);

  return (
    <div style={{ display: "grid", gap: 20 }}>
      <header>
        <Link
          href="/app/settings"
          style={{ fontSize: 12, color: "var(--cp-text-muted)", textDecoration: "none" }}
        >
          ← back to settings
        </Link>
        <h1 style={{ fontSize: 26, margin: "8px 0 0", letterSpacing: "-0.01em" }}>
          Bodyweight progression
        </h1>
        <p
          style={{
            margin: "6px 0 0",
            color: "var(--cp-text-muted)",
            fontSize: 14,
            lineHeight: 1.55,
          }}
        >
          Your current node per movement family and a preview of what comes
          next. Manual adjustments arrive in a later phase — for now this is a
          read-only view of what the assessment seeded.
        </p>
      </header>

      {!seeded && (
        <div data-testid="bw-progression-empty" style={emptyStyle}>
          <p style={{ margin: 0, fontSize: 14, lineHeight: 1.55 }}>
            No bodyweight progression on file yet. Complete the bodyweight
            assessment during onboarding (or re-run it later) to seed your
            starting nodes.
          </p>
        </div>
      )}

      {seeded && (
        <div data-testid="bw-progression-table" style={{ display: "grid", gap: 8 }}>
          {rows.map(({ family, current, next }) => {
            if (current == null) return null;
            return (
              <div
                key={family}
                data-testid={`bw-progression-row-${family}`}
                style={rowStyle}
              >
                <div style={{ display: "grid", gap: 2 }}>
                  <span style={{ fontSize: 11, color: "var(--cp-text-muted)" }}>
                    {FAMILY_LABEL[family]}
                  </span>
                  <span style={{ fontSize: 15, fontWeight: 600 }}>
                    {current.display_name}
                  </span>
                </div>
                <div
                  style={{
                    fontSize: 12,
                    color: "var(--cp-text-muted)",
                    textAlign: "right",
                    lineHeight: 1.45,
                  }}
                >
                  Next:{" "}
                  <strong style={{ color: "var(--cp-text)" }}>
                    {next ? next.display_name : "—"}
                  </strong>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

const emptyStyle: React.CSSProperties = {
  padding: 14,
  border: "1px dashed var(--cp-border)",
  borderRadius: 10,
  background: "var(--cp-surface-soft, var(--cp-surface))",
  color: "var(--cp-text-muted)",
};

const rowStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr auto",
  gap: 12,
  alignItems: "center",
  padding: "12px 14px",
  border: "1px solid var(--cp-border)",
  borderRadius: 10,
  background: "var(--cp-surface)",
};
