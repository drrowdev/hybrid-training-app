/* eslint-disable */
import { SEED_MOVEMENTS } from "../seeds/movements";

const lines: string[] = [];
lines.push("-- 0058_backfill_experience_bands.sql");
lines.push("--");
lines.push("-- PR W2 — backfill curated experience bands onto deployed catalogs.");
lines.push("-- Generated from `packages/db/seeds/movements-part{1,2,3}.ts` via");
lines.push("-- `scripts/generate-backfill-bands.ts`. Only rows whose curated band");
lines.push("-- diverges from the universal default `(0, 4)` are emitted —");
lines.push("-- everything else already matches the migration default.");
lines.push("--");
lines.push("-- Scope: global seed movements (`user_id IS NULL`). Per-user custom");
lines.push("-- movements keep whatever band the user originally inserted (which is");
lines.push("-- always `(0, 4)` today since there's no UI to declare it yet).");
lines.push("--");
lines.push("-- Re-running is safe: each UPDATE is idempotent — running it twice");
lines.push("-- writes the same values back.");
lines.push("");
const sorted = [...SEED_MOVEMENTS].sort((a, b) => a.slug.localeCompare(b.slug));
let banded = 0;
for (const m of sorted) {
  const min = m.experienceMin ?? 0;
  const max = m.experienceMax ?? 4;
  if (min === 0 && max === 4) continue;
  banded += 1;
  lines.push(
    `UPDATE public.movements SET experience_min = ${min}, experience_max = ${max} WHERE slug = '${m.slug}' AND user_id IS NULL;`,
  );
}
console.error(`Emitted ${banded} UPDATEs (out of ${SEED_MOVEMENTS.length} rows).`);
console.log(lines.join("\n"));
