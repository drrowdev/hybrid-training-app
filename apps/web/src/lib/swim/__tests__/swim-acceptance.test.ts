import { describe, expect, it } from "vitest";
import {
  CLI_ASSET, CLI_SHA256, DEFAULT_SERVICES, LIMITS, PROJECT_LABEL, RUN_LABEL,
  outcome, processIdentity, requireAcceptance, requireArchive, requireCleanupState,
  requireContainer, requireFreshReport, requireLocalStatus, requireManualContext,
  requireNetwork, requireNoInheritedTargets, requirePrivateLocation, requireProcess, requireReadyStack,
  resourceSchema, type Container, type Network, type Resources,
} from "../../../../scripts/swim-acceptance-guards";
import { MIN_RPC_CASES, RPC_SUITE, validateSwimRpcReport } from "./storage-rpc-report";

const sha = "a".repeat(40);
const configHash = "b".repeat(64);
const networkId = "c".repeat(64);
const project = "pr802-123-1";
const context = () => ({
  GITHUB_ACTIONS: "true", GITHUB_EVENT_NAME: "workflow_dispatch", GITHUB_JOB: "swim-acceptance",
  SWIM_ACCEPTANCE: "true", GITHUB_REPOSITORY: "drrowdev/hybrid-training-app",
  RUNNER_ENVIRONMENT: "github-hosted", RUNNER_OS: "Linux", RUNNER_ARCH: "X64",
  EXPECTED_SHA: sha, GITHUB_SHA: sha, GITHUB_REF_TYPE: "branch",
  GITHUB_REF: "refs/heads/reviewed-swim", MIGRATE_PRODUCTION: "false", ALLOW_UNDEPLOYED: "false",
  GITHUB_RUN_ID: "123", GITHUB_RUN_ATTEMPT: "1",
  GITHUB_WORKFLOW_REF: "drrowdev/hybrid-training-app/.github/workflows/ci.yml@refs/heads/reviewed-swim",
});
const bridge = (): Network => ({
  Id: networkId, Name: `${project}-loopback`, Driver: "bridge", Scope: "local",
  Internal: false, EnableIPv6: false, Containers: {},
  Options: { "com.docker.network.bridge.host_binding_ipv4": "127.0.0.1" },
  Labels: { [PROJECT_LABEL]: project, [RUN_LABEL]: project },
});
const container = (service = "db", index = 1): Container => ({
  Id: index.toString(16).padStart(64, "0"), Name: `/supabase_${service}_${project}`,
  Image: `sha256:${"d".repeat(64)}`,
  Config: { Image: `public.ecr.aws/supabase/${service}:reference`, Labels: { [PROJECT_LABEL]: project } },
  State: { Running: true, Status: "running", Health: { Status: "healthy" } },
  HostConfig: { NetworkMode: networkId },
  NetworkSettings: {
    Networks: { [`${project}-loopback`]: { NetworkID: networkId } },
    Ports: service === "db" ? { "5432/tcp": [{ HostIp: "127.0.0.1", HostPort: "54322" }] }
      : service === "kong" ? { "8000/tcp": [{ HostIp: "127.0.0.1", HostPort: "54321" }] } : {},
  },
  Mounts: [],
});
const localStatus = () => ({
  API_URL: "http://127.0.0.1:54321",
  DB_URL: `postgresql://postgres:${encodeURIComponent("synthetic-only")}@127.0.0.1:54322/postgres`,
  ANON_KEY: "local-anon-fixture-value", SERVICE_ROLE_KEY: "local-service-fixture-value",
});
const passed = { code: 0, signal: null, timedOut: false };
const report = () => ({
  success: true, numTotalTests: MIN_RPC_CASES, numPassedTests: MIN_RPC_CASES,
  numFailedTests: 0, numPendingTests: 0, numTodoTests: 0,
  numTotalTestSuites: 2, numPassedTestSuites: 2, numFailedTestSuites: 0, numPendingTestSuites: 0,
  testResults: [{ name: RPC_SUITE, status: "passed",
    assertionResults: Array.from({ length: MIN_RPC_CASES }, (_, i) => ({
      fullName: `synthetic runner guard case ${i}`, status: "passed", failureMessages: [],
    })) }],
});
const ledger = () => validateSwimRpcReport(JSON.stringify(report()), sha, configHash);

