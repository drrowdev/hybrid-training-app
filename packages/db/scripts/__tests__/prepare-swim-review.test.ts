import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  APPLICATION_SHA, SETUP_PATHS, assertPristine, defaultRuntime, prepareReview,
  runSeed, validateContext, validateDatabaseUrl, validateSourceDiff, type Runtime,
} from "../prepare-swim-review";

vi.mock("node:child_process", async (original) => ({
  ...await original<typeof import("node:child_process")>(), spawn: vi.fn(),
}));

const root = resolve(import.meta.dirname, "../../../..");
const password = encodeURIComponent(["offline", "unit", "only", "42"].join("-"));
const url = `postgresql://postgres.whwilnhqfiaquwxgkxwt:${password}@aws-0-eu-north-1.pooler.supabase.com:5432/postgres?sslmode=require`;
const pristine = {
  publicEmpty: true, ledgerAbsent: true, schemasExpected: true,
  publicCodeEmpty: true, usersEmpty: true, storageEmpty: true, visible: true,
};
const sha = "a".repeat(40);
const context = {
  GITHUB_ACTIONS: "true", GITHUB_EVENT_NAME: "workflow_dispatch",
  GITHUB_REPOSITORY: "drrowdev/hybrid-training-app", GITHUB_REF_TYPE: "branch",
  GITHUB_REF: "refs/heads/copilot/new-acceptance-cases", GITHUB_JOB: "prepare-swim-review",
  PREPARE_SWIM_REVIEW: "true", MIGRATE_PRODUCTION: "false",
  ALLOW_UNDEPLOYED: "false", SWIM_ACCEPTANCE: "false", EXPECTED_SHA: sha, GITHUB_SHA: sha,
};
const canonical = Array.from({ length: 150 }, (_, i) => ({ hash: `${i}`, folderMillis: i + 1 }));
function fake() {
  const query = vi.fn(async (text: string): Promise<Record<string, unknown>[]> => {
    if (text.includes('AS "publicEmpty"')) return [pristine];
    if (text.includes("auth.users")) return [{ usersEmpty: true, storageEmpty: true }];
    if (text.includes("ORDER BY id")) return canonical.map((m, i) =>
      ({ id: i + 1, hash: m.hash, created_at: m.folderMillis }));
    if (text.includes("AS global")) return [{ global: 334, seeded: 330, ready: true }];
    if (text.includes("c.relname AS name")) return [{ name: "movements" }, { name: "sessions" }];
    return [{ empty: true }];
  });
  const close = vi.fn(async () => {});
  const runtime: Runtime = {
    source: vi.fn(), canonical: vi.fn(() => canonical),
    connect: vi.fn(() => ({ query, close })),
    migrate: vi.fn(async () => {}), seed: vi.fn(async () => {}), emit: vi.fn(),
  };
  return { runtime, query, close };
}

