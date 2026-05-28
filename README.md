# Hybrid Training App

Science-informed hybrid training with adaptive load management — a public-ready, multi-user training app for serious recreational athletes who train across strength + endurance.

**Status:** Phase 0 — foundation scaffold. No user-visible features yet.

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
│   ├── engine/             v2 archetype budgets, bucket pressure, stall diagnosis (Phase 2+)
│   └── ui/                 shadcn/ui components shared web ↔ Capacitor (Phase 2+)
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

## Stack

| Layer | Choice |
|---|---|
| Framework | Next.js 16 (App Router) |
| Language | TypeScript (strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`) |
| Database | PostgreSQL via Supabase (EU-central region) |
| ORM | Drizzle ORM |
| Auth | Supabase Auth (`@supabase/ssr`) |
| Styling | Tailwind v4 + shadcn/ui |
| Data fetching | TanStack Query (Phase 1) |
| Forms | React Hook Form + Zod |
| Hosting | Vercel (web) + Supabase (DB) |
| Cardio | Strava integration (Phase 1) |
| Errors / analytics | Sentry + PostHog (Phase 0 stub) |

## MVP scope

See [`docs/knowledge/design-constraints.md` § U](./docs/knowledge/design-constraints.md). Headline: pre-session 2-slider check-in (fatigue + soreness), Strava-pulled cardio, derived region freshness from logged training, structured `limitations` table for injuries. No HRV, no AI, no daily symptom self-report in v1.

## Contributing / agent handoff

See `AGENTS.md` for conventions and `HANDOFF.md` for the current-state snapshot.
