import { acceptanceAssert as assert, processFailure } from "./swim-acceptance-reporting";
import { isAbsolute, relative, sep } from "node:path";
import { z } from "zod";
import { getSwimRpcTestEnv } from "../src/lib/swim/__tests__/storage-rpc-config";
import { RPC_CONFIG, RPC_SUITE, type readSwimRpcReport } from "../src/lib/swim/__tests__/storage-rpc-report";

export const CLI_VERSION = "2.116.0";
export const CLI_ASSET = `supabase_${CLI_VERSION}_linux_amd64.tar.gz`;
export const CLI_SHA256 = "5b3031cb297d51b25be4c284e4c852254460ec722ec221d3b81b07d55acfd158";
export const PROJECT_LABEL = "com.supabase.cli.project";
export const RUN_LABEL = "app.hta.swim-acceptance";
export const LIMITS = { total: 35 * 60_000, cleanup: 3 * 60_000, startup: 20 * 60_000, rpc: 12 * 60_000 };
export const DEFAULT_SERVICES = [
  "db", "kong", "auth", "inbucket", "realtime", "rest", "storage", "imgproxy",
  "pg_meta", "studio", "edge_runtime", "analytics", "vector",
] as const;

type Env = Record<string, string | undefined>;
export function requireManualContext(env: Env, head: string) {
  assert(env.GITHUB_ACTIONS === "true" && env.GITHUB_EVENT_NAME === "workflow_dispatch" &&
    env.GITHUB_JOB === "swim-acceptance" && env.SWIM_ACCEPTANCE === "true", "Manual swim job required");
  assert(env.GITHUB_REPOSITORY === "drrowdev/hybrid-training-app", "Unexpected repository");
  assert(env.RUNNER_ENVIRONMENT === "github-hosted" && env.RUNNER_OS === "Linux" &&
    env.RUNNER_ARCH === "X64", "Standard Linux x64 runner required");
  assert.match(env.EXPECTED_SHA ?? "", /^[a-f0-9]{40}$/, "Invalid reviewed SHA");
  assert(env.EXPECTED_SHA === env.GITHUB_SHA && head === env.EXPECTED_SHA, "Reviewed SHA mismatch");
  assert(env.GITHUB_REF_TYPE === "branch" && env.GITHUB_REF?.startsWith("refs/heads/") &&
    env.GITHUB_REF !== "refs/heads/main", "Non-main branch required");
  assert(env.GITHUB_WORKFLOW_REF === `${env.GITHUB_REPOSITORY}/.github/workflows/ci.yml@${env.GITHUB_REF}`,
    "Unexpected workflow");
  assert(env.MIGRATE_PRODUCTION === "false" && env.ALLOW_UNDEPLOYED === "false", "Production inputs forbidden");
  assert.match(env.GITHUB_RUN_ID ?? "", /^[1-9][0-9]*$/, "Invalid run ID");
  assert.match(env.GITHUB_RUN_ATTEMPT ?? "", /^[1-9][0-9]*$/, "Invalid run attempt");
  return `pr802-${env.GITHUB_RUN_ID}-${env.GITHUB_RUN_ATTEMPT}`;
}

export function requireNoInheritedTargets(env: Env) {
  const forbidden = /SUPABASE|DATABASE_URL|^PG|^SMOKE_|^E2E_|^SWIM_RPC_|^SWIM_TEST_|^DOCKER_(HOST|CONTEXT|CONFIG|TLS|CERT|API)|^CONTAINER_HOST$|^NODE_OPTIONS$|^DOTENV_|^VITEST_|^S3_|^OPENAI_API_KEY$|^(HTTP|HTTPS|ALL|NO)_PROXY$/i;
  assert(!Object.entries(env).some(([key, value]) => value && forbidden.test(key)),
    "Inherited database, platform or execution overrides forbidden");
}

export function requirePrivateLocation(directory: string, runnerTemp: string, checkout: string) {
  const within = (parent: string, child: string) => {
    const path = relative(parent, child);
    return path !== "" && path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path);
  };
  assert([directory, runnerTemp, checkout].every(isAbsolute) &&
    within(runnerTemp, directory) && !within(checkout, directory) && directory !== checkout,
  "Private storage must be under runner temp and outside checkout");
}

export function requireArchive(digest: string, checksums: string) {
  const entries = checksums.split(/\r?\n/).map((line) => line.trim().split(/\s+/))
    .filter((entry) => entry[1] === CLI_ASSET || entry[1] === `*${CLI_ASSET}`);
  assert(digest === CLI_SHA256 && entries.length === 1 && entries[0]![0] === digest,
    "Official CLI archive checksum mismatch");
}

