## Summary

<!-- One paragraph: what changed and why. -->

## Test plan

- [ ] `pnpm -r typecheck`
- [ ] `pnpm -r test`
- [ ] `pnpm --filter @hta/web lint`
- [ ] `pnpm --filter @hta/web build`

## Database migrations

- [ ] No migration added — skip this section.
- [ ] Migration added under `packages/db/drizzle/`. **After merge** apply it to Supabase:
      `pnpm --filter @hta/db db:migrate`
      _Then verify with a smoke test on the live preview — the schema cache
      can take ~30s to refresh; force-reload in Supabase Studio (API →
      Reload Schema) if a new RPC isn't visible._
