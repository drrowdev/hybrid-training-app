import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import {
  ACCOUNT_FLOW as profile, ACCOUNT_FLOW_SUPABASE as origin, accountIdentity, verifyAccountIdentity,
  accountAdminRequestAllowed as allowed, accountFlowContext, checkAccountFlowDispatch, cleanupAccountFixtures,
} from "../swim-account-flow-guards";
import { verifyRefreshCheckout, verifyRefreshSource } from "../refresh-swim-review";

const sha = "b".repeat(40), run = "34760399999";
const identities = [accountIdentity(run, sha, "a"), accountIdentity(run, sha, "b")];
const user = (index: number) => ({
  id: identities[index]!.id, email: identities[index]!.email, role: "authenticated",
  app_metadata: { hta_swim_account_flow: identities[index]!.marker, provider: "email", providers: ["email"] },
});
const env = {
  GITHUB_ACTIONS: "true", GITHUB_EVENT_NAME: "workflow_dispatch", GITHUB_REPOSITORY: "drrowdev/hybrid-training-app",
  GITHUB_REF_TYPE: "branch", GITHUB_REF: "refs/heads/copilot/new-acceptance-cases",
  GITHUB_JOB: profile.job, GITHUB_SHA: sha, EXPECTED_SHA: sha,
  GITHUB_RUN_ID: run, GITHUB_RUN_ATTEMPT: "1", TEST_SWIM_ACCOUNT_FLOW: "true",
  ...Object.fromEntries(profile.otherOperations.map((key) => [key, "false"])),
};
const inputs = () => ({
  test_swim_account_flow: "true", expected_sha: sha, review_upgrade_read_only: "true",
  ...Object.fromEntries(profile.otherOperations.map((key) => [key.toLowerCase(), "false"])),
});
const createBody = {
  id: identities[0]!.id, email: identities[0]!.email, password: "s".repeat(43), email_confirm: true,
  app_metadata: { hta_swim_account_flow: identities[0]!.marker },
};

