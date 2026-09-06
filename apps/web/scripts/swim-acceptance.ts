import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFileSync, chmodSync, closeSync, existsSync, lstatSync, mkdirSync,
  readFileSync, readdirSync, realpathSync, renameSync, writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { SEED_MOVEMENTS } from "../../../packages/db/seeds/movements";
import {
  CLI_ASSET, CLI_SHA256, CLI_VERSION, INSPECT_FORMAT, LIMITS, PROJECT_LABEL, RUN_LABEL,
  containerSchema, networkSchema, outcome, processIdentity, requireAcceptance, requireArchive,
  requireCleanupState, requireFreshReport, requireLocalStatus,
  requireManualContext, requireNetwork, requireNoInheritedTargets, requirePrivateLocation,
  requireProcess, requireReadyStack, requireStartupContainer, resourceSchema,
  type Container, type ProcessResult, type Resources,
} from "./swim-acceptance-guards";
import {
  acceptanceAssert as assert, AcceptanceReporting, formatAcceptanceSummary,
  openPrivateCommandLog, publishAcceptanceSummary, safeFailureCause,
} from "./swim-acceptance-reporting";
import { RPC_CONFIG, RPC_SUITE, readSwimRpcReport } from "../src/lib/swim/__tests__/storage-rpc-report";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const web = join(root, "apps/web");
const hash = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");
const git = (...args: string[]) => execFileSync("git", ["-C", root, ...args],
  { encoding: "utf8", timeout: 10_000, stdio: ["ignore", "pipe", "pipe"] }).trim();

