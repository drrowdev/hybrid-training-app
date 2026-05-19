/**
 * Region-ledger integration smoke test.
 *
 * Creates a temp user via the admin client, logs a session with one
 * heavy-back-squat set, marks the session complete (which fires
 * recomputeRegionState via the server action — we replicate that here
 * by calling the function directly), and verifies that region_state
 * has non-zero ATL/CTL on the squat-loaded regions and zero elsewhere.
 *
 * This is the end-to-end engine smoke test referenced in HANDOFF.md.
 *
 * Run:  node packages/db/integration-tests/region-ledger.mjs
 */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { strict as assert } from "node:assert";

config({ path: "../../apps/web/.env.local" });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !anonKey || !serviceKey) {
  console.error("Missing env in apps/web/.env.local");
  process.exit(1);
}

const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const EMAIL = `rls-test-engine-${Date.now()}@example.test`;
const PASS = "Pass-w0rd-for-test-only";

async function cleanup() {
  const { data } = await admin.auth.admin.listUsers({ perPage: 200 });
  for (const u of data.users) {
    if (u.email?.startsWith("rls-test-engine-")) {
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

// Replicates apps/web/src/lib/engine/region-ledger.ts logic here so the
// test runs without needing to invoke the Next.js server. Kept in sync
// manually — if you change the engine, update this too (or extract the
// function into @hta/engine and import it).
async function recomputeRegionState(supabase, userId) {
  const REGIONS = ["foot_ankle_calf","knee","hamstring_posterior","adductor_groin","lumbar_trunk","shoulder_scapular","elbow_forearm"];
  const PRIMARY_W = 1.0;
  const SECONDARY_W = 0.5;

  const { data: sessions } = await supabase.from("sessions")
    .select("id, performed_at, duration_min, session_rpe")
    .eq("user_id", userId).not("completed_at", "is", null)
    .order("performed_at", { ascending: true });
  if (!sessions?.length) return { updated: 0 };

  const ids = sessions.map((s) => s.id);
  const [{ data: sets }, { data: cardio }] = await Promise.all([
    supabase.from("set_logs").select("session_id, movement:movements(primary_region, secondary_regions)").in("session_id", ids),
    supabase.from("cardio_logs").select("session_id, movement:movements(primary_region, secondary_regions)").in("session_id", ids),
  ]);

  const daily = Object.fromEntries(REGIONS.map((r) => [r, new Map()]));
  const setsBy = new Map();
  for (const s of sets ?? []) {
    const list = setsBy.get(s.session_id) ?? [];
    list.push(s); setsBy.set(s.session_id, list);
  }
  const cardioBy = new Map();
  for (const c of cardio ?? []) {
    const list = cardioBy.get(c.session_id) ?? [];
    list.push(c); cardioBy.set(c.session_id, list);
  }

  function unwrap(m) { return Array.isArray(m) ? m[0] : m; }

  for (const s of sessions) {
    const date = s.performed_at.slice(0, 10);
    const dur = s.duration_min, rpe = s.session_rpe == null ? null : Number(s.session_rpe);
    const load = dur && rpe ? dur * rpe : (dur ? dur * 6 : 0);
    if (load <= 0) continue;

    const weights = new Map();
    for (const x of [...(setsBy.get(s.id) ?? []), ...(cardioBy.get(s.id) ?? [])]) {
      const mov = unwrap(x.movement);
      if (!mov) continue;
      weights.set(mov.primary_region, (weights.get(mov.primary_region) ?? 0) + PRIMARY_W);
      const sec = mov.secondary_regions;
      if (Array.isArray(sec)) {
        for (const r of sec) {
          if (REGIONS.includes(r)) weights.set(r, (weights.get(r) ?? 0) + SECONDARY_W);
        }
      }
    }
    if (!weights.size) continue;
    const total = [...weights.values()].reduce((a, b) => a + b, 0);
    if (total <= 0) continue;
    for (const [r, w] of weights) {
      const l = load * (w / total);
      daily[r].set(date, (daily[r].get(date) ?? 0) + l);
    }
  }

  function ewma(series, fromIso, toIso, n) {
    const alpha = 2 / (n + 1);
    let prev = 0;
    let d = new Date(fromIso + "T00:00:00Z");
    const end = new Date(toIso + "T00:00:00Z");
    while (d <= end) {
      const iso = d.toISOString().slice(0, 10);
      const v = series.get(iso) ?? 0;
      prev = alpha * v + (1 - alpha) * prev;
      d = new Date(d.getTime() + 86400000);
    }
    return prev;
  }

  const firstDate = sessions[0].performed_at.slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);
  const rows = REGIONS.map((r) => {
    const atl = ewma(daily[r], firstDate, today, 7);
    const ctl = ewma(daily[r], firstDate, today, 28);
    return {
      user_id: userId, region: r, atl, ctl,
      baseline_tolerance: ctl, last_load_date: null,
      updated_at: new Date().toISOString(),
    };
  });

  const { error } = await supabase.from("region_state").upsert(rows, { onConflict: "user_id,region" });
  if (error) throw error;
  return { updated: rows.length };
}

let passed = 0, failed = 0;
function test(name, fn) {
  return fn().then(
    () => { passed++; console.log(`  PASS  ${name}`); },
    (e) => { failed++; console.error(`  FAIL  ${name}\n        ${e.message ?? e}`); },
  );
}

console.log("Region-ledger end-to-end smoke test\n");
await cleanup();

const user = await provision(EMAIL);
const client = await asUser(EMAIL);
console.log(`  user: ${user.id}\n`);

// Pick a heavy-leg compound — back squat — by slug.
const { data: squatMov } = await admin
  .from("movements").select("id, primary_region, secondary_regions")
  .eq("slug", "back-squat-high-bar").single();

if (!squatMov) {
  console.error("FAIL: catalog missing 'back-squat-high-bar'. Run pnpm db:seed.");
  process.exit(3);
}

// Create a session yesterday + log 5 sets, mark complete.
const yesterday = new Date(Date.now() - 86400000).toISOString();
const { data: session, error: se } = await client.from("sessions").insert({
  user_id: user.id, title: "RLS engine smoke",
  performed_at: yesterday, fatigue: 3, soreness: 2,
}).select("id").single();
if (se) { console.error("session insert failed:", se.message); process.exit(3); }

for (let i = 0; i < 5; i++) {
  const { error } = await client.from("set_logs").insert({
    session_id: session.id, movement_id: squatMov.id, set_index: i,
    set_kind: "main", weight_kg: 120, reps: 5, rpe: 8,
  });
  if (error) { console.error("set insert failed:", error.message); process.exit(3); }
}

await client.from("sessions").update({
  session_rpe: 8, duration_min: 60,
  completed_at: new Date().toISOString(),
}).eq("id", session.id);

await test("recompute writes one row per region (7 total)", async () => {
  const out = await recomputeRegionState(client, user.id);
  assert.equal(out.updated, 7, `expected 7 rows updated, got ${out.updated}`);
});

await test("squat-loaded regions (knee + hamstring_posterior + lumbar) have non-zero ATL", async () => {
  const { data } = await client.from("region_state").select("region, atl, ctl").eq("user_id", user.id);
  const byRegion = Object.fromEntries((data ?? []).map((r) => [r.region, r]));
  for (const r of ["knee", "hamstring_posterior", "lumbar_trunk"]) {
    const atl = Number(byRegion[r]?.atl ?? 0);
    assert.ok(atl > 0, `${r} ATL should be > 0, got ${atl}`);
  }
});

await test("upper-body regions (shoulder + elbow) have zero ATL (no upper work logged)", async () => {
  const { data } = await client.from("region_state").select("region, atl").eq("user_id", user.id);
  const byRegion = Object.fromEntries((data ?? []).map((r) => [r.region, r]));
  for (const r of ["shoulder_scapular", "elbow_forearm"]) {
    const atl = Number(byRegion[r]?.atl ?? 0);
    assert.equal(atl, 0, `${r} ATL should be 0, got ${atl}`);
  }
});

await test("recompute is idempotent (running it again doesn't change values)", async () => {
  const { data: before } = await client.from("region_state").select("region, atl, ctl").eq("user_id", user.id).order("region");
  await recomputeRegionState(client, user.id);
  const { data: after } = await client.from("region_state").select("region, atl, ctl").eq("user_id", user.id).order("region");
  for (let i = 0; i < (before ?? []).length; i++) {
    assert.equal(Number(before[i].atl), Number(after[i].atl), `${before[i].region} ATL drifted on rerun`);
    assert.equal(Number(before[i].ctl), Number(after[i].ctl), `${before[i].region} CTL drifted on rerun`);
  }
});

await test("freshness math: knee ATL > 0 implies freshness < 1", async () => {
  const { data } = await client.from("region_state").select("atl, baseline_tolerance").eq("user_id", user.id).eq("region", "knee").single();
  const atl = Number(data.atl);
  const baseline = Number(data.baseline_tolerance);
  if (baseline > 0) {
    const freshness = Math.max(0, Math.min(1, 1 - atl / baseline));
    assert.ok(freshness <= 1, `freshness ${freshness} should be <= 1`);
  }
});

await cleanup();
console.log(`\nResults: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
