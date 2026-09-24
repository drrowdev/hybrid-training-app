import { describe, expect, it } from "vitest";
import { tmpdir } from "node:os";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  isModularBrowserProfile, MODULAR_BROWSER_CASES,
} from "../../../../scripts/modular-browser-profile";
import { buildBrowserEnv, buildBrowserServerEnv, requireBrowserEnvironment, SWIM_BROWSER_CASES } from "../../../../scripts/swim-browser-acceptance";
import { requireManualContext } from "../../../../scripts/swim-acceptance-guards";
import { ACCEPTANCE_MIGRATIONS, hasModularSchema, hasOwnershipSchema, requireAcceptanceMigrationFiles } from "../../../../scripts/acceptance-migrations";

const sha = "c".repeat(40);
const context = {
  SXC_ACCEPTANCE_PROFILE: "modular", GITHUB_ACTIONS: "true", GITHUB_EVENT_NAME: "workflow_dispatch",
  GITHUB_JOB: "swim-acceptance", SWIM_ACCEPTANCE: "true", GITHUB_REPOSITORY: "drrowdev/hybrid-training-app",
  RUNNER_ENVIRONMENT: "github-hosted", RUNNER_OS: "Linux", RUNNER_ARCH: "X64",
  EXPECTED_SHA: sha, GITHUB_SHA: sha, GITHUB_REF_TYPE: "branch",
  GITHUB_REF: "refs/heads/drrowdev-modular-programs-implementation",
  GITHUB_WORKFLOW_REF: "drrowdev/hybrid-training-app/.github/workflows/ci.yml@refs/heads/drrowdev-modular-programs-implementation",
  MIGRATE_PRODUCTION: "false", ALLOW_UNDEPLOYED: "false", GITHUB_RUN_ID: "35326000000", GITHUB_RUN_ATTEMPT: "1",
};

