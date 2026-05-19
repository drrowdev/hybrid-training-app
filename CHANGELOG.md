# Changelog

All notable changes to this project will be documented in this file.
The format is loosely based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added
- Phase 0 monorepo scaffold: pnpm workspaces, Next.js 16 in `apps/web`, empty `packages/{domain,db,engine,ui}`.
- `packages/domain`: first canonical function — `computeRegionFreshness` per DC-C14 — with Vitest coverage including the "morning after heavy squats" worked example.
- `packages/db`: Drizzle schema for `profiles`, `limitations` (DC-V1), `movements` with `interference_cost` enum (DC-D4) and the seven-region enum (DC-A6). Zod schemas via `drizzle-zod`.
- `packages/engine`: stub package.
- `packages/ui`: stub package.
- `docs/knowledge/`: wiki seed (plan, three research files, design constraints, index, log) imported from the planning workspace.
- Root `README.md`, `AGENTS.md`, `CHANGELOG.md`, `HANDOFF.md`.
- Strict `tsconfig.base.json` (target ES2022, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`).
- Comprehensive `.gitignore` covering Node, Next, Drizzle journal, env files, Vercel, OS junk.

### Notes
- Phase 0 definition-of-done items still pending: Supabase project provisioning (owner), Supabase Auth wiring + account-delete endpoint, RLS migrations, multi-user e2e test, Sentry + PostHog wiring, Vercel deploy, CI workflows, pre-push git hook. Tracked in `HANDOFF.md`.
