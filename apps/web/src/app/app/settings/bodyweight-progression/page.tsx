/**
 * Settings → Bodyweight progression.
 *
 * Redesigned UX (DC-Q6 brand-pure):
 *   1. Header summary — counts of families at starter / intermediate /
 *      advanced anchor bands plus a "Run assessment" entry point.
 *   2. Diagnostics — rendered only when ≥ 1 signal fires (the engine
 *      is gated against firing on a brand-new user — see
 *      `bw-diagnostics.ts`).
 *   3. Families grouped into 6 collapsible categories. Each row
 *      collapses the previous overview row + manual picker + loaded
 *      suggestion into a single compact card with an inline `<select>`,
 *      TUT/weeks meta, and an optional loaded-BW suggestion strip.
 *   4. Recent progressions — last 5, rendered only when ≥ 1 event.
 *   5. Footer — single "Run assessment again" link.
 *
 * The category groupings and anchor thresholds below are deliberately
 * named constants so tweaks live in one place.
 */
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import { MOVEMENT_FAMILIES, type MovementFamily, type MovementNode } from "@hta/db";
import { tutThreshold } from "@/lib/planner/bw-progression";
import { loadAndRunBwDiagnostics } from "@/lib/planner/bw-diagnostics-loader";
import { BwDiagnosticsSection } from "@/components/settings/BwDiagnosticsSection";
import { bwMultiplier } from "@/lib/planner/bw-multiplier";
import { suggestLoadOrVariant } from "@/lib/planner/bw-loaded-suggestion";
import { formatDate } from "@/lib/format/datetime";
import { getFormatProfile } from "@/lib/format/profile";
import {
  BwProgressionCategories,
  type BwCategoryGroup,
  type BwCategoryRow,
} from "@/components/settings/BwProgressionCategories";
import type {
  BwRowLoadedSuggestion,
  BwRowNode,
} from "@/components/settings/BwProgressionFamilyRow";

// ── Tuneables ────────────────────────────────────────────────────────
//
// All thresholds + groupings used by this page live here so they're
// easy to tweak without hunting through render code.

/** Anchor bands for the header summary chips. Values track the catalog
 *  `difficulty_anchor` scale (1–100). */
const STARTER_MAX_ANCHOR = 30;
const INTERMEDIATE_MAX_ANCHOR = 60;

/** Recent-progressions block cap — matches the spec's "last 5". */
const RECENT_PROGRESSIONS_LIMIT = 5;

/** Six categories the 15 movement families collapse into. Defined as
 *  a single source of truth so the category list, default-expanded
 *  gate, and testids all share the same order. */
const CATEGORIES: ReadonlyArray<{
  key: string;
  label: string;
  families: ReadonlyArray<MovementFamily>;
}> = [
  { key: "push", label: "Push", families: ["push_h", "push_v"] },
  { key: "pull", label: "Pull", families: ["pull_h", "pull_v"] },
  {
    key: "lower",
    label: "Lower body",
    families: ["squat_unilateral", "squat_bilateral", "hinge"],
  },
  {
    key: "core",
    label: "Core",
    families: ["core_anti_flexion", "core_anti_rotation"],
  },
  {
    key: "skills",
    label: "Skills",
    families: ["planche", "lever_front", "lever_back", "human_flag", "handstand"],
  },
  { key: "bridges", label: "Bridges", families: ["muscle_up"] },
];

/** Plain-English family labels — kept local because the catalog table
 *  doesn't carry one. */
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
  isometric_capable: boolean;
};

type ProgressRow = {
  family: MovementFamily;
  current_node_id: string;
  weeks_at_node: number;
  accumulated_tut_seconds: number;
  target_external_load_kg?: number | string | null;
};

type ProgressionEventRow = {
  occurred_at: string;
  family: MovementFamily;
  from_node_id: string;
  to_node_id: string;
};

