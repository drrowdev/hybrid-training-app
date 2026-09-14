import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { projectDashboardSwim, swimDashboardObservationSchema, swimImportEvidenceSchema } from "../import-evidence";

const tests = fileURLToPath(new URL("../../../../../../scripts/tests/", import.meta.url));
const python = process.platform === "win32" ? "python" : "python3";
const environment: NodeJS.ProcessEnv = {
  NODE_ENV: "test",
  ...Object.fromEntries(
    Object.entries(process.env).filter(([key]) => /^(PATH|SYSTEMROOT|TEMP|TMP)$/i.test(key)),
  ),
};

function runPython(args: string[]) {
  return spawnSync(python, ["-I", "-B", ...args], {
    encoding: "utf8", timeout: 30_000, maxBuffer: 1024 * 1024, env: environment,
  });
}

describe("DC-SW1/DC-SW4 cache-only swimming adapter", () => {
  it("runs the synthetic SQLite, privacy, sender failure and read-only contract checks", () => {
    const result = runPython(["-m", "unittest", "discover", "-s", tests, "-p", "test_swim_dashboard_*.py"]);
    expect(result.error).toBeUndefined();
    expect(result.signal).toBeNull();
    expect(result.status, result.stderr).toBe(0);
  }, 35_000);

  it("accepts the real adapter's synthetic output without promoting ambiguous timing or course", () => {
    const result = runPython([join(tests, "test_swim_dashboard_cache.py"), "--synthetic-batch"]);
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    const batch = z.array(z.object({ activity: z.unknown(), detail: z.unknown() }).strict())
      .parse(JSON.parse(result.stdout));
    expect(batch).toHaveLength(1);
    const projected = projectDashboardSwim(batch[0]!.activity, batch[0]!.detail);
    expect(projected.ok).toBe(true);
    if (!projected.ok) throw new Error("Synthetic cache output failed the application contract");
    expect(swimImportEvidenceSchema.safeParse(projected.value).success).toBe(true);
    expect(projected.value).toMatchObject({
      environment: "pool", nativeCourse: null, recordedDurationMs: 1200123, durationKind: "unspecified",
      detail: {
        status: "available",
        splits: [{ stroke: "freestyle", elapsedMs: 40125, reportedActiveMs: 35125, activeTimeVerified: false }],
      },
    });
    expect(result.stdout).not.toMatch(/SYNTHETIC_PRIVATE|avg_hr|credentials|weather/);
  }, 35_000);

  it("DC-SW8 accepts the actual sender's minimized request in the receiver's closed schema", () => {
    const result = runPython([join(tests, "test_swim_dashboard_send.py"), "--synthetic-requests"]);
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    const observations = z.array(swimDashboardObservationSchema).parse(JSON.parse(result.stdout));
    expect(observations).toHaveLength(1);
    expect(observations[0]).toMatchObject({
      version: 1,
      activity: { activity_id: "1", type: "lap_swimming" },
      detail: { splits: [{ distance_m: 50, active_s: 55, stroke: "freestyle" }] },
    });
    expect(result.stdout).not.toMatch(/SYNTHETIC_PRIVATE|credentials|avg_hr/);
  }, 35_000);
});
