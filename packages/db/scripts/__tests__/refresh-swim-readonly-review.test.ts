import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { READONLY_REVIEW_REFRESH as profile } from "../refresh-swim-readonly-review";
import { PLAN_REVIEW_REFRESH } from "../refresh-swim-plan-review";
import { ACCEPTED_DEPLOYMENT, CONFIGURATION, RECEIPT } from "../deploy-swim-review";
import { OVERRIDE_KEYS, REVIEW, type EnvironmentMetadata } from "../swim-review-config-plan";

const sha = "b".repeat(40);
const context: NodeJS.ProcessEnv = {
  GITHUB_ACTIONS: "true", GITHUB_EVENT_NAME: "workflow_dispatch", GITHUB_REPOSITORY: REVIEW.repository,
  GITHUB_REF_TYPE: "branch", GITHUB_REF: `refs/heads/${REVIEW.branch}`, GITHUB_SHA: sha, GITHUB_JOB: "ci",
};
const inputs = () => ({ refresh_swim_readonly_review: "true", expected_sha: sha,
  ...Object.fromEntries(profile.otherOperations.map((key) => [key.toLowerCase(), "false"])) });
function checkEvent(input: Record<string, unknown> | undefined, env: NodeJS.ProcessEnv) {
  if (input?.refresh_swim_readonly_review === undefined || input.refresh_swim_readonly_review === "false") return false;
  expect(input.refresh_swim_readonly_review).toBe("true");
  expect(profile.otherOperations.every((key) => input[key.toLowerCase()] === "false")).toBe(true);
  for (const key of ["GITHUB_ACTIONS", "GITHUB_EVENT_NAME", "GITHUB_REPOSITORY", "GITHUB_REF_TYPE", "GITHUB_REF"]) {
    expect(env[key]).toBe(context[key]);
  }
  expect(input.expected_sha).toMatch(/^[a-f0-9]{40}$/);
  expect(input.expected_sha).toBe(env.GITHUB_SHA);
  return true;
}