describe("manual swim acceptance preflight (no Docker or RPC execution)", () => {
  it("requires the reviewed manual standard-runner context and checked-out SHA", () => {
    expect(requireManualContext(context(), sha)).toBe(project);
    expect(() => requireManualContext(context(), "b".repeat(40))).toThrow();
  });
  it.each([
    ["GITHUB_ACTIONS", "false"], ["GITHUB_EVENT_NAME", "pull_request"], ["GITHUB_JOB", "ci"],
    ["SWIM_ACCEPTANCE", "false"], ["GITHUB_REPOSITORY", "other/repo"],
    ["RUNNER_ENVIRONMENT", "self-hosted"], ["RUNNER_OS", "Windows"], ["RUNNER_ARCH", "ARM64"],
    ["EXPECTED_SHA", ""], ["EXPECTED_SHA", "A".repeat(40)], ["EXPECTED_SHA", `${sha}; echo unsafe`],
    ["EXPECTED_SHA", "a".repeat(39)], ["GITHUB_SHA", "b".repeat(40)],
    ["GITHUB_REF_TYPE", "tag"], ["GITHUB_REF", "refs/heads/main"], ["GITHUB_REF", "refs/tags/v1"],
    ["MIGRATE_PRODUCTION", "true"], ["ALLOW_UNDEPLOYED", "true"], ["ALLOW_UNDEPLOYED", ""],
    ["GITHUB_WORKFLOW_REF", "other"], ["GITHUB_RUN_ID", "../../escape"], ["GITHUB_RUN_ATTEMPT", "0"],
  ])("rejects %s=%s", (key, value) => {
    expect(() => requireManualContext({ ...context(), [key]: value }, sha)).toThrow();
  });
  it.each([
    "DATABASE_URL", "SUPABASE_DB_URL", "NEXT_PUBLIC_SUPABASE_URL", "E2E_SUPABASE_URL",
    "SMOKE_SUPABASE_SERVICE_ROLE_KEY", "PGHOST", "PGSERVICE", "PGSSLMODE",
    "SWIM_RPC_TEST_LOCAL", "SWIM_TEST_PROJECT_REF", "DOCKER_HOST", "DOCKER_CONTEXT", "DOCKER_CONFIG",
    "NODE_OPTIONS", "VITEST_TEST_NAME_PATTERN", "DOTENV_CONFIG_PATH", "S3_HOST", "HTTPS_PROXY",
  ])("rejects inherited %s without exposing its value", (key) => {
    expect(() => requireNoInheritedTargets({ [key]: "private-value" })).toThrow();
    try { requireNoInheritedTargets({ [key]: "private-value" }); }
    catch (error) { expect(String(error)).not.toContain("private-value"); }
  });
  it("allows ordinary context and empty unset target values", () => {
    expect(() => requireNoInheritedTargets({ ...context(), DATABASE_URL: "" })).not.toThrow();
  });
  it("requires a private runner-temp directory outside checkout", () => {
    expect(() => requirePrivateLocation("/tmp/run/private", "/tmp/run", "/repo")).not.toThrow();
    for (const path of ["/repo/tmp/private", "/tmp/run", "/tmp/run/../../repo", "/tmp/runner/private", "relative"]) {
      expect(() => requirePrivateLocation(path, "/tmp/run", "/repo")).toThrow();
    }
  });
  it("requires both pinned and published archive checksums for the exact asset", () => {
    const published = `${CLI_SHA256}  ${CLI_ASSET}\r\n`;
    expect(() => requireArchive(CLI_SHA256, published)).not.toThrow();
    for (const [digest, checksums] of [
      ["e".repeat(64), published], [CLI_SHA256, `${"e".repeat(64)}  ${CLI_ASSET}`],
      [CLI_SHA256, `${CLI_SHA256}  different.tar.gz`], [CLI_SHA256, published + published],
    ]) expect(() => requireArchive(digest!, checksums!)).toThrow();
  });
  it("retains bounded process ceilings and a cleanup reserve", () => {
    expect(LIMITS).toEqual({ total: 35 * 60_000, cleanup: 3 * 60_000, startup: 20 * 60_000, rpc: 12 * 60_000 });
  });
});

