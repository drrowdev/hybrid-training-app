# Hybrid Training App

Science-informed hybrid training with adaptive load management — a public-ready, multi-user training app for serious recreational athletes who train across strength + endurance.

**Status:** Production. Multi-user, mobile-ready, with a five-archetype engine rebalanced through ADRs 0004–0006. Cardio is logged manually or linked from an already-recorded activity (the Strava integration was retired — Strava now charges for API access). See `HANDOFF.md` for the current-state snapshot and `CHANGELOG.md` for the running cycle log.

---

## What this is

An opinionated, principle-driven training app that treats hybrid training as a first-class concern. The engine reasons in five archetypes (`balanced_hybrid_build`, `strength_biased_hybrid`, `aesthetic_hybrid`, `engine_biased_hybrid`, `rebuild_return`) parameterised by user inputs, and respects a stress-budget model spanning six buckets (neural, mechanical, metabolic, impact, axial, tissue) and seven body regions.

The engine is **methodology-pure**: zero external program names appear in the catalog, data model, or engine. Marketing comparisons only.

For the conceptual framework, engine math, and 108 testable constraints driving the implementation, see [`docs/knowledge/`](./docs/knowledge/).

## Repo layout

```
hybrid-training-app/
├── apps/
│   └── web/                Next.js 16 app (UI + server actions + API routes)
├── packages/
│   ├── domain/             Pure TS: ceiling math, region freshness, EWMAs, RPE helpers
│   ├── db/                 Drizzle schema + zod schemas + typed client
│   ├── engine/             v2 archetype budgets, bucket pressure, stall diagnosis, modality-aware concurrent scalar
│   └── ui/                 shadcn/ui components shared web ↔ Capacitor
├── docs/
│   ├── knowledge/          The maintained wiki (plan, research, design constraints, log, index)
│   └── adr/                Architecture Decision Records
└── .github/workflows/      CI + deploy
```

## Quick start

```powershell
# From repo root, after cloning:
pnpm install
pnpm typecheck
pnpm test
pnpm dev          # runs apps/web on http://localhost:3000
```

You'll need a `.env.local` in `apps/web/` (and one in `packages/db/` for migrations) — see `apps/web/.env.example`.

### Required environment variables

- `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` — Supabase project credentials.
- `DATABASE_URL` — Drizzle migration target.
- `NEXT_PUBLIC_SITE_URL` — canonical public URL used by Supabase Auth redirects.

## Stack

| Layer | Choice |
|---|---|
| Framework | Next.js 16 (App Router) |
| Language | TypeScript (strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`) |
| Database | PostgreSQL via Supabase (EU-central region) |
| ORM | Drizzle ORM |
| Auth | Supabase Auth (`@supabase/ssr`) |
| Styling | Tailwind v4 + shadcn/ui |
| Data fetching | TanStack Query |
| Forms | React Hook Form + Zod |
| Hosting | Vercel (web) + Supabase (DB) |
| Cardio | Logged in-app (manual entry, or link an activity you already recorded elsewhere) |
| Errors / analytics | Sentry + PostHog (Phase 0 stub) |

## MVP scope

See [`docs/knowledge/design-constraints.md` § U](./docs/knowledge/design-constraints.md). Headline: pre-session 2-slider check-in (fatigue + soreness), user-logged cardio, derived region freshness from logged training, structured `limitations` table for injuries. No HRV, no AI, no daily symptom self-report in v1.

## Cardio logging

Cardio is entered in-app: log it directly on a planned cardio slot, or use
**Link activity** to attach a run/ride you already logged in the app to an
unfulfilled planned slot. Heart-rate zone distribution (`cardio_logs.hr_zones`)
drives intensity in the engine; HR bands are set in Settings → HR zones and
re-bucketing retained history is handled by `lib/cardio/hr-histogram.ts`.

The third-party activity-sync integration was removed in 2026-08 because the
upstream provider began charging for API access. Historical imported rows and
their columns (`cardio_logs.strava_activity_id`, `external_source`,
`hr_histogram`, `hr_zones`, `inferred_kind`, `inferred_confidence`,
`sessions.strava_activity_id`) are **retained** — `inferred_kind` still feeds
effective stress load. See `docs/knowledge/log.md` (2026-08-17).

## Contributing / agent handoff

See `AGENTS.md` for conventions and `HANDOFF.md` for the current-state snapshot.
