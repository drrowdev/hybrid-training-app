/**
 * Catalog-band invariants (PR W2). Wires the standalone
 * `check-experience-bands.ts` script into the vitest run so a curation
 * mistake in `movements-part{1,2,3}.ts` fails the test suite instead of
 * shipping silently.
 */
import { describe, it, expect } from "vitest";
import {
  buildBandReport,
  checkExperienceBands,
} from "../scripts/check-experience-bands";
import { SEED_MOVEMENTS } from "../seeds/movements";

describe("movement catalog — experience-band invariants", () => {
  it("every band passes the structural + coverage checks", () => {
    const violations = checkExperienceBands();
    expect(violations, violations.map((v) => v.message).join("\n")).toEqual([]);
  });

  it("every tier sees ≥ 50% of the catalog", () => {
    const report = buildBandReport();
    for (const t of [0, 1, 2, 3, 4] as const) {
      expect(
        report.perTier[t].pctOfTotal,
        `tier ${t}: ${(report.perTier[t].pctOfTotal * 100).toFixed(1)}%`,
      ).toBeGreaterThanOrEqual(0.5);
    }
  });

  it("tier 4 (highly advanced) sees ≥ 80% of the catalog", () => {
    const report = buildBandReport();
    expect(report.perTier[4].pctOfTotal).toBeGreaterThanOrEqual(0.8);
  });

  it("every banded row has min <= max within [0,4]", () => {
    for (const m of SEED_MOVEMENTS) {
      const min = m.experienceMin ?? 0;
      const max = m.experienceMax ?? 4;
      expect(min, `${m.slug}`).toBeGreaterThanOrEqual(0);
      expect(max, `${m.slug}`).toBeLessThanOrEqual(4);
      expect(min, `${m.slug}: min(${min}) > max(${max})`).toBeLessThanOrEqual(max);
    }
  });
});
