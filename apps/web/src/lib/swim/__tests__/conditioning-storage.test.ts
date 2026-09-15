import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { conditioningStorageAvailable, exportSwimConditioning } from "../conditioning-storage";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const userId = id(9000);
const binding = (n: number) => ({
  user_id: userId, planned_session_id: null, swim_workout_id: id(n), block_id: null,
  metadata: { version: 1, workoutRevision: 1, plannedPrescription: {}, plannedSessionId: id(n + 1000), blockId: id(8000) },
  created_at: "2026-09-14T00:00:00Z",
});
let bindings: unknown[];
let ready: unknown;
let readyStatus: number;
let benchmarkReady: unknown;
let benchmarkReadyStatus: number;
let lifecycleReady: unknown;
let lifecycleStatus: number;
const reads: URL[] = [];
const client = createClient("https://conditioning.test", "synthetic-test-key", {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  global: { fetch: async (input) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    reads.push(url);
    if (url.pathname.endsWith("swim_conditioning_ready")) return Response.json(ready, { status: readyStatus });
    if (url.pathname.endsWith("swim_conditioning_benchmarks_ready")) return Response.json(benchmarkReady, { status: benchmarkReadyStatus });
    if (url.pathname.endsWith("swim_conditioning_lifecycle_ready")) return Response.json(lifecycleReady, { status: lifecycleStatus });
    const offset = Number(url.searchParams.get("offset"));
    return Response.json(url.pathname.endsWith("swim_conditioning_bindings") ? bindings.slice(offset, offset + 500) : [{
      user_id: userId, request_id: id(7000), block_id: null, program_instance_id: null, swim_plan_id: id(8001),
      metadata: { fingerprint: "a".repeat(64), skipped: 2 }, created_at: "2026-09-14T00:00:00Z",
    }]);
  } },
});
beforeEach(() => {
  bindings = [binding(1)]; ready = true; readyStatus = 200;
  benchmarkReady = true; benchmarkReadyStatus = 200; reads.length = 0;
  lifecycleReady = true; lifecycleStatus = 200;
});
afterEach(() => vi.unstubAllEnvs());

it("exports every retained owner binding and receipt even while new setup is disabled", async () => {
  vi.stubEnv("SWIM_CONDITIONING_ENABLED", "false");
  bindings = Array.from({ length: 501 }, (_, index) => binding(index + 1));
  expect(await conditioningStorageAvailable(client)).toBe(true);
  const exported = await exportSwimConditioning(client, userId);
  expect(exported.bindings).toHaveLength(501);
  expect(exported.saves[0]?.metadata.skipped).toBe(2);
  const pages = reads.filter((url) => !url.pathname.includes("/rpc/"));
  expect(pages).toHaveLength(3);
  expect(pages.every((url) => url.searchParams.get("user_id") === `eq.${userId}`)).toBe(true);
  expect(pages.every((url) => url.searchParams.get("order") && url.searchParams.get("limit") === "500")).toBe(true);
});

it("distinguishes absent storage from a broken availability check", async () => {
  ready = { code: "PGRST202", message: "Missing function" }; readyStatus = 404;
  expect(await conditioningStorageAvailable(client)).toBe(false);
  ready = { code: "42501", message: "Denied" }; readyStatus = 403;
  await expect(conditioningStorageAvailable(client)).rejects.toThrow();
});

it("requires benchmark support for new saves without blocking existing history", async () => {
  benchmarkReady = { code: "PGRST202", message: "Missing function" }; benchmarkReadyStatus = 404;
  expect(await conditioningStorageAvailable(client, true)).toBe(false);
  expect(await conditioningStorageAvailable(client)).toBe(true);
  benchmarkReady = true; benchmarkReadyStatus = 200;
  expect(await conditioningStorageAvailable(client, true)).toBe(true);
});

it.each([
  { ...binding(1), metadata: {} },
  { ...binding(1), user_id: id(9001) },
])("fails rather than returning malformed or foreign export data", async (row) => {
  bindings = [row];
  await expect(exportSwimConditioning(client, userId)).rejects.toThrow();
});

it("requires linked lifecycle for new saves without disabling retained reads", async () => {
  lifecycleReady = { code: "PGRST202", message: "Missing function" }; lifecycleStatus = 404;
  expect(await conditioningStorageAvailable(client, true)).toBe(false);
  expect(await conditioningStorageAvailable(client)).toBe(true);
});
