/**
 * Smoke test that every load-summing engine query filters out
 * skipped sets (migration 0037).
 *
 * The project's vitest environment is Node-only and the engine
 * helpers reach into Supabase — so the cheapest reliable assertion
 * is a source-code check that each known tonnage / PR / bucket /
 * volume query carries an explicit `.eq('skipped', false)` filter.
 * If a new query is added that reads set_logs for tonnage, add it to
 * the FILES list below.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..", "..");

const FILES: Array<{ path: string; minHits: number }> = [
  { path: "lib/engine/region-ledger.ts", minHits: 1 },
  { path: "lib/engine/recovered-weeks.ts", minHits: 1 },
  { path: "lib/engine/deload.ts", minHits: 1 },
  { path: "lib/stats/volume.ts", minHits: 2 },
  { path: "lib/stats/muscle-volume.ts", minHits: 1 },
  { path: "lib/stats/bucket-state-queries.ts", minHits: 1 },
  { path: "lib/stats/engine.ts", minHits: 1 },
  { path: "lib/stats/pr-queries.ts", minHits: 2 },
  { path: "lib/stats/pr-recalibrate.ts", minHits: 2 },
  { path: "lib/stats/prs-range.ts", minHits: 2 },
  { path: "lib/stats/prs-this-month.ts", minHits: 2 },
  { path: "lib/stats/bump-proposal.ts", minHits: 2 },
  { path: "lib/stats/blocks.ts", minHits: 3 },
  { path: "lib/stats/movement.ts", minHits: 2 },
  { path: "lib/stats/region-state-snapshot.ts", minHits: 1 },
  { path: "lib/sessions/queries.ts", minHits: 1 },
];

describe("engine — skipped sets excluded from load summing", () => {
  for (const { path, minHits } of FILES) {
    it(`${path} filters skipped sets`, () => {
      const src = readFileSync(join(root, path), "utf8");
      const matches = src.match(/\.eq\(\s*"skipped"\s*,\s*false\s*\)/g) ?? [];
      expect(matches.length).toBeGreaterThanOrEqual(minHits);
    });
  }
});

describe("addStrengthSet — skipped rows persist as zero work", () => {
  it("the action zeroes weight + reps and forwards skip_reason", () => {
    const src = readFileSync(
      join(root, "lib/sessions/actions.ts"),
      "utf8",
    );
    expect(src).toMatch(/skip_reason:\s*isSkipped\s*\?\s*\(/);
    expect(src).toMatch(/weight_kg:\s*isSkipped\s*\?\s*0/);
    expect(src).toMatch(/reps:\s*isSkipped\s*\?\s*0/);
    expect(src).toMatch(/skipped:\s*isSkipped,/);
  });
});