export function requireLocalStatus(status: Record<string, string>) {
  assert(status.API_URL === "http://127.0.0.1:54321", "Unexpected local API");
  const db = new URL(status.DB_URL);
  assert(db.protocol === "postgresql:" && db.hostname === "127.0.0.1" && db.port === "54322" &&
    db.username === "postgres" && db.password.length > 0 && db.pathname === "/postgres" &&
    db.search === "" && db.hash === "", "Unexpected disposable database URI");
  const env = {
    SWIM_RPC_TEST_NONPRODUCTION: "true", SWIM_RPC_TEST_LOCAL: "true", SWIM_TEST_PROJECT_REF: "local",
    SMOKE_SUPABASE_URL: status.API_URL, SMOKE_SUPABASE_ANON_KEY: status.ANON_KEY,
    SMOKE_SUPABASE_SERVICE_ROLE_KEY: status.SERVICE_ROLE_KEY,
  };
  assert(getSwimRpcTestEnv(env), "Explicit local RPC environment required");
  return { rpcEnv: env, dbEnv: { DATABASE_URL: status.DB_URL, PGSSLMODE: "disable" } };
}

const id = z.string().regex(/^[a-f0-9]{64}$/);
const labels = z.record(z.string()).nullable();
export const networkSchema = z.object({
  Id: id, Name: z.string(), Driver: z.string(), Scope: z.string(), Internal: z.boolean(),
  EnableIPv6: z.boolean(), Options: z.record(z.string()), Labels: labels,
  Containers: z.record(z.unknown()).nullable(),
});
export type Network = z.infer<typeof networkSchema>;
export function requireNetwork(network: Network, project: string, empty = false) {
  assert(network.Name === `${project}-loopback` && network.Driver === "bridge" &&
    network.Scope === "local" && !network.Internal && !network.EnableIPv6 &&
    network.Labels?.[RUN_LABEL] === project && network.Labels?.[PROJECT_LABEL] === project,
  "Unexpected task network");
  assert.deepEqual(network.Options, { "com.docker.network.bridge.host_binding_ipv4": "127.0.0.1" },
    "Only approved loopback option permitted; default NAT required");
  if (empty) assert(Object.keys(network.Containers ?? {}).length === 0, "Task network not empty");
}

// Keep .Id: these lookups use Docker's JSON-map fallback, not the typed .ID.
// index handles absent Health map keys but cannot index the typed ContainerState.
export const INSPECT_FORMAT = `{"Id":{{json .Id}},"Name":{{json .Name}},"Image":{{json .Image}},
  "Config":{"Image":{{json .Config.Image}},"Labels":{{json .Config.Labels}}},
  "State":{"Running":{{json .State.Running}},"Status":{{json .State.Status}},
    "Health":{{with (index .State "Health")}}{"Status":{{json (index . "Status")}}}{{else}}null{{end}}},
  "HostConfig":{"NetworkMode":{{json .HostConfig.NetworkMode}}},
  "NetworkSettings":{"Networks":{{json .NetworkSettings.Networks}},"Ports":{{json .NetworkSettings.Ports}}},
  "Mounts":{{json .Mounts}}}`.replace(/\s+/g, " ");

export const containerSchema = z.object({
  Id: id, Name: z.string(), Image: id.or(z.string().regex(/^sha256:[a-f0-9]{64}$/)),
  Config: z.object({ Image: z.string(), Labels: labels }),
  State: z.object({ Running: z.boolean(), Status: z.string(), Health: z.object({ Status: z.string() }).nullable().optional() }),
  HostConfig: z.object({ NetworkMode: z.string() }),
  NetworkSettings: z.object({
    Networks: z.record(z.object({ NetworkID: id })),
    Ports: z.record(z.array(z.object({ HostIp: z.string(), HostPort: z.string() })).nullable()),
  }),
  Mounts: z.array(z.object({ Type: z.string(), Name: z.string().optional() })),
});
export type Container = z.infer<typeof containerSchema>;
function requireContainerNetwork(container: Container, project: string, networkId: string) {
  const networks = Object.values(container.NetworkSettings.Networks);
  assert(networks.length === 1 && networks[0]!.NetworkID === networkId &&
    [networkId, `${project}-loopback`].includes(container.HostConfig.NetworkMode), "Unexpected container network");
}

export function requireContainer(container: Container, project: string, networkId: string, ready = false) {
  assert(container.Config.Labels?.[PROJECT_LABEL] === project &&
    container.Name.startsWith("/supabase_") && container.Name.endsWith(`_${project}`), "Foreign container");
  requireContainerNetwork(container, project, networkId);
  for (const bindings of Object.values(container.NetworkSettings.Ports)) {
    for (const binding of bindings ?? []) {
      assert(binding.HostIp === "127.0.0.1" && /^(8083|54321|54322|54323|54324|54327)$/.test(binding.HostPort),
        "Non-loopback IPv4/IPv6 or unexpected publication");
    }
  }
  if (ready) assert(container.State.Running &&
    (!container.State.Health || container.State.Health.Status === "healthy"), "Service not ready");
}