describe("disposable targets and effective Docker publications", () => {
  it("reuses the explicit local/nonproduction RPC guard and restricts database TLS", () => {
    const target = requireLocalStatus(localStatus());
    expect(target.rpcEnv).toMatchObject({ SWIM_TEST_PROJECT_REF: "local", SWIM_RPC_TEST_LOCAL: "true",
      SWIM_RPC_TEST_NONPRODUCTION: "true", SMOKE_SUPABASE_URL: "http://127.0.0.1:54321" });
    expect(target.dbEnv.PGSSLMODE).toBe("disable");
  });
  it.each([
    ["API_URL", "https://test.supabase.co"], ["API_URL", "http://localhost:54321"],
    ["API_URL", "http://127.0.0.1:54322"], ["API_URL", "http://127.0.0.1:54321/path"],
    ["DB_URL", localStatus().DB_URL.replace("127.0.0.1", "remote")],
    ["DB_URL", localStatus().DB_URL.replace("54322", "54329")],
    ["DB_URL", localStatus().DB_URL.replace("//postgres:", "//other:")],
    ["DB_URL", "postgresql://postgres@127.0.0.1:54322/postgres"],
    ["DB_URL", localStatus().DB_URL.replace(/\/postgres$/, "/other")],
    ["DB_URL", `${localStatus().DB_URL}?host=remote`],
    ["DB_URL", `${localStatus().DB_URL}#fragment`],
    ["ANON_KEY", ""], ["SERVICE_ROLE_KEY", "placeholder"],
  ])("rejects an unexpected local status field %s", (key, value) => {
    expect(() => requireLocalStatus({ ...localStatus(), [key]: value })).toThrow();
  });
  it("requires the labeled, default-NAT, IPv6-disabled loopback bridge", () => {
    expect(() => requireNetwork(bridge(), project, true)).not.toThrow();
    for (const change of [
      { Driver: "host" }, { Scope: "swarm" }, { Internal: true }, { EnableIPv6: true }, { Labels: {} },
      { Options: {} }, { Options: { ...bridge().Options, "com.docker.network.bridge.gateway_mode_ipv4": "routed" } },
      { Containers: { foreign: {} } },
    ]) expect(() => requireNetwork({ ...bridge(), ...change }, project, true)).toThrow();
  });
  it.each(["0.0.0.0", "::", "", "::1", "192.0.2.1"])("rejects unexpected host binding %j", (host) => {
    const value = container();
    value.NetworkSettings.Ports["5432/tcp"]![0]!.HostIp = host;
    expect(() => requireContainer(value, project, networkId)).toThrow();
  });
  it("checks both address families, port, ownership, network and health", () => {
    const value = container();
    expect(() => requireContainer(value, project, networkId, true)).not.toThrow();
    value.NetworkSettings.Ports["5432/tcp"]!.push({ HostIp: "::", HostPort: "54322" });
    expect(() => requireContainer(value, project, networkId)).toThrow();
    expect(() => requireContainer(container(), "other", networkId)).toThrow();
    expect(() => requireContainer(container(), project, "d".repeat(64))).toThrow();
    const unhealthy = container();
    unhealthy.State.Health!.Status = "unhealthy";
    expect(() => requireContainer(unhealthy, project, networkId, true)).toThrow();
    const multiNetwork = container();
    multiNetwork.NetworkSettings.Networks.extra = { NetworkID: "d".repeat(64) };
    expect(() => requireContainer(multiNetwork, project, networkId)).toThrow();
  });
  it("requires all official default services and exact API/database publications", () => {
    const containers = DEFAULT_SERVICES.map((name, index) => container(name, index + 1));
    const network = { ...bridge(), Containers: Object.fromEntries(containers.map((c) => [c.Id, {}])) };
    expect(() => requireReadyStack(containers, network, project)).not.toThrow();
    expect(() => requireReadyStack(containers.slice(1), network, project)).toThrow();
    containers[0]!.NetworkSettings.Ports = {};
    expect(() => requireReadyStack(containers, network, project)).toThrow();
  });
});

