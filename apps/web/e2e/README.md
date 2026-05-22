# Playwright E2E

Foundation for browser-level E2E against `apps/web`. Covers the
**onboarding**, **plan-creation**, **multi-user RLS**, **session-log**,
**auth**, and **program-run** critical paths from
[`AGENTS.md`](../../../AGENTS.md). With program-run landed,
**all 3 AGENTS.md critical paths are covered** (`auth` ✓ + `log` ✓ +
`program-run` ✓), and the AGENTS.md "Multi-user E2E" mandate stays
satisfied by `multi-user-rls-desktop.spec.ts`.

> The engineering rule "E2E — Playwright in `apps/web`. Critical paths:
> auth + log + program-run" now has a passing spec for each path.

## Layout

```
apps/web/
├── playwright.config.ts        # base URL, projects, webServer
└── e2e/
    ├── fixtures/seed.ts        # freshUser fixture + skip-if-no-env logic
    ├── fixtures/auth.ts        # signInAs cookie-injection + generateMagicLink / generateSignupLink / deleteUserByEmail helpers
    ├── fixtures/seed-blocks.ts # direct-DB seed helpers
    ├── fixtures/session-log.ts # seedActiveBlock + assertSessionComplete helpers
    ├── fixtures/program-run.ts # seedBlockAtWeekDay + assertBlockStatus + STRENGTH_ANCHOR_WEEK_PROFILES
    ├── fixtures/multi-user.ts  # twoUsers fixture (parallel provisioning + cascade cleanup)
    ├── auth-desktop.spec.ts
    ├── onboarding-mobile.spec.ts
    ├── plan-new-wizard-desktop.spec.ts
    ├── plan-new-run-it-again-desktop.spec.ts
    ├── multi-user-rls-desktop.spec.ts
    ├── session-log-desktop.spec.ts
    └── program-run-desktop.spec.ts
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
> `e2e+<ts>+<rand>@hta-e2e.com` emails and auto-deleted in teardown,
> so the blast radius is small — but **never** run these against a
> Supabase project that holds real users you can't lose. When you ship
> to production, create a separate test project and set the `E2E_*`
> vars to override the fallback.

### Supabase project setup for auth E2E

`auth-desktop.spec.ts` scenarios A (magic-link sign-in) and B (signup via
UI) navigate Supabase's `/auth/v1/verify` action URL minted by
`admin.auth.admin.generateLink` and expect the callback to land on the
Playwright `baseURL`. For that to work the Supabase project must:

1. Have the `baseURL` origin (e.g. `http://localhost:3000`) added under
   **Authentication → URL Configuration → Redirect URLs** as
   `http://localhost:3000/**` (wildcard path required). Without this,
   Supabase silently overrides the `redirectTo` we pass and falls back
   to the project Site URL with an implicit-flow `#access_token=…`
   fragment that `/auth/callback` can't process.
2. Use PKCE as the default email-link flow (the `@supabase/ssr` default;
   no extra setting needed in modern projects).
3. For scenario B specifically: the spec uses `@hta-e2e.com` emails
   (a non-existent .com domain that Supabase's email validator accepts
   — RFC 2606 reserved TLDs like `.test` and `@example.com` are
   hardcoded-rejected by Supabase with no dashboard opt-out). The admin
   API mints the confirmation link directly, so no SMTP is needed.

When any of these aren't satisfied the scenario **skips with a clear
actionable message** rather than failing. Scenarios C (sign-out) and D
(protected-route gate) don't depend on any of this and always run.

## Current specs