const BOOTSTRAP_IMAGES = new Set([
  "supabase/realtime:v2.129.3",
  "public.ecr.aws/supabase/realtime:v2.129.3",
  "ghcr.io/supabase/realtime:v2.129.3",
  "supabase/storage-api:v1.70.3",
  "public.ecr.aws/supabase/storage-api:v1.70.3",
  "ghcr.io/supabase/storage-api:v1.70.3",
  "supabase/gotrue:v2.196.0",
  "public.ecr.aws/supabase/gotrue:v2.196.0",
  "ghcr.io/supabase/gotrue:v2.196.0",
]);

export function requireStartupContainer(container: Container, project: string, networkId: string) {
  if (container.Name.startsWith("/supabase_")) return requireContainer(container, project, networkId);
  assert(container.Config.Labels?.[PROJECT_LABEL] === project &&
    container.Config.Labels?.["com.docker.compose.project"] === project, "Foreign startup job");
  requireContainerNetwork(container, project, networkId);
  assert(Object.values(container.NetworkSettings.Ports).every((bindings) => (bindings ?? []).length === 0),
    "Startup job publication forbidden");
  assert(container.Mounts.every((mount) => mount.Type === "volume"), "Unexpected startup job mount");
  const image = container.Config.Image.replace(/@sha256:[a-f0-9]{64}$/, "");
  assert(BOOTSTRAP_IMAGES.has(image), "Unexpected startup job image");
}

export function requireReadyStack(containers: Container[], network: Network, project: string) {
  requireNetwork(network, project);
  assert.deepEqual(containers.map((c) => c.Name).sort(),
    DEFAULT_SERVICES.map((service) => `/supabase_${service}_${project}`).sort(), "Incomplete default service set");
  assert.deepEqual(Object.keys(network.Containers ?? {}).sort(), containers.map((c) => c.Id).sort(),
    "Unexpected network membership");
  for (const container of containers) requireContainer(container, project, network.Id, true);
  for (const [service, port, hostPort] of [["db", "5432/tcp", "54322"], ["kong", "8000/tcp", "54321"]]) {
    const container = containers.find((c) => c.Name === `/supabase_${service}_${project}`)!;
    assert.deepEqual(container.NetworkSettings.Ports[port!], [{ HostIp: "127.0.0.1", HostPort: hostPort }],
      "API/database publication does not match status target");
  }
}

export type ProcessResult = { code: number | null; signal: string | null; timedOut: boolean };
export function requireProcess(result: ProcessResult) {
  if (result.code !== 0 || result.signal !== null || result.timedOut) throw processFailure(result);
}
export function requireFreshReport(
  info: { size: number; mtimeMs: number; isFile: boolean }, started: number, now: number,
) {
  assert(info.isFile && info.size > 0 && info.mtimeMs >= started && info.mtimeMs <= now,
    "RPC report missing, empty or stale");
}
export function requireAcceptance(
  result: ProcessResult, ledger: ReturnType<typeof readSwimRpcReport>, sha: string, configHash: string,
) {
  requireProcess(result);
  assert(ledger.success && ledger.testedSha === sha && ledger.config === RPC_CONFIG &&
    ledger.configSha256 === configHash && ledger.expectedSuite === RPC_SUITE &&
    ledger.suites.length === 1 && ledger.suites[0]!.cases.length >= ledger.minimumCases,
  "Positive canonical RPC ledger required");
}

export const resourceSchema = z.object({
  project: z.string().regex(/^pr802-[1-9][0-9]*-[1-9][0-9]*$/),
  sha: z.string().regex(/^[a-f0-9]{40}$/), createdAt: z.number().int().positive(),
  networkId: id.optional(), containers: z.array(id), volumes: z.array(z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]+$/)),
  processes: z.array(z.object({ pid: z.number().int().min(2), startTicks: z.string().regex(/^\d+$/) })),
  cleanup: z.enum(["unconfirmed", "verified"]),
});
export type Resources = z.infer<typeof resourceSchema>;
export function requireCleanupState(state: Resources, project: string, sha: string) {
  assert(state.project === project && state.sha === sha, "Foreign cleanup state");
}
export function processIdentity(stat: string) {
  const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
  assert(fields.length >= 20 && /^\d+$/.test(fields[19]!), "Invalid process identity");
  return { group: Number(fields[2]), startTicks: fields[19]! };
}
export function outcome(primary: string | undefined, cleanupVerified: boolean) {
  return { success: !primary && cleanupVerified, primary: primary ?? null,
    cleanup: cleanupVerified ? "verified" : "unconfirmed" };
}
