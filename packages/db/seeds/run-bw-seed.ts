/**
 * Bodyweight catalog seed runner.
 *
 *   pnpm --filter @hta/db db:seed:bw
 *
 * Two-pass insert:
 *   1. Insert every node with empty `prerequisites = '{}'` so the
 *      catalog rows exist and we can resolve their generated UUIDs.
 *      ON CONFLICT (family, node_key) DO NOTHING — re-running this
 *      against an already-seeded DB is a no-op for unchanged rows.
 *   2. Resolve each seed's `prerequisites` list against the inserted
 *      ids (by `(family, node_key)`) and UPDATE the row's
 *      `prerequisites` array.
 *
 * Idempotency: running twice produces the same final state. We
 * unconditionally re-write prerequisites on pass 2 so editing a
 * seed's prereq list in code propagates on the next run.
 */
import { config } from "dotenv";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { and, eq, sql as dsql } from "drizzle-orm";
import { movementNodes } from "../src/schema/movement-nodes";
import { BW_MOVEMENT_NODES, type SeedMovementNode } from "./bw-movement-nodes";

config({ path: ".env.local" });

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is required (in packages/db/.env.local)");
  process.exit(1);
}

const client = postgres(url, { prepare: false, ssl: "require", max: 4 });
const db = drizzle(client);

function resolveRef(
  ref: string | { family: string; nodeKey: string },
  ownerFamily: string,
): { family: string; nodeKey: string } {
  return typeof ref === "string"
    ? { family: ownerFamily, nodeKey: ref }
    : ref;
}

async function main() {
  console.log(`Seeding ${BW_MOVEMENT_NODES.length} bodyweight movement nodes...`);

  // Pre-flight: every prereq points at a seed we're about to insert.
  const seedKeys = new Set(
    BW_MOVEMENT_NODES.map((n) => `${n.family}:${n.nodeKey}`),
  );
  const dangling: string[] = [];
  for (const n of BW_MOVEMENT_NODES) {
    for (const p of n.prerequisites) {
      const r = resolveRef(p, n.family);
      const k = `${r.family}:${r.nodeKey}`;
      if (!seedKeys.has(k)) dangling.push(`${n.family}:${n.nodeKey} -> ${k}`);
    }
  }
  if (dangling.length > 0) {
    console.error(`✗ ${dangling.length} dangling prerequisite(s):`);
    for (const d of dangling) console.error(`  ${d}`);
    process.exit(2);
  }

  // Pass 1: insert (or no-op) all rows with empty prerequisites.
  const inserts = BW_MOVEMENT_NODES.map((n: SeedMovementNode) => ({
    family: n.family,
    nodeKey: n.nodeKey,
    displayName: n.displayName,
    externalLoadCapable: n.externalLoadCapable,
    isometricCapable: n.isometricCapable,
    unilateral: n.unilateral,
    defaultTempoSeconds: n.defaultTempoSeconds,
    tutPerRepSeconds: n.tutPerRepSeconds,
    difficultyAnchor: n.difficultyAnchor,
  }));

  await db
    .insert(movementNodes)
    .values(inserts)
    .onConflictDoNothing({
      target: [movementNodes.family, movementNodes.nodeKey],
    });

  // Read back every (family, node_key) -> id so we can resolve prereqs.
  const rows = await db
    .select({
      id: movementNodes.id,
      family: movementNodes.family,
      nodeKey: movementNodes.nodeKey,
    })
    .from(movementNodes);

  const idByKey = new Map<string, string>();
  for (const r of rows) idByKey.set(`${r.family}:${r.nodeKey}`, r.id);

  // Pass 2: resolve prereq ids and UPDATE each row. Unconditional so
  // edits to the seed propagate; cheap (75 rows).
  let updated = 0;
  for (const n of BW_MOVEMENT_NODES) {
    const prereqIds = n.prerequisites.map((p) => {
      const r = resolveRef(p, n.family);
      const id = idByKey.get(`${r.family}:${r.nodeKey}`);
      if (!id) throw new Error(`prereq ${r.family}:${r.nodeKey} not in DB`);
      return id;
    });

    await db
      .update(movementNodes)
      .set({
        prerequisites: prereqIds,
        // Re-write the rest of the columns too so seed edits land.
        displayName: n.displayName,
        externalLoadCapable: n.externalLoadCapable,
        isometricCapable: n.isometricCapable,
        unilateral: n.unilateral,
        defaultTempoSeconds: n.defaultTempoSeconds,
        tutPerRepSeconds: n.tutPerRepSeconds,
        difficultyAnchor: n.difficultyAnchor,
      })
      .where(
        and(
          eq(movementNodes.family, n.family),
          eq(movementNodes.nodeKey, n.nodeKey),
        ),
      );
    updated += 1;
  }

  // Report counts per family.
  const counts = await client`
    SELECT family, COUNT(*)::int AS n
    FROM movement_nodes
    GROUP BY family
    ORDER BY family
  `;
  console.log("\nSeed counts by family:");
  for (const r of counts) console.log(`  ${r.family.padEnd(20)} ${r.n}`);

  const totalRow = await client`SELECT COUNT(*)::int AS n FROM movement_nodes`;
  console.log(`\nTotal movement_nodes: ${totalRow[0]!.n}`);
  console.log(`Rows updated (pass 2): ${updated}`);

  await client.end();
}

main().catch(async (err) => {
  console.error("Seed failed:", err);
  await client.end({ timeout: 5 }).catch(() => {});
  process.exit(99);
});
// Silence unused-import lint until needed for ad-hoc raw SQL.
void dsql;
