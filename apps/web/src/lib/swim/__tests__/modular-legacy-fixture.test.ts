import { readFileSync } from "node:fs";
import * as fs from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { authoredProgramDates } from "@hta/domain";
import { authoredProgramSchema } from "../../programs/authored/schema";
import {
  createLegacyUpgradeProof, createModularLegacyPreparation, legacyProgramInput,
} from "../../../../scripts/modular-legacy-fixture";
import { modularLegacySchema, readModularLegacyFixture, legacyGraphSnapshot } from "../../../../e2e/fixtures/modular-legacy";
import * as guards from "../../../../scripts/swim-acceptance-guards";

vi.mock("node:fs", async (importOriginal) => ({ ...(await importOriginal<typeof import("node:fs")>()) }));

const id = "00000000-0000-4000-8000-000000000001";
const movement = { id, slug: "bench-press-flat", displayName: "Bench press", pattern: "horizontal_push" };
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

function mockedPreparation(failure?: "deploy" | "upgrade" | "delete" | "remaining") {
  const root = resolve(__dirname, "synthetic-native-run");
  const directory = resolve(root, "swim-acceptance-pr802-123-1");
  vi.stubGlobal("process", { ...process, platform: "linux", getuid: () => 1000 });
  vi.stubEnv("RUNNER_TEMP", root); vi.stubEnv("SXC_ACCEPTANCE_PROFILE", "modular");
  vi.stubEnv("GITHUB_REF", "refs/heads/drrowdev-modular-programs-implementation");
  vi.stubEnv("GITHUB_RUN_ATTEMPT", "1");
  vi.spyOn(guards, "requireManualContext").mockReturnValue("pr802-123-1");
  vi.spyOn(fs, "realpathSync").mockImplementation((path) => String(path));
  const stat = fs.lstatSync(__dirname);
  vi.spyOn(fs, "lstatSync").mockReturnValue(Object.assign(stat, { uid: 1000, mode: 0o40700 }));
  let file = false, deleted = false, changed = false;
  vi.spyOn(fs, "existsSync").mockImplementation(() => file);
  const write = vi.spyOn(fs, "writeFileSync").mockImplementation(() => { file = true; });
  const unlink = vi.spyOn(fs, "unlinkSync").mockImplementation(() => { file = false; });
  const id2 = "00000000-0000-4000-8000-000000000002";
  const calls: Array<{ path: string; method: string }> = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    const method = init?.method ?? "GET";
    calls.push({ path: url.pathname, method });
    const respond = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
      status, headers: { "Content-Type": "application/json" },
    });
    if (url.pathname === "/auth/v1/admin/users" && method === "POST") return respond({ id });
    if (url.pathname === "/auth/v1/token") return respond({
      access_token: "synthetic-access", refresh_token: "synthetic-refresh", token_type: "bearer", expires_in: 3600, user: { id },
    });
    if (url.pathname === `/auth/v1/admin/users/${id}`) {
      if (method === "DELETE") {
        if (failure === "delete") return respond({ code: "unexpected_failure", msg: "Synthetic cleanup failure" }, 500);
        deleted = true; return respond({});
      }
      return respond({ code: "user_not_found", msg: "User not found" }, 404);
    }
    if (url.pathname.endsWith("/deploy_program_instance_atomically")) {
      return failure === "deploy" ? respond({ message: "Synthetic deployment refusal", code: "22023" }, 400)
        : respond([{ block_id: id, program_instance_id: id }]);
    }
    if (url.pathname.endsWith("/start_planned_session_atomically")) return respond(id);
    if (url.pathname.endsWith("/insert_set_log_with_bw_progress")) return respond(id);
    if (url.pathname.endsWith("/complete_training_session_with_transition")) return respond([{ user_id: id, transitioned: true }]);
    if (url.pathname === "/rest/v1/profiles") return respond({ id });
    if (url.pathname === "/rest/v1/movements") return respond({ id, slug: movement.slug, display_name: movement.displayName, pattern: movement.pattern });
    if (["training_blocks", "program_instances", "planned_sessions", "sessions", "set_logs"].includes(url.pathname.split("/").at(-1)!)) {
      if (deleted && failure !== "remaining") return respond([]);
      const rows = url.pathname.endsWith("/planned_sessions") ? [{ id }, { id: id2 }] : [{ id }];
      return respond(changed && failure === "upgrade" ? rows.map((row) => ({ ...row, changed: true })) : rows);
    }
    throw new Error(`Unexpected synthetic fixture request: ${method} ${url.pathname}`);
  });
  const proof = createLegacyUpgradeProof(), secrets = new Set<string>();
  const preparation = createModularLegacyPreparation({
    target: { url: "http://127.0.0.1:54321", projectRef: "local", anonKey: "synthetic-anon", serviceRoleKey: "synthetic-service" },
    runDirectory: directory, proof, secrets,
  });
  return { preparation, proof, write, unlink, calls, secrets, change: () => { changed = true; } };
}