describe("DC-SW3/SW5/SW8 bounded synthetic account flow", () => {
  it("rejects mixed live dispatches in prerequisite CI", () => {
    if (process.env.GITHUB_EVENT_NAME !== "workflow_dispatch") return;
    const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH!, "utf8")) as { inputs?: Record<string, unknown> };
    checkAccountFlowDispatch(event.inputs, process.env);
  });
  it("binds the real feature context, exact SHA and explicit inactive operations", () => {
    expect(checkAccountFlowDispatch(inputs(), { ...env, GITHUB_JOB: "ci" })).toBe(true);
    expect(checkAccountFlowDispatch(undefined, env)).toBe(false);
    for (const key of profile.otherOperations) {
      for (const value of ["true", true, undefined]) {
        expect(() => checkAccountFlowDispatch({ ...inputs(), [key.toLowerCase()]: value }, env)).toThrow();
      }
    }
    expect(() => checkAccountFlowDispatch({ ...inputs(), unknown: "false" }, env)).toThrow();
    expect(() => checkAccountFlowDispatch({ ...inputs(), review_upgrade_read_only: "false" }, env)).toThrow();
    expect(() => checkAccountFlowDispatch({ ...inputs(), expected_sha: profile.reference.sha },
      { ...env, GITHUB_SHA: profile.reference.sha })).toThrow();
  });
  it.each(["GITHUB_ACTIONS", "GITHUB_EVENT_NAME", "GITHUB_REPOSITORY", "GITHUB_REF_TYPE", "GITHUB_REF",
    "GITHUB_JOB", "GITHUB_SHA", "GITHUB_RUN_ID", "GITHUB_RUN_ATTEMPT"])("refuses wrong %s", (key) => {
    expect(() => accountFlowContext({ ...env, [key]: "wrong" })).toThrow();
  });
  it("allows later-attempt cleanup but never repeats account creation", () => {
    expect(() => accountFlowContext({ ...env, GITHUB_RUN_ATTEMPT: "2" })).toThrow();
    expect(accountFlowContext({ ...env, GITHUB_RUN_ATTEMPT: "2" }, true)).toEqual({ sha, run });
  });
  it("derives two stable project/run/source-specific fixture identities", () => {
    expect(identities[0]).toEqual(accountIdentity(run, sha, "a"));
    expect(new Set([identities[0]!.id, identities[1]!.id, accountIdentity("34760399998", sha, "a").id,
      accountIdentity(run, "c".repeat(40), "a").id]).size).toBe(4);
    expect(identities[0]!.id).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-a[a-f0-9]{3}-[a-f0-9]{12}$/);
    expect(() => accountIdentity("bad", sha, "a")).toThrow();
  });
  it("requires exact fixture identity, role and server-owned cleanup marker", () => {
    expect(() => verifyAccountIdentity(user(0), identities[0]!)).not.toThrow();
    for (const change of [{ id: identities[1]!.id }, { email: "owner@example.invalid" },
      { role: "service_role" }, { app_metadata: {} }]) {
      expect(() => verifyAccountIdentity({ ...user(0), ...change }, identities[0]!)).toThrow();
    }
  });
  it("permits only two exact confirmed synthetic creations and narrow profile setup", () => {
    expect(allowed(`${origin}/auth/v1/admin/users`, "POST", createBody, identities, false)).toBe(true);
    expect(allowed(`${origin}/auth/v1/admin/users`, "POST", createBody, identities, true)).toBe(false);
    for (const change of [{ id: "c".repeat(36) }, { email: "owner@example.invalid" }, { email_confirm: false },
      { role: "service_role" }, { app_metadata: {} }]) {
      expect(allowed(`${origin}/auth/v1/admin/users`, "POST", { ...createBody, ...change }, identities, false)).toBe(false);
    }
    const path = `${origin}/rest/v1/profiles?id=eq.${identities[0]!.id}`;
    expect(allowed(path, "PATCH", { onboarded_at: "2026-09-13T00:00:00.000Z" }, identities, false)).toBe(true);
    expect(allowed(path, "PATCH", { onboarded_at: "2026-09-13T00:00:00.000Z", email: "wrong" }, identities, false)).toBe(false);
    expect(allowed(path, "PATCH", { onboarded_at: "2026-09-13T00:00:00.000Z" }, identities, true)).toBe(false);
  });
  it("cannot list users, inspect owner rows, change settings or contact production", () => {
    for (const path of ["/auth/v1/admin/users", "/auth/v1/settings", "/rest/v1/profiles?select=*",
      "/rest/v1/swim_plans?user_id=eq.ffffffff-ffff-4fff-afff-ffffffffffff&select=id",
      `/rest/v1/swim_plans?user_id=eq.${identities[0]!.id}&select=*`]) {
      expect(allowed(origin + path, "GET", undefined, identities, false)).toBe(false);
    }
    expect(allowed("https://grhetczkxawkcfgkwerj.supabase.co/auth/v1/admin/users", "POST", createBody, identities, false)).toBe(false);
    expect(allowed(origin.replace("https:", "http:") + "/auth/v1/admin/users", "POST", createBody, identities, false)).toBe(false);
    expect(allowed(`${origin}/auth/v1/admin/users/${identities[0]!.id}`, "DELETE", undefined, identities, false)).toBe(false);
    expect(allowed(`${origin}/auth/v1/admin/users/${identities[0]!.id}`, "DELETE", undefined, identities, true)).toBe(true);
  });
  it("cleans both allocated accounts and verifies cascade absence", async () => {
    const remaining = new Set(identities.map((identity) => identity.id));
    const requests: string[] = [];
    const result = await cleanupAccountFixtures(identities, async (path, method) => {
      requests.push(`${method} ${path}`);
      if (method === "HEAD") return { status: 200, value: { count: 0 } };
      const id = path.split("/").at(-1)!;
      if (method === "DELETE") { remaining.delete(id); return { status: 200, value: {} }; }
      return remaining.has(id) ? { status: 200, value: { user: user(identities.findIndex((identity) => identity.id === id)) } }
        : { status: 404, value: {} };
    });
    expect(result).toEqual({ removed: 2, absent: 2, failed: 0 });
    expect(requests.filter((request) => request.startsWith("HEAD"))).toHaveLength(12);
    expect(requests.some((request) => request === "GET /auth/v1/admin/users")).toBe(false);
  });
  it("never deletes a collision and still cleans the other owned fixture", async () => {
    const removed: string[] = [];
    const result = await cleanupAccountFixtures(identities, async (path, method) => {
      if (method === "HEAD") return { status: 200, value: { count: 0 } };
      const id = path.split("/").at(-1)!;
      if (method === "DELETE") { removed.push(id); return { status: 200, value: {} }; }
      if (removed.includes(id)) return { status: 404, value: {} };
      return { status: 200, value: id === identities[0]!.id ? { ...user(0), app_metadata: {} } : user(1) };
    });
    expect(removed).toEqual([identities[1]!.id]);
    expect(result).toEqual({ removed: 1, absent: 1, failed: 1 });
  });
  it("surfaces missing cascade cleanup without persisting error text", async () => {
    const result = await cleanupAccountFixtures(identities, async (_path, method) => {
      if (method === "HEAD") throw new Error("PrivateSyntheticCanary");
      return { status: 404, value: {} };
    });
    expect(result).toEqual({ removed: 0, absent: 0, failed: 2 });
    expect(JSON.stringify(result)).not.toContain("PrivateSyntheticCanary");
  });
  it("keeps immutable source checks during cleanup without depending on live refs", () => {
    const io = {
      event: () => ({ inputs: inputs() }), regular: () => true,
      git: (...args: string[]) => {
        if (args[0] === "rev-parse") return sha;
        if (args[0] === "status" || args[0] === "merge-base") return "";
        if (args[0] === "diff") return profile.paths[0]!;
        if (args[0] === "ls-tree") return `100644 blob ${sha}\t${profile.paths[0]}`;
        throw new Error("Live ref moved");
      },
    };
    expect(verifyRefreshCheckout(env, io, profile)).toBe(sha);
    expect(() => verifyRefreshSource(env, io, profile)).toThrow();
    expect(() => verifyRefreshCheckout(env, { ...io, regular: () => false }, profile)).toThrow();
    expect(() => verifyRefreshCheckout(env, { ...io, git: (...args) => args[0] === "status" ? " M file" : io.git(...args) }, profile)).toThrow();
  });
  it("refuses the executable before credentials outside the authorized runner", () => {
    const canary = "PrivateSyntheticCanary";
    const child = spawnSync(process.execPath, [require.resolve("tsx/cli"),
      resolve(__dirname, "../../../../apps/web/scripts/swim-account-flow.ts")], {
      cwd: resolve(__dirname, "../../../.."), encoding: "utf8", timeout: 20_000,
      env: { ...process.env, GITHUB_ACTIONS: "false", SWIM_REVIEW_SUPABASE_SERVICE_ROLE_KEY: canary },
    });
    expect(child.status).toBe(1); expect(child.stderr).toBe("");
    expect(child.stdout).toContain("SWIM_ACCOUNT_FLOW_SUMMARY");
    expect(child.stdout).not.toContain(canary);
    expect(child.stdout).toContain('"accountsAttempted":0');
  });
  it("keeps the prior untimed job intact and puts credentials after source checks", () => {
    const workflow = readFileSync(resolve(__dirname, "../../../../.github/workflows/ci.yml"), "utf8").replaceAll("\r\n", "\n");
    const old = workflow.split("\n  update-untimed-swim-review:\n")[1]!;
    expect(createHash("sha256").update(old).digest("hex")).toBe("c6ea6485b4a5038d30803067f730e4a367f0d95ce23abc69b36c0b5c31eb00cf");
    const job = workflow.split("\n  test-swim-account-flow:\n")[1]!.split("\n  update-untimed-swim-review:\n")[0]!;
    for (const gate of ["needs: [ci, identity-guard]", "environment: swim-review", "group: swim-review-bootstrap",
      "persist-credentials: false", "inputs.review_upgrade_read_only == true",
      ...profile.otherOperations.map((key) => `inputs.${key.toLowerCase()} == false`)]) expect(job).toContain(gate);
    const [before, operation] = job.split("      - name: Exercise synthetic account flow\n");
    expect(before).toContain("--check-source"); expect(before).not.toContain("secrets.");
    expect(operation!.match(/secrets\.\w+/g)).toHaveLength(10);
    expect(operation).toContain("if: always()");
    expect(operation).toContain("swim-account-flow.ts --cleanup");
    expect(job).not.toContain("upload-artifact");
  });
});