describe("DC-SW8 modular browser profile retains the isolated runtime boundaries", () => {
  it("needs no hosted credentials or protected review environment", () => {
    const workflow = readFileSync(resolve(__dirname, "../../../../../../.github/workflows/ci.yml"), "utf8")
      .replaceAll("\r\n", "\n");
    const job = workflow.split("\n  swim-acceptance:\n")[1]!.split("\n  prod-migrate:\n")[0]!;
    expect(job).toContain("SXC_ACCEPTANCE_PROFILE:");
    expect(job).not.toContain("environment:");
    expect(job).not.toContain("secrets.");
    const inputs = workflow.split("    inputs:\n")[1]!.split("\nconcurrency:")[0]!;
    expect(inputs).toContain("      acceptance_profile:");
    expect(inputs).toContain("          - auto\n          - modular\n          - swimming");
    expect(job).toContain('SXC_ACCEPTANCE_PROFILE: ${{ matrix.profile }}');
    expect(job).toContain('EXPECTED_SHA: ${{ github.sha }}');
    expect(job).toContain('MIGRATE_PRODUCTION: "false"');
    expect(job).toContain('ALLOW_UNDEPLOYED: "false"');
    expect(job).toContain("github.event.pull_request.head.repo.full_name == github.repository");
    expect(job).toContain("!github.event.pull_request.draft");
    expect(job).toContain('["modular","swimming"]');
    expect(workflow).toContain("types: [opened, synchronize, reopened, ready_for_review]");
  });

  it("declares unique cases for both browser profiles", () => {
    for (const cases of [SWIM_BROWSER_CASES, MODULAR_BROWSER_CASES]) {
      expect(cases.length).toBeGreaterThan(0);
      expect(new Set(cases.map(({ file, describe, title }) => `${file}:${describe}:${title}`)).size).toBe(cases.length);
    }
    const source = readFileSync(resolve(__dirname, "../../../../e2e/program-builder-mobile.spec.ts"), "utf8");
    const declared = [...source.matchAll(/\b(?:test|legacyTest|ownedTest)\("([^"]+)"/g)].map((match) => match[1]);
    expect(declared.sort()).toEqual(MODULAR_BROWSER_CASES.map(({ title }) => title).sort());
    expect(new Set(MODULAR_BROWSER_CASES.map(({ file }) => file))).toEqual(new Set(["e2e/program-builder-mobile.spec.ts"]));
    expect(Object.isFrozen(MODULAR_BROWSER_CASES) && MODULAR_BROWSER_CASES.every(Object.isFrozen)).toBe(true);
  });

  it("accepts non-main branches and retries while preserving runner and SHA guards", () => {
    expect(requireManualContext(context, sha)).toBe("pr802-35326000000-1");
    const redesign = { ...context, GITHUB_REF: "refs/heads/drrowdev-programs-page-redesign",
      GITHUB_WORKFLOW_REF: "drrowdev/hybrid-training-app/.github/workflows/ci.yml@refs/heads/drrowdev-programs-page-redesign" };
    expect(requireManualContext(redesign, sha)).toBe("pr802-35326000000-1");
    expect(requireManualContext({ ...redesign, GITHUB_RUN_ATTEMPT: "2" }, sha)).toBe("pr802-35326000000-2");
    expect(() => requireManualContext({ ...redesign, EXPECTED_SHA: "d".repeat(40) }, sha)).toThrow();
    expect(isModularBrowserProfile({})).toBe(false);
    expect(isModularBrowserProfile({ SXC_ACCEPTANCE_PROFILE: "swimming" })).toBe(false);
    for (const changed of [
      { ...context, SXC_ACCEPTANCE_PROFILE: "unknown" },
      { ...context, GITHUB_REF: "refs/heads/main" },
      { ...context, GITHUB_ACTIONS: "false" },
      { ...context, MIGRATE_PRODUCTION: "true" },
      { ...context, ALLOW_UNDEPLOYED: "true" },
    ]) expect(() => requireManualContext(changed, sha)).toThrow();
  });

  it.each([
    "refs/heads/drrowdev-modular-programs-implementation",
    "refs/heads/drrowdev-programs-page-redesign",
    "refs/heads/drrowdev-swimming-test-suite-repair",
    "refs/heads/copilot/new-acceptance-cases",
    "refs/heads/drrowdev-programs-page-redesign-extra",
    "refs/heads/drrowdev-swimming-test-suite-repair-extra",
  ])("qualifies the exact schema independently of browser cases on %s", (ref) => {
    for (const profile of [undefined, "swimming", "modular"]) {
      const env = { ...context, GITHUB_REF: ref, SXC_ACCEPTANCE_PROFILE: profile,
        GITHUB_WORKFLOW_REF: `drrowdev/hybrid-training-app/.github/workflows/ci.yml@${ref}` };
      expect(isModularBrowserProfile(env)).toBe(profile === "modular");
      expect(hasModularSchema).toBe(ACCEPTANCE_MIGRATIONS.includes("0156_modular_training_schedule"));
      expect(hasOwnershipSchema).toBe(ACCEPTANCE_MIGRATIONS.includes("0158_independent_program_ownership"));
      expect(requireManualContext(env, sha)).toBe("pr802-35326000000-1");
      expect(() => requireManualContext({ ...env, EXPECTED_SHA: "d".repeat(40) }, sha)).toThrow();
      expect(requireManualContext({ ...env, GITHUB_RUN_ATTEMPT: "2" }, sha)).toBe("pr802-35326000000-2");
    }
  });

  it("derives migration counts from the journal and rejects missing, extra and duplicate SQL", () => {
    const files = ACCEPTANCE_MIGRATIONS.map((tag) => `packages/db/drizzle/${tag}.sql`);
    expect(requireAcceptanceMigrationFiles(files)).toBe(ACCEPTANCE_MIGRATIONS.length);
    expect(requireAcceptanceMigrationFiles([...files, "apps/web/package.json"])).toBe(files.length);
    for (const changed of [files.slice(1), [...files, "packages/db/drizzle/unregistered.sql"], [...files, files[0]!]]) {
      expect(() => requireAcceptanceMigrationFiles(changed)).toThrow();
    }
  });

  it.each(["opened", "synchronize", "reopened", "ready_for_review"])("accepts the same-repository non-draft PR event %s", (action) => {
    const env = { ...context, GITHUB_EVENT_NAME: "pull_request", GITHUB_REF: "refs/pull/824/merge",
      GITHUB_WORKFLOW_REF: "drrowdev/hybrid-training-app/.github/workflows/ci.yml@refs/pull/824/merge",
      PR_HEAD_REPOSITORY: context.GITHUB_REPOSITORY, PR_BASE_REF: "main", PR_DRAFT: "false", PR_ACTION: action };
    expect(requireManualContext(env, sha)).toBe("pr802-35326000000-1");
    for (const change of [
      { PR_HEAD_REPOSITORY: "fork/repo" }, { PR_BASE_REF: "feature" }, { PR_DRAFT: "true" },
      { PR_ACTION: "closed" }, { GITHUB_REF: "refs/heads/main" }, { EXPECTED_SHA: "d".repeat(40) },
    ]) expect(() => requireManualContext({ ...env, ...change }, sha)).toThrow();
  });

  it("enables supported course controls only for the selected disposable browser app", () => {
    const paths = {
      runDirectory: join(tmpdir(), "swim-acceptance-pr802-1-1"),
      reportPath: join(tmpdir(), "swim-acceptance-pr802-1-1/browser.json"),
      outputDir: join(tmpdir(), "swim-acceptance-pr802-1-1/browser-output"),
    };
    const target = { url: "http://127.0.0.1:54321", projectRef: "local",
      anonKey: `sb_publishable_${"a".repeat(24)}`, serviceRoleKey: `sb_secret_${"b".repeat(24)}` };
    expect(buildBrowserEnv(target, paths).SXC_ACCEPTANCE_PROFILE).toBeUndefined();
    expect(buildBrowserEnv(target, paths).SWIM_PRIVATE_COURSE_ENABLED).toBeUndefined();
    expect(buildBrowserEnv(target, paths).SWIM_IMPORT_OUTCOMES_ENABLED).toBeUndefined();
    expect(buildBrowserEnv(target, paths).SUPABASE_SERVICE_ROLE_KEY).toBeUndefined();
    expect(buildBrowserEnv(target, paths, true)).toMatchObject({
      SXC_ACCEPTANCE_PROFILE: "modular", SWIM_PRIVATE_COURSE_ENABLED: "true", SWIM_POOL_EDITING_ENABLED: "true",
      SWIM_IMPORT_ENABLED: "true", SWIM_IMPORT_MATCHING_ENABLED: "true",
      SWIM_IMPORT_OUTCOMES_ENABLED: "true",
    });
    expect(() => buildBrowserEnv({ ...target, url: "https://example.invalid" }, paths, true)).toThrow();
    expect(() => buildBrowserEnv({ ...target, projectRef: "production" }, paths, true)).toThrow();
    const env = buildBrowserEnv(target, paths, true);
    expect(env.SUPABASE_SERVICE_ROLE_KEY).toBeUndefined();
    const server = buildBrowserServerEnv(env);
    expect(server.SUPABASE_SERVICE_ROLE_KEY).toBe(env.E2E_SUPABASE_SERVICE_ROLE_KEY);
    expect(server.SUPABASE_SERVICE_ROLE_KEY).toBe(target.serviceRoleKey);
    expect(buildBrowserServerEnv(buildBrowserEnv(target, paths)).SUPABASE_SERVICE_ROLE_KEY).toBe(target.serviceRoleKey);
    expect(env.SUPABASE_SERVICE_ROLE_KEY).toBeUndefined();
    expect(Object.keys(env).filter((key) => key.startsWith("NEXT_PUBLIC_")).sort())
      .toEqual(["NEXT_PUBLIC_SUPABASE_ANON_KEY", "NEXT_PUBLIC_SUPABASE_URL"]);
    for (const change of [
      { SUPABASE_SERVICE_ROLE_KEY: "ambient-value" },
      { SWIM_IMPORT_OUTCOMES_ENABLED: "false" },
      { NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY: target.serviceRoleKey },
      { SXC_ACCEPTANCE_PROFILE: undefined },
    ]) expect(() => requireBrowserEnvironment({ ...env, ...change })).toThrow();
    expect(() => buildBrowserServerEnv({ ...env, E2E_SUPABASE_URL: "https://example.invalid" })).toThrow();
    expect(() => buildBrowserServerEnv({ ...env, SUPABASE_SERVICE_ROLE_KEY: "ambient-value" })).toThrow();
  });
});
