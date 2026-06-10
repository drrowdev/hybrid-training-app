/**
 * Cluster validation — the TB1 cluster taxonomy as pure, reusable rules.
 *
 * Shared single source of truth for the engine setup path and the program
 * wizard. Encodes the book's per-template lift-count bounds:
 *   - Minimalist cluster = exactly 2 lifts (the only kind Gladiator allows).
 *   - Standard cluster   = 3 lifts.
 *   - Heavy cluster      = 4–8 lifts (Zulu almost exclusively).
 *   - Operator may add ONE optional bodyweight movement that does not count
 *     toward its 2–3 ceiling.
 */
import type { TbTemplate, TbClusterEntry } from "./templates";

export interface ClusterValidation {
  ok: boolean;
  errors: string[];
  /** Lifts that count toward the template's size bounds (excludes Operator's optional bodyweight). */
  countingLifts: number;
}

/** Count the lifts that count toward the size bounds (Operator's optional bodyweight is exempt). */
export function countingLifts(
  template: TbTemplate,
  cluster: Pick<TbClusterEntry, "kind">[],
): number {
  if (template.allowsBodyweightFourth) {
    const bodyweight = cluster.filter((l) => l.kind === "bodyweight").length;
    return cluster.length - Math.min(bodyweight, 1);
  }
  return cluster.length;
}

export function validateCluster(
  template: TbTemplate,
  cluster: TbClusterEntry[],
): ClusterValidation {
  const errors: string[] = [];
  const count = countingLifts(template, cluster);

  if (template.clusterMin === template.clusterMax) {
    if (count !== template.clusterMin) {
      errors.push(
        `${template.name} uses exactly ${template.clusterMin} main lift${template.clusterMin === 1 ? "" : "s"}.`,
      );
    }
  } else {
    if (count < template.clusterMin) {
      errors.push(`${template.name} needs at least ${template.clusterMin} main lifts.`);
    }
    if (count > template.clusterMax) {
      errors.push(
        `${template.name} allows at most ${template.clusterMax} main lifts` +
          (template.allowsBodyweightFourth ? " (plus one optional bodyweight movement)." : "."),
      );
    }
  }

  if (template.allowsBodyweightFourth) {
    const bodyweight = cluster.filter((l) => l.kind === "bodyweight").length;
    if (bodyweight > 1) {
      errors.push(`${template.name} allows only one optional bodyweight movement.`);
    }
  }

  // Zulu A/B split: every lift carries a group, and both groups must be non-empty.
  if (template.structure === "split") {
    const a = cluster.filter((l) => l.split === "A").length;
    const b = cluster.filter((l) => l.split === "B").length;
    const ungrouped = cluster.filter((l) => l.split !== "A" && l.split !== "B").length;
    if (ungrouped > 0) {
      errors.push(`${template.name} assigns every lift to an A or B session.`);
    }
    if (a === 0 || b === 0) {
      errors.push(`${template.name} divides lifts across an A and a B session — each needs at least one lift.`);
    }
  }

  // No duplicate movements within a cluster.
  const seen = new Set<string>();
  for (const lift of cluster) {
    if (seen.has(lift.movement)) {
      errors.push(`Duplicate lift in the cluster: ${lift.movement}.`);
    }
    seen.add(lift.movement);
  }

  return { ok: errors.length === 0, errors, countingLifts: count };
}
