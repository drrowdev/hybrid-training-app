/**
 * Multi-user RLS verification — Phase 0 definition-of-done item.
 *
 * Proves user A cannot read user B's data. Uses the service-role key to
 * provision two temp users + their data, then uses anon clients
 * authenticated as each user to verify isolation.
 *
 * Run with:
 *   pnpm -F @hta/db node integration-tests/rls.mjs
 *
 * The script is idempotent — it cleans up its temp users at the end (and
 * also at the start, in case a previous run crashed).
 */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { strict as assert } from "node:assert";

config({ path: "../../apps/web/.env.local" });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !anonKey || !serviceKey) {
  console.error("Missing env: NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const EMAIL_A = `rls-test-a-${Date.now()}@example.test`;
const EMAIL_B = `rls-test-b-${Date.now()}@example.test`;
const PASS = "Pass-w0rd-for-test-only";

async function cleanup() {
  const { data } = await admin.auth.admin.listUsers({ perPage: 200 });
  for (const u of data.users) {
    if (u.email?.startsWith("rls-test-")) {
      await admin.auth.admin.deleteUser(u.id);
    }
  }
}

async function provision(email) {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: PASS,
    email_confirm: true,
  });
  if (error) throw error;
  return data.user;
}

async function asUser(email) {
  const c = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await c.auth.signInWithPassword({ email, password: PASS });
  if (error) throw error;
  return c;
}

let passed = 0;
let failed = 0;
function test(name, fn) {
  return fn().then(
    () => { passed++; console.log(`  PASS  ${name}`); },
    (e) => { failed++; console.error(`  FAIL  ${name}\n        ${e.message ?? e}`); },
  );
}

console.log("RLS multi-user verification\n");
await cleanup();

const userA = await provision(EMAIL_A);
const userB = await provision(EMAIL_B);
const clientA = await asUser(EMAIL_A);
const clientB = await asUser(EMAIL_B);

console.log(`  user A: ${userA.id}`);
console.log(`  user B: ${userB.id}\n`);

console.log("profiles");
await test("trigger auto-created profile for A", async () => {
  const { data } = await clientA.from("profiles").select("id").eq("id", userA.id).maybeSingle();
  assert.equal(data?.id, userA.id);
});

await test("A cannot SELECT B's profile (RLS isolates)", async () => {
  const { data } = await clientA.from("profiles").select("id").eq("id", userB.id);
  assert.deepEqual(data, [], "A saw B's profile row");
});

await test("A cannot UPDATE B's profile", async () => {
  const { data, error } = await clientA.from("profiles").update({ display_name: "pwned" }).eq("id", userB.id).select();
  assert.equal(error, null, "update raised unexpectedly");
  assert.deepEqual(data, [], "A's update touched B's row");
});

console.log("\nlimitations");
await test("A can insert their own limitation", async () => {
  const { error } = await clientA.from("limitations").insert({
    user_id: userA.id, region: "knee", severity: "mild",
  });
  assert.equal(error, null, `insert failed: ${error?.message}`);
});

await test("A cannot insert a limitation for B (RLS blocks)", async () => {
  const { error } = await clientA.from("limitations").insert({
    user_id: userB.id, region: "shoulder_scapular", severity: "severe",
  });
  assert.notEqual(error, null, "RLS should have blocked the insert");
});

await test("B sees zero limitations (none of their own, A's isolated)", async () => {
  const { data } = await clientB.from("limitations").select("id");
  assert.deepEqual(data, []);
});

await test("A sees exactly their own limitation", async () => {
  const { data } = await clientA.from("limitations").select("region");
  assert.equal(data.length, 1);
  assert.equal(data[0].region, "knee");
});

console.log("\nmovements");
await test("anon can read global seeds (empty in Phase 0, query succeeds)", async () => {
  const anon = createClient(url, anonKey);
  const { error } = await anon.from("movements").select("id").is("user_id", null);
  assert.equal(error, null);
});

await test("A can insert their own custom movement", async () => {
  const { error } = await clientA.from("movements").insert({
    user_id: userA.id,
    slug: "custom-test-squat",
    display_name: "My Squat",
    pattern: "squat",
    primary_region: "knee",
  });
  assert.equal(error, null, `insert failed: ${error?.message}`);
});

await test("B cannot see A's custom movement", async () => {
  const { data } = await clientB.from("movements").select("id, slug").eq("slug", "custom-test-squat");
  assert.deepEqual(data, [], "B saw A's custom movement");
});

