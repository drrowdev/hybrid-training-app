# RPC smoke tests

Smoke tests for Postgres RPCs / functions defined under
`packages/db/drizzle/*.sql`. They run against the shared **E2E Supabase
project** (same secrets the Playwright e2e job uses) and call each RPC
with realistic arguments. The point is to surface SQL syntax /
signature / GRANT / RLS bugs that mocked unit tests can't catch — the
kind that only fire when the function is actually invoked against a
real Postgres instance.

This is **not** a replacement for unit tests. Unit tests cover the
JavaScript action layer (input validation, error mapping, etc.); these
cover the SQL layer.

**When to add one:** any time you ship a new `CREATE FUNCTION` or
materially change an existing function's body or signature.

## Why this exists

PR #148 added the `add_session_movement` plpgsql function. The unit
tests mocked `supabase.rpc(...)` so the SQL was never executed. The bug
("column reference `session_id` is ambiguous") only surfaced when a
real user hit the function in prod. PR #150 hot-fixed it. A smoke
test that invoked the function once against a real Postgres would have
caught it before merge.

## How it runs

- **Locally:** `pnpm --filter @hta/web test:rpc-smoke`. Requires
  `SMOKE_SUPABASE_URL` and `SMOKE_SUPABASE_SERVICE_ROLE_KEY` in the
  environment. If unset, the suite self-skips with a clear message —
  it never fails on missing env.
- **CI:** the `rpc-smoke` job in `.github/workflows/ci.yml`. **Runs
  post-merge to `main` only** — same trigger as `prod-drift`. PRs do
  not run it (the e2e Supabase project is shared and we want PR
  feedback to stay fast).

## Isolation + cleanup

Each test creates its own `sessions` row tagged with a per-run UUID
prefix (`smoke-<runId>-...` in `notes`). Cleanup deletes the session
row in `afterEach`; the schema's `ON DELETE CASCADE` from
`session_movements.session_id -> sessions.id` and from
`set_logs.session_id -> sessions.id` removes anything the test
attached.

To bound damage from a leaked test, a final `afterAll` sweeps any
session whose `notes` still carry the current `runId` prefix.

## v1 caveats

- The RPC calls themselves run as **service-role**, which bypasses
  RLS. We exercise the SQL body (the bug class we're chasing) but not
  the RLS path. A follow-up should authenticate as a per-test
  synthetic user and re-run a subset against `anon`/`authenticated`.
- We only test the two `session_movements` RPCs today. Add a
  `*.smoke.test.ts` per new function.
- Read-only on seed catalog tables (`movements`). Do not insert /
  mutate seed data from here.
