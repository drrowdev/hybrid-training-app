# Changelog

All notable changes to this project will be documented in this file.
The format is loosely based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added
- Phase 0 monorepo scaffold: pnpm workspaces, Next.js 16 in `apps/web`, `packages/{domain,db,engine,ui}`.
- `packages/domain`: first canonical functions — `computeRegionFreshness` (DC-C14) and `ewmaStep` (DC-C1) — with 14/14 Vitest cases including the morning-after-heavy-squats worked example.
- `packages/db`: Drizzle schema (`profiles`, `limitations` per DC-V1, `movements` per DC-D4) with three enums (`region`, `limitation_severity`, `interference_cost`). Zod schemas via `drizzle-zod`. Migrations applied live: `0000` (tables + enums) and `0001_auth_and_rls` (FKs to `auth.users` with `ON DELETE CASCADE`, RLS, 11 policies, `handle_new_user` trigger).
- Supabase Auth wired in `apps/web` via `@supabase/ssr`: client + server + middleware helpers, root middleware refreshes session every request, `/login` (tabbed signin/signup/magic-link), `/auth/callback`, protected `/app`, `signOut`, `deleteAccount` (GDPR Art. 17 with FK cascade), `/api/health`.
- Multi-user RLS integration test (`packages/db/integration-tests/rls.mjs`): 11/11 pass live, covering profile/limitations/movements isolation and full FK cascade on `auth.users` deletion.
- Vercel project linked to GitHub repo with Supabase + `NEXT_PUBLIC_SITE_URL` env vars; Deployment Protection disabled so public signups work.
- Supabase Auth Site URL + 2 Redirect URLs (production + localhost) configured.
- `docs/knowledge/` wiki bootstrap (plan + 3 research files + 108-constraint design constraints + index + log).
- `docs/adr/0001-stack-choices.md` capturing Phase D verdicts.
- `.github/workflows/ci.yml`: pnpm + Node 20, typecheck + lint + tests + build.
- Husky `pre-push` hook running typecheck + domain/engine tests.
- Privacy + Terms placeholder pages (per plan §4.5 — to be expanded before public launch).
- Home page with footer linking to privacy + terms.

### Notes
- **Phase 0 definition-of-done: ✓ achieved.** Live at https://hybrid-training-app-web.vercel.app. Health check + login + auto-created profile + signOut + account-delete all verified.
- Phase 1 starting points listed in `HANDOFF.md`: movement catalog seed, sessions + set_logs tables + logging UI, Strava integration, Playwright e2e tests.
