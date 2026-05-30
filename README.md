# Hybrid Training App

Science-informed hybrid training with adaptive load management — a public-ready, multi-user training app for serious recreational athletes who train across strength + endurance.

**Status:** Production. Multi-user, mobile-ready, with AI (Explain v1 + BYOAI), an MCP server for external clients, end-to-end Strava integration, and a five-archetype engine rebalanced through ADRs 0004–0006. See `HANDOFF.md` for the current-state snapshot and `CHANGELOG.md` for the running cycle log. ~2500 tests passing.

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
- `AI_KEY_ENCRYPTION_KEY` — pgcrypto master key for the BYOAI key vault (ADR 0002).
- `MCP_TOKEN_SIGNING_KEY` — HMAC secret (≥ 32 chars) used to sign MCP bearer tokens and authorization codes (ADR 0003). **Required** at runtime when the `/mcp/*` routes are reachable.
- `STRAVA_CLIENT_ID` / `STRAVA_CLIENT_SECRET` — Strava OAuth app credentials.
- `STRAVA_WEBHOOK_VERIFY_TOKEN` — opaque string Strava echoes back during webhook verification.
- `STRAVA_WEBHOOK_CALLBACK_URL` — public URL of `/api/integrations/strava/webhook`.
- `STRAVA_WEBHOOK_SUBSCRIPTION_ID` — numeric id returned by Strava after `strava:subscribe`; the webhook handler rejects any event whose `subscription_id` doesn't match.

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
| Cardio | Strava integration — OAuth + push-subscription webhook + history import |
| AI | Pluggable `LlmProvider` (Anthropic / OpenAI / Gemini) with BYOAI vault (ADR 0002); MCP server at `/mcp` with OAuth 2.1 bridge (ADR 0003) |
| Errors / analytics | Sentry + PostHog (Phase 0 stub) |

## MVP scope

See [`docs/knowledge/design-constraints.md` § U](./docs/knowledge/design-constraints.md). Headline: pre-session 2-slider check-in (fatigue + soreness), Strava-pulled cardio, derived region freshness from logged training, structured `limitations` table for injuries. No HRV, no AI, no daily symptom self-report in v1.

## Strava push-subscription (webhook)

Cardio sessions auto-refresh via Strava's webhook API. One-time setup per environment, after the webhook route is deployed and reachable:

1. Set the four env vars in `apps/web/.env.example`: `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET`, `STRAVA_WEBHOOK_VERIFY_TOKEN` (any opaque string), and `STRAVA_WEBHOOK_CALLBACK_URL` (the public URL of `/api/integrations/strava/webhook`).
2. Register the subscription: `pnpm --filter @hta/web run strava:subscribe`. Strava replies with a numeric subscription id — paste it into `STRAVA_WEBHOOK_SUBSCRIPTION_ID` and redeploy. The webhook handler rejects events whose `subscription_id` doesn't match.
3. Inspect / clean up existing subscriptions with `pnpm --filter @hta/web run strava:list-subscriptions`.

Idempotency is enforced by the `strava_event_log` table (UNIQUE on `(subscription_id, event_time, object_id, aspect_type)`) — duplicate redeliveries are silently dropped.

## Contributing / agent handoff

See `AGENTS.md` for conventions and `HANDOFF.md` for the current-state snapshot.
