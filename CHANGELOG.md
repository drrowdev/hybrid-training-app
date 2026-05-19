# Changelog

All notable changes to this project will be documented in this file.
The format is loosely based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added
- Phase 0 monorepo scaffold: pnpm workspaces, Next.js 16 in `apps/web`, empty `packages/{domain,db,engine,ui}`.
- `packages/domain`: first canonical function — `computeRegionFreshness` per DC-C14 — with Vitest coverage including the "morning after heavy squats" worked example.
- `packages/db`: Drizzle schema for `profiles`, `limitations` (DC-V1), `movements` with `interference_cost` enum (DC-D4) and the seven-region enum (DC-A6). Zod schemas via `drizzle-zod`.
- `packages/engine` and `packages/ui`: stub packages.
- `docs/knowledge/`: wiki seed (plan, three research files, design constraints, index, log) imported from the planning workspace.
- `docs/adr/0001-stack-choices.md` capturing the Phase D verdicts.
- Strict `tsconfig.base.json` (target ES2022, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`).
- **Supabase project provisioned** in `eu-west-1` and migrations applied: `0000` (tables + enums) and `0001_auth_and_rls` (FKs to `auth.users` with `ON DELETE CASCADE`, RLS enabled, 11 self-only policies, `handle_new_user` trigger).
- **Supabase Auth wired** in `apps/web` via `@supabase/ssr`: client + server + middleware helpers, `/login` (signin/signup/magic-link tabbed form), `/auth/callback`, protected `/app` route, `/api/health` endpoint, `signOut` server action, `deleteAccount` server action with cascade verification.
- Multi-user RLS verification suite (`packages/db/integration-tests/rls.mjs`): 11/11 pass live against Supabase, covering profiles + limitations + movements isolation and full FK cascade on `auth.users` deletion (GDPR Article 17).
- `.github/workflows/ci.yml`: pnpm + Node 20, typecheck + lint + tests + build.
- Root `README.md`, `AGENTS.md`, `CHANGELOG.md`, `HANDOFF.md`, comprehensive `.gitignore`.

### Notes
- Phase 0 definition-of-done items still pending: Vercel deploy (H3 — owner-blocked), Sentry + PostHog wiring, Playwright e2e tests, Husky pre-push hook, Google + Apple OAuth provider setup. Tracked in `HANDOFF.md`.