| Spec                                      | Status   | Notes                                                                                                            |
| ----------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------- |
| `onboarding-mobile.spec.ts` (gate)        | passing  | Asserts /app → /onboarding redirect + 375px no-horizontal-scroll on a fresh user.                                |
| `onboarding-mobile.spec.ts` (full walk)   | **skipped** | TODO: walk all 5 onboarding steps. Blocked on adding stable `data-testid`s to the wizard step controls.       |
| `plan-new-wizard-desktop.spec.ts`         | passing  | Walks Step 1 → Step 5 and asserts the gated "Start this block" button is enabled. Post-click create + redirect verification is intentionally not asserted — see `actions.ts` camelCase bug below. |
| `plan-new-run-it-again-desktop.spec.ts`   | passing  | Seeds a completed block, asserts the picker card renders with the right metadata. Click-to-clone is **not** exercised — same camelCase bug. |
| `multi-user-rls-desktop.spec.ts`          | passing  | Three scenarios: (A) /app/plan RLS isolation across two browser contexts, (B) concurrent block-creation race via `Promise.all`, (C) read-after-write isolation on /app/settings/training-maxes. Closes the AGENTS.md multi-user-E2E mandate. |
| `session-log-desktop.spec.ts`             | passing  | Three scenarios: (A) seed → /app Start session → log two strength sets → finish → service-role verify `sessions.completed_at`, `set_logs` (×2), `planned_sessions.completed_session_id`. (B) DC-P1 pre-session check-in: fatigue + soreness chips persist to the `sessions` row. (C) Skip a planned session: `planned_sessions.skipped_at` is set; the Start CTA is replaced by the Un-skip button. Closes the AGENTS.md session-log critical-path mandate. |
| `auth-desktop.spec.ts`                    | passing / 2 conditional skips  | Four scenarios: (A) Magic-link sign-in via admin `generateLink({ type: 'magiclink' })` → navigate to `action_link` → land in `/app`, service-role verify the auth user. (B) Sign-up via the UI form: submit email + password → "check your email" state → admin lookup + `generateLink({ type: 'signup' })` → navigate → land in `/onboarding`. (C) Sign-out: cookie-inject sign in → click the AppShell `data-testid=sign-out-button` → redirect to `/login`; re-visiting `/app` redirects back to `/login?next=/app`. (D) Unauthenticated deep-link to `/app/plan/new` redirects to `/login?next=/app/plan/new`. Closes the AGENTS.md auth critical-path mandate. **A and B skip when the Supabase project isn't configured for localhost E2E** — see "Supabase project setup for auth E2E" below; C and D always run. |
| `program-run-desktop.spec.ts`             | passing  | Four scenarios: (A) Multi-day cursor advancement — seed a block at `weekIndex=0`, /app surfaces today's prescription, log it end-to-end, refresh /app → `today-logged` card replaces today-card and `Up next this week` lists future planned sessions. (B) Deload week prescription differs — seed at `weekIndex=3` (strength_anchor's `weekProfiles[3].intensityLabel === "Deload"`), assert today's card title carries the `(deload)` suffix and the persisted prescription items use the deload intensities `[40,50,60]%TM` halved to 2 items by `strengthVolumeScale=0.5`. (C) Block completion — log the only un-completed row in a block where all other rows are pre-completed; assert status stays `active` (no auto-completion in the codebase today), click `data-testid=end-block-button` → status flips to `archived`; archived block surfaces in `/plan/new` "Run it again". (D) Two active blocks — schema has no `(user_id, status='active')` uniqueness and no DC-* mandates it; direct-DB seed inserts two `active` rows and assert `getActiveBlock`'s `started_on DESC LIMIT 1` ordering surfaces the newer one. Closes the AGENTS.md program-run critical-path mandate. |

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

- **Visual regression** / screenshot diffs.
- **Firefox + WebKit projects** (first PR is Chromium-only).
- **Performance budgets** (Lighthouse / web-vitals in CI).

### TZ-skew in `apps/web/src/lib/planner/queries.ts::dayDate` (fixed)

`dayDate` previously mixed UTC and local-date math: its `ymd` helper
used `d.toISOString().slice(0, 10)` (UTC) while `todayYmd` used local
getFullYear/getMonth/getDate. In timezones with a non-zero UTC offset
this could shift which `(week_index, day_index)` pair resolved to today
by ±1–2 days. Fixed in `fix(planner): use timezone-aware date arithmetic
for today resolution`: `dayDate` is now pure UTC string-math (no TZ
mixing) and `todayYmd(tz)` formats the current instant via
`Intl.DateTimeFormat` in the user's profile timezone. The
`fixtures/program-run.ts::productionDayDate` helper now mirrors the
corrected math, and `__tests__/daydate-tz.test.ts` guards against
regression in UTC / Europe/Helsinki / America/Los_Angeles.
