import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PLAN_REVIEW_REFRESH as profile } from "../refresh-swim-plan-review";
import { ACCEPTED_DEPLOYMENT, CONFIGURATION, RECEIPT, acceptedReceipt } from "../deploy-swim-review";
import { REFRESH_PATHS, REFRESH_REFERENCE } from "../refresh-swim-review";
import { OVERRIDE_KEYS, REVIEW, type EnvironmentMetadata } from "../swim-review-config-plan";

const sha = "b".repeat(40);
const context: NodeJS.ProcessEnv = {
  GITHUB_ACTIONS: "true", GITHUB_EVENT_NAME: "workflow_dispatch", GITHUB_REPOSITORY: REVIEW.repository,
  GITHUB_REF_TYPE: "branch", GITHUB_REF: `refs/heads/${REVIEW.branch}`, GITHUB_SHA: sha, GITHUB_JOB: "ci",
};
const inputs = () => ({ refresh_swim_plan_review: "true", expected_sha: sha,
  ...Object.fromEntries(profile.otherOperations.map((key) => [key.toLowerCase(), "false"])) });
function checkEvent(input: Record<string, unknown> | undefined, env: NodeJS.ProcessEnv) {
  if (input?.refresh_swim_plan_review === undefined || input.refresh_swim_plan_review === "false") return false;
  expect(input.refresh_swim_plan_review).toBe("true");
  expect(profile.otherOperations.every((key) => input[key.toLowerCase()] === "false")).toBe(true);
  for (const key of ["GITHUB_ACTIONS", "GITHUB_EVENT_NAME", "GITHUB_REPOSITORY", "GITHUB_REF_TYPE", "GITHUB_REF"]) {
    expect(env[key]).toBe(context[key]);
  }
  expect(input.expected_sha).toMatch(/^[a-f0-9]{40}$/);
  expect(input.expected_sha).toBe(env.GITHUB_SHA);
  return true;
}
function receipt(): EnvironmentMetadata[] {
  return OVERRIDE_KEYS.map((key) => ({
    id: RECEIPT[key], key, type: "encrypted", target: ["preview"], gitBranch: REVIEW.branch,
    createdAt: CONFIGURATION.start + 1000,
    updatedAt: key === "NEXT_PUBLIC_BUILD_SHA" ? profile.previous.start + 1000 :
      key === "POOL_SWIMMING_ENABLED" ? ACCEPTED_DEPLOYMENT.start + 1000 : CONFIGURATION.end - 1000,
  }));
}

