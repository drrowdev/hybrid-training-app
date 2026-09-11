import { describe, expect, it } from "vitest";
import { APPLICATION_SHA } from "../prepare-swim-review";
import {
  buildConfigurationPlan, INHERITED_KEYS, OVERRIDE_KEYS, PlanFailure, projectPlanMetadata,
  REVIEW, type ConfigurationInput, type EnvironmentMetadata,
} from "../swim-review-config-plan";

const sha = "a".repeat(40);
const canary = "offline_canary_not_a_real_credential_42";
const credentials = {
  publishableKey: `sb_publishable_${canary}`,
  secretKey: `sb_secret_${canary}`,
  databaseUrl: `postgresql://postgres.whwilnhqfiaquwxgkxwt:${canary}@aws-0-eu-north-1.pooler.supabase.com:5432/postgres?sslmode=require`,
  testCronSecret: `independent_${canary}`,
};
function entry(key: string, extra: Partial<EnvironmentMetadata> = {}): EnvironmentMetadata {
  return { key, id: `env_${key}`, type: "encrypted", target: ["preview"],
    gitBranch: null, createdAt: 1, updatedAt: 2, ...extra };
}
function list(entries: EnvironmentMetadata[]) {
  return { entries, complete: true, pagination: null };
}
function input(): ConfigurationInput {
  return {
    context: {
      actions: true, eventName: "workflow_dispatch", repository: REVIEW.repository,
      refType: "branch", ref: `refs/heads/${REVIEW.branch}`, configure: true,
      inspect: false, prepare: false, swimAcceptance: false, migrateProduction: false,
      allowUndeployed: false, expectedSha: sha, githubSha: sha,
    },
    project: {
      id: REVIEW.projectId, accountId: REVIEW.teamId, name: REVIEW.projectName,
      rootDirectory: "apps/web", framework: "nextjs",
      link: { type: "github", org: "drrowdev", repo: "hybrid-training-app", productionBranch: "main" },
    },
    supabase: { id: REVIEW.supabaseId, name: REVIEW.supabaseName,
      organization_id: REVIEW.organizationId, region: REVIEW.region },
    projectEnvironment: list(INHERITED_KEYS.map((key) => entry(key))),
    sharedEnvironment: list([]),
    priorAuth: { site_url: "http://localhost:3000", uri_allow_list: "", disable_signup: false },
    credentials: { ...credentials },
  };
}
function accepted(value = input()) {
  const result = buildConfigurationPlan(value);
  if (!result.ok) throw new Error(result.code);
  return result.plan;
}
function refused(value: ConfigurationInput, code: PlanFailure) {
  const result = buildConfigurationPlan(value);
  expect(result).toEqual({ ok: false, code });
  expect(JSON.stringify(result)).not.toContain(canary);
}

