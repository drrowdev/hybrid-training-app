/**
 * Eval-harness coverage for the 5 Explain v1 starter fixtures.
 *
 * Replay mode: load each fixture JSON, pass through the runner, and
 * assert all matchers pass against the recorded cassette.
 *
 * Cassette pinning ("strict mode" in spirit): re-hash each fixture's
 * id and confirm it matches the `promptHash` field on disk; if a
 * future contributor renames a fixture without re-recording its
 * cassette, this test goes red.
 */
import { describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import { createHash } from "node:crypto";
import * as path from "node:path";

import { runFixture, type EvalFixture } from "../runner";

const FIXTURE_IDS = [
  "why-deload-this-week",
  "squat-trend-3-months",
  "knee-pain-suggestion",
  "compare-blocks",
  "no-data-question",
  "explain-this-session",
] as const;

async function loadFixture(id: string): Promise<EvalFixture & {
  id: string;
  synthetic: boolean;
  input: string;
}> {
  const file = path.resolve(__dirname, "..", "fixtures", `${id}.json`);
  const raw = await fs.readFile(file, "utf8");
  return JSON.parse(raw);
}

function expectedHash(id: string): string {
  return createHash("sha256").update(`fixture:${id}:v2`).digest("hex");
}

describe("eval fixtures — Explain v1", () => {
  it.each(FIXTURE_IDS)(
    "%s — replays green against its checked-in cassette",
    async (id) => {
      const fixture = await loadFixture(id);
      const r = await runFixture(fixture, { mode: "replay" });
      expect(r.errors, `${id} failed: ${r.errors.join("; ")}`).toEqual([]);
      expect(r.ok).toBe(true);
    },
  );

  it.each(FIXTURE_IDS)(
    "%s — promptHash is pinned to sha256(`fixture:<id>:v2`)",
    async (id) => {
      const fixture = await loadFixture(id);
      expect(fixture.promptHash).toBe(expectedHash(id));
    },
  );

  it("every fixture is currently flagged synthetic-pending-real-recording", async () => {
    for (const id of FIXTURE_IDS) {
      const f = await loadFixture(id);
      expect(f.synthetic, `${id} is missing synthetic flag`).toBe(true);
    }
  });
});