describe("accepted plan-review update boundaries", () => {
  const workflow = readFileSync(resolve(__dirname, "../../../../.github/workflows/ci.yml"), "utf8").replace(/\r\n/g, "\n");
  const job = workflow.split("\n  refresh-swim-plan-review:\n")[1]!.split("\n  refresh-swim-review:\n")[0]!;

  it("checks real dispatch exclusivity in prerequisite CI without privileged-job impersonation", () => {
    if (process.env.GITHUB_EVENT_NAME !== "workflow_dispatch") return;
    const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH!, "utf8")) as { inputs?: Record<string, unknown> };
    checkEvent(event.inputs, process.env);
  });
  it("accepts only the new isolated operation while preserving old dispatch guards", () => {
    expect(checkEvent(inputs(), context)).toBe(true);
    expect(checkEvent(undefined, context)).toBe(false);
    expect(checkEvent({ refresh_swim_review: "true", refresh_swim_plan_review: "false" }, context)).toBe(false);
  });
  it.each(profile.otherOperations)("blocks mixed or missing %s flags before privileged jobs", (key) => {
    for (const value of ["true", undefined]) {
      const event = inputs();
      Reflect.set(event, key.toLowerCase(), value);
      expect(() => checkEvent(event, context)).toThrow();
    }
  });
  it.each(["GITHUB_ACTIONS", "GITHUB_EVENT_NAME", "GITHUB_REPOSITORY", "GITHUB_REF_TYPE", "GITHUB_REF", "GITHUB_SHA"])(
    "refuses actual-event %s drift", (key) => {
      expect(() => checkEvent(inputs(), { ...context, [key]: "wrong" })).toThrow();
    });
  it.each([undefined, "", "wrong", true])("refuses malformed expected source %#", (value) => {
    expect(() => checkEvent({ ...inputs(), expected_sha: value }, context)).toThrow();
  });
  it.each(["yes", true, null])("refuses malformed mode %#", (value) => {
    expect(() => checkEvent({ ...inputs(), refresh_swim_plan_review: value }, context)).toThrow();
  });
  it("pins accepted app/reference, previous deployment and existing alias without changing original pins", () => {
    expect(profile.reference).toEqual({ sha: "c1f25d2b2704d710f83c1e5be2d14839d1a545fe", run: "34645293193" });
    expect(profile.previous).toMatchObject({ run: "34625326276", sha: "abbd6583ef0dc459f8ae7cee4dd728a98d85d0d7",
      id: "dpl_8Y5MZiTJPBpYuZviFh3azJdkK6Xj", url: "hybrid-training-app-arqdi4e2y-drrowdevs-projects.vercel.app" });
    expect(profile.aliasUid).toMatch(/^[a-f0-9]{128}$/);
    expect(REFRESH_REFERENCE.sha).toBe("0a3d12e862ad2ffe7acbb8498f3442923005674c");
    expect(REFRESH_PATHS).toHaveLength(7);
    expect(ACCEPTED_DEPLOYMENT.id).toBe("dpl_6nkvV3revZgf1MCD4LnNkJ5Kyynt");
    expect(profile.paths.every((path) => /^(packages\/db\/scripts\/|\.github\/workflows\/ci\.yml$|docs\/knowledge\/)/.test(path))).toBe(true);
  });
  it("accepts only the new BUILD_SHA receipt window, retaining the original pool/configuration windows", () => {
    const rows = receipt();
    expect(() => profile.receipt(rows, [])).not.toThrow();
    expect(() => acceptedReceipt(rows, [], true)).toThrow();
    for (const key of OVERRIDE_KEYS) {
      const changed = structuredClone(rows);
      changed.find((row) => row.key === key)!.updatedAt = profile.previous.end + 1;
      expect(() => profile.receipt(changed, [])).toThrow();
    }
    for (const updatedAt of [ACCEPTED_DEPLOYMENT.end, profile.previous.start - 1, profile.previous.end + 1]) {
      const changed = structuredClone(rows);
      changed.find((row) => row.key === "NEXT_PUBLIC_BUILD_SHA")!.updatedAt = updatedAt;
      expect(() => profile.receipt(changed, [])).toThrow();
    }
  });
  it("preserves production and identity job bodies", () => {
    const pins: Record<string, string> = {
      "identity-guard": "35779b9424f98e571769068bcf1bbff818aff147c51eb178bd83438bc267e479",
      "prod-migrate": "4c3643cb734fcaeb1f70d97b5f12590f84684fb7625f7d6b3fe3eb15e6272a06",
      "prod-drift": "fe7c0ca259846a82aa0612ef08135411618c75c22bad3bb9f23cf3e6cf6e4f12",
    };
    for (const [id, expected] of Object.entries(pins)) {
      const body = workflow.split(`\n  ${id}:\n`)[1]!.split(/\n  [a-z][a-z0-9-]+:\n/)[0]!;
      expect(createHash("sha256").update(body).digest("hex"), id).toBe(expected);
    }
  });
  it("gates a separate default-false job on source, both prerequisites and every other mode being false", () => {
    expect(workflow.match(/\n  refresh-swim-plan-review:/g)).toHaveLength(1);
    expect(workflow).toMatch(/refresh_swim_plan_review:\n\s+description:.*\n\s+required: false\n\s+default: false\n\s+type: boolean/);
    for (const gate of [
      "needs: [ci, identity-guard]", "github.event_name == 'workflow_dispatch'",
      "github.repository == 'drrowdev/hybrid-training-app'", "github.ref_type == 'branch'",
      "github.ref == 'refs/heads/copilot/new-acceptance-cases'", "inputs.refresh_swim_plan_review == true",
      "inputs.expected_sha != '' && inputs.expected_sha == github.sha",
      ...profile.otherOperations.map((key) => `inputs.${key.toLowerCase()} == false`),
      "environment: swim-review", "contents: read", "fetch-depth: 0", "persist-credentials: false",
      "ref: ${{ inputs.expected_sha }}", "group: swim-review-bootstrap", "cancel-in-progress: false",
      "timeout-minutes: 25", "timeout-minutes: 20",
      "REFRESH_SWIM_PLAN_REVIEW: ${{ inputs.refresh_swim_plan_review }}",
      ...profile.otherOperations.map((key) => `${key}: \${{ inputs.${key.toLowerCase()} }}`),
    ]) expect(job).toContain(gate);
    const concurrency = workflow.split("\nconcurrency:\n")[1]!.split("\njobs:\n")[0]!;
    expect(concurrency.match(/inputs\.refresh_swim_plan_review/g)).toHaveLength(2);
    expect(concurrency).toContain("'ci-swim-review-configuration'");
  });
  it("exposes only four credentials after offline checks and source verification, never database/account secrets", () => {
    const [before, operation] = job.split("      - name: Refresh isolated plan review\n");
    expect(before).not.toContain("secrets.");
    expect(before!.indexOf("pnpm install")).toBeLessThan(before!.indexOf("vitest run"));
    expect(before!.indexOf("vitest run")).toBeLessThan(before!.indexOf("--check-source"));
    expect(before).toContain("--strict scripts/refresh-swim-plan-review.ts");
    expect(operation!.match(/secrets\.\w+/g)).toEqual([
      "secrets.VERCEL_REVIEW_TOKEN", "secrets.SUPABASE_REVIEW_MANAGEMENT_TOKEN",
      "secrets.SWIM_REVIEW_SUPABASE_ANON_KEY", "secrets.SWIM_REVIEW_SUPABASE_SERVICE_ROLE_KEY",
    ]);
    expect(operation).toContain("run: pnpm --filter @hta/db exec tsx scripts/refresh-swim-plan-review.ts");
    expect(job).not.toContain("DATABASE_URL");
    expect(job).not.toContain("secrets.SWIM_REVIEW_OWNER_");
  });
});