describe("pure swim review configuration plan", () => {
  it("creates exactly 18 encrypted, preview-only, new branch overrides", () => {
    const plan = accepted();
    expect(plan.environment.operation).toBe("create");
    expect(plan.environment.upsert).toBe(false);
    expect(plan.environment.overrides.map((e) => e.key).sort()).toEqual([...OVERRIDE_KEYS].sort());
    expect(new Set(OVERRIDE_KEYS).size).toBe(18);
    for (const override of plan.environment.overrides) {
      expect(override).toMatchObject({ type: "encrypted", target: ["preview"], gitBranch: REVIEW.branch });
      expect(Object.keys(override).sort()).toEqual(["gitBranch", "key", "target", "type", "value"]);
    }
    const values = Object.fromEntries(plan.environment.overrides.map((e) => [e.key, e.value]));
    expect(values).toMatchObject({
      NEXT_PUBLIC_SUPABASE_URL: REVIEW.supabaseUrl,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: credentials.publishableKey,
      SUPABASE_SERVICE_ROLE_KEY: credentials.secretKey, DATABASE_URL: credentials.databaseUrl,
      CRON_SECRET: credentials.testCronSecret, NEXT_PUBLIC_SITE_URL: REVIEW.origin,
      POOL_SWIMMING_ENABLED: "true", ENABLE_E2E_FIXTURES: "false", NEXT_PUBLIC_BUILD_SHA: sha,
    });
    expect(plan.environment.overrides.filter((e) => e.value === "").map((e) => e.key).sort())
      .toEqual(["ADMIN_EMAILS", "AI_KEY_ENCRYPTION_KEY", "MCP_TOKEN_SIGNING_KEY",
        "STRAVA_CLIENT_ID", "STRAVA_CLIENT_SECRET", "STRAVA_REDIRECT_URI",
        "STRAVA_WEBHOOK_CALLBACK_URL", "STRAVA_WEBHOOK_SUBSCRIPTION_ID", "STRAVA_WEBHOOK_VERIFY_TOKEN"]);
    expect(plan.environment.overrides.filter((e) => e.key.startsWith("NEXT_PUBLIC_"))
      .some((e) => e.value === credentials.secretKey)).toBe(false);
    expect(plan.proposedAlias.availability).toBe("unverified");
    expect(plan.auth.patch).toEqual({ site_url: REVIEW.origin,
      uri_allow_list: `${REVIEW.origin}/auth/callback`, disable_signup: true });
    expect(plan.auth.previous).toEqual(input().priorAuth);
  });

  it.each(Object.keys(input().context))("rejects invalid manual context field %s", (key) => {
    const value = input();
    Object.assign(value.context, { [key]: canary });
    refused(value, PlanFailure.Context);
  });
  it.each([APPLICATION_SHA, "f".repeat(39), "g".repeat(40)])("rejects forbidden SHA %s", (expectedSha) => {
    const value = input();
    Object.assign(value.context, { expectedSha, githubSha: expectedSha });
    refused(value, PlanFailure.Context);
  });
  it("rejects mismatched otherwise valid SHAs", () => {
    const value = input();
    value.context.githubSha = "b".repeat(40);
    refused(value, PlanFailure.Context);
  });
  it.each(["actions", "configure", "inspect", "prepare", "swimAcceptance",
    "migrateProduction", "allowUndeployed"] as const)("rejects reversed context flag %s", (key) => {
    const value = input();
    Object.assign(value.context, { [key]: !value.context[key] });
    refused(value, PlanFailure.Context);
  });

  it.each(["id", "accountId", "name", "rootDirectory", "framework", "link"])(
    "binds project %s", (key) => {
      const value = input();
      Object.assign(value.project as object, { [key]: canary });
      refused(value, PlanFailure.Project);
    });
  it.each(["type", "org", "repo", "productionBranch"])("binds GitHub link %s", (key) => {
    const value = input();
    Object.assign((value.project as { link: object }).link, { [key]: canary });
    refused(value, PlanFailure.Project);
  });
  it.each(["id", "name", "organization_id", "region"])("binds Supabase %s", (key) => {
    const value = input();
    Object.assign(value.supabase as object, { [key]: canary });
    refused(value, PlanFailure.Supabase);
  });

  it("preserves protected metadata and permits shared known-key shadowing without mutation", () => {
    const value = input();
    const protectedEntries = [
      entry("UNRELATED_PRODUCTION", { target: ["production"] }),
      entry("OTHER_BRANCH", { gitBranch: "other/feature" }),
      entry("DATABASE_URL", { id: "production_db", target: ["production"] }),
    ];
    value.projectEnvironment = list([...INHERITED_KEYS.map((key) => entry(key)), ...protectedEntries]);
    value.sharedEnvironment = list([entry("DATABASE_URL", { id: "shared_db", target: ["preview", "production"] })]);
    const before = structuredClone(value);
    const plan = accepted(value);
    expect(value).toEqual(before);
    expect(plan.environment.preserved.project.slice(-3)).toEqual(protectedEntries);
    expect(plan.environment.preserved.shared).toEqual((value.sharedEnvironment as ReturnType<typeof list>).entries);
    plan.environment.preserved.project[0]!.target.push("production");
    expect(value).toEqual(before);
  });
  it("accepts a complete inherited baseline supplied only by shared entries", () => {
    const value = input();
    value.sharedEnvironment = value.projectEnvironment;
    value.projectEnvironment = list([]);
    expect(accepted(value).environment.overrides).toHaveLength(18);
  });

  for (const source of ["projectEnvironment", "sharedEnvironment"] as const) {
    it.each([undefined, null, [], {}, { entries: [] }, { ...list([]), complete: false },
      { ...list([]), pagination: { next: "cursor" } }, { entries: [], complete: true },
      { ...list([]), values: canary }])(`refuses malformed/incomplete ${source} %j`, (metadata) => {
      const value = input();
      value[source] = metadata;
      refused(value, PlanFailure.Metadata);
    });
    it.each([
      [entry("NEW_LIVE_INTEGRATION"), PlanFailure.UnknownPreviewKey],
      [entry("DATABASE_URL", { gitBranch: REVIEW.branch }), PlanFailure.ExistingOverride],
      [{ ...entry("DATABASE_URL"), value: canary }, PlanFailure.Metadata],
      [{ ...entry("DATABASE_URL"), updatedAt: undefined }, PlanFailure.Metadata],
      [{ ...entry("DATABASE_URL"), key: null }, PlanFailure.Metadata],
      [{ ...entry("DATABASE_URL"), type: "unknown" }, PlanFailure.Metadata],
      [{ ...entry("DATABASE_URL"), id: "" }, PlanFailure.Metadata],
      [{ ...entry("DATABASE_URL"), target: ["custom"] }, PlanFailure.Metadata],
      [{ ...entry("DATABASE_URL"), gitBranch: undefined }, PlanFailure.Metadata],
      [entry("DATABASE_URL", { updatedAt: 0 }), PlanFailure.Metadata],
      [entry("DATABASE_URL", { target: ["preview", "preview"] }), PlanFailure.Metadata],
      [entry("DATABASE_URL", { gitBranch: "other", target: ["production"] }), PlanFailure.Metadata],
    ] as const)(`guards ${source} entry %#`, (metadata, code) => {
      const value = input();
      value[source] = { ...list([]), entries: [metadata] };
      refused(value, code);
    });
    it.each([
      [entry("DATABASE_URL"), entry("DATABASE_URL")],
      [entry("DATABASE_URL"), entry("DATABASE_URL", { id: "different", target: ["preview", "production"] })],
      [entry("DATABASE_URL"), entry("CRON_SECRET", { id: "env_DATABASE_URL" })],
    ])(`rejects duplicate ${source} identity or overlapping scope %#`, (...entries) => {
      const value = input();
      value[source] = list(entries);
      refused(value, PlanFailure.Duplicate);
    });
  }
  it("rejects missing inherited keys, including an explicitly empty baseline", () => {
    for (let length = 0; length < INHERITED_KEYS.length; length++) {
      const value = input();
      value.projectEnvironment = list(INHERITED_KEYS.slice(0, length).map((key) => entry(key)));
      refused(value, PlanFailure.Incomplete);
    }
  });

  it.each([
    { publishableKey: credentials.secretKey }, { secretKey: credentials.publishableKey },
    { publishableKey: "eyJ_legacy" }, { secretKey: "sb_secret_short" },
    { testCronSecret: "" }, { testCronSecret: credentials.secretKey },
    { testCronSecret: credentials.publishableKey }, { testCronSecret: canary },
  ])("guards credential roles and independence %#", (change) => {
    const value = input();
    Object.assign(value.credentials, change);
    refused(value, PlanFailure.Credentials);
  });
  it.each([
    credentials.databaseUrl.replace("whwilnhqfiaquwxgkxwt", "differentproject"),
    credentials.databaseUrl.replace("eu-north-1", "eu-west-1"),
    credentials.databaseUrl.replace(":5432", ":6543"),
    credentials.databaseUrl.replace("?sslmode=require", ""),
    credentials.databaseUrl.replace("/postgres?", "/production?"),
    credentials.databaseUrl.replace("postgresql:", "postgres:"),
    `${credentials.databaseUrl}&extra=1`, `invalid://${canary}`,
  ])("refuses unapproved DSN %# without echoing it", (databaseUrl) => {
    const value = input();
    value.credentials.databaseUrl = databaseUrl;
    refused(value, PlanFailure.Database);
  });
  it.each([
    { site_url: `https://${canary}.invalid` },
    { uri_allow_list: "https://production.invalid/auth/callback" },
    { uri_allow_list: `${REVIEW.origin}/**` },
    { uri_allow_list: `${REVIEW.origin}/auth/callback,https://unrelated.invalid` },
    { uri_allow_list: `,${REVIEW.origin}` },
    { uri_allow_list: `${REVIEW.origin},${REVIEW.origin}` },
    { site_url: `${REVIEW.origin}.unrelated.invalid` },
    { disable_signup: "false" }, { smtp_pass: canary },
  ])("rejects unrelated or malformed prior Auth fields %#", (change) => {
    const value = input();
    value.priorAuth = { ...value.priorAuth as object, ...change };
    refused(value, PlanFailure.Auth);
  });
  it.each(["", "http://localhost:3000", "http://127.0.0.1:3000", REVIEW.origin])(
    "retains reversible bounded prior Auth %s", (site_url) => {
      const value = input();
      value.priorAuth = { site_url, uri_allow_list: site_url ? `${site_url}/auth/callback` : "",
        disable_signup: true };
      expect(accepted(value).auth.previous).toEqual(value.priorAuth);
    });
  it("projects only keys, targets and branch, never supplied values or hashes", () => {
    const metadata = projectPlanMetadata(accepted());
    expect(metadata).toHaveLength(18);
    for (const row of metadata) {
      expect(Object.keys(row).sort()).toEqual(["gitBranch", "key", "target"]);
    }
    const output = JSON.stringify(metadata);
    for (const secret of [...Object.values(credentials), canary, sha]) expect(output).not.toContain(secret);
  });
  it("returns a stable safe failure for a malformed top-level input", () => {
    refused(null as unknown as ConfigurationInput, PlanFailure.Input);
  });
});
