# `@hta/db`

Drizzle ORM schemas + raw SQL migrations for the HTA Supabase project.

## Layout

```
packages/db/
├── src/schema/              # Drizzle table definitions (the camelCase mirror)
├── drizzle/                 # Raw SQL migrations (the snake_case source of truth)
│   ├── meta/_journal.json   # Drizzle's manifest — one entry per migration
│   └── 00NN_*.sql           # Numbered, append-only. NEVER edit a committed one
│                            # except for idempotency tweaks (ADD COLUMN IF NOT EXISTS).
├── seeds/                   # Data-only seeds (movements, archetypes, …)
├── scripts/                 # One-off ops helpers (e.g. tracking resync)
├── sync-migrations-tracking.sql   # Backfill rows for __drizzle_migrations
└── drizzle.config.ts        # drizzle-kit config (reads DATABASE_URL)
```

## Day-to-day commands

```bash
pnpm --filter @hta/db db:generate   # diff schema → emit a new 00NN_*.sql
pnpm --filter @hta/db db:migrate    # apply pending migrations to DATABASE_URL
pnpm --filter @hta/db db:studio     # open drizzle-studio against DATABASE_URL
pnpm --filter @hta/db db:seed       # idempotent data seeds
```

## Schema discipline (plan §6.8)

Before adding a top-level column, answer:

1. What removes it?
2. Is it observable from outside the engine?

If both answers are "no", put it in a `definition` / `metadata` JSONB blob
and skip the migration entirely. ADR required for any new top-level column.

## Migration runbook

### Normal path

1. Edit the Drizzle schema under `src/schema/`.
2. Run `pnpm --filter @hta/db db:generate` — produces the next-numbered SQL
   file in `drizzle/` and appends to `meta/_journal.json`.
3. Inspect the generated SQL. Add `IF NOT EXISTS` / `WHERE NOT EXISTS`
   guards if the change is not purely additive — defense in depth against
   accidental re-runs.
4. Run `pnpm --filter @hta/db db:migrate` against your local Supabase /
   the staging DB.
5. Commit the schema change + the new SQL file + the journal update
   together in one PR.
6. After the PR merges, apply pending migrations through the guarded
   production workflow:
   ```bash
   gh workflow run ci.yml --ref main -f migrate_production=true
   ```
   The job runs only from `main`, serializes production migrations, uses the
   protected `Production` environment, and verifies the migration journal
   against the live database before succeeding.

   It also **refuses to run until Vercel has successfully deployed that exact
   commit** (see "Deploy order" below), so waiting for the deploy to finish is
   enforced rather than remembered.

### Deploy order: app first, database second

This repo deploys the app automatically on merge to `main`, and applies
migrations later by dispatching the job above. The database is therefore
always *behind* the running app for a window, which has two consequences:

- **Every migration on `main` must be backwards-compatible with the build
  already serving traffic.** Additive changes are safe by construction as long
  as the new code tolerates the column being absent.
- **A destructive change (`DROP COLUMN` / `DROP TABLE`) is only safe once the
  release that stopped reading the dropped object is live.** Ship the code
  removal first, let it deploy, then migrate. Migration `0131` (dropping
  `profiles.body_comp_phase`) is the reference example: the previous build
  `SELECT`s those columns by name and 500s the moment they disappear.

The `prod-migrate` job enforces this by requiring a **successful `Production`
deployment record for the commit being migrated** before it touches the
database. Those records come from the Vercel GitHub integration, so no extra
secret is involved. If the deploy is still building, failed, or was superseded,
the job stops with an explanation instead of migrating.

The escape hatch is `-f allow_undeployed=true`, which skips the check. It is
only correct when the currently live build already tolerates the pending
migrations (a purely additive change), or when the repo has no Vercel
integration at all. It logs a warning in the job summary when used.

### Out-of-band path (Supabase dashboard) — discouraged

Sometimes — usually for emergency hotfixes — a migration is run by hand
in the Supabase SQL editor instead of through `drizzle-kit migrate`.
When that happens, `drizzle.__drizzle_migrations` doesn't get the row
that `drizzle-kit migrate` would have written, and the next normal
migrate run will try to re-apply the SQL from scratch.

To re-sync the tracking table:

1. Make sure the migration file is committed to `drizzle/` with **the
   exact SQL you ran in the dashboard**. Wrap every statement in
   `IF NOT EXISTS` / `WHERE NOT EXISTS` so the file is safe to re-run.
2. Add the matching journal entry to `meta/_journal.json` (drizzle-kit
   `migrate` only sees migrations it knows about via the journal).
3. Regenerate `sync-migrations-tracking.sql` to include the new tag:
   ```bash
   pnpm --filter @hta/db tsx scripts/sync-migrations-tracking.ts --write
   ```
   The script hashes each migration file with **LF-normalized** content
   so the output matches what drizzle-kit will compute on Linux/CI. If
   your local checkout has CRLF endings the hash will still match
   because the script normalizes before hashing.
4. Apply the SQL against the affected DB(s):
   ```bash
   psql "$DATABASE_URL" -f packages/db/sync-migrations-tracking.sql
   # …or paste it into the Supabase SQL editor
   ```
   The script uses `WHERE NOT EXISTS (… WHERE hash = …)` so it's safe
   to re-run; it only inserts rows for migrations not already tracked.
5. Confirm `drizzle-kit migrate` reports "nothing to apply" against the
   freshly-synced DB before merging anything that depends on the new
   migration.

### Why the helper script exists

Drizzle's tracking table stores `sha256(<file contents>)` in hex. That
hash is line-ending-sensitive: the same file checked out on Windows
(CRLF) and Linux (LF) hashes differently. To avoid OS drift between
contributors, `scripts/sync-migrations-tracking.ts` normalizes file
content to LF before hashing — matching the canonical Linux/CI form.
If you ever need the raw on-disk hash (e.g. for debugging an existing
tracking row), use:

```ts
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
console.log(createHash("sha256").update(readFileSync(path)).digest("hex"));
```

## Testing

```bash
pnpm --filter @hta/db test           # vitest (currently --passWithNoTests)
pnpm --filter @hta/db typecheck      # tsc --noEmit
```

The DB integration tests (`integration-tests/*.mjs`) require a live
Postgres + `DATABASE_URL`; they're run separately in CI against a
disposable Supabase project, not on every `pnpm test`.


## One-shot ops scripts

### `backfill-region-state-history`

Populates `region_state_history` (migration 0029) with the trailing 30
days of per-region freshness for every existing user. Run once after
deploying the migration so existing users have a 14-day strip on the
engine page without waiting two weeks for the cron to fill in.

```bash
# requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
pnpm --filter @hta/db exec tsx scripts/backfill-region-state-history.ts
```

Idempotent — re-running overwrites existing rows via
`ON CONFLICT (user_id, region, snapshot_date) DO UPDATE`. Safe to
run repeatedly during development or after a data re-import.

After this one-shot, ongoing snapshots are written daily by the Vercel
cron at `/api/cron/region-state-snapshot` (03:00 UTC).