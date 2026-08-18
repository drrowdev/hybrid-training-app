## Summary

<!-- One paragraph: what changed and why. -->

## Test plan

- [ ] `pnpm -r typecheck`
- [ ] `pnpm -r test`
- [ ] `pnpm --filter @hta/web lint`
- [ ] `pnpm --filter @hta/web build`

## Database migrations

- [ ] No migration added — skip this section.
- [ ] Migration added under `packages/db/drizzle/`. **After merge**, wait for the
      Vercel production deploy to go green, then apply it to Supabase:
      `gh workflow run ci.yml --ref main -f migrate_production=true`
      _The job refuses to run until that commit has deployed successfully, so a
      failure here usually means the deploy is still building. Then verify with a
      smoke test on the live preview — the schema cache can take ~30s to refresh;
      force-reload in Supabase Studio (API → Reload Schema) if a new RPC isn't
      visible._
- [ ] Migration is **destructive** (`DROP COLUMN` / `DROP TABLE`). Confirm the
      code that read the dropped object is removed in this same PR, since the
      app deploys before the migration runs. See `packages/db/README.md`
      → "Deploy order".
