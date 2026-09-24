import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { appendFileSync, lstatSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { ACCOUNT_FLOW, ACCOUNT_FLOW_ORIGIN, ACCOUNT_FLOW_SUPABASE, AccountFlowRefusal,
  accountFlowContext, checkAccountFlowDispatch, accountIdentity, accountSlots, verifyAccountIdentity,
  accountAdminRequestAllowed, accountAbsenceQuery, priorAccountRun, cleanupAccountFixtures, demand, type AccountIdentity,
} from "../../../packages/db/scripts/swim-account-flow-guards";
import { verifyRefreshCheckout, verifyRefreshSource } from "../../../packages/db/scripts/refresh-swim-review";
import { inspectUpgradeSnapshot, upgradeSnapshotTransport } from "../../../packages/db/scripts/upgrade-swim-review";
import { storageAdapter } from "../../../packages/db/scripts/configure-swim-review";
import { connectReviewDatabase } from "../../../packages/db/scripts/upgrade-swim-review-storage";
import { inspectUntimedLedger, untimedReviewMigrations } from "../../../packages/db/scripts/untimed-swim-review-storage";
import { REVIEW } from "../../../packages/db/scripts/swim-review-config-plan";
import { nativeAccountFlow, type NativeReport } from "./swim-account-flow-browser";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const web = resolve(root, "apps/web");
const next = createRequire(import.meta.url).resolve("next/dist/bin/next");
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));
const baseEnvironment = (env: NodeJS.ProcessEnv) => Object.fromEntries(
  ["PATH", "HOME", "TMPDIR", "TEMP", "TMP", "SystemRoot"].flatMap((key) => env[key] ? [[key, env[key]]] : []),
);
function webEnvironment(env: NodeJS.ProcessEnv, server: boolean): NodeJS.ProcessEnv {
  return {
    ...baseEnvironment(env), NODE_ENV: "production", CI: "true", NEXT_TELEMETRY_DISABLED: "1",
    NEXT_PUBLIC_SUPABASE_URL: ACCOUNT_FLOW_SUPABASE,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: env.SWIM_REVIEW_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_SITE_URL: ACCOUNT_FLOW_ORIGIN,
    ...(server ? { SUPABASE_SERVICE_ROLE_KEY: env.SWIM_REVIEW_SUPABASE_SERVICE_ROLE_KEY } : {}),
    POOL_SWIMMING_ENABLED: "true", SWIM_POOL_EDITING_ENABLED: "true", SWIM_PRIVATE_COURSE_ENABLED: "true",
    SWIM_IMPORT_ENABLED: "true", SWIM_IMPORT_MATCHING_ENABLED: "true",
    ENABLE_E2E_FIXTURES: "0",
  };
}
async function stop(child: ChildProcess | undefined) {
  if (!child || !child.pid || child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  for (let attempt = 0; attempt < 50 && child.exitCode === null && child.signalCode === null; attempt++) await sleep(100);
  if (child.exitCode === null && child.signalCode === null) {
    child.kill("SIGKILL");
    for (let attempt = 0; attempt < 50 && child.exitCode === null && child.signalCode === null; attempt++) await sleep(100);
  }
  demand(child.exitCode !== null || child.signalCode !== null, "process_close");
}
function source(env: NodeJS.ProcessEnv, deadline: number, cleanup: boolean) {
  accountFlowContext(env, cleanup);
  const io = {
    git: (...args: string[]) => {
      demand(Date.now() < deadline, "deadline");
      return execFileSync("git", args, { cwd: root, encoding: "utf8", timeout: 15_000, maxBuffer: 2 * 1024 * 1024,
        stdio: ["ignore", "pipe", "ignore"] }).trim();
    },
    event: () => {
      const path = env.GITHUB_EVENT_PATH;
      demand(path && lstatSync(path).isFile() && !lstatSync(path).isSymbolicLink() &&
        lstatSync(path).size <= 2 * 1024 * 1024, "event");
      const event = z.object({ inputs: z.record(z.unknown()) }).passthrough().parse(JSON.parse(readFileSync(path, "utf8")));
      demand(checkAccountFlowDispatch(event.inputs, env), "event");
      return event;
    },
    regular: (path: string) => path.split("/").every((_, index, parts) => {
      const entry = lstatSync(resolve(root, ...parts.slice(0, index + 1)));
      return !entry.isSymbolicLink() && (index === parts.length - 1 ? entry.isFile() : entry.isDirectory());
    }),
  };
  // Cleanup retains immutable source/context checks, but must survive a moved live ref.
  if (cleanup) verifyRefreshCheckout(env, io, ACCOUNT_FLOW);
  else verifyRefreshSource(env, io, ACCOUNT_FLOW);
}
export async function runAccountFlow(env: NodeJS.ProcessEnv, mode: "source" | "run" | "cleanup") {
  const deadline = Date.now() + (mode === "cleanup" ? 4 : 18) * 60_000;
  const result = {
    scope: "swim-account-flow", testedSha: /^[a-f0-9]{40}$/.test(env.EXPECTED_SHA ?? "") ? env.EXPECTED_SHA : null,
    project: REVIEW.supabaseId, run: /^\d{8,16}$/.test(env.GITHUB_RUN_ID ?? "") ? env.GITHUB_RUN_ID : null,
    acceptedApplicationSha: ACCOUNT_FLOW.reference.sha, acceptedApplicationRun: ACCOUNT_FLOW.reference.run,
    mode, status: "failed", stages: [] as { stage: string; status: "passed" | "failed"; code: string }[],
    accountsAttempted: 0, accountsCreated: 0, accountsRemoved: 0, accountsAbsent: 0, accountCleanupFailures: 0, adminRequests: 0,
    priorAccountsAbsent: 0, priorCleanupPassed: false,
    databaseClosed: false, serverClosed: false, buildClosed: false, cleanupPassed: false,
    native: { checks: [], browserClosed: false, browserRequests: 0, clientRequests: 0,
      importPhase: null, importAccount: null } as NativeReport,
  };
  let stage = "source", server: ChildProcess | undefined, build: ChildProcess | undefined;
  let sql: ReturnType<typeof connectReviewDatabase> | undefined;
  let identities: AccountIdentity[] = [], credentialsChecked = false;
  const created = new Set<string>(), deleted = new Set<string>();
  const step = async (name: string, action: () => Promise<void> | void) => {
    stage = name; demand(Date.now() < deadline, "deadline"); await action();
    demand(Date.now() < deadline, "deadline");
    result.stages.push({ stage: name, status: "passed", code: "passed" });
  };
  async function admin(path: string, method: string, body: unknown, cleanup: boolean,
    allocated: readonly AccountIdentity[] = identities) {
    const url = ACCOUNT_FLOW_SUPABASE + path;
    const requestDeadline = cleanup ? deadline + 60_000 : deadline;
    demand(credentialsChecked && Date.now() < requestDeadline && ++result.adminRequests <= 70 &&
      (allocated === identities || method === "GET") &&
      accountAdminRequestAllowed(url, method, body, allocated, cleanup), "admin_transport");
    if (method === "POST") {
      const id = z.object({ id: z.string() }).parse(body).id;
      demand(!created.has(id), "duplicate_create"); created.add(id);
    }
    if (method === "DELETE") {
      demand(!deleted.has(path), "duplicate_delete"); deleted.add(path);
    }
    const response = await fetch(url, {
      method, redirect: "error", signal: AbortSignal.timeout(Math.min(15_000, requestDeadline - Date.now())),
      headers: {
        apikey: env.SWIM_REVIEW_SUPABASE_SERVICE_ROLE_KEY!,
        Authorization: `Bearer ${env.SWIM_REVIEW_SUPABASE_SERVICE_ROLE_KEY!}`,
        "Content-Type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const chunks: Uint8Array[] = [];
    const reader = response.body?.getReader();
    let bytes = 0;
    if (reader) {
      try {
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          bytes += part.value.byteLength;
          if (bytes > 64 * 1024) { await reader.cancel(); throw new AccountFlowRefusal("admin_response"); }
          chunks.push(part.value);
        }
      } finally { reader.releaseLock(); }
    }
    const text = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
    const value: unknown = text ? JSON.parse(text) : null;
    return { status: response.status, value };
  }
  async function rowsAbsent(identity: AccountIdentity) {
    demand(Date.now() < deadline + 60_000 && sql === undefined, "cleanup_context");
    const query = accountAbsenceQuery(identity);
    sql = connectReviewDatabase(env.SWIM_REVIEW_DATABASE_URL);
    result.databaseClosed = false;
    try {
      return await sql.begin(async (tx) => {
        await tx.unsafe("SET TRANSACTION READ ONLY");
        await tx.unsafe("SET LOCAL statement_timeout='10s'");
        const rows = await tx.unsafe(query.query, query.parameters);
        demand(rows.length === 1 && typeof rows[0]!.empty === "boolean", "cleanup_rows");
        return rows[0]!.empty === true;
      });
    } finally {
      await sql.end({ timeout: 5 }); result.databaseClosed = true; sql = undefined;
    }
  }
  async function cleanup() {
    demand(credentialsChecked && identities.length === 2, "cleanup_context");
    const cleaned = await cleanupAccountFixtures(identities, (path, method) => admin(path, method, undefined, true), rowsAbsent);
    result.accountsRemoved = cleaned.removed; result.accountsAbsent = cleaned.absent;
    result.accountCleanupFailures = cleaned.failed;
    demand(cleaned.failed === 0 && cleaned.absent === 2, "cleanup_count");
    result.cleanupPassed = true;
  }
  try {
    await step("source", () => source(env, deadline, mode === "cleanup"));
    if (mode === "source") { result.status = "source_pass"; return result; }
    const context = accountFlowContext(env, mode === "cleanup");
    identities = accountSlots.map((slot) => accountIdentity(context.run, context.sha, slot));
    await step("credentials", () => {
      demand(/^sb_publishable_[A-Za-z0-9_-]{20,256}$/.test(env.SWIM_REVIEW_SUPABASE_ANON_KEY ?? "") &&
        /^sb_secret_[A-Za-z0-9_-]{20,256}$/.test(env.SWIM_REVIEW_SUPABASE_SERVICE_ROLE_KEY ?? ""), "credentials");
      credentialsChecked = true;
    });
    if (mode === "cleanup") { await step("cleanup", cleanup); result.status = "cleanup_pass"; return result; }
    await step("prior_cleanup", async () => {
      const prior = accountSlots.map((slot) => accountIdentity(priorAccountRun.run, priorAccountRun.sha, slot));
      for (const identity of prior) {
        const response = await admin(`/auth/v1/admin/users/${identity.id}`, "GET", undefined, true, prior);
        demand(response.status === 404 && await rowsAbsent(identity), "prior_cleanup");
        result.priorAccountsAbsent++;
      }
      result.priorCleanupPassed = true;
    });
    const request = upgradeSnapshotTransport(env, deadline, fetch, ACCOUNT_FLOW);
    const snapshot = () => inspectUpgradeSnapshot(request, storageAdapter(env, request), ACCOUNT_FLOW);
    let expected: Awaited<ReturnType<typeof snapshot>>;
    await step("snapshot", async () => { expected = await snapshot(); ACCOUNT_FLOW.receipt(expected.project, expected.shared); });
    const guard = async () => {
      source(env, deadline, false);
      demand(same(await snapshot(), expected), "snapshot_changed");
      demand(!server || (server.pid && server.exitCode === null && server.signalCode === null), "server_stopped");
    };
    await step("ledger", async () => {
      sql = connectReviewDatabase(env.SWIM_REVIEW_DATABASE_URL);
      result.databaseClosed = false;
      await inspectUntimedLedger(sql, untimedReviewMigrations(), 155);
      await sql.end({ timeout: 5 }); result.databaseClosed = true; sql = undefined;
    });
    await step("build", async () => {
      await guard();
      build = spawn(process.execPath, [next, "build", "--webpack"], { cwd: web, env: webEnvironment(env, false), stdio: "ignore" });
      let spawnFailed = false; build.on("error", () => { spawnFailed = true; });
      const buildDeadline = Math.min(deadline, Date.now() + 5 * 60_000);
      while (!spawnFailed && build.exitCode === null && build.signalCode === null && Date.now() < buildDeadline) await sleep(250);
      demand(!spawnFailed && build.exitCode === 0, "build_failed");
      result.buildClosed = true;
    });
    await step("server", async () => {
      server = spawn(process.execPath, [next, "start", "--hostname", "127.0.0.1", "--port", "4229"], {
        cwd: web, env: webEnvironment(env, true), stdio: ["ignore", "pipe", "ignore"],
      });
      let spawnFailed = false, listening = false, outputBytes = 0, output = "";
      server.on("error", () => { spawnFailed = true; });
      const stdout = server.stdout!;
      const readyMessage = (chunk: Buffer) => {
        outputBytes += chunk.byteLength;
        if (outputBytes > 16_384) spawnFailed = true;
        output = (output + chunk.toString("utf8")).slice(-512);
        if (/Ready in \d+(?:\.\d+)?(?:ms|s)/.test(output)) listening = true;
        if (listening || spawnFailed) { output = ""; stdout.off("data", readyMessage); }
      };
      stdout.on("data", readyMessage);
      const readyDeadline = Math.min(deadline, Date.now() + 60_000);
      let ready = false;
      while (!spawnFailed && server.exitCode === null && server.signalCode === null && Date.now() < readyDeadline) {
        if (listening) {
          try {
            const response = await fetch(`${ACCOUNT_FLOW_ORIGIN}/login`, { redirect: "error", signal: AbortSignal.timeout(2000) });
            ready = response.status === 200; await response.body?.cancel();
          } catch { /* Startup connection refusal is bounded by readyDeadline. */ }
        }
        if (ready) break;
        await sleep(500);
      }
      stdout.off("data", readyMessage); output = ""; stdout.resume();
      demand(ready && listening && !spawnFailed && server.exitCode === null && server.signalCode === null, "server_ready");
    });
    const accounts = identities.map((identity) => ({ identity, password: randomBytes(32).toString("base64url") }));
    await step("accounts", async () => {
      await guard();
      for (const { identity, password } of accounts) {
        const absent = await admin(`/auth/v1/admin/users/${identity.id}`, "GET", undefined, false);
        demand(absent.status === 404, "account_collision");
        result.accountsAttempted++;
        const created = await admin("/auth/v1/admin/users", "POST", {
          id: identity.id, email: identity.email, password, email_confirm: true,
          app_metadata: { hta_swim_account_flow: identity.marker },
        }, false);
        demand([200, 201].includes(created.status), "account_create");
        verifyAccountIdentity(created.value, identity);
        result.accountsCreated++;
        const profile = await admin(`/rest/v1/profiles?id=eq.${identity.id}`, "PATCH",
          { onboarded_at: new Date().toISOString() }, false);
        demand(profile.status === 204, "profile_setup");
      }
    });
    await step("browser", () => nativeAccountFlow([accounts[0]!, accounts[1]!],
      env.SWIM_REVIEW_SUPABASE_ANON_KEY!, result.native, guard));
    await step("completion", async () => {
      await guard();
      demand(result.accountsCreated === 2 && result.native.checks.length === 7 &&
        result.native.checks.every((check) => check.status === "passed") && result.native.browserClosed, "native_completion");
    });
    result.status = "account_flow_pass";
  } catch (error) {
    result.stages.push({ stage, status: "failed", code: error instanceof AccountFlowRefusal ? error.code : "refused" });
  } finally {
    if (mode === "run") {
      for (const [name, child] of [["server", server], ["build", build]] as const) {
        try { await stop(child); if (name === "server") result.serverClosed = true; else result.buildClosed = true; }
        catch { result.status = "failed"; result.stages.push({ stage: "close", status: "failed", code: `${name}_close` }); }
      }
      if (sql) {
        try { await sql.end({ timeout: 5 }); result.databaseClosed = true; sql = undefined; }
        catch { result.status = "failed"; result.stages.push({ stage: "close", status: "failed", code: "database_close" }); }
      }
      if (credentialsChecked && identities.length === 2) {
        try { await cleanup(); result.stages.push({ stage: "cleanup", status: "passed", code: "passed" }); }
        catch { result.status = "failed"; result.stages.push({ stage: "cleanup", status: "failed", code: "cleanup_failed" }); }
      }
    }
  }
  return result;
}
async function main() {
  const args = process.argv.slice(2);
  if (args.length > 1 || args.some((arg) => !["--check-source", "--cleanup"].includes(arg))) {
    console.log("SWIM_ACCOUNT_FLOW_REFUSED"); process.exitCode = 1; return;
  }
  const mode = args[0] === "--check-source" ? "source" : args[0] === "--cleanup" ? "cleanup" : "run";
  const result = await runAccountFlow(process.env, mode);
  const marker = mode === "source" ? "SWIM_ACCOUNT_FLOW_SOURCE" : mode === "cleanup" ? "SWIM_ACCOUNT_FLOW_CLEANUP" : "SWIM_ACCOUNT_FLOW_SUMMARY";
  const summary = () => `${marker}\n<pre>${JSON.stringify(result).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</pre>\n`;
  try { if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary()); }
  catch { result.status = "failed"; result.stages.push({ stage: "report", status: "failed", code: "report_failed" }); }
  console.log(summary());
  if (result.status === "failed") process.exitCode = 1;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) void main();
