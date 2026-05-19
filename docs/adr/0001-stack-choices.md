# ADR 0001 — Stack choices for the Hybrid Training App

**Status:** Accepted
**Date:** 2026-05-19
**Phase:** D (resolved during the Phase D session, before any code was written)

## Context

The plan §7 listed eight open questions. The Phase D session of 2026-05-19 closed six of them; two are owner-deferred (domain name, public launch criteria) and tracked separately.

## Decisions

| Topic | Decision | Why |
|---|---|---|
| Database | **Supabase** (managed Postgres) | Bundled auth + storage + DB; cuts Phase 0 wiring time; vendor lock is acceptable for a solo project. Drizzle keeps the SQL layer portable if we ever migrate off |
| Auth library | **Supabase Auth** via `@supabase/ssr` | Matches the DB choice. Out-of-the-box email/password, magic link, Google + Apple OAuth |
| Hosting region | **`aws-eu-west-1`** | GDPR-first; EU residency. Note: Supabase placed the project in `eu-west-1` rather than `eu-central-1`; pooler hostname `aws-0-eu-west-1.pooler.supabase.com` |
| Pricing intent | **Free for all + pricing later** | Defers Stripe; doesn't shape the data model around tiers. A `subscription_tier` column can be added later |
| Methodology naming | **Methodology-pure** (re-confirmed) | Zero external program names in catalog, data model, or engine. Only the five archetypes (`balanced_hybrid_build`, `strength_biased_hybrid`, `aesthetic_hybrid`, `engine_biased_hybrid`, `rebuild_return`). Marketing copy may compare externally |
| Day-one platform | **Web-first**; Capacitor wrap in Phase 2 | Lifts the existing Capacitor scaffold from the wendler-app. PWA explicitly not a substitute |
| Public launch criteria | **Personal-use rock-solid ≥ 8 weeks + anchor-compliance ≥ 90% + zero data-loss + ≥ 1 external alpha for 4 weeks** | Engineer-readable gate; KPI-driven; defined before Phase 3 |

## Owner-deferred (re-open before public launch)

- **Domain name** — interim: personal Gmail as the Resend transactional sender; no custom-domain DNS work in Phase 0
- (none others)

## Consequences

- Two pooler URLs are used: **session pooler** (port 5432) for Drizzle migrations, **transaction pooler** (port 6543) for runtime queries from `apps/web` (one short-lived query per server action).
- Direct connection (port 5432 on `db.<ref>.supabase.co`) is IPv6-only on Supabase free tier and is **not** used.
- The publishable / secret key format (`sb_publishable_…` / `sb_secret_…`) is the modern (April 2026+) Supabase key format — wired into `NEXT_PUBLIC_SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` respectively.

## Verification

The `packages/db/integration-tests/rls.mjs` script proves multi-tenant isolation: 11/11 assertions pass against the live Supabase project, including the FK-cascade chain on `auth.users` deletion.