async function main(cleanupOnly: boolean) {
  // Fail before any filesystem/resource creation outside the reviewed manual job.
  const project = requireManualContext(process.env, process.env.GITHUB_SHA ?? "");
  requireManualContext(process.env, git("rev-parse", "HEAD"));
  const temp = realpathSync(process.env.RUNNER_TEMP!);
  assert(realpathSync(process.env.GITHUB_WORKSPACE!) === realpathSync(root));
  const directory = join(temp, `swim-acceptance-${project}`);
  requirePrivateLocation(directory, temp, realpathSync(root));
  const statePath = join(directory, "resources.json");
  const started = Date.now();
  let deadline = started + LIMITS.total - LIMITS.cleanup;
  let cancelling = false;
  let sequence = 0;
  const reporting = new AcceptanceReporting();
  const active = new Map<number, () => void>();
  const secrets = new Set<string>();
  const manifest: Record<string, unknown> = { testedSha: process.env.EXPECTED_SHA, project };
  let state: Resources = { project, sha: process.env.EXPECTED_SHA!, createdAt: started,
    containers: [], volumes: [], processes: [], cleanup: "unconfirmed" };
  const save = () => {
    writeFileSync(`${statePath}.new`, JSON.stringify(state), { mode: 0o600 });
    renameSync(`${statePath}.new`, statePath);
  };
  const summary = (heading: string, data: unknown) =>
    publishAcceptanceSummary(process.env.GITHUB_STEP_SUMMARY!, heading, data, secrets);
  const stage = <T>(name: string, action: () => Promise<T>) =>
    reporting.stage(name, action, (entry) => summary("Swim acceptance stage", entry));

  if (cleanupOnly) {
    assert(process.env.SWIM_ACCEPTANCE_DIR === directory);
    for (const [path, mode] of [[directory, 0o700], [statePath, 0o600]] as const) {
      assert(!lstatSync(path).isSymbolicLink() && (lstatSync(path).mode & 0o777) === mode);
    }
    state = resourceSchema.parse(JSON.parse(readFileSync(statePath, "utf8")));
    requireCleanupState(state, project, process.env.EXPECTED_SHA!);
  } else {
    requireNoInheritedTargets(process.env);
    assert(git("status", "--porcelain", "--untracked-files=all") === "", "Dirty checkout");
    for (const relative of ["", "apps/web", "packages/db"]) {
      assert(!readdirSync(join(root, relative)).some((name) =>
        (name === ".env" || name.startsWith(".env.")) && ![".env.example", ".env.template"].includes(name)),
      "Repository dotenv files forbidden");
    }
    process.umask(0o077);
    mkdirSync(directory, { mode: 0o700 });
    for (const name of ["bin", "project", "home"]) mkdirSync(join(directory, name), { mode: 0o700 });
    save();
    appendFileSync(process.env.GITHUB_ENV!, `SWIM_ACCEPTANCE_DIR=${directory}\n`);
    summary("Swim acceptance scope", {
      ...manifest, cleanup: "unconfirmed until a terminal cleanup record; forced cancellation may prevent observation",
      scope: "Reference startup, unchanged migrations/catalog and complete swim RPC file only; not standalone release acceptance",
    });
  }
  process.umask(0o077);
  // No application credentials, CLI login cache or registry overrides reach children.
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH, HOME: join(directory, "home"), CI: "true", LANG: "C.UTF-8", NODE_ENV: "test",
  };
  const cancel = () => {
    cancelling = true;
    for (const terminate of active.values()) terminate();
  };
  process.on("SIGINT", cancel);
  process.on("SIGTERM", cancel);

  async function command(
    executable: string, args: string[], options: {
      cwd?: string; env?: Record<string, string>; timeout?: number; capture?: boolean;
      allowFailure?: boolean; diagnose?: () => Promise<void>; onSpawn?: (stop: () => void) => void;
    } = {},
  ) {
    assert(!cancelling && Date.now() < deadline, "Run cancelled or total time exhausted");
    const duration = Math.min(options.timeout ?? 60_000, deadline - Date.now());
    const log = join(directory, `${cleanupOnly ? "cleanup" : "run"}-${started}-${++sequence}.log`);
    const commandLog = openPrivateCommandLog(log);
    const { fd } = commandLog;
    let text = "";
    let timedOut = false;
    let killed: Promise<void> | undefined;
    const child = spawn(executable, args, {
      cwd: options.cwd ?? root, env: { ...env, ...options.env }, detached: true,
      stdio: ["ignore", options.capture ? "pipe" : fd, fd],
    });
    const terminate = () => {
      if (!child.pid) return;
      // The group is created by this spawn, never looked up by process name.
      try { process.kill(-child.pid, "SIGTERM"); } catch { return; }
      killed ??= sleep(2_000).then(() => {
        try { process.kill(-child.pid!, "SIGKILL"); } catch { /* already exited */ }
      });
    };
    if (child.pid) {
      active.set(child.pid, terminate);
      try {
        const identity = processIdentity(readFileSync(`/proc/${child.pid}/stat`, "utf8"));
        state.processes.push({ pid: child.pid, startTicks: identity.startTicks });
        save();
      } catch {
        // A short-lived child may already be gone; a live unrecorded group is unsafe.
        try { process.kill(-child.pid, 0); timedOut = true; terminate(); } catch { /* already exited */ }
      }
      options.onSpawn?.(terminate);
    }
    child.stdout?.on("data", (chunk: Buffer) => {
      commandLog.append(chunk);
      text += chunk.toString("utf8");
      if (text.length > 8 * 1024 * 1024) { timedOut = true; terminate(); }
    });
    const timeout = setTimeout(() => { timedOut = true; terminate(); }, Math.max(1, duration - 2_000));
    let diagnosis: Promise<void> | undefined;
    const diagnostic = options.diagnose && setTimeout(() => {
      diagnosis = options.diagnose!().catch(() => {
        manifest.rpcDiagnostic = "unavailable";
      });
    }, Math.max(1, duration - 15_000));
    const result = await new Promise<ProcessResult>((done) => {
      child.once("error", () => done({ code: null, signal: "spawn-error", timedOut }));
      child.once("close", (code, signal) => done({ code, signal, timedOut }));
    });
    clearTimeout(timeout);
    if (diagnostic) clearTimeout(diagnostic);
    // Reap descendants too, including workers left behind after the leader exits.
    terminate();
    await killed;
    await diagnosis;
    if (child.pid) {
      active.delete(child.pid);
      try { process.kill(-child.pid, 0); } catch {
        state.processes = state.processes.filter((p) => p.pid !== child.pid);
        save();
      }
    }
    closeSync(fd);
    if (!options.allowFailure) requireProcess(result);
    return { text: text.trim(), result, log };
  }
  const docker = (args: string[]) => command("docker", args, { capture: true, timeout: 15_000 });
  const list = async (kind: "container" | "volume" | "network") => {
    const args = kind === "container"
      ? ["ps", "-a", "--no-trunc", "--quiet"]
      : [kind, "ls", ...(kind === "network" ? ["--no-trunc"] : []), "--quiet"];
    const { text } = await docker([...args, "--filter", `label=${PROJECT_LABEL}=${project}`]);
    return text ? text.split(/\r?\n/) : [];
  };
  const inspect = async (ids: string[]) => {
    if (ids.length === 0) return [];
    const { text } = await docker(["inspect", "--format", INSPECT_FORMAT, ...ids]);
    return text.split("\n").map((line) => containerSchema.parse(JSON.parse(line)));
  };
  const network = async () => {
    assert(state.networkId);
    const { text } = await docker(["network", "inspect", state.networkId]);
    return networkSchema.parse(JSON.parse(text)[0]);
  };
  async function recordResources() {
    const containers = await list("container");
    const volumes = await list("volume");
    state.containers = [...new Set([...state.containers, ...containers])];
    state.volumes = [...new Set([...state.volumes, ...volumes])];
    resourceSchema.parse(state);
    save();
    return { containers, volumes };
  }
  async function cleanup() {
    cancelling = false;
    deadline = cleanupOnly ? Date.now() + LIMITS.cleanup : Math.min(Date.now() + LIMITS.cleanup, started + LIMITS.total);
    state.cleanup = "unconfirmed";
    save();
    let failed = false;
    const attempt = async (fn: () => Promise<unknown>) => {
      try { await fn(); } catch (error) {
        failed = true;
        reporting.recordFailure("resource cleanup", error, true);
      }
    };
    for (const recorded of [...state.processes]) await attempt(async () => {
      try { process.kill(-recorded.pid, 0); } catch {
        state.processes = state.processes.filter((p) => p.pid !== recorded.pid);
        return;
      }
      // Never kill a reused PID or an unidentifiable group after forced cancellation.
      const current = processIdentity(readFileSync(`/proc/${recorded.pid}/stat`, "utf8"));
      assert(current.group === recorded.pid && current.startTicks === recorded.startTicks);
      process.kill(-recorded.pid, "SIGTERM");
      await sleep(2_000);
      try { process.kill(-recorded.pid, "SIGKILL"); } catch { /* already exited */ }
      await sleep(100);
      let exists = true;
      try { process.kill(-recorded.pid, 0); } catch { exists = false; }
      assert(!exists);
      state.processes = state.processes.filter((p) => p.pid !== recorded.pid);
    });
    const remaining = await recordResources();
    if (!state.networkId) {
      const ids = await list("network");
      assert(ids.length <= 1);
      if (ids[0]) {
        const { text } = await docker(["network", "inspect", ids[0]]);
        requireNetwork(networkSchema.parse(JSON.parse(text)[0]), project);
        state.networkId = ids[0];
        save();
      }
    }
    for (const id of remaining.containers) await attempt(async () => {
      const [container] = await inspect([id]);
      assert(container?.Config.Labels?.[PROJECT_LABEL] === project && state.containers.includes(id));
      await docker(["rm", "--force", id]);
    });
    for (const volume of remaining.volumes) await attempt(async () => {
      const { text } = await docker(["volume", "inspect", volume]);
      const [value] = JSON.parse(text);
      assert(value.Name === volume && value.Labels?.[PROJECT_LABEL] === project && state.volumes.includes(volume));
      await docker(["volume", "rm", volume]);
    });
    for (const id of await list("network")) await attempt(async () => {
      assert(id === state.networkId);
      requireNetwork(await network(), project, true);
      await docker(["network", "rm", id]);
    });
    for (const kind of ["container", "volume", "network"] as const) {
      await attempt(async () => assert((await list(kind)).length === 0));
    }
    state.cleanup = failed ? "unconfirmed" : "verified";
    save();
    assert(!failed, "Task cleanup unconfirmed");
  }
  let sourceFiles: string[] = [];
  let sourceHashes: Record<string, string> = {};
  const sources = () => Object.fromEntries(sourceFiles.map((file) => [file, hash(readFileSync(join(root, file)))]));
  const requireUnchanged = () => {
    const after = sources();
    manifest.sourceSha256After = hash(JSON.stringify(after));
    manifest.configSha256After = hash(readFileSync(RPC_CONFIG));
    manifest.rpcSourceSha256After = hash(readFileSync(RPC_SUITE));
    assert.deepEqual(after, sourceHashes, "Tracked acceptance sources changed");
    if (manifest.localConfigSha256) {
      manifest.localConfigSha256After = hash(readFileSync(join(directory, "project/supabase/config.toml")));
      assert(manifest.localConfigSha256After === manifest.localConfigSha256, "Local CLI configuration changed");
    }
    assert(git("status", "--porcelain", "--untracked-files=all") === "", "Checkout changed during acceptance");
    requireManualContext(process.env, git("rev-parse", "HEAD"));
  };
  const cli = join(directory, "bin/supabase");
  const cliCommand = (args: string[], options: Parameters<typeof command>[2] = {}) =>
    command(cli, args, { ...options, cwd: join(directory, "project") });
  try {
    if (cleanupOnly) return;
    await stage("source and runner preflight", async () => {
      sourceFiles = git("ls-files", "-z", "--", "packages/db", "packages/domain", "packages/engine",
        "apps/web/src/lib/swim", "apps/web/e2e-rpc/setup.ts", "apps/web/scripts",
        "apps/web/vitest.config.ts", "apps/web/package.json", "package.json", "pnpm-lock.yaml",
        "pnpm-workspace.yaml", ".github/workflows/ci.yml").split("\0").filter(Boolean);
      sourceHashes = sources();
      const journal = JSON.parse(readFileSync(join(root, "packages/db/drizzle/meta/_journal.json"), "utf8"));
      assert(journal.entries.length === 146 && sourceFiles.filter((f) => /^packages\/db\/drizzle\/[^/]+\.sql$/.test(f)).length === 146);
      manifest.sourceSha256 = hash(JSON.stringify(sourceHashes));
      manifest.configSha256 = hash(readFileSync(RPC_CONFIG));
      manifest.rpcSourceSha256 = hash(readFileSync(RPC_SUITE));
      manifest.migrationCount = 146;
      writeFileSync(join(directory, "source-hashes.json"), JSON.stringify(sourceHashes), { mode: 0o600 });
      assert(process.version.startsWith("v22.") && process.platform === "linux" && process.arch === "x64");
      assert((await command("pnpm", ["--version"], { capture: true })).text === "10.33.2");
      const endpoint = (await docker(["context", "inspect", "--format", "{{.Endpoints.docker.Host}}"])).text;
      assert(endpoint === "unix:///var/run/docker.sock");
      const version = (await docker(["version", "--format", "{{.Server.Version}}"])).text;
      assert(/^\d+\.\d+\.\d+/.test(version) && Number(version.split(".")[0]) >= 28);
      manifest.dockerVersion = version;
      manifest.nodeVersion = process.version;
      manifest.pnpmVersion = "10.33.2";
      for (const kind of ["container", "volume", "network"] as const) assert((await list(kind)).length === 0);
    });
    await stage("official CLI archive and initialization", async () => {
      const base = `https://github.com/supabase/cli/releases/download/v${CLI_VERSION}`;
      for (const file of [CLI_ASSET, "checksums.txt"]) {
        await command("curl", ["--fail", "--silent", "--show-error", "--location",
          "--proto", "=https", "--proto-redir", "=https", "--connect-timeout", "20", "--max-time", "120",
          "--output", join(directory, file), `${base}/${file}`], { timeout: 125_000 });
      }
      requireArchive(hash(readFileSync(join(directory, CLI_ASSET))), readFileSync(join(directory, "checksums.txt"), "utf8"));
      await command("tar", ["-xzf", join(directory, CLI_ASSET), "-C", join(directory, "bin"), "supabase"]);
      chmodSync(cli, 0o700);
      assert((await cliCommand(["--version"], { capture: true })).text === CLI_VERSION);
      manifest.cli = { version: CLI_VERSION, asset: CLI_ASSET, sha256: CLI_SHA256 };
      await cliCommand(["init", "--yes"]);
      const configPath = join(directory, "project/supabase/config.toml");
      const config = readFileSync(configPath, "utf8");
      assert((config.match(/^project_id = "[^"]*"$/gm) ?? []).length === 1);
      writeFileSync(configPath, config.replace(/^project_id = "[^"]*"$/m, `project_id = "${project}"`), { mode: 0o600 });
      chmodSync(configPath, 0o600);
      assert(!existsSync(join(directory, "project/supabase/seed.sql")));
      const migrations = join(directory, "project/supabase/migrations");
      assert(!existsSync(migrations) || readdirSync(migrations).length === 0);
      manifest.localConfigSha256 = hash(readFileSync(configPath));
    });
    await stage("loopback task bridge", async () => {
      const { text } = await docker(["network", "create", "--driver", "bridge",
        "--label", `${PROJECT_LABEL}=${project}`, "--label", `${RUN_LABEL}=${project}`,
        "--opt", "com.docker.network.bridge.host_binding_ipv4=127.0.0.1", `${project}-loopback`]);
      state.networkId = text;
      resourceSchema.parse(state);
      save();
      requireNetwork(await network(), project, true);
    });
    await stage("one official default-service startup", async () => {
      const snapshots = new Map<string, Container>();
      let observing = true;
      let unsafe = false;
      let unavailable = 0;
      let stopStartup: (() => void) | undefined;
      const stopSleep = new AbortController();
      const observer = (async () => {
        while (observing && !cancelling) {
          try {
            const resources = await recordResources();
            const containers = await inspect(resources.containers);
            for (const container of containers) {
              snapshots.set(container.Id, container);
              if (!container.State.Running) continue;
              try { requireStartupContainer(container, project, state.networkId!); }
              catch (error) {
                manifest.startupViolation ??= safeFailureCause(error);
                unsafe = true;
                stopStartup?.();
              }
            }
          } catch { unavailable++; }
          await sleep(2_000, undefined, { signal: stopSleep.signal }).catch(() => {});
        }
      })();
      let startup;
      try {
        startup = await cliCommand(["start", "--debug", "--network-id", state.networkId!],
          { timeout: LIMITS.startup, allowFailure: true, onSpawn: (stop) => { stopStartup = stop; } });
      } finally {
        observing = false;
        stopSleep.abort();
        await observer;
        manifest.startupSnapshots = [...snapshots.values()];
        manifest.unavailableStartupSnapshots = unavailable;
      }
      const { result, log } = startup;
      manifest.startup = result;
      // Classify only this literal diagnostic; never publish startup output.
      manifest.storageDnsEaiAgain = readFileSync(log, "utf8").includes("EAI_AGAIN");
      await recordResources();
      assert(!unsafe, "Unsafe startup publication or membership");
      requireProcess(result);
    });
    const target = await stage("effective publications and reference health", async () => {
      const { containers: ids } = await recordResources();
      const containers = await inspect(ids);
      const bridge = await network();
      requireReadyStack(containers, bridge, project);
      const services = [];
      for (const container of containers) {
        const { text } = await docker(["image", "inspect", "--format", "{{json .RepoDigests}}", container.Image]);
        const digests = JSON.parse(text) as string[];
        assert(digests.length > 0 && digests.every((digest) => /@sha256:[a-f0-9]{64}$/.test(digest)));
        services.push({ name: container.Name, id: container.Id, image: container.Config.Image, digests,
          health: container.State, networks: container.NetworkSettings.Networks, ports: container.NetworkSettings.Ports });
      }
      manifest.services = services;
      manifest.network = { id: bridge.Id, driver: bridge.Driver, options: bridge.Options, ipv6: bridge.EnableIPv6 };
      const { text } = await cliCommand(["status", "--output", "json"], { capture: true });
      const status = JSON.parse(text) as Record<string, string>;
      for (const [key, value] of Object.entries(status)) {
        if (/KEY|SECRET|DB_URL/.test(key) && typeof value === "string" && value.length > 0) {
          secrets.add(value);
          const escaped = value.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");
          console.log(`::add-mask::${escaped}`);
        }
      }
      const local = requireLocalStatus(status);
      for (const path of ["/auth/v1/health", "/rest/v1/", "/storage/v1/status",
        "/rest-admin/v1/ready", "/functions/v1/_internal/health"]) {
        const response = await fetch(`${status.API_URL}${path}`, {
          method: path.includes("/_internal/") || path.includes("/rest-admin/") ? "HEAD" : "GET",
          headers: { apikey: status.SERVICE_ROLE_KEY!, authorization: ["Bearer", status.SERVICE_ROLE_KEY!].join(" ") },
          redirect: "error", signal: AbortSignal.timeout(Math.min(10_000, Math.max(1, deadline - Date.now()))),
        });
        await response.body?.cancel();
        assert(response.ok, "Local API health failure");
      }
      const db = containers.find((c) => c.Name === `/supabase_db_${project}`)!;
      await docker(["exec", db.Id, "pg_isready", "-h", "127.0.0.1", "-p", "5432", "-U", "postgres", "-d", "postgres"]);
      return { ...local, dbId: db.Id };
    });
    await stage("unchanged migrations", async () => {
      requireUnchanged();
      await command("pnpm", ["--filter", "@hta/db", "db:migrate"], { env: target.dbEnv, timeout: 180_000 });
      requireUnchanged();
    });
    await stage("global catalog and migration consistency", async () => {
      await command("pnpm", ["--filter", "@hta/db", "db:seed"], { env: target.dbEnv, timeout: 120_000 });
      await command("pnpm", ["--filter", "@hta/db", "db:check"], { env: target.dbEnv, timeout: 60_000 });
      const { text } = await docker(["exec", target.dbId, "psql", "-XAt", "-U", "postgres", "-d", "postgres",
        "-v", "ON_ERROR_STOP=1", "-c",
        "SELECT COALESCE(json_agg(slug ORDER BY slug), '[]') FROM public.movements WHERE user_id IS NULL;"]);
      const slugs = JSON.parse(text) as string[];
      assert(slugs.includes("swim-easy") && slugs.includes("swim-intervals"));
      for (const movement of SEED_MOVEMENTS) assert(slugs.filter((slug) => slug === movement.slug).length === 1);
      assert(new Set(slugs).size === slugs.length);
      manifest.catalog = { seedCount: SEED_MOVEMENTS.length, globalCount: slugs.length, slugsSha256: hash(text) };
      requireUnchanged();
    });
    await stage("complete authenticated RPC file and positive ledger", async () => {
      const reportPath = join(directory, "rpc.json");
      assert(!existsSync(reportPath));
      const rpcStarted = Date.now();
      const { result } = await command("pnpm", ["exec", "vitest", "run", "--config", "vitest.config.ts",
        "src/lib/swim/__tests__/storage-rpc.smoke.test.ts", "--passWithNoTests=false",
        "--fileParallelism=false", "--sequence.concurrent=false", "--retry=0",
        "--reporter=verbose", "--reporter=json", `--outputFile=${reportPath}`], {
        cwd: web, env: target.rpcEnv, timeout: LIMITS.rpc, allowFailure: true,
        diagnose: async () => {
          await command("docker", ["exec", target.dbId, "psql", "-X", "-U", "postgres", "-d", "postgres",
            "-v", "ON_ERROR_STOP=1", "-c",
            "BEGIN READ ONLY; SET LOCAL statement_timeout = '5s'; SELECT pid,state,wait_event_type,wait_event,pg_blocking_pids(pid) FROM pg_stat_activity WHERE datname=current_database(); SELECT pid,locktype,mode,granted FROM pg_locks WHERE pid IN (SELECT pid FROM pg_stat_activity WHERE datname=current_database()); ROLLBACK;"],
          { timeout: 10_000 });
          manifest.rpcDiagnostic = "bounded read-only activity/locks captured privately before cancellation";
        },
      });
      manifest.rpcProcess = result;
      requireUnchanged();
      const info = lstatSync(reportPath);
      requireFreshReport({ size: info.size, mtimeMs: info.mtimeMs, isFile: info.isFile() }, rpcStarted, Date.now());
      chmodSync(reportPath, 0o600);
      const ledger = readSwimRpcReport(reportPath, state.sha, manifest.configSha256 as string);
      manifest.ledger = ledger;
      requireAcceptance(result, ledger, state.sha, manifest.configSha256 as string);
    });
  } catch (error) {
    if (!reporting.failures.primary) reporting.recordFailure("acceptance", error);
  } finally {
    if (!cleanupOnly && sourceFiles.length > 0) {
      try { requireUnchanged(); } catch (error) {
        reporting.recordFailure("source verification", error);
      }
    }
    try { await cleanup(); } catch (error) {
      state.cleanup = "unconfirmed";
      reporting.recordFailure("cleanup", error, true);
    }
    process.off("SIGINT", cancel);
    process.off("SIGTERM", cancel);
    const primary = reporting.failures.primary?.stage;
    if (primary || state.cleanup !== "verified") process.exitCode = 1;
    try {
      summary(cleanupOnly ? "Swim cleanup verification" : "Swim acceptance result", {
        ...outcome(primary, state.cleanup === "verified"), stages: reporting.stages,
        failures: reporting.failures, manifest,
      });
    } catch (error) {
      reporting.recordFailure("summary publication", error);
      console.error(formatAcceptanceSummary({ failures: reporting.failures, cleanup: state.cleanup }, secrets));
      process.exitCode = 1;
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length === 1 && args[0] !== "--cleanup")) {
    console.error("Unsupported swim acceptance arguments");
    process.exitCode = 1;
  } else {
    void main(args[0] === "--cleanup").catch((error) => {
      console.error(formatAcceptanceSummary({
        failure: safeFailureCause(error),
        cleanup: "unconfirmed if resources were created",
      }));
      process.exitCode = 1;
    });
  }
}
