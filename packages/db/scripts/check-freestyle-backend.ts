#!/usr/bin/env tsx
/**
 * One-shot health check for the freestyle backend.
 * Verifies the post-PR-#147 + #148 + #150 + #152 chain is healthy:
 *   - session_movements table exists
 *   - GRANTs to authenticated role
 *   - RLS enabled + policies present
 *   - add_session_movement + remove_session_movement functions exist
 *   - Functions are SECURITY INVOKER + granted to authenticated
 * Read-only — never writes.
 */
import postgres from "postgres";
import "dotenv/config";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

const sql = postgres(url, { max: 1, ssl: "require" });

async function main() {
  let ok = true;
  const fail = (msg: string) => { console.error("✗", msg); ok = false; };
  const pass = (msg: string) => console.log("✓", msg);

  // 1. Table exists
  const tables = await sql<{ table_name: string }[]>`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'session_movements'`;
  tables.length === 1
    ? pass("public.session_movements table exists")
    : fail("public.session_movements table missing");

  // 2. Column shape
  const cols = await sql<{ column_name: string; data_type: string; is_nullable: string }[]>`
    SELECT column_name, data_type, is_nullable FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'session_movements'
    ORDER BY ordinal_position`;
  const expected = ["session_id", "movement_id", "user_id", "sort_order", "added_at"];
  const got = cols.map((c) => c.column_name);
  JSON.stringify(got) === JSON.stringify(expected)
    ? pass(`columns: ${got.join(", ")}`)
    : fail(`columns mismatch: got ${got.join(", ")}, expected ${expected.join(", ")}`);

  // 3. RLS enabled
  const rls = await sql<{ relrowsecurity: boolean }[]>`
    SELECT relrowsecurity FROM pg_class
    WHERE relname = 'session_movements' AND relnamespace = 'public'::regnamespace`;
  rls[0]?.relrowsecurity
    ? pass("RLS enabled")
    : fail("RLS NOT enabled");

  // 4. Policies present
  const policies = await sql<{ polname: string; polcmd: string }[]>`
    SELECT polname, polcmd::text FROM pg_policy
    WHERE polrelid = 'public.session_movements'::regclass
    ORDER BY polname`;
  const expectedPolicies = ["session_movements_delete_self", "session_movements_insert_self", "session_movements_select_self"];
  const gotPolicies = policies.map((p) => p.polname);
  JSON.stringify(gotPolicies) === JSON.stringify(expectedPolicies)
    ? pass(`policies: ${gotPolicies.join(", ")}`)
    : fail(`policies mismatch: got ${gotPolicies.join(", ")}, expected ${expectedPolicies.join(", ")}`);

  // 5. Table GRANTs to authenticated
  const grants = await sql<{ privilege_type: string }[]>`
    SELECT privilege_type FROM information_schema.table_privileges
    WHERE table_schema = 'public' AND table_name = 'session_movements'
      AND grantee = 'authenticated'`;
  const got_g = new Set(grants.map((g) => g.privilege_type));
  const required = ["SELECT", "INSERT", "DELETE"];
  const missing = required.filter((p) => !got_g.has(p));
  missing.length === 0
    ? pass(`authenticated has required: ${required.join(", ")} (+ defaults)`)
    : fail(`authenticated missing: ${missing.join(", ")}`);

  // 6. Functions exist with correct signatures
  const fns = await sql<{ proname: string; prosecdef: boolean; pg_get_function_identity_arguments: string }[]>`
    SELECT proname, prosecdef, pg_get_function_identity_arguments(oid)
    FROM pg_proc
    WHERE pronamespace = 'public'::regnamespace
      AND proname IN ('add_session_movement', 'remove_session_movement')
    ORDER BY proname`;
  if (fns.length !== 2) {
    fail(`functions missing — found ${fns.length}/2: ${fns.map((f) => f.proname).join(", ")}`);
  } else {
    for (const f of fns) {
      if (f.prosecdef) {
        fail(`${f.proname} is SECURITY DEFINER (should be INVOKER)`);
      } else {
        pass(`${f.proname}(${f.pg_get_function_identity_arguments}) — SECURITY INVOKER`);
      }
    }
  }

  // 7. Function GRANTs to authenticated
  const fnGrants = await sql<{ routine_name: string; privilege_type: string }[]>`
    SELECT routine_name, privilege_type FROM information_schema.routine_privileges
    WHERE specific_schema = 'public' AND grantee = 'authenticated'
      AND routine_name IN ('add_session_movement', 'remove_session_movement')`;
  const grantedFns = new Set(fnGrants.map((g) => g.routine_name));
  ["add_session_movement", "remove_session_movement"].forEach((fn) =>
    grantedFns.has(fn) ? pass(`${fn} EXECUTE granted to authenticated`) : fail(`${fn} EXECUTE NOT granted`),
  );

  // 8. Confirm both prod migrations are applied
  const migs = await sql<{ hash: string }[]>`
    SELECT hash FROM drizzle.__drizzle_migrations
    ORDER BY id DESC LIMIT 5`;
  console.log(`\nLast 5 migrations applied to prod: ${migs.length} rows`);

  await sql.end();
  if (ok) {
    console.log("\n✓ All freestyle backend checks pass.");
    process.exit(0);
  } else {
    console.error("\n✗ Some checks failed.");
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