describe("read-only swim review update boundaries", () => {
  const workflow = readFileSync(resolve(__dirname, "../../../../.github/workflows/ci.yml"), "utf8").replace(/\r\n/g, "\n");
  const job = workflow.split("\n  refresh-swim-readonly-review:\n")[1]!.split("\n  refresh-swim-plan-review:\n")[0]!;

  it("checks actual dispatch exclusivity in prerequisite CI before privileged jobs", () => {
    if (process.env.GITHUB_EVENT_NAME !== "workflow_dispatch") return;
    const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH!, "utf8")) as { inputs?: Record<string, unknown> };
    checkEvent(event.inputs, process.env);
  });
  it("accepts the isolated new mode while leaving other dispatches to their original guards", () => {
    expect(checkEvent(inputs(), context)).toBe(true);
    expect(checkEvent(undefined, context)).toBe(false);
    expect(checkEvent({ refresh_swim_plan_review: "true", refresh_swim_readonly_review: "false" }, context)).toBe(false);
  });
  it.each(profile.otherOperations)("blocks mixed or missing %s before any provider job", (key) => {
    for (const value of ["true", undefined]) {
      const event = inputs();
      Reflect.set(event, key.toLowerCase(), value);
      expect(() => checkEvent(event, context)).toThrow();
    }
  });
  it.each(["GITHUB_ACTIONS", "GITHUB_EVENT_NAME", "GITHUB_REPOSITORY", "GITHUB_REF_TYPE", "GITHUB_REF", "GITHUB_SHA"])(
    "refuses dispatch %s drift", (key) => expect(() => checkEvent(inputs(), { ...context, [key]: "wrong" })).toThrow());
  it.each([undefined, "", "wrong", true])("refuses malformed source %#", (value) => {
    expect(() => checkEvent({ ...inputs(), expected_sha: value }, context)).toThrow();
  });
  it.each(["yes", true, null])("refuses malformed mode %#", (value) => {
    expect(() => checkEvent({ ...inputs(), refresh_swim_readonly_review: value }, context)).toThrow();
  });
  it("pins the logging-removal CI, not the historical frozen26 result", () => {
    expect(profile.reference).toEqual({
      sha: "1c082ee854c5b3e595ebf198b01f878e4d9fe39d", run: "34676255050", kind: "automatic_ci",
    });
    expect(profile.previous).toEqual({
      run: "34675114561", sha: "da91ab606680d5436591d7fe51446f184147602e",
      id: "dpl_3vfgXX3bpYQ9BL5JhA6F8U3Qwy73", url: "hybrid-training-app-afdlerer6-drrowdevs-projects.vercel.app",
      start: Date.parse("2026-09-12T05:20:38Z"), end: Date.parse("2026-09-12T05:22:27Z"),
    });
    expect(profile.aliasUid).toBe(PLAN_REVIEW_REFRESH.aliasUid);
    expect(profile.paths).toHaveLength(7);
    expect(profile.paths.every((path) => /^(packages\/db\/scripts\/|\.github\/workflows\/ci\.yml$|docs\/knowledge\/)/.test(path))).toBe(true);
    expect(PLAN_REVIEW_REFRESH.reference).toEqual({
      sha: "c1f25d2b2704d710f83c1e5be2d14839d1a545fe", run: "34645293193",
    });
  });
  it("changes only the BUILD_SHA receipt window, not pool/configuration/branch identity", () => {
    const rows: EnvironmentMetadata[] = OVERRIDE_KEYS.map((key) => ({
      id: RECEIPT[key], key, type: "encrypted", target: ["preview"], gitBranch: REVIEW.branch,
      createdAt: CONFIGURATION.start + 1000,
      updatedAt: key === "NEXT_PUBLIC_BUILD_SHA" ? profile.previous.start + 1000 :
        key === "POOL_SWIMMING_ENABLED" ? ACCEPTED_DEPLOYMENT.start + 1000 : CONFIGURATION.end - 1000,
    }));
    expect(() => profile.receipt(rows, [])).not.toThrow();
    expect(() => PLAN_REVIEW_REFRESH.receipt(rows, [])).toThrow();
    for (const key of OVERRIDE_KEYS) {
      const changed = structuredClone(rows);
      changed.find((row) => row.key === key)!.updatedAt = profile.previous.end + 1;
      expect(() => profile.receipt(changed, [])).toThrow();
    }
    for (const updatedAt of [PLAN_REVIEW_REFRESH.previous.end, profile.previous.start - 1, profile.previous.end + 1]) {
      const changed = structuredClone(rows);
      changed.find((row) => row.key === "NEXT_PUBLIC_BUILD_SHA")!.updatedAt = updatedAt;
      expect(() => profile.receipt(changed, [])).toThrow();
    }
  });
  it("preserves the previous plan-refresh job in addition to its existing eleven job pins", () => {
    const body = workflow.split("\n  refresh-swim-plan-review:\n")[1]!.split("\n  refresh-swim-review:\n")[0]!;
    expect(createHash("sha256").update(body).digest("hex")).toBe("da73ff93c546891102d80428b0ea9130bbc88a669c143dc22e5f3e2b692eebaa");
  });
  it("requires one default-false job, both prerequisites and all twelve other flags false", () => {
    expect(workflow.match(/\n  refresh-swim-readonly-review:/g)).toHaveLength(1);
    expect(workflow).toMatch(/refresh_swim_readonly_review:\n\s+description:.*\n\s+required: false\n\s+default: false\n\s+type: boolean/);
    expect(profile.otherOperations).toHaveLength(12);
    for (const gate of [
      "needs: [ci, identity-guard]", "github.event_name == 'workflow_dispatch'",
      "github.repository == 'drrowdev/hybrid-training-app'", "github.ref_type == 'branch'",
      "github.ref == 'refs/heads/copilot/new-acceptance-cases'", "inputs.refresh_swim_readonly_review == true",
      "inputs.expected_sha != '' && inputs.expected_sha == github.sha",
      ...profile.otherOperations.map((key) => `inputs.${key.toLowerCase()} == false`),
      "environment: swim-review", "contents: read", "fetch-depth: 0", "persist-credentials: false",
      "ref: ${{ inputs.expected_sha }}", "group: swim-review-bootstrap", "cancel-in-progress: false",
      "timeout-minutes: 25", "timeout-minutes: 20",
      "REFRESH_SWIM_READONLY_REVIEW: ${{ inputs.refresh_swim_readonly_review }}",
      ...profile.otherOperations.map((key) => `${key}: \${{ inputs.${key.toLowerCase()} }}`),
    ]) expect(job).toContain(gate);
    const concurrency = workflow.split("\nconcurrency:\n")[1]!.split("\njobs:\n")[0]!;
    expect(concurrency.match(/inputs\.refresh_swim_readonly_review/g)).toHaveLength(2);
    expect(concurrency).toContain("'ci-swim-review-configuration'");
  });
  it("limits credentials to the final operation after offline/type/source checks", () => {
    const [before, operation] = job.split("      - name: Refresh read-only swim review\n");
    expect(before).not.toContain("secrets.");
    expect(before!.indexOf("pnpm install")).toBeLessThan(before!.indexOf("vitest run"));
    expect(before!.indexOf("vitest run")).toBeLessThan(before!.indexOf("--check-source"));
    expect(before).toContain("--strict scripts/refresh-swim-readonly-review.ts");
    expect(operation!.match(/secrets\.\w+/g)).toEqual([
      "secrets.VERCEL_REVIEW_TOKEN", "secrets.SUPABASE_REVIEW_MANAGEMENT_TOKEN",
      "secrets.SWIM_REVIEW_SUPABASE_ANON_KEY", "secrets.SWIM_REVIEW_SUPABASE_SERVICE_ROLE_KEY",
    ]);
    expect(operation).toContain("run: pnpm --filter @hta/db exec tsx scripts/refresh-swim-readonly-review.ts");
    expect(job).not.toMatch(/DATABASE_URL|secrets\.SWIM_REVIEW_OWNER_/);
  });
});
