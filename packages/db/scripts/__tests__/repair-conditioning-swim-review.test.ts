import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  checkIdentityRepairDispatch, CONDITIONING_IDENTITY_REPAIR as profile,
  initialIdentityRepair, repairIdentityReview, reportIdentityRepair,
} from "../repair-conditioning-swim-review";
import { CONDITIONING_DEPLOYED_RECEIPT } from "../swim-conditioning-account-flow-guards";
import { verifyRefreshSource } from "../refresh-swim-review";
import { upgradeSnapshotTransport } from "../upgrade-swim-review";
import { ROUTES } from "../configure-swim-review";
import { DEPLOY_ROUTES } from "../deploy-swim-review";
import { REVIEW } from "../swim-review-config-plan";

const sha = "b".repeat(40);
const env: NodeJS.ProcessEnv = {
  GITHUB_ACTIONS: "true", GITHUB_EVENT_NAME: "workflow_dispatch", GITHUB_REPOSITORY: REVIEW.repository,
  GITHUB_REF_TYPE: "branch", GITHUB_REF: `refs/heads/${REVIEW.branch}`, GITHUB_SHA: sha,
  GITHUB_JOB: profile.job, EXPECTED_SHA: sha, GITHUB_RUN_ATTEMPT: "1", GITHUB_RUN_ID: "34976059999",
  UPDATE_CONDITIONING_SWIM_REVIEW: "true", REVIEW_UPGRADE_READ_ONLY: "true",
  ...Object.fromEntries(profile.otherOperations.map((key) => [key, "false"])),
};
const inputs = () => ({
  update_conditioning_swim_review: "true", review_upgrade_read_only: "true",
  expected_sha: sha, production_readonly_scope: "preflight",
  ...Object.fromEntries(profile.otherOperations.map((key) => [key.toLowerCase(), "false"])),
});
const dependencies = () => ({
  source: vi.fn(() => {}),
  snapshot: vi.fn(async () => ({ deployment: "fixed", flags: ["a", "b"], auth: "fixed" })),
  inspect: vi.fn(async (_count: 158 | 159) => {}),
  append: vi.fn(async (guard: () => Promise<void>) => { await guard(); }),
  close: vi.fn(async () => {}),
});
describe("DC-SW8 bounded conditioning identity repair", () => {
  it("checks the actual update dispatch in prerequisite CI without requiring that job to perform the update", () => {
    if (process.env.GITHUB_EVENT_NAME !== "workflow_dispatch") return;
    const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH!, "utf8")) as { inputs?: Record<string, unknown> };
    checkIdentityRepairDispatch(event.inputs, process.env);
  });
  it("accepts explicit preflight/apply only and keeps the actual deployment distinct from repaired source", () => {
    expect(checkIdentityRepairDispatch(inputs(), { ...env, GITHUB_JOB: "ci" })).toBe(true);
    expect(checkIdentityRepairDispatch({ ...inputs(), review_upgrade_read_only: "false" }, env)).toBe(true);
    expect(checkIdentityRepairDispatch(undefined, env)).toBe(false);
    expect(profile.previous.sha).toBe(CONDITIONING_DEPLOYED_RECEIPT.sha);
    expect(profile.previous.sha).not.toBe(profile.reference.sha);
    for (const values of [
      { review_upgrade_read_only: true }, { update_conditioning_swim_review: true },
      { production_readonly_scope: "post_update" }, { unknown: "false" }, { expected_sha: profile.reference.sha },
    ]) expect(() => checkIdentityRepairDispatch({ ...inputs(), ...values }, env)).toThrow();
  });
  it.each(profile.otherOperations)("refuses missing, enabled or malformed competing operation %s", (key) => {
    for (const value of [undefined, "true", true]) {
      expect(() => checkIdentityRepairDispatch({ ...inputs(), [key.toLowerCase()]: value }, env)).toThrow();
    }
  });
  it.each(["GITHUB_ACTIONS", "GITHUB_EVENT_NAME", "GITHUB_REPOSITORY", "GITHUB_REF_TYPE", "GITHUB_REF", "GITHUB_SHA", "GITHUB_RUN_ATTEMPT"])(
    "refuses context drift and replay through %s", (key) => {
      expect(() => checkIdentityRepairDispatch(inputs(), { ...env, [key]: "wrong" })).toThrow();
    });
  it("requires accepted ancestry, unchanged main/live ref and no application or migration edits", () => {
    const io = {
      event: () => ({ inputs: inputs() }), regular: () => true,
      git: (...args: string[]) => {
        if (args[0] === "rev-parse") return sha;
        if (args[0] === "status" || args[0] === "merge-base") return "";
        if (args[0] === "diff") return profile.paths.join("\n");
        if (args[0] === "ls-tree") return profile.paths.map((path) => `100644 blob ${sha}\t${path}`).join("\n");
        if (args[0] === "ls-remote") return `${args[3] === "refs/heads/main" ? profile.expectedMain : sha}\t${args[3]}`;
        throw new Error("unexpected");
      },
    };
    expect(() => verifyRefreshSource(env, io, profile)).not.toThrow();
    for (const [command, output] of [
      ["status", "dirty"], ["diff", "apps/web/src/app/page.tsx"],
      ["diff", "packages/db/drizzle/0158_conditioning_request_identity.sql"], ["ls-remote", "moved"],
    ]) expect(() => verifyRefreshSource(env, {
      ...io, git: (...args) => args[0] === command ? output! : io.git(...args),
    }, profile)).toThrow();
    expect(() => verifyRefreshSource(env, { ...io, regular: () => false }, profile)).toThrow();
  });
  it("performs a genuinely read-only preflight with a final unchanged snapshot and database closure", async () => {
    const deps = dependencies(), result = await repairIdentityReview(true, deps);
    expect(result).toMatchObject({ status: "inspection_pass", attempted: false, committed: false,
      verified: false, databaseClosed: true, manualReconciliation: false });
    expect(deps.inspect.mock.calls).toEqual([[158]]);
    expect(deps.append).not.toHaveBeenCalled();
    expect(deps.snapshot).toHaveBeenCalledTimes(2);
    expect(deps.close).toHaveBeenCalledOnce();
  });
  it("requires both post-commit ledger verification and unchanged external metadata", async () => {
    const deps = dependencies(), result = await repairIdentityReview(false, deps);
    expect(result).toMatchObject({ status: "repair_pass", attempted: true, committed: true,
      verified: true, databaseClosed: true, manualReconciliation: false });
    expect(deps.inspect.mock.calls).toEqual([[158], [159]]);
    expect(deps.append).toHaveBeenCalledOnce();
  });
  it("refuses changed preflight metadata without attempting any migration", async () => {
    const deps = dependencies();
    deps.snapshot.mockResolvedValueOnce({ deployment: "changed", flags: ["a", "b"], auth: "fixed" });
    const result = await repairIdentityReview(true, deps);
    expect(result).toMatchObject({ status: "failed", attempted: false, databaseClosed: true });
    expect(result.stages.at(-1)).toEqual({ stage: "completion", status: "failed" });
  });
  it.each(["source", "snapshot", "inspect"] as const)("closes and refuses %s failure before writing", async (key) => {
    const deps = dependencies();
    deps[key].mockImplementationOnce(() => { throw new Error("private diagnostic"); });
    const result = await repairIdentityReview(false, deps);
    expect(result).toMatchObject({ status: "failed", attempted: false, databaseClosed: true, manualReconciliation: false });
    expect(deps.append).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain("private diagnostic");
  });
  it("marks an uncertain transaction for reconciliation rather than retrying or automatically rolling back", async () => {
    const deps = dependencies();
    deps.append.mockRejectedValueOnce(new Error("private diagnostic"));
    const result = await repairIdentityReview(false, deps);
    expect(result).toMatchObject({ status: "failed", attempted: true, committed: false,
      verified: false, databaseClosed: true, manualReconciliation: true });
    expect(deps.append).toHaveBeenCalledOnce();
  });
  it("does not hide a committed but unverified repair", async () => {
    const deps = dependencies();
    deps.inspect.mockImplementation(async (count) => { if (count === 159) throw new Error("private diagnostic"); });
    expect(await repairIdentityReview(false, deps)).toMatchObject({
      status: "failed", attempted: true, committed: true, verified: false, manualReconciliation: true,
    });
  });
  it("marks failure after a changed post-commit snapshot even when ledger verification passed", async () => {
    const deps = dependencies();
    deps.append.mockImplementationOnce(async () => {
      deps.snapshot.mockResolvedValue({ deployment: "changed", flags: ["a", "b"], auth: "fixed" });
    });
    expect(await repairIdentityReview(false, deps)).toMatchObject({
      status: "failed", committed: true, verified: false, manualReconciliation: true,
    });
  });
  it.each([true, false])("cannot pass when database closure fails (readOnly=%s)", async (readOnly) => {
    const deps = dependencies();
    deps.close.mockRejectedValueOnce(new Error("private diagnostic"));
    const result = await repairIdentityReview(readOnly, deps);
    expect(result).toMatchObject({ status: "failed", databaseClosed: false, manualReconciliation: !readOnly });
    expect(result.stages.at(-1)).toEqual({ stage: "close", status: "failed" });
  });
  it("emits a failed safe summary when reporting fails, preserving any committed repair", async () => {
    const outcome = await repairIdentityReview(false, dependencies()), emit = vi.fn();
    const passed = reportIdentityRepair(env, outcome, () => { throw new Error("private diagnostic"); }, emit);
    expect(passed).toBe(false);
    const raw = emit.mock.calls[0]![0] as string;
    const summary = JSON.parse(raw.match(/<pre>(.*)<\/pre>/)![1]!) as {
      testedSha: string; outcome: ReturnType<typeof initialIdentityRepair>;
    };
    expect(summary.testedSha).toBe(sha);
    expect(summary.outcome).toMatchObject({ status: "failed", committed: true, verified: true, manualReconciliation: true });
    expect(summary.outcome.stages.at(-1)).toEqual({ stage: "report", status: "failed" });
    expect(raw).not.toContain("private diagnostic");
  });
  it("provides no deployment, flag or auth mutation route even in apply mode", () => {
    const fetcher = vi.fn<typeof fetch>();
    const request = upgradeSnapshotTransport({ ...env, REVIEW_UPGRADE_READ_ONLY: "false" }, Date.now() + 60_000, fetcher, profile);
    for (const [url, method] of [[ROUTES.auth, "PATCH"], [ROUTES.create, "POST"], [DEPLOY_ROUTES.create, "POST"]]) {
      expect(() => request(url!, method!, {})).toThrow();
    }
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("wires only the fresh database repair entrypoint with all operation exclusions before credentials", () => {
    const workflow = readFileSync(resolve(__dirname, "../../../../.github/workflows/ci.yml"), "utf8").replaceAll("\r\n", "\n");
    const job = workflow.split("\n  update-conditioning-swim-review:\n")[1]!.split(/\n  [a-z][a-z0-9-]+:\n/)[0]!;
    for (const operation of profile.otherOperations) {
      expect(job).toContain(`!inputs.${operation.toLowerCase()}`);
      expect(job).toContain(`${operation}:`);
    }
    expect(job).toContain("needs: [ci, identity-guard]");
    expect(job).toContain("environment: swim-review");
    expect(job).toContain("group: swim-review-bootstrap");
    expect(job).toContain("cancel-in-progress: false");
    expect(job.match(/scripts\/repair-conditioning-swim-review\.ts/g)).toHaveLength(3);
    expect(job).not.toContain("scripts/update-conditioning-swim-review.ts");
    expect(job.split("      - name: Update protected conditioning review once\n")[0]).not.toContain("secrets.");
  });
});
