/**
 * Seed runner — applies the 250-movement catalog to the live DB.
 *
 * Idempotent: ON CONFLICT (user_id, slug) DO UPDATE so re-running this
 * after schema/seed edits picks up changes without duplicates.
 *
 *   pnpm --filter @hta/db db:seed
 */
import { config } from "dotenv";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { movements } from "../src/schema/movements";
import { SEED_MOVEMENTS } from "./movements";

config({ path: ".env.local" });

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is required (in packages/db/.env.local)");
  process.exit(1);
}

const sql = postgres(url, { prepare: false, ssl: "require", max: 4 });
const db = drizzle(sql);

async function main() {
  console.log(`Seeding ${SEED_MOVEMENTS.length} movements...`);

  // Sanity: every movement has at least one primary muscle.
  const malformed = SEED_MOVEMENTS.filter((m) => m.primaryMuscles.length === 0 && m.pattern !== "carry");
  if (malformed.length > 0) {
    console.error(`✗ ${malformed.length} movements missing primary muscles:`);
    for (const m of malformed.slice(0, 10)) console.error(`  ${m.slug}`);
    process.exit(2);
  }

  // Sanity: every slug is unique.
  const slugCounts = new Map<string, number>();
  for (const m of SEED_MOVEMENTS) {
    slugCounts.set(m.slug, (slugCounts.get(m.slug) ?? 0) + 1);
  }
  const dupes = [...slugCounts.entries()].filter(([, n]) => n > 1);
  if (dupes.length > 0) {
    console.error(`✗ Duplicate slugs:`);
    for (const [slug, n] of dupes) console.error(`  ${slug} (×${n})`);
    process.exit(3);
  }

  // Idempotent upsert.
  await db
    .insert(movements)
    .values(SEED_MOVEMENTS)
    .onConflictDoUpdate({
      target: [movements.userId, movements.slug],
      set: {
        displayName: movements.displayName,
        pattern: movements.pattern,
        primaryRegion: movements.primaryRegion,
        secondaryRegions: movements.secondaryRegions,
        primaryMuscles: movements.primaryMuscles,
        secondaryMuscles: movements.secondaryMuscles,
        equipment: movements.equipment,
        isCompound: movements.isCompound,
        interferenceCost: movements.interferenceCost,
        highStrainTendon: movements.highStrainTendon,
        axialLoad: movements.axialLoad,
        stability: movements.stability,
        bilateral: movements.bilateral,
        bodyWeightLoaded: movements.bodyWeightLoaded,
        metadata: movements.metadata,
      },
    });

  // Verify what landed.
  const counts = await sql`
    SELECT pattern, COUNT(*)::int AS n
    FROM movements
    WHERE user_id IS NULL
    GROUP BY pattern
    ORDER BY n DESC
  `;
  console.log(`\nGlobal seed counts by pattern:`);
  for (const r of counts) console.log(`  ${r.pattern.padEnd(14)} ${r.n}`);

  const total = await sql`SELECT COUNT(*)::int AS n FROM movements WHERE user_id IS NULL`;
  console.log(`\nTotal global movements: ${total[0]!.n}`);

  const tendonCount = await sql`
    SELECT COUNT(*)::int AS n FROM movements
    WHERE user_id IS NULL AND high_strain_tendon = true
  `;
  console.log(`  high_strain_tendon: ${tendonCount[0]!.n}`);

  await sql.end();
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(99);
});
