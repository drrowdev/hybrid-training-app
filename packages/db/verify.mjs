import { config } from "dotenv";
import postgres from "postgres";

config({ path: ".env.local" });
const url = process.env.DATABASE_URL;
if (!url) {
  console.error("no DATABASE_URL");
  process.exit(1);
}

const sql = postgres(url, { prepare: false, ssl: "require" });

try {
  const tables = await sql`
    SELECT tablename, rowsecurity FROM pg_tables
    WHERE schemaname = 'public' ORDER BY tablename
  `;
  console.log("Tables in public:");
  for (const t of tables) console.log(`  ${t.tablename}\tRLS=${t.rowsecurity}`);

  const policies = await sql`
    SELECT tablename, policyname, cmd FROM pg_policies
    WHERE schemaname = 'public' ORDER BY tablename, policyname
  `;
  console.log(`\nPolicies (${policies.length}):`);
  for (const p of policies) console.log(`  ${p.tablename}.${p.policyname} (${p.cmd})`);

  const triggers = await sql`
    SELECT trigger_name, event_object_table FROM information_schema.triggers
    WHERE trigger_schema IN ('public','auth') ORDER BY trigger_name
  `;
  console.log(`\nTriggers (${triggers.length}):`);
  for (const t of triggers) console.log(`  ${t.event_object_table}: ${t.trigger_name}`);

  const enums = await sql`
    SELECT t.typname, array_agg(e.enumlabel ORDER BY e.enumsortorder) as labels
    FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public'
    GROUP BY t.typname ORDER BY t.typname
  `;
  console.log(`\nEnums (${enums.length}):`);
  for (const e of enums) console.log(`  ${e.typname}: ${e.labels.join(', ')}`);
} catch (e) {
  console.error("VERIFY FAILED:", e.message);
  process.exit(2);
} finally {
  await sql.end();
}