describe("stage results, canonical ledger and cleanup state", () => {
  it.each([
    { code: 1, signal: null, timedOut: false }, { code: null, signal: "SIGTERM", timedOut: false },
    { code: 0, signal: null, timedOut: true }, { code: null, signal: "spawn-error", timedOut: false },
  ])("rejects unsuccessful processes even with a positive ledger: %j", (result) => {
    expect(() => requireProcess(result)).toThrow();
    expect(() => requireAcceptance(result, ledger(), sha, configHash)).toThrow();
  });
  it("requires nonempty fresh regular-file evidence", () => {
    expect(() => requireFreshReport({ size: 100, mtimeMs: 150, isFile: true }, 100, 200)).not.toThrow();
    for (const change of [{ size: 0 }, { mtimeMs: 99 }, { mtimeMs: 201 }, { isFile: false }]) {
      expect(() => requireFreshReport({ size: 100, mtimeMs: 150, isFile: true, ...change }, 100, 200)).toThrow();
    }
  });
  it("exit zero cannot replace the canonical positive ledger, SHA or config", () => {
    expect(() => requireAcceptance(passed, ledger(), sha, configHash)).not.toThrow();
    for (const value of [
      { ...ledger(), success: false }, { ...ledger(), testedSha: "d".repeat(40) },
      { ...ledger(), configSha256: "d".repeat(64) }, { ...ledger(), suites: [] },
    ]) expect(() => requireAcceptance(passed, value, sha, configHash)).toThrow();
    const skipped = report();
    skipped.testResults[0]!.assertionResults[0]!.status = "skipped";
    expect(() => requireAcceptance(passed,
      validateSwimRpcReport(JSON.stringify(skipped), sha, configHash), sha, configHash)).toThrow();
  });
  it("validates exact task cleanup state and process fingerprints", () => {
    const state: Resources = { project, sha, createdAt: 1, containers: [container().Id],
      volumes: [`supabase_db_${project}`], networkId, processes: [{ pid: 123, startTicks: "456" }], cleanup: "unconfirmed" };
    expect(resourceSchema.parse(state)).toEqual(state);
    expect(() => requireCleanupState(state, project, sha)).not.toThrow();
    expect(() => requireCleanupState(state, "pr802-124-1", sha)).toThrow();
    expect(() => requireCleanupState(state, project, "d".repeat(40))).toThrow();
    expect(() => resourceSchema.parse({ ...state, volumes: ["*"] })).toThrow();
    expect(() => resourceSchema.parse({ ...state, processes: [{ pid: 1, startTicks: "456" }] })).toThrow();
    const fields = ["S", "1", "123", ...Array(16).fill("0"), "456"];
    expect(processIdentity(`123 (name with ) spaces) ${fields.join(" ")}`)).toEqual({ group: 123, startTicks: "456" });
  });
  it("retains the original failed stage when cleanup also fails", () => {
    expect(outcome("migrations", false)).toEqual({ success: false, primary: "migrations", cleanup: "unconfirmed" });
    expect(outcome(undefined, false).success).toBe(false);
    expect(outcome("RPC", true).success).toBe(false);
    expect(outcome(undefined, true).success).toBe(true);
  });
});
