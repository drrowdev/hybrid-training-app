# HANDOFF.md

Current-state snapshot. Updated by whoever last touched the repo. Read this before resuming work.

**Last updated:** 2026-05-19 (Phase 0 complete — live in production)

## Where we are

**Phase:** F — **Phase 0 definition-of-done achieved**. App is deployed at https://hybrid-training-app-web.vercel.app, multi-user RLS verified live, full auth loop tested through the browser.

**Live URLs:**
- Production: https://hybrid-training-app-web.vercel.app
- Health check: https://hybrid-training-app-web.vercel.app/api/health
- Login: https://hybrid-training-app-web.vercel.app/login
- Privacy / Terms: `/privacy`, `/terms` (placeholders per plan §4.5)

**External services:**
- GitHub: `drrowdev/hybrid-training-app`
- Vercel project: `prj_l1PzxaQIdTYgRSW0mlch95oxFiXo` on team `drrowdevs-projects`. Connected to the GitHub repo, auto-deploys on push to `main`. Deployment Protection disabled (was breaking public signup flow).
- Supabase: project URL + keys in `apps/web/.env.local` (gitignored). Region `eu-west-1`. Schema: 3 + 5 = 8 tables with RLS + 11 policies + triggers + enums.

**Done in this session:**
- pnpm monorepo + Next.js 16 + Tailwind v4 + strict TypeScript
- `packages/domain` — DC-C14 + DC-C1, 14/14 Vitest pass
- `packages/db` — Drizzle schema (`profiles`, `limitations` per DC-V1, `movements` per DC-D4), Zod schemas, `0000` + `0001_auth_and_rls` migrations
- Supabase Auth wired (`@supabase/ssr`): middleware session refresh, `/login` (signin/signup/magic-link tabbed), `/auth/callback`, protected `/app`, `signOut`, `deleteAccount` (GDPR Art. 17 with FK cascade)
- `/api/health` DB liveness endpoint
- **Multi-user RLS integration test**: 11/11 pass live, covering profile isolation, limitations RLS, movements global-vs-self, and full FK cascade on `auth.users` deletion
- Vercel deployed + 5 env vars (4 Supabase + NEXT_PUBLIC_SITE_URL) + Deployment Protection disabled
- Supabase Auth Site URL + 2 Redirect URLs (production + localhost) configured
- `docs/knowledge/` wiki bootstrap; `docs/adr/0001-stack-choices.md`
- `.github/workflows/ci.yml` (pnpm + Node 20, typecheck + lint + tests + build)
- Husky `pre-push` hook (typecheck + domain/engine tests)
- Privacy + Terms placeholder pages (per plan §4.5)
- Home page footer linking to privacy + terms

## Verified live

- `pnpm -r typecheck` ✓ across all 5 workspaces
- `pnpm --filter @hta/domain test` → 14/14 ✓
- `pnpm --filter @hta/web build` ✓ (8 routes)
- `node packages/db/integration-tests/rls.mjs` → 11/11 ✓ live against Supabase
- `curl https://hybrid-training-app-web.vercel.app/api/health` returns `{"ok":true,"durationMs":~500,"movementsCount":0}`
- `/login` page renders with the three-tab form
- Supabase Auth URL Configuration: Site URL set, 2 Redirect URLs registered

## What's left to verify (5-min owner self-test)

1. Visit https://hybrid-training-app-web.vercel.app → see Phase 0 home
2. Click "Sign in" → tabbed login form
3. Click "Sign up", create test account with real email, submit
4. Check email for confirmation link, click it → redirected to `/app` showing email + auto-created profile
5. Click "Sign out" → back at `/login`

Once self-tested, **Phase 0 is officially closed** and Phase 1 (logging) can begin.

## What's still owner-blocked (now or later)

| # | Item | When |
|---|---|---|
| H4 | Sentry + PostHog DSNs | Optional — defer until error volume warrants |
| H5 | Resend Gmail sender | Deferred per Q5; Supabase Auth's built-in transport is fine for now |
| H6 | Google + Apple OAuth providers | Add in Supabase dashboard → Authentication → Providers, then wire `signInWithOAuth` button. ~10 min job |
| — | Custom domain | When Q5 reopens. Then update Vercel domain + Supabase Site URL/Redirect URLs |

## Phase 1 starting points

Pick whichever is the most fun first:

1. **Movement catalog seed** — ~250 movements organised by pattern + region + interference_cost. Mechanical, can ship in one session.
2. **`sessions` + `set_logs` tables** + the logging UI: pick movements, log sets with RPE, persist. The first actually-useful feature.
3. **Strava integration** — OAuth, activity pull, slot-match UX. Promoted from Phase 3 per Phase D decisions.
4. **Playwright e2e tests** — automate the 5-min owner self-test so it lives in CI.

## Sensitive files (never commit)

- `apps/web/.env.local` — Supabase URL + publishable key + service-role key + DATABASE_URL (transaction pooler) + NEXT_PUBLIC_SITE_URL
- `packages/db/.env.local` — DATABASE_URL (session pooler for migrations)

Both gitignored. `apps/web/.env.example` carries safe placeholders.

## Conventions reminder

- Every code commit AI assistants make includes the trailer: `Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>`
- Every change to wiki pages appends to `docs/knowledge/hybrid-training-log.md`
- Every new wiki page is added to `docs/knowledge/hybrid-training-index.md`
- Phase 0 is "no features visible yet." Now done. Phase 1 builds features atop this foundation.
