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

await cleanup();
console.log(`\nResults: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
