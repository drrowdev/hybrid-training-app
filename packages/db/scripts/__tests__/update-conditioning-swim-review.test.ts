import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as migrator from "drizzle-orm/migrator";
import { describe, expect, it, vi } from "vitest";
import { historicalSwimMigrations } from "../../integration-tests/historical-swim-migrations";
import { checkConditioningReviewDispatch, CONDITIONING_REVIEW, CONDITIONING_REVIEW_FLAGS } from "../update-conditioning-swim-review";
import { conditioningReviewMigrations, validateConditioningLedger } from "../conditioning-swim-review-storage";
import { upgradeFlagBody, upgradeFlagTransport, upgradeSnapshotTransport } from "../upgrade-swim-review";
import { verifyRefreshSource } from "../refresh-swim-review";
import { ROUTES } from "../configure-swim-review";
import { DEPLOY_ROUTES } from "../deploy-swim-review";
import { REVIEW } from "../swim-review-config-plan";

vi.mock("drizzle-orm/migrator", async (importOriginal) => {
  const original = await importOriginal<typeof import("drizzle-orm/migrator")>();
  return { ...original, readMigrationFiles: vi.fn(original.readMigrationFiles) };
});

const sha = "b".repeat(40);
const env: NodeJS.ProcessEnv = {
  GITHUB_ACTIONS: "true", GITHUB_EVENT_NAME: "workflow_dispatch", GITHUB_REPOSITORY: REVIEW.repository,
  GITHUB_REF_TYPE: "branch", GITHUB_REF: `refs/heads/${REVIEW.branch}`, GITHUB_SHA: sha,
  GITHUB_JOB: CONDITIONING_REVIEW.job, EXPECTED_SHA: sha, GITHUB_RUN_ATTEMPT: "1",
  UPDATE_CONDITIONING_SWIM_REVIEW: "true", REVIEW_UPGRADE_READ_ONLY: "false",
  ...Object.fromEntries(CONDITIONING_REVIEW.otherOperations.map((key) => [key, "false"])),
};
const inputs = () => ({
  update_conditioning_swim_review: "true", review_upgrade_read_only: "false",
  production_readonly_scope: "preflight", expected_sha: sha,
  test_swim_conditioning_account_flow: "false",
  ...Object.fromEntries(CONDITIONING_REVIEW.otherOperations.map((key) => [key.toLowerCase(), "false"])),
});
describe("conditioning review exact-source and operation boundary", () => {
  it("checks the actual dispatch in prerequisite CI before any credentialed job", () => {
    if (process.env.GITHUB_EVENT_NAME !== "workflow_dispatch") return;
    const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH!, "utf8")) as { inputs?: Record<string, unknown> };
    checkConditioningReviewDispatch(event.inputs, process.env);
  });
  it("accepts only the new operation and harmless production scope", () => {
    expect(checkConditioningReviewDispatch(inputs(), env)).toBe(true);
    expect(checkConditioningReviewDispatch(undefined, env)).toBe(false);
    expect(() => checkConditioningReviewDispatch({ ...inputs(), production_readonly_scope: "post_update" }, env)).toThrow();
    expect(() => checkConditioningReviewDispatch({ ...inputs(), unexpected: "false" }, env)).toThrow();
    expect(() => checkConditioningReviewDispatch({ ...inputs(), test_swim_conditioning_account_flow: "true" }, env)).toThrow();
  });
  it.each(CONDITIONING_REVIEW.otherOperations)("refuses missing, enabled or malformed %s", (key) => {
    for (const value of [undefined, "true", true]) {
      expect(() => checkConditioningReviewDispatch({ ...inputs(), [key.toLowerCase()]: value }, env)).toThrow();
    }
  });
  it.each(["GITHUB_ACTIONS", "GITHUB_EVENT_NAME", "GITHUB_REPOSITORY", "GITHUB_REF_TYPE", "GITHUB_REF", "GITHUB_SHA", "GITHUB_RUN_ATTEMPT"])(
    "refuses %s drift or replay", (key) => {
      expect(() => checkConditioningReviewDispatch(inputs(), { ...env, [key]: "wrong" })).toThrow();
    });
  it("requires the accepted application ancestor, both live refs and a clean tooling-only checkout", () => {
    const io = {
      event: () => ({ inputs: inputs() }), regular: () => true,
      git: (...args: string[]) => {
        if (args[0] === "rev-parse") return sha;
        if (args[0] === "status" || args[0] === "merge-base") return "";
        if (args[0] === "diff") return CONDITIONING_REVIEW.paths.join("\n");
        if (args[0] === "ls-tree") return CONDITIONING_REVIEW.paths.map((path) => `100644 blob ${sha}\t${path}`).join("\n");
        if (args[0] === "ls-remote") return `${args[3] === "refs/heads/main" ? CONDITIONING_REVIEW.expectedMain : sha}\t${args[3]}`;
        throw new Error("unexpected");
      },
    };
    expect(() => verifyRefreshSource(env, io, CONDITIONING_REVIEW)).not.toThrow();
    expect(() => verifyRefreshSource(env, { ...io, regular: () => false }, CONDITIONING_REVIEW)).toThrow();
    for (const [command, output] of [
      ["status", "dirty"], ["diff", "apps/web/src/app/page.tsx"],
      ["diff", "packages/db/drizzle/0157_swim_conditioning_lifecycle.sql"], ["ls-remote", "moved"],
    ]) {
      expect(() => verifyRefreshSource(env, { ...io, git: (...args) => args[0] === command ? output! : io.git(...args) }, CONDITIONING_REVIEW)).toThrow();
    }
  });
  it("verifies the unchanged155 prefix and exact158 target without requiring consecutive ledger IDs", () => {
    // The deployment checkout uses canonical LF; Windows may check out old SQL as CRLF.
    const canonical = [...historicalSwimMigrations(),
      ...migrator.readMigrationFiles({ migrationsFolder: resolve(__dirname, "../../drizzle") }).slice(155)];
    vi.mocked(migrator.readMigrationFiles).mockReturnValueOnce(canonical);
    const migrations = conditioningReviewMigrations();
    const rows = migrations.map((entry, index) => ({ id: index * 3 + 10, hash: entry.hash, created_at: String(entry.folderMillis) }));
    expect(() => validateConditioningLedger(rows.slice(0, 155), migrations, 155)).not.toThrow();
    expect(() => validateConditioningLedger(rows, migrations, 158)).not.toThrow();
    for (const value of [
      rows.slice(0, 154), rows.slice(0, 156), [...rows, rows[157]],
      rows.map((row, index) => index === 42 ? { ...row, hash: "0".repeat(64) } : row),
      rows.map((row, index) => index === 42 ? { ...row, created_at: "1" } : row),
      rows.map((row, index) => index === 42 ? { ...row, id: 1 } : row),
    ]) expect(() => validateConditioningLedger(value, migrations, 158)).toThrow();
  });
  it("cannot mutate through preflight or create old, production or shared flags", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const readOnly = { ...env, REVIEW_UPGRADE_READ_ONLY: "true" };
    const read = upgradeSnapshotTransport(readOnly, Date.now() + 60_000, fetcher, CONDITIONING_REVIEW);
    for (const [url, method] of [[ROUTES.auth, "PATCH"], [ROUTES.create, "POST"], [DEPLOY_ROUTES.create, "POST"]]) {
      expect(() => read(url!, method!, {})).toThrow();
    }
    await expect(upgradeFlagTransport(readOnly, Date.now() + 60_000, fetcher, CONDITIONING_REVIEW, CONDITIONING_REVIEW_FLAGS)(
      ROUTES.create, "POST", upgradeFlagBody(CONDITIONING_REVIEW_FLAGS))).rejects.toThrow();
    for (const body of [
      upgradeFlagBody(), upgradeFlagBody(CONDITIONING_REVIEW_FLAGS).map((row) => ({ ...row, target: ["production"] })),
      upgradeFlagBody(CONDITIONING_REVIEW_FLAGS).map((row) => ({ ...row, gitBranch: undefined })),
    ]) await expect(upgradeFlagTransport(env, Date.now() + 60_000, fetcher, CONDITIONING_REVIEW, CONDITIONING_REVIEW_FLAGS)(
      ROUTES.create, "POST", body)).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("gates every declared operation, serializes review updates and exposes credentials only after source checks", () => {
    const workflow = readFileSync(resolve(__dirname, "../../../../.github/workflows/ci.yml"), "utf8").replaceAll("\r\n", "\n");
    const declared = [...workflow.split("\nconcurrency:")[0]!.matchAll(/^      ([a-z][a-z_]+):$/gm)].map((match) => match[1]);
    expect(declared).toEqual(expect.arrayContaining(Object.keys(inputs())));
    for (const key of declared.filter((name) => !(name! in inputs()))) {
      expect(() => checkConditioningReviewDispatch({ ...inputs(), [key!]: "false" }, env)).toThrow();
    }
    expect(declared.length).toBeLessThanOrEqual(25);
    const job = workflow.split("\n  update-conditioning-swim-review:\n")[1]!.split(/\n  [a-z][a-z0-9-]+:\n/)[0]!;
    for (const gate of ["needs: [ci, identity-guard]", "environment: swim-review",
      "group: swim-review-bootstrap", "cancel-in-progress: false", "persist-credentials: false",
      "inputs.expected_sha != '' && inputs.expected_sha == github.sha",
      ...CONDITIONING_REVIEW.otherOperations.map((key) => `!inputs.${key.toLowerCase()}`),
    ]) expect(job).toContain(gate);
    const [before, operation] = job.split("      - name: Update protected conditioning review once\n");
    expect(before).toContain("--check-source");
    expect(before).not.toContain("secrets.");
    expect(operation!.match(/secrets\.\w+/g)).toHaveLength(5);
    expect(workflow.split("\njobs:")[0]!.match(/inputs\.update_conditioning_swim_review/g)).toHaveLength(2);
  });
});