describe("isolated review guards (offline, not hosted proof)", () => {
  it("accepts only the exact test route", () => expect(validateDatabaseUrl(url)).toBe(url));
  it.each([
    undefined, "", url.replace("whwilnhqfiaquwxgkxwt", "grhetczkxawkcfgkwerj"),
    url.replace("aws-0-eu-north-1", "aws-0-eu-west-1"),
    url.replace(":5432/", ":6543/"), url.replace("/postgres?", "/other?"),
    url.replace("postgres.whwilnhqfiaquwxgkxwt", "postgres"),
    url.replace("postgresql:", "http:"), url.replace(password, ""),
    url.replace(password, "placeholder-password"), url.replace(password, "%0A" + password),
    url.replace(password, "%ZZ"), url + "#fragment", " " + url,
    url + "&host=localhost", url + "&sslmode=disable", url + "&options=-c",
    url.replace("require", "disable"), url.replace("?sslmode=require", ""),
    url.replace(":5432", ""), url.replace(password, "%6F" + password.slice(1)),
    url.replace("aws-0", "AWS-0"), url.replace("/postgres", "/x/../postgres"),
    url.replace(password, "your-secret-goes-here"),
  ])("refuses unsafe credentials without connecting: %s", (value) => {
    expect(() => validateDatabaseUrl(value)).toThrow();
  });
  it.each(Object.keys(context))("fails closed on missing or changed %s", (key) => {
    expect(() => validateContext(context)).not.toThrow();
    expect(() => validateContext({ ...context, [key]: "" })).toThrow();
    expect(() => validateContext({ ...context, [key]: "wrong" })).toThrow();
  });
  it.each([
    { GITHUB_REF: "refs/heads/main" }, { GITHUB_REF_TYPE: "tag" },
    { GITHUB_REPOSITORY: "fork/hybrid-training-app" }, { GITHUB_EVENT_NAME: "push" },
    { EXPECTED_SHA: APPLICATION_SHA, GITHUB_SHA: APPLICATION_SHA },
  ])("rejects non-review source contexts", (override) => {
    expect(() => validateContext({ ...context, ...override })).toThrow();
  });
  it("confines the accepted application diff to four setup paths", () => {
    expect(() => validateSourceDiff([...SETUP_PATHS])).not.toThrow();
    for (const paths of [[], ["packages/db/package.json"], ["packages/db/drizzle/0149.sql"],
      ["apps/web/src/app/page.tsx"], ["HANDOFF.md", "pnpm-lock.yaml"]]) {
      expect(() => validateSourceDiff(paths)).toThrow();
    }
  });
  it.each(Object.keys(pristine))("requires exact readable true for %s", (key) => {
    for (const value of [false, null, undefined, 1, "true"]) {
      expect(() => assertPristine({ ...pristine, [key]: value })).toThrow();
    }
  });
  it("reads the unchanged 150 canonical files and validates the 330-entry seed offline", () => {
    expect(defaultRuntime().canonical()).toHaveLength(150);
  });
});