describe("DC-SW8 historical owner preparation stays within the disposable native boundary", () => {
  it.each([
    ["refs/heads/drrowdev-modular-programs-implementation", "modular"],
    ["refs/heads/drrowdev-modular-programs-implementation", "swimming"],
    ["refs/heads/drrowdev-programs-page-redesign", "modular"],
    ["refs/heads/drrowdev-programs-page-redesign", "swimming"],
    ["refs/heads/drrowdev-swimming-test-suite-repair", "modular"],
    ["refs/heads/drrowdev-swimming-test-suite-repair", "swimming"],
  ])("prepares once, preserves the exact graph and verifies cleanup on %s with %s cases", async (ref, profile) => {
    const { preparation, proof, write, unlink, calls, secrets } = mockedPreparation();
    vi.stubEnv("GITHUB_REF", ref); vi.stubEnv("SXC_ACCEPTANCE_PROFILE", profile);
    await preparation.prepare();
    expect(proof).toMatchObject({ prepared: true, unchanged: false, cleanup: "pending" });
    expect(write).toHaveBeenCalledWith(expect.stringContaining("modular-legacy.json"),
      expect.any(String), { flag: "wx", mode: 0o600 });
    expect(secrets.has("synthetic-access")).toBe(true); expect(secrets.has("synthetic-refresh")).toBe(true);
    await expect(preparation.prepare()).rejects.toThrow();
    await preparation.verifyUpgrade();
    expect(proof.beforeSha256).toBe(proof.afterSha256);
    expect(proof.unchanged).toBe(true);
    await preparation.cleanup();
    expect(proof.cleanup).toBe("verified"); expect(unlink).toHaveBeenCalledTimes(1);
    expect(calls.filter((call) => call.path === "/auth/v1/admin/users" && call.method === "POST")).toHaveLength(1);
    expect(calls.filter((call) => call.method === "DELETE")).toHaveLength(1);
    await expect(preparation.cleanup()).rejects.toThrow();
  });

  it.each([
    ["refs/heads/unreviewed", "swimming", "1"],
    ["refs/heads/unreviewed", "modular", "1"],
    ["refs/heads/drrowdev-programs-page-redesign-extra", "swimming", "1"],
    ["refs/heads/drrowdev-modular-programs-implementation", "swimming", "2"],
    ["refs/heads/drrowdev-programs-page-redesign", "modular", "2"],
    ["refs/heads/drrowdev-programs-page-redesign", "swimming", "2"],
    ["refs/heads/drrowdev-programs-page-redesign", "unknown", "1"],
    ["refs/heads/drrowdev-swimming-test-suite-repair-extra", "swimming", "1"],
    ["refs/heads/drrowdev-swimming-test-suite-repair-extra", "modular", "1"],
    ["refs/heads/drrowdev-swimming-test-suite-repair", "modular", "2"],
    ["refs/heads/drrowdev-swimming-test-suite-repair", "swimming", "2"],
    ["refs/heads/drrowdev-swimming-test-suite-repair", "unknown", "1"],
  ])("rejects unqualified legacy preparation before allocation: %s / %s / attempt %s", async (ref, profile, attempt) => {
    const { preparation, proof, calls, write } = mockedPreparation();
    vi.stubEnv("GITHUB_REF", ref); vi.stubEnv("SXC_ACCEPTANCE_PROFILE", profile);
    vi.stubEnv("GITHUB_RUN_ATTEMPT", attempt);
    await expect(preparation.prepare()).rejects.toThrow();
    expect(calls).toEqual([]);
    expect(write).not.toHaveBeenCalled();
    expect(proof).toEqual(createLegacyUpgradeProof());
  });

  it("cleans an allocated account after a failed historical deployment without publishing a handoff", async () => {
    const { preparation, proof, write, unlink } = mockedPreparation("deploy");
    await expect(preparation.prepare()).rejects.toThrow();
    expect(proof).toMatchObject({ prepared: false, unchanged: false, cleanup: "pending" });
    expect(write).not.toHaveBeenCalled();
    await preparation.cleanup();
    expect(proof.cleanup).toBe("verified"); expect(unlink).not.toHaveBeenCalled();
  });

  it.each(["upgrade", "delete", "remaining"] as const)("refuses %s failure without claiming successful qualification", async (failure) => {
    const { preparation, proof, unlink, change } = mockedPreparation(failure);
    await preparation.prepare();
    change();
    if (failure === "upgrade") {
      await expect(preparation.verifyUpgrade()).rejects.toThrow();
      expect(proof.unchanged).toBe(false);
      await preparation.cleanup();
      expect(proof.cleanup).toBe("verified");
    } else {
      await preparation.verifyUpgrade();
      await expect(preparation.cleanup()).rejects.toThrow();
      expect(proof.cleanup).toBe("pending"); expect(unlink).not.toHaveBeenCalled();
    }
  });

  it.each([21, 22, 23, 24, 25, 26, 27])("uses real authored compilation and calendar placement on September %i", (day) => {
    const today = `2026-09-${day}`;
    const input = legacyProgramInput(movement, today);
    const definition = authoredProgramSchema.parse(input.p_program_instance.instance);
    const dated = authoredProgramDates(definition, input.p_block.started_on);
    expect(input.p_block).not.toHaveProperty("program_kind");
    expect(input.p_block).toMatchObject({ program_id: "authored", days_per_week: 2 });
    expect(input.p_program_instance).toMatchObject({ program_id: "authored",
      setup_input: { definition, startedOn: input.p_block.started_on } });
    expect(input.p_planned_sessions).toHaveLength(2);
    expect(new Set(input.p_planned_sessions.map((row) => `${row.week_index}:${row.day_index}`)).size).toBe(2);
    expect(input.p_block.weeks).toBe(Math.max(...dated.map((row) => row.weekIndex)) + 1);
    for (const [index, row] of input.p_planned_sessions.entries()) {
      expect(Number.isFinite(row.effective_stress_load)).toBe(true);
      expect(row.session_modality).toBe("pure_hypertrophy");
      expect(row).toMatchObject({ week_index: dated[index]!.weekIndex, day_index: dated[index]!.dayIndex,
        prescription: { programRef: dated[index]!.ref, meta: { authoredWorkout: dated[index]!.workout },
          items: [{ movementId: id, movementName: movement.displayName, reps: 5, targetWeightKg: 20 }] } });
      expect(dated[index]!.date < today).toBe(true);
    }
  });

  it("rejects laptop execution and missing native fixture configuration before networking", async () => {
    vi.stubEnv("GITHUB_ACTIONS", "false");
    const network = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Unexpected network request"));
    const proof = createLegacyUpgradeProof();
    const preparation = createModularLegacyPreparation({
      target: { url: "http://127.0.0.1:54321", projectRef: "local", anonKey: "synthetic", serviceRoleKey: "synthetic" },
      runDirectory: resolve(__dirname), proof, secrets: new Set(),
    });
    await expect(preparation.prepare()).rejects.toThrow();
    await expect(preparation.cleanup()).resolves.toBeUndefined();
    expect(() => readModularLegacyFixture()).toThrow();
    expect(network).not.toHaveBeenCalled();
    expect(proof).toEqual(createLegacyUpgradeProof());
  });

  it("requires an exact run-bound graph and never accepts an empty legacy identifier", () => {
    const fixture = { version: 1, run: "swim-acceptance-pr802-123-1", email: `e2e+${id}@hta-e2e.com`,
      password: id, userId: id, blockId: id, instanceId: id,
      plannedIds: [id, "00000000-0000-4000-8000-000000000002"], sessionId: id, setId: id,
      beforeSha256: "a".repeat(64) };
    expect(modularLegacySchema.safeParse(fixture).success).toBe(true);
    for (const change of [{ run: "swim-acceptance-pr802-123-2" }, { userId: "" }, { sessionId: "" },
      { plannedIds: [] }, { plannedIds: [id, id] }, { beforeSha256: "" }, { serviceRoleKey: "forbidden" }]) {
      expect(modularLegacySchema.safeParse({ ...fixture, ...change }).success).toBe(false);
    }
  });

  it("fingerprints owner-filtered graph rows and session-owned sets without a service role read", async () => {
    const fetched: URL[] = [];
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      fetched.push(url);
      const table = url.pathname.split("/").at(-1);
      const count = table === "planned_sessions" ? 2 : 1;
      return new Response(JSON.stringify(Array.from({ length: count }, (_, index) => ({
        id: index === 0 ? id : "00000000-0000-4000-8000-000000000002",
      }))), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    const actor = createClient("http://127.0.0.1:54321", "synthetic-anon", {
      auth: { persistSession: false, autoRefreshToken: false }, global: { fetch },
    });
    const snapshot = await legacyGraphSnapshot(actor, id);
    expect(snapshot.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(fetched).toHaveLength(5);
    for (const url of fetched.slice(0, 4)) expect(url.searchParams.get("user_id")).toBe(`eq.${id}`);
    expect(fetched[4]!.pathname).toBe("/rest/v1/set_logs");
    expect(fetched[4]!.searchParams.get("session_id")).toBe(`eq.${id}`);
    expect(fetched[4]!.searchParams.has("user_id")).toBe(false);
  });

  it("does not insert user data with admin credentials or attach the legacy result to swimming", () => {
    const source = readFileSync(resolve(__dirname, "../../../../scripts/modular-legacy-fixture.ts"), "utf8");
    expect(source).not.toMatch(/admin\.from|\.insert\(|swim_workouts|swim_import/);
    for (const rpc of ["deploy_program_instance_atomically", "start_planned_session_atomically",
      "insert_set_log_with_bw_progress", "complete_training_session_with_transition"]) {
      expect(source).toContain(`actor.rpc("${rpc}"`);
    }
    expect(source).toContain('p_planned_id: plannedIds[0]');
    expect(source).toContain('proof.afterSha256 === proof.beforeSha256');
    expect(source).toContain('remaining.error?.status === 404');
  });
});
