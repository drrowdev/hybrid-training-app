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
specs talk to a Supabase project via the service-role key.

The fixture reads either the `E2E_*` variables (when you want a dedicated
test project) or falls back to the standard Next.js Supabase variables
that already exist in `apps/web/.env.local` for local dev. **The
playwright config auto-loads `.env.local`** at startup (small inline
parser, no `dotenv` dep), so locally you don't need to export anything —
the same vars the dev server uses are visible to Playwright.

| Variable                              | Fallback                              | Purpose                                                    |
| ------------------------------------- | ------------------------------------- | ---------------------------------------------------------- |
| `PLAYWRIGHT_BASE_URL`                 | `http://localhost:3000`               | Where the app under test is running.                       |
| `E2E_SUPABASE_URL`                    | `NEXT_PUBLIC_SUPABASE_URL`            | Supabase project URL.                                      |
| `E2E_SUPABASE_SERVICE_ROLE_KEY`       | `SUPABASE_SERVICE_ROLE_KEY`           | Service-role key — used to create/delete users + seed rows. |
| `E2E_SUPABASE_ANON_KEY`               | `NEXT_PUBLIC_SUPABASE_ANON_KEY`       | Anon key — used by sign-in flows.                          |

When neither set is configured, the affected test **skips** with a clear
message rather than failing. That keeps CI green for forks / PRs that
can't see the secrets.

When the integration-test helper lands, replace `fixtures/seed.ts` with
a fixture that boots the same testcontainers Postgres, runs the Drizzle
migrations, and seeds a user directly. The spec shape stays the same.

### Auth (cookie injection, not UI walk)

The login page's password input renders without a `<label>` or
`aria-label`, so `getByLabel(/password/i)` can't see it — and exercising
the login UI isn't the point of these specs anyway. Each spec instead
signs the user in programmatically and injects the resulting cookies
into the Playwright `BrowserContext`:

```ts
import { signInAs } from "./fixtures/auth";

await signInAs(context, freshUser, seedConfig, baseURL);
```

`signInAs` uses the same `@supabase/ssr` `createServerClient` the app's
middleware uses, with an in-memory Map-backed cookie store. After
`signInWithPassword`, every captured cookie is forwarded to
`context.addCookies(...)` for the app's domain. This handles the
chunked, base64-encoded session-cookie shape Supabase emits without
re-implementing it.

### Direct-DB seed helpers

`fixtures/seed-blocks.ts` exposes thin helpers that bypass UI walks for
pre-conditions that aren't what the spec is testing:

- `markOnboarded(admin, userId)` — sets `profiles.onboarded_at = now()`
  so `/app` doesn't redirect to `/onboarding`.
- `seedRecentBlock(admin, userId, opts)` — inserts a `training_blocks`
  row so the "Run it again" picker on `/plan/new` has a card to render.
- `seedStrengthTms(admin, userId)` — inserts `training_maxes` rows for
  the canonical squat / deadlift / horizontal-press / vertical-press
  slugs so the wizard's TM-gating allows clicking "Start this block".

Column names in these helpers mirror the Drizzle schema in
`packages/db/src/schema` — `profiles.id` (PK = `auth.uid()`),
`profiles.onboarded_at`, `training_blocks.user_id`,
`training_blocks.started_on`, `training_blocks.weeks`, etc.

> ⚠️ **If you don't have a dedicated test Supabase project**, the
> fallback uses your dev project. Test users are created with
> `e2e+<ts>+<rand>@example.test` emails and auto-deleted in teardown,
> so the blast radius is small — but **never** run these against a
> Supabase project that holds real users you can't lose. When you ship
> to production, create a separate test project and set the `E2E_*`
> vars to override the fallback.

## Current specs

| Spec                                      | Status   | Notes                                                                                                            |
| ----------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------- |
| `onboarding-mobile.spec.ts` (gate)        | passing  | Asserts /app → /onboarding redirect + 375px no-horizontal-scroll on a fresh user.                                |
| `onboarding-mobile.spec.ts` (full walk)   | **skipped** | TODO: walk all 5 onboarding steps. Blocked on adding stable `data-testid`s to the wizard step controls.       |
| `plan-new-wizard-desktop.spec.ts`         | passing  | Walks Step 1 → Step 5 and asserts the gated "Start this block" button is enabled. Post-click create + redirect verification is intentionally not asserted — see `actions.ts` camelCase bug below. |
| `plan-new-run-it-again-desktop.spec.ts`   | passing  | Seeds a completed block, asserts the picker card renders with the right metadata. Click-to-clone is **not** exercised — same camelCase bug. |

### Known production bug blocking deeper assertions

`apps/web/src/lib/planner/actions.ts` (`createBlock` + `createCustomBlock`)
inserts `planned_sessions` rows with camelCase property keys (`blockId`,
`userId`, `weekIndex`, …). PostgREST rejects with `Could not find the
'blockId' column of 'planned_sessions' in the schema cache` because the
columns are snake_case. The action returns `ok:false` and the page
surfaces an inline error — no block / planned sessions are written.

This bug is out of scope for this E2E-repair PR (rule: no production
code changes). Once it's fixed in a follow-up, restore the deeper
assertions in the wizard and run-it-again specs (verify URL changes to
`/app/plan` after Start / Run-Again, and assert that `training_blocks`
has the expected row count for the user).

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

**Current policy: secrets are intentionally NOT set in GitHub Actions.**
The job runs every PR but every test self-skips because the Supabase
env vars aren't present in CI. This is a deliberate choice — adding the
service-role key as a GitHub secret means anyone able to push a workflow
change to a PR could exfiltrate it. The risk isn't worth the coverage at
this stage.

The expectation is that the author runs `pnpm --filter @hta/web test:e2e`
locally before pushing significant changes to the wizard / onboarding /
plan-creation surfaces. When the project ships to production and gets a
dedicated test Supabase project, set the `E2E_*` secrets (which override
the standard fallback) so CI can exercise the tests against the test
project without ever seeing prod credentials.

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