describe("bounded phase evidence and connection cleanup", () => {
  it("executes ordered phases and closes on success", async () => {
    const { runtime, close } = fake();
    expect(await prepareReview(url, runtime)).toBe(true);
    expect(close).toHaveBeenCalledOnce();
    expect(vi.mocked(runtime.emit).mock.calls.map(([r]) => [r.phase, r.status])).toEqual(
      ["source", "credentials", "canonical", "client", "preflight", "migrate", "seed", "verify", "close"]
        .map((phase) => [phase, "passed"]));
  });
  it.each(["source", "canonical", "connect", "migrate", "seed"] as const)(
    "redacts raw %s failures and never proceeds to later writes", async (phase) => {
      const { runtime, close } = fake();
      vi.mocked(runtime[phase]).mockImplementation(() => { throw new Error(`private SQL ${url}`); });
      expect(await prepareReview(url, runtime)).toBe(false);
      expect(JSON.stringify(vi.mocked(runtime.emit).mock.calls)).not.toContain("private SQL");
      expect(JSON.stringify(vi.mocked(runtime.emit).mock.calls)).not.toContain(password);
      expect(close).toHaveBeenCalledTimes(phase === "migrate" || phase === "seed" ? 1 : 0);
      if (phase !== "seed") expect(runtime.seed).not.toHaveBeenCalled();
    });
  it("does not connect with invalid credentials", async () => {
    const { runtime } = fake();
    expect(await prepareReview(undefined, runtime)).toBe(false);
    expect(runtime.connect).not.toHaveBeenCalled();
  });
  it.each(Object.keys(pristine))("blocks writes on existing/ambiguous %s", async (key) => {
    const { runtime, query, close } = fake();
    query.mockResolvedValue([{ ...pristine, [key]: false }]);
    expect(await prepareReview(url, runtime)).toBe(false);
    expect(runtime.migrate).not.toHaveBeenCalled();
    expect(runtime.seed).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce();
  });
  it("fails closed on unreadable preflight and closes without raw errors", async () => {
    const { runtime, query, close } = fake();
    query.mockRejectedValue(new Error(`private rows ${url}`));
    expect(await prepareReview(url, runtime)).toBe(false);
    expect(runtime.migrate).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce();
    expect(JSON.stringify(vi.mocked(runtime.emit).mock.calls)).not.toContain("private");
  });
  it.each(["hash", "order", "count", "ready", "catalog", "users", "storage", "application"])(
    "fails postflight on mismatched %s and preserves partial setup for inspection", async (kind) => {
      const { runtime, query, close } = fake();
      const original = query.getMockImplementation()!;
      query.mockImplementation(async (text) => {
        const rows = await original(text);
        if (text.includes("ORDER BY id")) {
          if (kind === "hash") rows[0]!.hash = "wrong";
          if (kind === "order") rows.reverse();
          if (kind === "count") rows.pop();
        }
        if (text.includes("AS global")) {
          if (kind === "ready") rows[0]!.ready = "true";
          if (kind === "catalog") rows[0]!.global = 330;
        }
        if (vi.mocked(runtime.seed).mock.calls.length && text.includes("auth.users")) {
          if (kind === "users") rows[0]!.usersEmpty = false;
          if (kind === "storage") rows[0]!.storageEmpty = false;
        }
        if (kind === "application" && text.includes("AS empty")) rows[0]!.empty = false;
        return rows;
      });
      expect(await prepareReview(url, runtime)).toBe(false);
      expect(runtime.seed).toHaveBeenCalledOnce();
      expect(close).toHaveBeenCalledOnce();
      expect(query.mock.calls.every(([sql]) => !/DELETE|TRUNCATE|DROP|UPDATE/.test(sql))).toBe(true);
    });
  it("reports shutdown failure as failure, not success", async () => {
    const { runtime, close } = fake();
    close.mockRejectedValue(new Error(url));
    expect(await prepareReview(url, runtime)).toBe(false);
    expect(vi.mocked(runtime.emit).mock.calls.at(-1)![0]).toMatchObject({ phase: "close", status: "failed" });
  });
  it("aborts a stalled phase, closes the connection and never starts a later write", async () => {
    vi.useFakeTimers();
    try {
      const { runtime, close } = fake();
      vi.mocked(runtime.migrate).mockImplementation(() => new Promise(() => {}));
      const result = prepareReview(url, runtime);
      await vi.advanceTimersByTimeAsync(300_000);
      expect(await result).toBe(false);
      expect(close).toHaveBeenCalledOnce();
      expect(runtime.seed).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });
});

describe("canonical seed subprocess boundary (fake process only)", () => {
  function child() {
    const process = Object.assign(new EventEmitter(), {
      kill: vi.fn(() => true),
    });
    vi.mocked(spawn).mockReturnValue(process as unknown as ReturnType<typeof spawn>);
    return process;
  }
  it("discards all raw streams and supplies only bounded isolated connection settings", async () => {
    const process = child();
    const result = runSeed(url, new AbortController().signal);
    const [, args, options] = vi.mocked(spawn).mock.calls.at(-1)!;
    expect(args).toEqual(["--import", "tsx", "seeds/run.ts"]);
    expect(options!.stdio).toBe("ignore");
    expect(Object.keys(options!.env!).sort()).toEqual(["DATABASE_URL", "PATH", "PGSSLMODE"]);
    const target = new URL(options!.env!.DATABASE_URL!);
    expect(target.searchParams.get("statement_timeout")).toBe("60000");
    expect(target.searchParams.get("connect_timeout")).toBe("10");
    expect(target.searchParams.get("client_min_messages")).toBe("error");
    process.emit("close", 0);
    await expect(result).resolves.toBeUndefined();
  });
  it.each([1, 99, null])("never treats exit %s as success", async (code) => {
    const process = child();
    const result = runSeed(url, new AbortController().signal);
    process.emit("close", code);
    await expect(result).rejects.toThrow("Seed process failed");
  });
  it("suppresses raw process errors", async () => {
    const process = child();
    const result = runSeed(url, new AbortController().signal);
    process.emit("error", new Error(`private ${url}`));
    await expect(result).rejects.toThrow(/^Seed process failed$/);
  });
  it("kills a timed-out process and fails even if it subsequently reports zero", async () => {
    vi.useFakeTimers();
    try {
      const process = child();
      const result = runSeed(url, new AbortController().signal);
      await vi.advanceTimersByTimeAsync(90_000);
      expect(process.kill).toHaveBeenCalledWith("SIGKILL");
      process.emit("close", 0);
      await expect(result).rejects.toThrow("Seed deadline exceeded");
    } finally { vi.useRealTimers(); }
  });
  it("kills the child on bootstrap cancellation", async () => {
    const process = child();
    const controller = new AbortController();
    const result = runSeed(url, controller.signal);
    controller.abort();
    expect(process.kill).toHaveBeenCalledWith("SIGKILL");
    process.emit("close", null);
    await expect(result).rejects.toThrow("Seed deadline exceeded");
  });
});

describe("saved workflow and raw-stream boundaries", () => {
  const workflow = readFileSync(resolve(root, ".github/workflows/ci.yml"), "utf8");
  const job = workflow.split("\n  prepare-swim-review:\n")[1]!.split("\n  prod-migrate:")[0]!;
  const source = readFileSync(resolve(root, "packages/db/scripts/prepare-swim-review.ts"), "utf8");
  it("preserves every existing job byte-for-byte", () => {
    // Accepted APPLICATION_SHA jobs digest; also works in CI's shallow checkout.
    const existing = workflow.slice(workflow.indexOf("\njobs:")).replace(
      "\n  prepare-swim-review:\n" + job, "");
    expect(createHash("sha256").update(existing).digest("hex")).toBe(
      "f12b596a4038dae77b798b60c8b2f2ebd2486110bde61bf6b952d49e7aca6bc9");
  });
  it("requires explicit manual exact-head context and independent noncancelling serialization", () => {
    for (const gate of ["needs: [ci, identity-guard]", "github.event_name == 'workflow_dispatch'",
      "github.repository == 'drrowdev/hybrid-training-app'", "github.ref_type == 'branch'",
      "github.ref == 'refs/heads/copilot/new-acceptance-cases'",
      "inputs.expected_sha != '' && inputs.expected_sha == github.sha",
      "!inputs.migrate_production && !inputs.allow_undeployed", "!inputs.swim_acceptance",
      "ref: ${{ inputs.expected_sha }}", "environment: swim-review",
      "cancel-in-progress: false", "timeout-minutes: 7"]) expect(job).toContain(gate);
    expect(workflow).toMatch(/prepare_swim_review:\n[\s\S]*?default: false\n\s+type: boolean/);
    expect(workflow).toContain("inputs.prepare_swim_review && 'ci-swim-review-bootstrap'");
    expect(source).toContain('git("ls-remote", "--exit-code"');
    expect(source).toContain('git("rev-parse", "HEAD") === env.EXPECTED_SHA');
  });
  it("exposes only the environment DB secret, only after installation and offline checks", () => {
    expect(job.match(/secrets\.[A-Z_]+/g)).toEqual(["secrets.SWIM_REVIEW_DATABASE_URL"]);
    expect(job.indexOf("secrets.SWIM_REVIEW_DATABASE_URL")).toBeGreaterThan(job.indexOf("--check-source"));
    expect(job).not.toMatch(/SUPABASE_PROD|E2E_|continue-on-error|retry/);
    expect(source).toContain('cwd: packageRoot, stdio: "ignore"');
    expect(source).toContain('child.kill("SIGKILL")');
    expect(source).toContain("onnotice: () => {}");
    expect(source).not.toContain("console.error");
    expect(source).not.toContain("openMigrationEvidence(");
  });
});
