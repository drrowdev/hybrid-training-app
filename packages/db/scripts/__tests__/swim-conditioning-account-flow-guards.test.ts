import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { conditioningAccountProfile, checkConditioningAccountDispatch, conditioningAccountAbsenceQuery,
  conditioningAccountTables, conditioningSaveDiagnostic, CONDITIONING_ACCOUNT_REFERENCE,
  repairedConditioningAccountProfile, todayConditioningAccountProfile, verifyConditioningContextRequests,
  CONDITIONING_DEPLOYED_RECEIPT } from "../swim-conditioning-account-flow-guards";
import { accountIdentity, accountFlowContext } from "../swim-account-flow-guards";
import { verifyRefreshCheckout, verifyRefreshSource } from "../refresh-swim-review";
import { OVERRIDE_KEYS, REVIEW, type EnvironmentMetadata } from "../swim-review-config-plan";
import { ACCEPTED_DEPLOYMENT, CONFIGURATION, RECEIPT } from "../deploy-swim-review";
import { UNTIMED_FLAG_RECEIPT } from "../update-untimed-swim-review";

const review = {
  run: "34952341296", sha: CONDITIONING_ACCOUNT_REFERENCE.sha,
  id: "dpl_ConditioningSynthetic", url: "hybrid-training-app-conditioning-synthetic.vercel.app",
  start: Date.parse("2026-09-15T10:00:00Z"), end: Date.parse("2026-09-15T10:05:00Z"),
  flags: { SWIM_CONDITIONING_ENABLED: "conditioningFlag", SWIM_IMPORT_OUTCOMES_ENABLED: "outcomesFlag" },
};
const profile = conditioningAccountProfile(review), sha = "b".repeat(40);
const env: NodeJS.ProcessEnv = {
  GITHUB_ACTIONS: "true", GITHUB_EVENT_NAME: "workflow_dispatch", GITHUB_REPOSITORY: REVIEW.repository,
  GITHUB_REF_TYPE: "branch", GITHUB_REF: `refs/heads/${REVIEW.branch}`, GITHUB_SHA: sha,
  EXPECTED_SHA: sha, GITHUB_RUN_ID: "34999999999", GITHUB_RUN_ATTEMPT: "1", GITHUB_JOB: profile.job,
  TEST_SWIM_CONDITIONING_ACCOUNT_FLOW: "true",
  ...Object.fromEntries(profile.otherOperations.map((key) => [key, "false"])),
};
const inputs = () => ({
  test_swim_conditioning_account_flow: "true", review_upgrade_read_only: "true", production_readonly_scope: "preflight",
  expected_sha: sha, ...Object.fromEntries(profile.otherOperations.map((key) => [key.toLowerCase(), "false"])),
});
function installed(): EnvironmentMetadata[] {
  return [
    ...OVERRIDE_KEYS.map((key): EnvironmentMetadata => ({
      id: RECEIPT[key], key, type: "encrypted", target: ["preview"], gitBranch: REVIEW.branch,
      createdAt: CONFIGURATION.start + 1000,
      updatedAt: key === "NEXT_PUBLIC_BUILD_SHA" ? review.start + 1000 :
        key === "POOL_SWIMMING_ENABLED" ? ACCEPTED_DEPLOYMENT.start + 1000 : CONFIGURATION.end - 1000,
    })),
    ...Object.entries(UNTIMED_FLAG_RECEIPT).map(([key, id]): EnvironmentMetadata => ({
      id, key, type: "encrypted", target: ["preview"], gitBranch: REVIEW.branch,
      createdAt: Date.parse("2026-09-13T08:07:00Z"), updatedAt: Date.parse("2026-09-13T08:07:00Z"),
    })),
    ...Object.entries(review.flags).map(([key, id]): EnvironmentMetadata => ({
      id, key, type: "encrypted", target: ["preview"], gitBranch: REVIEW.branch,
      createdAt: review.start + 1000, updatedAt: review.start + 1000,
    })),
  ];
}
describe("DC-SW3/SW5/SW8 integrated disposable-account boundary", () => {
  it("pins the repaired accepted source separately from the unchanged deployment and refuses further schema changes", () => {
    const repaired = repairedConditioningAccountProfile();
    expect(repaired.reference).toEqual({
      sha: "42154e140b58a609573bccf2169eaff7b59aebdf", run: "34977730272", kind: "automatic_ci",
    });
    expect(repaired.previous.sha).toBe(CONDITIONING_DEPLOYED_RECEIPT.sha);
    expect(repaired.previous.id).toBe(CONDITIONING_DEPLOYED_RECEIPT.id);
    expect(repaired.paths.every((path) => !path.startsWith("packages/db/drizzle/"))).toBe(true);
    const source = readFileSync(resolve(__dirname, "../../../../apps/web/scripts/swim-conditioning-account-flow.ts"), "utf8");
    expect(source).toContain("ledger: (sql) => inspectIdentityReview(sql, 159)");
    expect(repaired.otherOperations).toEqual(profile.otherOperations);
  });
  it("pins the Today application reference without admitting more application or schema changes", () => {
    const current = todayConditioningAccountProfile();
    expect(current.reference).toEqual({
      sha: "97518f6d4818b648e474f4bd544a7a293cd378b9", run: "35015324525", kind: "automatic_ci",
    });
    expect(current.previous).toEqual(repairedConditioningAccountProfile().previous);
    expect(current.paths.some((path) => path.startsWith("apps/web/src/") || path.startsWith("packages/db/drizzle/"))).toBe(false);
    const source = readFileSync(resolve(__dirname, "../../../../apps/web/scripts/swim-conditioning-account-flow.ts"), "utf8");
    expect(source).toContain("todayConditioningAccountProfile()");
    expect(source).toContain("validateRequests: verifyConditioningContextRequests");
    const runner = readFileSync(resolve(__dirname, "../../../../apps/web/scripts/swim-account-flow.ts"), "utf8");
    expect(runner).toContain("configuration.validateRequests?.(result.requestDiagnostics)");
  });
  it("rejects an observed context-read failure even when all browser cases pass", () => {
    expect(() => verifyConditioningContextRequests([])).not.toThrow();
    expect(() => verifyConditioningContextRequests([
      { operation: "save", status: 200, code: "ok" },
      { operation: "context", status: 200, code: "ok" },
    ])).not.toThrow();
    expect(() => verifyConditioningContextRequests([
      { operation: "context", status: 400, code: "42703" },
    ])).toThrow("context_read_failed");
    expect(() => verifyConditioningContextRequests([
      { operation: "context", status: 503, code: "unreadable" },
    ])).toThrow("context_read_failed");
  });
  it("uses the declared action bound for browser assertions and excludes route announcements from save errors", () => {
    const browser = readFileSync(resolve(__dirname, "../../../../apps/web/scripts/swim-conditioning-account-flow-browser.ts"), "utf8");
    expect(browser).toContain("baseExpect.configure({ timeout: 20_000 })");
    expect(browser).toContain("context.setDefaultTimeout(20_000)");
    expect(browser).toContain(`page.locator('p[role="alert"]')`);
    expect(browser).toContain("const MAX_BROWSER_REQUESTS = 750");
    expect(browser).toContain("++report.browserRequests > MAX_BROWSER_REQUESTS");
    expect(browser).toContain("++report.clientRequests <= 100");
    expect(browser).toContain("await page.reload()");
    expect(browser.match(/page\.goto\(/g)).toHaveLength(1);
    expect(browser).toContain(`page.locator('a[href="/app/plan"]:visible').first().click()`);
    expect(browser).toContain('getByTestId("program-card-tactical-barbell")');
    expect(browser).toContain('a[href="/app/swim/recordings/${receipt.id}"]');
    expect(browser).toContain('await page.getByTestId("settings-hub-swimming").click()');
    const standalone = readFileSync(resolve(__dirname, "../../../../apps/web/scripts/swim-account-flow-browser.ts"), "utf8");
    expect(standalone).toContain("++report.browserRequests > 500");
  });
  it("reduces save alerts to fixed categories without retaining their text", () => {
    expect(conditioningSaveDiagnostic([])).toBe("no_alert");
    expect(conditioningSaveDiagnostic(["PrivateSyntheticCanary"])).toBe("unclassified_alert");
    expect(conditioningSaveDiagnostic(["The programme and swimming could not be saved."])).toBe("save_refused");
    expect(conditioningSaveDiagnostic(["This plan does not fit the selected sessions."])).toBe("course_fit");
    expect(conditioningSaveDiagnostic(["The save was not confirmed."])).toBe("unconfirmed");
  });
  it("validates an actual manual dispatch before privileged account work", () => {
    if (process.env.GITHUB_EVENT_NAME !== "workflow_dispatch") return;
    const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH!, "utf8")) as { inputs?: Record<string, unknown> };
    checkConditioningAccountDispatch(event.inputs, process.env);
  });
  it("accepts only isolated testing, not configuration, production, missing or unknown flags", () => {
    expect(checkConditioningAccountDispatch(inputs(), env)).toBe(true);
    expect(checkConditioningAccountDispatch(undefined, env)).toBe(false);
    for (const key of profile.otherOperations) for (const value of ["true", undefined, true]) {
      expect(() => checkConditioningAccountDispatch({ ...inputs(), [key.toLowerCase()]: value }, env)).toThrow();
    }
    for (const change of [{ review_upgrade_read_only: "false" }, { production_readonly_scope: "post_update" }, { extra: "false" }]) {
      expect(() => checkConditioningAccountDispatch({ ...inputs(), ...change }, env)).toThrow();
    }
  });
  it.each(["GITHUB_ACTIONS", "GITHUB_EVENT_NAME", "GITHUB_REPOSITORY", "GITHUB_REF_TYPE", "GITHUB_REF", "GITHUB_SHA"])(
    "refuses %s drift", (key) => expect(() => checkConditioningAccountDispatch(inputs(), { ...env, [key]: "wrong" })).toThrow());
  it("allows later attempts for cleanup only and validates immutable source even after live refs move", () => {
    expect(accountFlowContext(env, false, profile).sha).toBe(sha);
    expect(() => accountFlowContext({ ...env, GITHUB_RUN_ATTEMPT: "2" }, false, profile)).toThrow();
    expect(accountFlowContext({ ...env, GITHUB_RUN_ATTEMPT: "2" }, true, profile).sha).toBe(sha);
    const io = {
      event: () => ({ inputs: inputs() }), regular: () => true,
      git: (...args: string[]) => {
        if (args[0] === "rev-parse") return sha;
        if (args[0] === "status" || args[0] === "merge-base") return "";
        if (args[0] === "diff") return profile.paths.join("\n");
        if (args[0] === "ls-tree") return profile.paths.map((path) => `100644 blob ${sha}\t${path}`).join("\n");
        if (args[0] === "ls-remote") return "moved";
        throw new Error("unexpected");
      },
    };
    expect(() => verifyRefreshSource(env, io, profile)).toThrow();
    expect(() => verifyRefreshCheckout(env, io, profile)).not.toThrow();
    expect(() => verifyRefreshCheckout(env, { ...io, regular: () => false }, profile)).toThrow();
    expect(() => verifyRefreshCheckout(env, { ...io, git: (...args) =>
      args[0] === "diff" ? "apps/web/src/app/page.tsx" : io.git(...args) }, profile)).toThrow();
  });
  it("requires both new flag receipts while retaining all previous encrypted preview settings", () => {
    expect(() => profile.receipt(installed(), [])).not.toThrow();
    const changes: Partial<EnvironmentMetadata>[] = [
      { target: ["production"] }, { gitBranch: "main" }, { id: "changedFlag" }, { type: "plain" },
      { createdAt: review.start - 1 }, { updatedAt: review.end + 1 }, { key: "UNAPPROVED_FLAG" },
    ];
    for (const change of changes) {
      const rows = installed();
      rows[rows.length - 1] = { ...rows.at(-1)!, ...change };
      expect(() => profile.receipt(rows, [])).toThrow();
    }
    expect(() => profile.receipt(installed().slice(0, -1), [])).toThrow();
    expect(() => conditioningAccountProfile({ ...review, end: review.start + 1_200_001 })).toThrow();
    expect(() => conditioningAccountProfile({ ...review, flags: {
      SWIM_CONDITIONING_ENABLED: "sameFlagId", SWIM_IMPORT_OUTCOMES_ENABLED: "sameFlagId",
    } })).toThrow();
  });
  it("verifies all new primary, benchmark and swim rows disappear without querying any other owner", () => {
    const identity = accountIdentity(env.GITHUB_RUN_ID!, sha, "a");
    const query = conditioningAccountAbsenceQuery(identity);
    expect(query.parameters).toEqual([identity.id]);
    expect(query.query).not.toContain(identity.id);
    expect(query.query.match(/\$1::uuid/g)).toHaveLength(conditioningAccountTables.length);
    expect(query.query).not.toMatch(/INSERT|UPDATE|DELETE|TRUNCATE/);
    for (const table of ["swim_import_outcomes", "swim_conditioning_bindings", "swim_conditioning_saves",
      "training_blocks", "program_instances", "planned_sessions", "training_maxes", "sessions"]) {
      expect(query.query).toContain(`FROM public.${table} WHERE user_id = $1::uuid`);
    }
    expect(query.query).toContain("FROM public.cardio_logs c JOIN public.sessions s ON s.id = c.session_id WHERE s.user_id = $1::uuid");
    expect(query.query).not.toContain("cardio_logs WHERE user_id");
    expect(() => conditioningAccountAbsenceQuery({ ...identity, id: accountIdentity(env.GITHUB_RUN_ID!, sha, "b").id })).toThrow();
  });
  it("refuses the real executable outside GitHub before starting a server or creating accounts", () => {
    const canary = "PrivateSyntheticCanary";
    const child = spawnSync(process.execPath, [require.resolve("tsx/cli"),
      resolve(__dirname, "../../../../apps/web/scripts/swim-conditioning-account-flow.ts")], {
      cwd: resolve(__dirname, "../../../.."), encoding: "utf8", timeout: 20_000,
      env: { ...process.env, GITHUB_ACTIONS: "false", GITHUB_STEP_SUMMARY: "",
        SWIM_REVIEW_SUPABASE_SERVICE_ROLE_KEY: canary },
    });
    expect(child.status).toBe(1);
    expect(child.stderr).toBe("");
    expect(child.stdout).toContain("SWIM_CONDITIONING_ACCOUNT_FLOW_SUMMARY");
    expect(child.stdout).toContain('"accountsAttempted":0');
    expect(child.stdout).not.toContain(canary);
  });
  it("uses the final supported workflow input, existing serialization and independent least-privilege cleanup", () => {
    const workflow = readFileSync(resolve(__dirname, "../../../../.github/workflows/ci.yml"), "utf8").replaceAll("\r\n", "\n");
    const declared = [...workflow.split("\nconcurrency:")[0]!.matchAll(/^      ([a-z][a-z_]+):$/gm)].map((match) => match[1]);
    expect(declared.sort()).toEqual(Object.keys(inputs()).sort());
    expect(declared.length).toBeLessThanOrEqual(25);
    const job = workflow.split("\n  test-swim-conditioning-account-flow:\n")[1]!;
    for (const gate of ["needs: [ci, identity-guard]", "environment: swim-review", "group: swim-review-bootstrap",
      "cancel-in-progress: false", "persist-credentials: false", "inputs.review_upgrade_read_only == true",
      ...profile.otherOperations.map((key) => `!inputs.${key.toLowerCase()}`)]) expect(job).toContain(gate);
    const [before, operation] = job.split("      - name: Exercise integrated account flow\n");
    expect(before).not.toContain("secrets.");
    expect(before).toContain("--check-source");
    expect(before).toContain("tsc -p tsconfig.account-flow.json");
    expect(operation!.match(/secrets\.\w+/g)).toHaveLength(8);
    expect(operation).toContain("if: always()");
    expect(operation).toContain("swim-conditioning-account-flow.ts --cleanup");
    expect(job).not.toContain("upload-artifact");
  });
});