console.log("\naccount deletion (DC-V1 + plan §4.4 GDPR Article 17)");
await test("admin deletes user A, FK cascades remove profile + limitation + movement", async () => {
  const { error } = await admin.auth.admin.deleteUser(userA.id);
  assert.equal(error, null);
  const { data: profA } = await admin.from("profiles").select("id").eq("id", userA.id);
  assert.equal((profA ?? []).length, 0, "profile not cascaded");
  const { data: limA } = await admin.from("limitations").select("id").eq("user_id", userA.id);
  assert.equal((limA ?? []).length, 0, "limitation not cascaded");
  const { data: movA } = await admin.from("movements").select("id").eq("user_id", userA.id);
  assert.equal((movA ?? []).length, 0, "movement not cascaded");
});

console.log("\nsessions + set_logs + cardio_logs (logged work, scoped via parent session)");

// Pick a global movement we can reuse across test rows.
const { data: pickMov, error: pickErr } = await admin
  .from("movements")
  .select("id, user_id")
  .limit(5);
if (pickErr) {
  console.error("FAIL: movement query errored:", pickErr.message);
  process.exit(4);
}
const movementId = pickMov?.find((m) => m.user_id === null)?.id ?? pickMov?.[0]?.id;
if (!movementId) {
  console.error(`FAIL: no movements at all. Got: ${JSON.stringify(pickMov)}`);
  process.exit(4);
}

// Re-provision B (A was just deleted above) and add a fresh user A for the next batch.
const userA2 = await provision(`rls-test-a2-${Date.now()}@example.test`);
const clientA2 = await asUser(userA2.email);

let sessionAId = null;
await test("A can create a session", async () => {
  const { data, error } = await clientA2.from("sessions").insert({
    user_id: userA2.id, title: "RLS test session",
  }).select("id").single();
  assert.equal(error, null, `insert failed: ${error?.message}`);
  sessionAId = data.id;
});

await test("B cannot see A's session", async () => {
  const { data } = await clientB.from("sessions").select("id").eq("id", sessionAId);
  assert.equal((data ?? []).length, 0, "B saw A's session");
});

await test("B cannot insert a session as A (RLS WITH CHECK blocks)", async () => {
  const { error } = await clientB.from("sessions").insert({
    user_id: userA2.id, title: "hijack",
  });
  assert.notEqual(error, null, "RLS should have blocked");
});

await test("A can add a set to their own session", async () => {
  const { error } = await clientA2.from("set_logs").insert({
    session_id: sessionAId, movement_id: movementId, set_index: 0,
    set_kind: "main", weight_kg: 100, reps: 5,
  });
  assert.equal(error, null, `set insert failed: ${error?.message}`);
});

await test("B cannot add a set to A's session (scoped via parent)", async () => {
  const { error } = await clientB.from("set_logs").insert({
    session_id: sessionAId, movement_id: movementId, set_index: 99,
    set_kind: "main", weight_kg: 999, reps: 1,
  });
  assert.notEqual(error, null, "RLS should have blocked the set insert");
});

await test("B sees zero sets (A's are isolated through the session RLS chain)", async () => {
  const { data } = await clientB.from("set_logs").select("id");
  assert.equal((data ?? []).length, 0);
});

await test("A can add a cardio block to their own session", async () => {
  const { error } = await clientA2.from("cardio_logs").insert({
    session_id: sessionAId, modality: "cycling", duration_sec: 1800,
  });
  assert.equal(error, null, `cardio insert failed: ${error?.message}`);
});

await test("B cannot add cardio to A's session", async () => {
  const { error } = await clientB.from("cardio_logs").insert({
    session_id: sessionAId, modality: "cycling", duration_sec: 1800,
  });
  assert.notEqual(error, null, "RLS should have blocked the cardio insert");
});

await test("B sees zero cardio blocks", async () => {
  const { data } = await clientB.from("cardio_logs").select("id");
  assert.equal((data ?? []).length, 0);
});

console.log("\nwellness");

await test("A can log their own bodyweight", async () => {
  const today = new Date().toISOString().slice(0, 10);
  const { error } = await clientA2.from("wellness").upsert({
    user_id: userA2.id, date: today, bodyweight_kg: 80.5,
  }, { onConflict: "user_id,date" });
  assert.equal(error, null, `wellness insert failed: ${error?.message}`);
});

