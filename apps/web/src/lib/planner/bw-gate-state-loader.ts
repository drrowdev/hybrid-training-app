/**
 * Server-side helper that computes the Phase 4 gate-state snapshot
 * per BW family for the families that appear in a planned-session
 * prescription. The snapshot drives the "Next:" chip popover in the
 * focus view + the row badges on the BW progression settings page.
 *
 * Pure I/O wrapper around the pure engine — all rule maths lives in
 * `bw-progression.ts`. Recent-session over-completion is computed
 * conservatively (no DB scan of historical actuals) — the page shows
 * a counter, the actual advance decision still runs server-side in
 * `applyBwSessionCompletionSideEffects` where the real session actuals
 * are already in scope.
 */
import type { Prescription } from "@hta/db";
import type { createClient } from "@/lib/supabase/server";
import { gateStateFor, type GateStateSnapshot } from "./bw-progression";

type SupabaseLike = Awaited<ReturnType<typeof createClient>>;

export async function loadBwGateStatesForPrescription(args: {
  supabase: SupabaseLike;
  userId: string;
  prescription: Prescription | null;
}): Promise<Record<string, GateStateSnapshot>> {
  const families = collectBwFamilies(args.prescription);
  if (families.length === 0) return {};

  const progressRes = await args.supabase
    .from("bw_progress")
    .select(
      "family, current_node_id, current_node_key, weeks_at_node, accumulated_tut_seconds",
    )
    .eq("user_id", args.userId)
    .in("family", families);
  if (progressRes.error) return {};
  const progressRows = (progressRes.data ?? []) as Array<{
    family: string;
    current_node_id: string;
    current_node_key: string;
    weeks_at_node: number;
    accumulated_tut_seconds: number;
  }>;
  if (progressRows.length === 0) return {};

  const nodeIds = progressRows.map((r) => r.current_node_id);
  const nodesRes = await args.supabase
    .from("movement_nodes")
    .select(
      "id, node_key, display_name, family, difficulty_anchor, isometric_capable, prerequisites",
    )
    .in("id", nodeIds);
  if (nodesRes.error) return {};
  const allNodesData = (nodesRes.data ?? []) as Array<{
    id: string;
    node_key: string;
    display_name: string;
    family: string;
    difficulty_anchor: number;
    isometric_capable: boolean;
    prerequisites: string[] | null;
  }>;

  const childrenRes = await args.supabase
    .from("movement_nodes")
    .select(
      "id, node_key, display_name, family, difficulty_anchor, isometric_capable, prerequisites",
    )
    .in("family", families)
    .overlaps("prerequisites", nodeIds);
  const childRows = childrenRes.error
    ? []
    : ((childrenRes.data ?? []) as typeof allNodesData);

  const out: Record<string, GateStateSnapshot> = {};
  for (const prog of progressRows) {
    const current = allNodesData.find((n) => n.id === prog.current_node_id);
    if (!current) continue;
    const candidates = childRows.filter(
      (n) =>
        n.family === prog.family &&
        (n.prerequisites ?? []).includes(prog.current_node_id),
    );
    const snap = gateStateFor({
      bwProgress: {
        userId: args.userId,
        family: prog.family as never,
        currentNodeId: prog.current_node_id,
        currentNodeKey: prog.current_node_key,
        weeksAtNode: prog.weeks_at_node,
        accumulatedTutSeconds: prog.accumulated_tut_seconds,
        lastUpdatedAt: new Date(),
      } as never,
      currentNode: {
        id: current.id,
        nodeKey: current.node_key,
        displayName: current.display_name,
        family: current.family,
        difficultyAnchor: current.difficulty_anchor,
        isometricCapable: current.isometric_capable,
        prerequisites: current.prerequisites ?? [],
      } as never,
      candidateNextNodes: candidates.map((n) => ({
        id: n.id,
        nodeKey: n.node_key,
        displayName: n.display_name,
        family: n.family,
        difficultyAnchor: n.difficulty_anchor,
        isometricCapable: n.isometric_capable,
        prerequisites: n.prerequisites ?? [],
      })) as never,
      recentSessions: [],
    });
    out[prog.family] = snap;
  }
  return out;
}

function collectBwFamilies(prescription: Prescription | null): string[] {
  if (!prescription?.items) return [];
  const set = new Set<string>();
  for (const it of prescription.items) {
    const fam = it.bw?.family;
    if (fam) set.add(fam);
  }
  return Array.from(set);
}