export default async function BodyweightProgressionPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) redirect("/login");

  const [
    { data: progressRows },
    { data: catalogRows },
    { data: eventRows },
    { data: profileRow },
    formatProfile,
  ] = await Promise.all([
    supabase
      .from("bw_progress")
      .select(
        "family, current_node_id, weeks_at_node, accumulated_tut_seconds, target_external_load_kg",
      )
      .eq("user_id", user.id),
    supabase
      .from("movement_nodes")
      .select(
        "id, family, node_key, display_name, prerequisites, difficulty_anchor, isometric_capable",
      ),
    supabase
      .from("bw_progression_events")
      .select("occurred_at, family, from_node_id, to_node_id")
      .eq("user_id", user.id)
      .order("occurred_at", { ascending: false })
      .limit(RECENT_PROGRESSIONS_LIMIT),
    supabase
      .from("profiles")
      .select("bodyweight_kg, bw_assessment_completed_at")
      .eq("id", user.id)
      .maybeSingle(),
    getFormatProfile(supabase, user.id),
  ]);

  const catalog: CatalogNode[] = (catalogRows ?? []) as CatalogNode[];
  const nodeById = new Map(catalog.map((n) => [n.id, n]));
  const nodesByFamily = new Map<MovementFamily, CatalogNode[]>();
  for (const n of catalog) {
    const arr = nodesByFamily.get(n.family) ?? [];
    arr.push(n);
    nodesByFamily.set(n.family, arr);
  }
  for (const arr of nodesByFamily.values()) {
    arr.sort((a, b) => a.difficulty_anchor - b.difficulty_anchor);
  }

  const progressByFamily = new Map<MovementFamily, ProgressRow>(
    ((progressRows ?? []) as ProgressRow[]).map((r) => [r.family, r]),
  );

  const userBodyweightKg =
    profileRow?.bodyweight_kg != null && Number.isFinite(Number(profileRow.bodyweight_kg))
      ? Number(profileRow.bodyweight_kg)
      : 75;

  const assessmentCompletedAt = (
    profileRow as { bw_assessment_completed_at?: string | null } | null
  )?.bw_assessment_completed_at ?? null;

  // ── Anchor-band counts for the header chip line ──────────────────────
  let starterCount = 0;
  let intermediateCount = 0;
  let advancedCount = 0;
  for (const [, p] of progressByFamily) {
    const n = nodeById.get(p.current_node_id);
    if (!n) continue;
    if (n.difficulty_anchor < STARTER_MAX_ANCHOR) starterCount += 1;
    else if (n.difficulty_anchor < INTERMEDIATE_MAX_ANCHOR) intermediateCount += 1;
    else advancedCount += 1;
  }
  const totalSeeded = starterCount + intermediateCount + advancedCount;
  const seeded = totalSeeded > 0;

  // ── Per-family row payloads ──────────────────────────────────────────
  const rowsByFamily = new Map<MovementFamily, BwCategoryRow>();
  for (const family of MOVEMENT_FAMILIES) {
    const familyCatalog = nodesByFamily.get(family) ?? [];
    if (familyCatalog.length === 0) continue;

    const progress = progressByFamily.get(family);
    const current = progress
      ? nodeById.get(progress.current_node_id) ?? null
      : null;

    const next =
      current == null
        ? null
        : familyCatalog
            .filter((n) => n.prerequisites.includes(current.id))
            .sort((a, b) => a.difficulty_anchor - b.difficulty_anchor)[0] ?? null;

    const tutRequired = current
      ? tutThreshold({
          id: current.id,
          nodeKey: current.node_key,
          displayName: current.display_name,
          family: current.family,
          difficultyAnchor: current.difficulty_anchor,
          isometricCapable: current.isometric_capable,
          prerequisites: current.prerequisites,
        } as never)
      : 0;

    const nodes: BwRowNode[] = familyCatalog.map((n) => ({
      id: n.id,
      nodeKey: n.node_key,
      displayName: n.display_name,
      difficultyAnchor: n.difficulty_anchor,
      prerequisites: n.prerequisites ?? [],
    }));

    let loadedSuggestion: BwRowLoadedSuggestion | null = null;
    let currentLoadKg = 0;
    if (current) {
      const synthNode = {
        id: current.id,
        family: current.family,
        nodeKey: current.node_key,
        displayName: current.display_name,
        prerequisites: current.prerequisites,
        difficultyAnchor: current.difficulty_anchor,
        isometricCapable: current.isometric_capable,
      } as unknown as MovementNode;
      const mult = bwMultiplier(synthNode);
      if (mult > 0) {
        currentLoadKg = Number(progress?.target_external_load_kg ?? 0) || 0;
        const candidates = familyCatalog
          .filter((n) => n.prerequisites.includes(current.id))
          .map(
            (n) =>
              ({
                id: n.id,
                family: n.family,
                nodeKey: n.node_key,
                displayName: n.display_name,
                difficultyAnchor: n.difficulty_anchor,
              }) as unknown as MovementNode,
          );
        const overWeeks = progress?.weeks_at_node ?? 0;
        const suggestion = suggestLoadOrVariant({
          currentNode: synthNode,
          candidateNextNodes: candidates,
          currentLoadKg,
          userBodyweightKg,
          cleanOverCompletionWeeks: overWeeks,
        });
        // Only surface the loaded-BW suggestion when there's an
        // actionable signal: the user has already loaded the variant
        // (currentLoadKg > 0), or they've banked at least 2 clean
        // over-completed weeks. Otherwise the strip just shows a
        // disabled "+0 kg · need 2+ weeks" line that wastes vertical
        // space on a brand-new family.
        const suggestionIsMeaningful = currentLoadKg > 0 || overWeeks >= 2;
        if (!suggestionIsMeaningful) {
          loadedSuggestion = null;
        } else if (suggestion.kind === "hold" || suggestion.kind === "increase_load") {
          loadedSuggestion = suggestion;
        } else {
          const target = candidates.find(
            (n) => n.nodeKey === suggestion.toNodeKey,
          );
          loadedSuggestion = {
            kind: "advance_variant",
            toNodeKey: suggestion.toNodeKey,
            toNodeId: target?.id ?? "",
            toNodeDisplayName: target?.displayName ?? suggestion.toNodeKey,
            reason: suggestion.reason,
          };
        }
      }
    }

    rowsByFamily.set(family, {
      family,
      familyLabel: FAMILY_LABEL[family],
      nodes,
      currentNodeId: current?.id ?? null,
      currentDisplayName: current?.display_name ?? null,
      nextDisplayName: next?.display_name ?? null,
      weeksAtNode: progress?.weeks_at_node ?? 0,
      tutAccumulated: progress?.accumulated_tut_seconds ?? 0,
      tutRequired,
      loadedSuggestion,
      currentLoadKg,
    });
  }

  // ── Category groups ──────────────────────────────────────────────────
  const categories: BwCategoryGroup[] = CATEGORIES.map((cat) => {
    const rows = cat.families
      .map((f) => rowsByFamily.get(f))
      .filter((r): r is BwCategoryRow => r != null);
    const hasProgress = rows.some((r) => {
      if (!r.currentNodeId) return false;
      // Entry node = lowest difficulty_anchor with no prerequisites.
      // Fall back to the lowest-anchor node if none flag prereqs=[]
      // (defensive; the catalog should always seed at least one root).
      const rootNodes = r.nodes.filter((n) => n.prerequisites.length === 0);
      const entry = (rootNodes.length > 0 ? rootNodes : r.nodes).reduce(
        (lo, n) => (n.difficultyAnchor < lo.difficultyAnchor ? n : lo),
        (rootNodes[0] ?? r.nodes[0])!,
      );
      const cur = r.nodes.find((n) => n.id === r.currentNodeId);
      return cur != null && cur.difficultyAnchor > entry.difficultyAnchor;
    });
    return { key: cat.key, label: cat.label, rows, hasProgress };
  });

  // ── Diagnostics ──────────────────────────────────────────────────────
  const diagnostics = seeded
    ? await loadAndRunBwDiagnostics({ supabase, userId: user.id })
    : [];

  const events: ProgressionEventRow[] = (eventRows ?? []) as ProgressionEventRow[];

  return (
    <div data-testid="bw-progression-page" style={{ display: "grid", gap: 20 }}>
      <header style={{ display: "grid", gap: 8 }}>
        <h1 style={{ fontSize: 26, margin: 0, letterSpacing: "-0.01em" }}>
          Bodyweight progression
        </h1>
        <p
          style={{
            margin: "2px 0 0",
            color: "var(--cp-text-muted)",
            fontSize: 14,
            lineHeight: 1.55,
          }}
        >
          {seeded
            ? "You have completed your assessment. Here is your current node per family."
            : "You haven’t completed the bodyweight assessment yet. Run it to seed your starting nodes per movement family."}
        </p>
        <div
          data-testid="bw-progression-summary"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            flexWrap: "wrap",
            marginTop: 4,
          }}
        >
          <div
            data-testid="bw-progression-chips"
            style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}
          >
            <SummaryChip
              testid="bw-chip-total"
              label={`${totalSeeded} families`}
              tone="default"
            />
            <SummaryChip
              testid="bw-chip-starter"
              label={`${starterCount} starter`}
              tone="muted"
            />
            <SummaryChip
              testid="bw-chip-intermediate"
              label={`${intermediateCount} intermediate`}
              tone="muted"
            />
            <SummaryChip
              testid="bw-chip-advanced"
              label={`${advancedCount} advanced`}
              tone={advancedCount > 0 ? "accent" : "muted"}
            />
          </div>
          <Link
            href="/app/onboarding/bw-assessment"
            data-testid="bw-progression-run-assessment"
            className="cp-btn ghost"
            style={{
              fontSize: 12,
              padding: "4px 10px",
              textDecoration: "none",
              minHeight: 28,
            }}
          >
            {seeded ? "Run assessment →" : "Run assessment"}
          </Link>
        </div>
        {assessmentCompletedAt && (
          <span
            data-testid="bw-progression-assessment-date"
            style={{ fontSize: 11, color: "var(--cp-text-muted)" }}
          >
            Last assessment: {formatDate(assessmentCompletedAt, formatProfile)}
          </span>
        )}
      </header>

      <BwDiagnosticsSection results={diagnostics} />

      <BwProgressionCategories categories={categories} />

      {events.length > 0 && (
        <section
          data-testid="bw-progression-recent"
          style={{ display: "grid", gap: 8 }}
        >
          <h2 style={{ fontSize: 14, margin: 0 }}>Recent progressions</h2>
          <ul
            style={{
              listStyle: "none",
              margin: 0,
              padding: 0,
              display: "grid",
              gap: 6,
            }}
          >
            {events.slice(0, RECENT_PROGRESSIONS_LIMIT).map((ev, i) => {
              const from = nodeById.get(ev.from_node_id);
              const to = nodeById.get(ev.to_node_id);
              return (
                <li
                  key={`${ev.occurred_at}-${i}`}
                  data-testid="bw-progression-event"
                  style={{
                    padding: "8px 12px",
                    border: "1px solid var(--cp-border)",
                    borderRadius: 8,
                    background: "var(--cp-surface)",
                    fontSize: 12,
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 12,
                  }}
                >
                  <span>
                    <span style={{ color: "var(--cp-text-muted)" }}>
                      {FAMILY_LABEL[ev.family]}:
                    </span>{" "}
                    {from?.display_name ?? "—"} →{" "}
                    <strong>{to?.display_name ?? "—"}</strong>
                  </span>
                  <span style={{ color: "var(--cp-text-muted)" }}>
                    {formatDate(ev.occurred_at, formatProfile)}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <footer
        data-testid="bw-progression-footer"
        style={{
          paddingTop: 6,
          borderTop: "1px dashed var(--cp-border)",
          fontSize: 12,
        }}
      >
        <Link
          href="/app/onboarding/bw-assessment"
          data-testid="bw-progression-rerun-assessment"
          style={{ color: "var(--cp-link, var(--cp-text))" }}
        >
          Run assessment again →
        </Link>
      </footer>
    </div>
  );
}

type ChipTone = "default" | "muted" | "accent";

function SummaryChip({
  label,
  tone,
  testid,
}: {
  label: string;
  tone: ChipTone;
  testid: string;
}) {
  const style: React.CSSProperties = {
    display: "inline-block",
    padding: "2px 8px",
    borderRadius: 999,
    border: "1px solid var(--cp-border)",
    fontSize: 11,
    color:
      tone === "accent"
        ? "var(--cp-accent, var(--cp-text))"
        : tone === "muted"
          ? "var(--cp-text-muted)"
          : "var(--cp-text)",
    background:
      tone === "accent"
        ? "color-mix(in oklab, var(--cp-accent, var(--cp-text)) 8%, transparent)"
        : "transparent",
    whiteSpace: "nowrap",
  };
  return (
    <span data-testid={testid} style={style}>
      {label}
    </span>
  );
}
