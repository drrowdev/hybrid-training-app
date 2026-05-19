# HANDOFF.md

Current-state snapshot. Updated by whoever last touched the repo. Read this before resuming work.

**Last updated:** 2026-05-19

## Where we are

**Phase:** F (first commits per plan §9). Solo-doable items 1–4, 7, 10 done in this session.

**Done in this commit:**
- pnpm monorepo scaffold (`pnpm-workspace.yaml`, root `package.json`)
- Next.js 16 in `apps/web` (TypeScript strict, Tailwind v4, App Router, ESLint, src/, `@/*` alias)
- `packages/domain` — `computeRegionFreshness` (DC-C14) + `ewmaStep` (DC-C1) with Vitest tests including the worked-example fixture
- `packages/db` — Drizzle schema: `profiles`, `limitations` (DC-V1 + DC-A6 region enum + severity enum), `movements` (DC-D4 interference_cost enum). Zod schemas via `drizzle-zod`. Postgres client factory in `client.ts`. `drizzle.config.ts` reads `DATABASE_URL` from env.
- `packages/engine` and `packages/ui` — stub packages
- `docs/knowledge/` — wiki bootstrap: plan + three research files + design constraints + index + log (copied/moved from the planning workspace)
- Root docs: `README.md`, `AGENTS.md`, `CHANGELOG.md`, `HANDOFF.md` (this file)
- Strict `tsconfig.base.json`, comprehensive `.gitignore`
- Git initialised at monorepo root (single repo, not nested)

## What's blocked on the owner

Plan §9 step numbering preserved.

| # | Item | What's needed |
|---|---|---|
| H1 | **Supabase project** | Owner creates a free-tier Supabase project in `eu-central-1` (or `eu-west-1`). Capture `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and the Postgres `DATABASE_URL` (Connection string → URI) |
| H2 | **GitHub remote** | First commit on `main` ready. Owner-approved: run `gh repo create drrowdev/hybrid-training-app --private --source . --remote origin --push` from `C:\code\hybrid-training-app` |
| H3 | **Vercel project** | After H2 push, connect the repo in Vercel; add the four env vars from H1 |
| H4 | **Sentry + PostHog DSNs** | Optional for Phase 0; stubbed in code. Add later when desired |
| H5 | **Resend Gmail sender** | Deferred per Q5; Supabase Auth's built-in transport covers signup OTP/magic-link without it |

## Next solo items (after H1 lands)

In order:

1. `pnpm install` at root
2. `apps/web/.env.example` + add Supabase deps to `apps/web/package.json` (`@supabase/ssr`, `@supabase/supabase-js`)
3. Auth flows: signup, login (email/password + magic link), Google + Apple OAuth wiring, signout, **account-delete endpoint** that cascades to `profiles` + `limitations`
4. RLS migrations in `packages/db/drizzle/`: `profiles.id = auth.uid()`, `limitations.user_id = auth.uid()`, `movements`: user-owned rows scoped + global-seed rows readable to all
5. Multi-user E2E test scaffold in `apps/web` (Playwright): two browser contexts, verify RLS isolation on `profiles` and `limitations`
6. CI workflows: `.github/workflows/{ci,deploy,security}.yml` — lint + typecheck + test + build; pre-push git hook installed via Husky
7. Health-check endpoint exercising DB + auth
8. `docs/adr/0001-stack-choice.md` capturing Phase D verdicts (Supabase, EU-central, web-first, methodology-pure)

## Conventions reminder

- Every code commit AI assistants make includes the trailer: `Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>`
- Every change to wiki pages appends to `docs/knowledge/hybrid-training-log.md`
- Every new wiki page is added to `docs/knowledge/hybrid-training-index.md`
- Phase 0 is "no features visible yet." Out-of-scope work goes to backlog.
