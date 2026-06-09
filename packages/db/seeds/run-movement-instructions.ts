/**
 * Seed runner for movement how-to content (migration 0098).
 *
 * Resolves each seed entry's stable slug to the global (user_id IS NULL)
 * movement id and upserts into `movement_instructions`. Idempotent — ON CONFLICT
 * (movement_id) DO UPDATE so re-running picks up content edits. Unmatched slugs
 * are reported and counted, never silently dropped.
 *
 *   pnpm --filter @hta/db db:seed:instructions
 */
import { config } from "dotenv";
import postgres from "postgres";
import { MOVEMENT_INSTRUCTIONS } from "./movement-instructions";

config({ path: ".env.local" });

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is required (in packages/db/.env.local)");
  process.exit(1);
}

const sql = postgres(url, { prepare: false, ssl: "require", max: 4 });

async function main() {
  console.log(`Seeding ${MOVEMENT_INSTRUCTIONS.length} movement instructions...`);

  // Sanity: unique slugs in the seed.
  const counts = new Map<string, number>();
  for (const m of MOVEMENT_INSTRUCTIONS) counts.set(m.slug, (counts.get(m.slug) ?? 0) + 1);
  const dupes = [...counts.entries()].filter(([, n]) => n > 1);
  if (dupes.length > 0) {
    console.error("✗ Duplicate slugs in seed:");
    for (const [slug, n] of dupes) console.error(`  ${slug} (×${n})`);
    process.exit(2);
  }

  const rows = (await sql`
    select id, slug from movements where user_id is null
  `) as Array<{ id: string; slug: string }>;
  const idBySlug = new Map(rows.map((r) => [r.slug, r.id]));

  const unmatched: string[] = [];
  let upserted = 0;

  for (const m of MOVEMENT_INSTRUCTIONS) {
    const movementId = idBySlug.get(m.slug);
    if (!movementId) {
      unmatched.push(m.slug);
      continue;
    }
    await sql`
      insert into movement_instructions
        (movement_id, summary, setup, steps, cues, common_mistakes, source, reviewed, updated_at)
      values (
        ${movementId},
        ${m.summary},
        ${m.setup ?? null},
        ${sql.json(m.steps)},
        ${sql.json(m.cues)},
        ${sql.json(m.commonMistakes ?? [])},
        'seed-v1',
        false,
        now()
      )
      on conflict (movement_id) do update set
        summary = excluded.summary,
        setup = excluded.setup,
        steps = excluded.steps,
        cues = excluded.cues,
        common_mistakes = excluded.common_mistakes,
        source = excluded.source,
        updated_at = now()
    `;
    upserted += 1;
  }

  console.log(`✓ Upserted ${upserted} instruction rows.`);
  if (unmatched.length > 0) {
    console.warn(`⚠ ${unmatched.length} seed slug(s) had no matching movement:`);
    for (const s of unmatched) console.warn(`  ${s}`);
  }
  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
