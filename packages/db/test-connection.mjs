import { config } from "dotenv";
import postgres from "postgres";

config({ path: ".env.local" });

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("no DATABASE_URL");
  process.exit(1);
}

const sql = postgres(url, {
  prepare: false,
  connect_timeout: 15,
  ssl: "require",
});

try {
  const r = await sql`SELECT current_database() as db, current_user as usr, version() as v`;
  console.log("OK:", JSON.stringify(r[0], null, 2));
} catch (e) {
  console.error("CONNECT FAILED:", e.message);
  process.exit(2);
} finally {
  await sql.end();
}