await test("B cannot read A's bodyweight history", async () => {
  const { data } = await clientB.from("wellness").select("bodyweight_kg").eq("user_id", userA2.id);
  assert.equal((data ?? []).length, 0);
});

await test("B cannot upsert wellness as A", async () => {
  const today = new Date().toISOString().slice(0, 10);
  const { error } = await clientB.from("wellness").upsert({
    user_id: userA2.id, date: today, bodyweight_kg: 200,
  }, { onConflict: "user_id,date" });
  assert.notEqual(error, null, "RLS should have blocked");
});

console.log("\nregion_state (read after engine recompute would write)");

// Insert a stub region_state row as A to simulate a recompute.
await test("A can upsert their own region_state row", async () => {
  const { error } = await clientA2.from("region_state").upsert({
    user_id: userA2.id, region: "knee", atl: 50, ctl: 60, baseline_tolerance: 60,
  }, { onConflict: "user_id,region" });
  assert.equal(error, null, `region_state upsert failed: ${error?.message}`);
});

await test("B cannot see A's region_state", async () => {
  const { data } = await clientB.from("region_state").select("region").eq("user_id", userA2.id);
  assert.equal((data ?? []).length, 0, "B saw A's region_state");
});

await test("B cannot insert region_state as A", async () => {
  const { error } = await clientB.from("region_state").upsert({
    user_id: userA2.id, region: "knee", atl: 0, ctl: 0, baseline_tolerance: 0,
  }, { onConflict: "user_id,region" });
  assert.notEqual(error, null, "RLS should have blocked");
});

console.log("\nmcp_tool_calls + mcp_authorizations (ADR 0003)");

// Service-role insert as A so we have rows to assert isolation against.
await test("admin can insert an mcp_tool_calls row for A", async () => {
  const { error } = await admin.from("mcp_tool_calls").insert({
    user_id: userA2.id,
    tool_name: "getProfile",
    latency_ms: 12,
    result_size_bytes: 200,
    error_code: null,
  });
  assert.equal(error, null, `mcp_tool_calls insert failed: ${error?.message}`);
});

await test("A sees their own mcp_tool_calls row", async () => {
  const { data } = await clientA2.from("mcp_tool_calls").select("tool_name");
  assert.equal((data ?? []).length, 1);
  assert.equal(data[0].tool_name, "getProfile");
});

await test("B cannot see A's mcp_tool_calls (RLS isolates)", async () => {
  const { data } = await clientB.from("mcp_tool_calls").select("id").eq("user_id", userA2.id);
  assert.equal((data ?? []).length, 0, "B saw A's mcp_tool_calls");
});

await test("authenticated cannot INSERT mcp_tool_calls (writes are server-only)", async () => {
  const { error } = await clientA2.from("mcp_tool_calls").insert({
    user_id: userA2.id,
    tool_name: "getProfile",
    latency_ms: 1,
    result_size_bytes: 1,
    error_code: null,
  });
  assert.notEqual(error, null, "authenticated INSERT should have been blocked");
});

await test("admin can insert an mcp_authorizations row for A", async () => {
  const { error } = await admin.from("mcp_authorizations").insert({
    user_id: userA2.id,
    client_id: "claude-web",
    event: "authorize",
    scope: "tools:read",
  });
  assert.equal(error, null, `mcp_authorizations insert failed: ${error?.message}`);
});

await test("B cannot see A's mcp_authorizations", async () => {
  const { data } = await clientB.from("mcp_authorizations").select("id").eq("user_id", userA2.id);
  assert.equal((data ?? []).length, 0, "B saw A's mcp_authorizations");
});

console.log("\nfull-cascade verification (delete userA2 → everything goes)");

await test("deleting userA2 cascades through sessions / sets / cardio / wellness / region_state", async () => {
  const { error } = await admin.auth.admin.deleteUser(userA2.id);
  assert.equal(error, null);

  // Use the admin client because RLS is now meaningless (user gone).
  const tables = [
    "sessions", "set_logs", "cardio_logs", "wellness", "region_state", "limitations",
  ];
  for (const t of tables) {
    const col = t === "set_logs" || t === "cardio_logs" ? "session_id" : "user_id";
    let q = admin.from(t).select("id, " + col);
    if (col === "user_id") q = q.eq("user_id", userA2.id);
    else q = q.eq("session_id", sessionAId);
    const { data } = await q;
    assert.equal((data ?? []).length, 0, `${t} not cascaded`);
  }
});

await cleanup();
console.log(`\nResults: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
