import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { conditioningRequestDiagnosticSchema } from "../swim-conditioning-account-flow-guards";

describe("DC-SW8 bounded account-runner request observation", () => {
  it("preserves responses and emits only fixed operations, HTTP statuses and public error codes", () => {
    const moduleUrl = pathToFileURL(resolve(__dirname, "../../../../apps/web/scripts/swim-conditioning-account-flow-observer.mjs")).href;
    const script = `
      import assert from "node:assert/strict";
      const canary = "PrivateSyntheticCanary";
      let body, status;
      globalThis.fetch = async () => new Response(body, { status });
      await import(${JSON.stringify(moduleUrl)});
      const cases = [
        ["/rest/v1/rpc/swim_conditioning_replay", 200, { id: canary }],
        ["/rest/v1/rpc/deploy_program_with_swimming", 400, { code: "23503", message: canary }],
        ["/rest/v1/training_maxes", 400, { code: "42703", details: canary }],
        ["/rest/v1/rpc/deploy_program_with_swimming", 400, { code: "42702", details: canary }],
        ["/rest/v1/rpc/swim_conditioning_replay", 300, { code: "PGRST203", details: canary }],
        ["/rest/v1/rpc/deploy_program_with_swimming", 400, { code: canary, message: canary }],
        ["/rest/v1/rpc/deploy_program_with_swimming", 400, { code: "23503", details: canary.repeat(2000) }],
        ["/rest/v1/swim_workouts", 400, { code: "23503", details: canary }],
      ];
      for (const [path, expectedStatus, value] of cases) {
        status = expectedStatus; body = JSON.stringify(value);
        const response = await fetch("https://review.example" + path);
        assert.equal(response.status, status);
        assert.equal(await response.text(), body);
      }
      status = 400; body = JSON.stringify({ code: "23503", details: canary });
      await (await fetch("https://unapproved.example/rest/v1/rpc/deploy_program_with_swimming")).text();
      await new Promise((done) => setTimeout(done, 1100));
    `;
    const child = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
      encoding: "utf8", timeout: 10_000,
      env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot,
        SWIM_ACCOUNT_FLOW_OBSERVE: "1", NEXT_PUBLIC_SUPABASE_URL: "https://review.example" },
    });
    expect(child.status).toBe(0);
    expect(child.stderr).toBe("");
    expect(child.stdout).not.toContain("PrivateSyntheticCanary");
    const records = child.stdout.trim().split("\n").map((line) => {
      expect(line).toMatch(/^SWIM_CONDITIONING_REQUEST /);
      return conditioningRequestDiagnosticSchema.parse(JSON.parse(line.slice("SWIM_CONDITIONING_REQUEST ".length)));
    });
    expect(records).toHaveLength(7);
    expect(records).toEqual(expect.arrayContaining([
      { operation: "replay", status: 200, code: "ok" },
      { operation: "save", status: 400, code: "23503" },
      { operation: "context", status: 400, code: "42703" },
      { operation: "save", status: 400, code: "42702" },
      { operation: "replay", status: 300, code: "PGRST203" },
      { operation: "save", status: 400, code: "other" },
      { operation: "save", status: 400, code: "unreadable" },
    ]));
    expect(conditioningRequestDiagnosticSchema.safeParse({
      operation: "save", status: 400, code: "23503", message: "PrivateSyntheticCanary",
    }).success).toBe(false);
  });
});
