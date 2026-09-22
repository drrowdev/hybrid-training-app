import { describe, expect, it } from "vitest";
import { tmpdir } from "node:os";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  isModularAcceptance, isModularBrowserProfile, MODULAR_BROWSER_CASES, MODULAR_MIGRATION_TOTAL,
} from "../../../../scripts/modular-browser-profile";
import { buildBrowserEnv, SWIM_BROWSER_CASES } from "../../../../scripts/swim-browser-acceptance";
import { requireManualContext } from "../../../../scripts/swim-acceptance-guards";

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
  });

  it("preserves the historical cohort and declares exactly six new cases", () => {
    expect(SWIM_BROWSER_CASES).toHaveLength(26);
    expect(MODULAR_BROWSER_CASES).toHaveLength(6);
    expect(new Set(MODULAR_BROWSER_CASES.map(({ title }) => title)).size).toBe(6);
    expect(new Set(MODULAR_BROWSER_CASES.map(({ file }) => file))).toEqual(new Set(["e2e/program-builder-mobile.spec.ts"]));
    expect(Object.isFrozen(MODULAR_BROWSER_CASES) && MODULAR_BROWSER_CASES.every(Object.isFrozen)).toBe(true);
    expect(MODULAR_MIGRATION_TOTAL).toBe(157);
  });

  it("requires the exact modular branch and a fresh first attempt", () => {
    expect(isModularAcceptance(context)).toBe(true);
    expect(requireManualContext(context, sha)).toBe("pr802-35326000000-1");
    expect(isModularAcceptance({})).toBe(false);
    expect(isModularBrowserProfile({ SXC_ACCEPTANCE_PROFILE: "swimming" })).toBe(false);
    for (const changed of [
      { ...context, SXC_ACCEPTANCE_PROFILE: "unknown" },
      { ...context, GITHUB_REF: "refs/heads/main" },
      { ...context, GITHUB_REF: "refs/heads/copilot/new-acceptance-cases" },
      { ...context, GITHUB_RUN_ATTEMPT: "2" },
      { ...context, GITHUB_ACTIONS: "false" },
      { ...context, MIGRATE_PRODUCTION: "true" },
      { ...context, ALLOW_UNDEPLOYED: "true" },
    ]) expect(() => requireManualContext(changed, sha)).toThrow();
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
    expect(buildBrowserEnv(target, paths, true)).toMatchObject({
      SXC_ACCEPTANCE_PROFILE: "modular", SWIM_PRIVATE_COURSE_ENABLED: "true", SWIM_POOL_EDITING_ENABLED: "true",
      SWIM_IMPORT_ENABLED: "true", SWIM_IMPORT_MATCHING_ENABLED: "true",
    });
    expect(() => buildBrowserEnv({ ...target, url: "https://example.invalid" }, paths, true)).toThrow();
    expect(() => buildBrowserEnv({ ...target, projectRef: "production" }, paths, true)).toThrow();
  });
});
