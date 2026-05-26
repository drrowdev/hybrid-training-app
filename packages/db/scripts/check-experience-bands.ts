/**
 * Experience-band invariants for the movement catalog (PR W2 / Option B).
 *
 * Asserts that the curated `experienceMin` / `experienceMax` bands on
 * the seed produce a healthy catalog for every declared tier:
 *
 *   1. Every band lives inside [0, 4] with `min <= max`.
 *   2. No tier is starved — each tier must see ≥ 50% of the full
 *      catalog. If a tier drops below that, the curation pass is too
 *      aggressive and beginners (or any tier) end up with too few
 *      options.
 *   3. Tier 4 (highly advanced) must see ≥ 80% of the catalog. The
 *      whole point of the system is to expose advanced users to
 *      everything; if they can't see most of it, something's wrong.
 *   4. Beginners (tier 0) get ≥ 3 candidates for each of the priority
 *      muscles (`PRIORITY_MUSCLES` below). Mirrors the existing
 *      `movements.test.ts` priority-muscle check, but tier-aware so a
 *      "beginner pool" is guaranteed to be programmable.
 *
 * Re-exported as a helper so other scripts can call into it and so the
 * test file in `__tests__/experience-bands.test.ts` can wire it into
 * the regular vitest run.
 */
import { SEED_MOVEMENTS } from "../seeds/movements";
import type { NewMovement } from "../src/schema/movements";

export const TIER_MIN = 0;
export const TIER_MAX = 4;

export const PRIORITY_MUSCLES = [
  "front_delts",
  "side_delts",
  "rear_delts",
  "biceps",
  "triceps",
  "calves",
  "abs",
  "upper_chest",
  "lats",
  "mid_back",
  "glutes",
  "quads",
  "hamstrings",
  "chest",
] as const;

type Tier = 0 | 1 | 2 | 3 | 4;

const TIERS: Tier[] = [0, 1, 2, 3, 4];

function expMin(m: NewMovement): number {
  return m.experienceMin ?? 0;
}
function expMax(m: NewMovement): number {
  return m.experienceMax ?? 4;
}

function isAvailableForTier(m: NewMovement, tier: number): boolean {
  return expMin(m) <= tier && expMax(m) >= tier;
}

export type BandReport = {
  totalRows: number;
  perTier: Record<Tier, { count: number; pctOfTotal: number }>;
  bandedRows: number;
  bandDistribution: Record<string, number>; // "min-max" -> count
};

export function buildBandReport(catalog: NewMovement[] = SEED_MOVEMENTS): BandReport {
  const total = catalog.length;
  const perTier = {} as BandReport["perTier"];
  for (const t of TIERS) {
    const count = catalog.filter((m) => isAvailableForTier(m, t)).length;
    perTier[t] = { count, pctOfTotal: count / total };
  }
  const bandDistribution: Record<string, number> = {};
  let banded = 0;
  for (const m of catalog) {
    const key = `${expMin(m)}-${expMax(m)}`;
    bandDistribution[key] = (bandDistribution[key] ?? 0) + 1;
    if (expMin(m) !== 0 || expMax(m) !== 4) banded += 1;
  }
  return { totalRows: total, perTier, bandedRows: banded, bandDistribution };
}

export type Violation = { kind: string; message: string };

export function checkExperienceBands(
  catalog: NewMovement[] = SEED_MOVEMENTS,
): Violation[] {
  const out: Violation[] = [];
  const total = catalog.length;

  for (const m of catalog) {
    const min = expMin(m);
    const max = expMax(m);
    if (min < TIER_MIN || max > TIER_MAX || min > max) {
      out.push({
        kind: "invalid_band",
        message: `${m.slug}: invalid band [${min}, ${max}] (expected 0..4 with min<=max)`,
      });
    }
  }

  for (const t of TIERS) {
    const count = catalog.filter((m) => isAvailableForTier(m, t)).length;
    const pct = count / total;
    if (pct < 0.5) {
      out.push({
        kind: "tier_starved",
        message: `tier ${t}: ${count}/${total} movements available (${(pct * 100).toFixed(1)}%) — below 50% floor`,
      });
    }
  }

  const tier4 = catalog.filter((m) => isAvailableForTier(m, 4)).length;
  if (tier4 / total < 0.8) {
    out.push({
      kind: "advanced_starved",
      message: `tier 4 (highly advanced) sees ${tier4}/${total} (${((tier4 / total) * 100).toFixed(1)}%) — expected ≥ 80%`,
    });
  }

  for (const muscle of PRIORITY_MUSCLES) {
    const count = catalog.filter(
      (m) =>
        isAvailableForTier(m, 0) &&
        (m.primaryMuscles ?? []).includes(muscle as never),
    ).length;
    if (count < 3) {
      out.push({
        kind: "beginner_muscle_starved",
        message: `tier 0 has only ${count} primary candidates for muscle '${muscle}' (expected ≥ 3)`,
      });
    }
  }

  return out;
}

function main(): void {
  const report = buildBandReport();
  const violations = checkExperienceBands();
  console.log("Movement catalog experience-band report");
  console.log(`  Total rows: ${report.totalRows}`);
  console.log(`  Banded (non-default) rows: ${report.bandedRows}`);
  for (const t of TIERS) {
    const { count, pctOfTotal } = report.perTier[t];
    console.log(
      `  tier ${t}: ${count} (${(pctOfTotal * 100).toFixed(1)}%) movements available`,
    );
  }
  console.log("  Band distribution:");
  for (const [key, count] of Object.entries(report.bandDistribution).sort()) {
    console.log(`    [${key}]: ${count}`);
  }
  if (violations.length === 0) {
    console.log("All catalog experience-band invariants pass.");
  } else {
    console.log(`Violations (${violations.length}):`);
    for (const v of violations) console.log(`  - [${v.kind}] ${v.message}`);
    process.exitCode = 1;
  }
}

// Run when invoked as `tsx scripts/check-experience-bands.ts`.
const invokedDirectly = (() => {
  try {
    const argv1 = process.argv[1];
    if (!argv1) return false;
    return argv1.replace(/\\/g, "/").includes("check-experience-bands");
  } catch {
    return false;
  }
})();
if (invokedDirectly) main();
