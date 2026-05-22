# Playwright E2E

Foundation for browser-level E2E against `apps/web`. Covers the
**onboarding** and **plan-creation** critical paths from
[`AGENTS.md`](../../../AGENTS.md). Auth, session-log, program-run and
multi-user E2E are still pending — see [Follow-ups](#follow-ups).

## Layout

```
apps/web/
├── playwright.config.ts        # base URL, projects, webServer
└── e2e/
    ├── fixtures/seed.ts        # freshUser fixture + skip-if-no-env logic
    ├── onboarding-mobile.spec.ts
    ├── plan-new-wizard-desktop.spec.ts
    └── plan-new-run-it-again-desktop.spec.ts
```

## Seed strategy

The integration-test layer mandated by `AGENTS.md` (Vitest + real
Postgres via testcontainers) is **not yet wired**. Until it lands, these
specs talk to a real Supabase test project via the service-role key.

Required environment variables:

| Variable                              | Purpose                                      |
| ------------------------------------- | -------------------------------------------- |
| `PLAYWRIGHT_BASE_URL`                 | Where the app under test is running. Default `http://localhost:3000`. |
| `E2E_SUPABASE_URL`                    | Supabase project URL (**must be a test/staging project**). |
| `E2E_SUPABASE_SERVICE_ROLE_KEY`       | Service-role key — used to create/delete users + seed rows. |
| `E2E_SUPABASE_ANON_KEY`               | Anon key — used by sign-in flows.            |

When any of these is missing, the affected test **skips** with a clear
message rather than failing. That keeps CI green for forks / PRs that
can't see the secrets.

When the integration-test helper lands, replace `fixtures/seed.ts` with
a fixture that boots the same testcontainers Postgres, runs the Drizzle
migrations, and seeds a user directly. The spec shape stays the same.

> ⚠️ **Never point these at the production Supabase project.** The fixture
> creates and deletes users with the service-role key and seeds rows
> directly into application tables.

## Running locally

```sh
# Install browsers once (Chromium only — first PR keeps CI cost down)
pnpm --filter @hta/web exec playwright install --with-deps chromium

# Run everything (auto-starts `pnpm dev` via playwright.config.ts)
pnpm --filter @hta/web test:e2e

# Just the mobile project
pnpm --filter @hta/web test:e2e:mobile

# A single spec / a single test
pnpm --filter @hta/web exec playwright test e2e/onboarding-mobile.spec.ts
pnpm --filter @hta/web exec playwright test --grep "run it again"

# UI / debug modes
pnpm --filter @hta/web test:e2e:ui
pnpm --filter @hta/web exec playwright test --headed
pnpm --filter @hta/web exec playwright test --debug
```

To point at an already-running dev server (skip the auto-start):

```sh
PLAYWRIGHT_BASE_URL=http://localhost:3000 \
  pnpm --filter @hta/web exec playwright test
```

## Updating the seed user

Each test creates a brand-new disposable user per run and deletes it on
teardown — there is no shared seed user to update. To seed more
complex pre-conditions (e.g. a user with a completed block), extend
`fixtures/seed.ts` with helper functions that insert rows via the
service-role client.

## CI

The `e2e (playwright)` job in `.github/workflows/ci.yml`:

1. Installs deps with pnpm.
2. Installs Chromium via `playwright install --with-deps chromium`.
3. Builds the web app (`pnpm --filter @hta/web build`).
4. Starts it in the background (`pnpm --filter @hta/web start`) and
   waits for `localhost:3000` to respond.
5. Runs `pnpm --filter @hta/web exec playwright test`.
6. Uploads `apps/web/playwright-report/` as an artifact on failure.

The job is gated on the `E2E_SUPABASE_URL` secret being present — when
it isn't (e.g. PRs from forks), every test skips cleanly and the job
still passes.

## Follow-ups

Things AGENTS.md mandates that this PR does **not** yet cover. Each is
a one-spec follow-up PR:

- **Auth E2E** — sign-up, sign-in, sign-out, magic-link / password-reset.
- **Session log E2E** — start session, log sets/cardio, mark complete.
- **Program-run E2E** — multi-day cursor advancement, deload, completion.
- **Multi-user E2E** — at least one spec that mutates state from two
  browser contexts and verifies the server-canonical state (catches
  sync-style races). Required by AGENTS.md.
- **Visual regression** / screenshot diffs.
- **Firefox + WebKit projects** (first PR is Chromium-only).
- **Performance budgets** (Lighthouse / web-vitals in CI).
