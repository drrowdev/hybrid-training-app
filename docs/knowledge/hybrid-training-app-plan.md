# Hybrid Training App — Project Plan & Architecture

**Status:** Planning. No code yet.
**Date drafted:** 2026-05-19

---

## 1. Purpose of this document

Hand-off brief for a new AI assistant (or future self) starting a fresh codebase. The goal is a **public-ready, multi-user training app** that implements an **adaptive hybrid programming engine** built on the principles in `hybrid-training-research-v1.md`, the engineering spec in `hybrid-training-research-v2.md`, and the literature-grounded translation rules in `hybrid-training-research-new.md`. The engine reasons in v2's vocabulary — buckets, regions, archetypes, ceilings — and treats hybrid training (strength + endurance) as a first-class concern, not an afterthought.

The engine is **methodology-pure**: it has no concept of any specific external program. Users pick an archetype (Strength Anchor, Hypertrophy Anchor, Endurance Anchor, Concurrent Hybrid, Maintenance / Recovery, etc.) parameterized by their inputs. Marketing copy may compare archetypes to well-known programs ("if you've run X-style programming, you'll recognize our Strength Anchor"), but no external program names appear in the catalog, the data model, or the engine. This avoids trademark exposure and prevents the engine from being shaped by any one methodology's quirks.

### Companion documents

This plan is one of four documents the next AI must read together:

| Doc | Role |
|---|---|
| **`hybrid-training-app-plan.md`** (this file) | High-level orchestrator — scope, architecture, phasing, conventions, onboarding protocol |
| **`hybrid-training-research-v1.md`** | Conceptual framework — anchor-filler model, stress-budget concept, five structural rules, durability framing, aesthetics layer, app architecture overview |
| **`hybrid-training-research-v2.md`** | Engine math spec — ceiling equation, recovery multiplier, bucket pressure, archetype specs with budgets, user-tier inference, stall diagnosis, data model, pseudocode |
| **`hybrid-training-research-new.md`** | Literature grounding + translation rules — citations with HIGH/MODERATE/LOW confidence labels, MV/MEV/MAV/MRV framework, polarized 80/20 data, modality interference table, "Translation to app logic" code blocks per section, monitoring-stack priority, pre-mortem |

The three research files are **complementary, not redundant.** v1 establishes the vocabulary (anchor-filler, buckets, stress budget). v2 turns v1's concepts into computable math (ceiling equation, multipliers, archetype budgets). `new` adds peer-reviewed grounding (with confidence labels), explicit literature-derived thresholds, and lift-ready "Translation to app logic" code blocks.

**When the three converge on a principle, that's the strongest signal — extract it as a design constraint with all three citations. When they diverge, `new`'s HIGH/MODERATE/LOW confidence labels are the primary tiebreaker on numerical thresholds; otherwise flag the conflict for the project owner in Phase D.**

Phase A of the onboarding protocol (§8) reads this file. Phase B reads all three research files. Phase C extracts a `docs/design-constraints.md` in the new repo that bridges plan ↔ research and becomes the engine's testable requirements.

The new AI should treat the sections below as the source of truth for scope, architecture, and phasing.

---

## 2. Product identity

### 2.1 What it is

A web-based training app for serious recreational athletes who train across multiple disciplines (strength + running, strength + cycling, hybrid CrossFit-style work) and want a single source of truth for their programming, logging, and analytics.

It is **opinionated about training principles** (progressive overload, submaximal work, fatigue management, periodization, variation rotation — see the research files) but **not opinionated about which named program you must follow**. The user picks an archetype (or asks the AI to pick), and the app generates appropriate programming.

### 2.2 What it is NOT

- Not a generic workout logger (those are powerful but methodology-blind).
- Not a single-methodology vertical (those are opinionated about one named program; this engine is principle-driven and methodology-pure).
- Not a coaching marketplace (no human coaches).
- Not a social network (no feed, no followers — but exporting / sharing PRs is fine).

### 2.3 Who it is for

The persona: a hybrid athlete who is past beginner, knows what RPE is, lifts 2–4 times a week, runs / cycles / etc. another 2–5 days, has occasional races / events, dislikes ambiguity in programming, and wants the app to be **smart about fatigue and recovery** across both strength and endurance.

Not for: complete beginners (those need a guided path, not a flexible engine), bodybuilders only (the cardio integration is overkill), or strength-sport-only athletes prepping a meet (use an opinionated meet-prep tool).

---

## 3. Hybrid training principles — see the three research files

The training principles that this app must encode are documented in three separate research files in this folder, each with a distinct role:

- **`hybrid-training-research-v1.md`** — conceptual framework (anchor-filler model, stress-budget concept, five structural rules, durability architecture, aesthetics layer, app-architecture overview)
- **`hybrid-training-research-v2.md`** — engineering spec (ceiling equation, recovery multiplier, bucket pressure, mesocycle archetype specs with stress budgets, user-tier inference, stall diagnosis decision tree, AI-readable data model, planning pseudocode)
- **`hybrid-training-research-new.md`** — literature grounding (citations with HIGH/MODERATE/LOW confidence labels, MV/MEV/MAV/MRV framework, polarized 80/20 data, modality interference table, "Translation to app logic" code blocks per section, monitoring stack priority, pre-mortem)

Read v1 first, then v2 (it depends on v1's vocabulary), then `new` (it complements and validates both). v1 establishes vocabulary; v2 turns it into math; `new` grounds it in cited literature with confidence labels.

**What the next AI must do with all three — not optional:**

1. **Read v1 in full.** ~45 minutes. The anchor-filler model and stress-budget concept are referenced throughout v2.

2. **Read v2 in full.** ~60 minutes. Mesocycle archetypes (§4) and stall-diagnosis decision tree (§6) are particularly load-bearing.

3. **Read `new` in full.** ~45 minutes. The "Translation to app logic" code blocks at the end of each section are lift-ready engineering inputs.

4. **Extract `docs/design-constraints.md` cross-validating across the three.** Each constraint should cite EVERY file that supports it. Format:

   > **DCI-spacing (v1 §2 Rule 3 + v2 §3.8 + new §1.3, Wilson 2012 meta HIGH; Robineau 2016 HIGH)** — scheduler defaults to ≥ 24h between max-effort lower-body lifts and threshold/VO2 runs. Override-settable. Conflict-matrix coefficient: 0.85 per v2 §3.8 default. Unit test: scheduling these two on the same day with no override raises a warning. Confidence: HIGH (supported by all three sources, peer-reviewed meta).

   The format makes convergence visible:
   - **3-source agreement → HIGH confidence**, encode as a default
   - **2-source agreement → HIGH-MODERATE**, encode as a default
   - **1-source only → MODERATE-LOW**, flag for review in Phase D
   - **Conflict between sources → resolve in Phase D**, with `new`'s confidence labels as primary tiebreaker for numerical thresholds

   Aim for 60–100 constraints. The three files together have enough density to support this without padding.

5. **Surface conflicts proactively.** When v1/v2/`new` disagree, document it explicitly in `## Open conflicts` at the bottom of `design-constraints.md`. Common conflict shapes to look for: numerical thresholds, categorical claims about interference cost, differing emphasis on the same concept.

6. **Embed in tests.** Every design constraint that touches the engine gets at least one unit test in `packages/domain` that fails if the constraint is violated. Constraints derived from `new`'s "Translation to app logic" code blocks are particularly easy to test — they already specify the if/then rules.

7. **Carry v2's data model forward.** v2 §10 already specifies an AI-readable data model. Use it as the starting shape for the Drizzle schema in §4.3 of this plan. When v2's shape conflicts with `new`'s implicit data needs (e.g. `new` expects per-modality interference-cost tags on sessions), extend v2's model — don't replace it.

The engine should let the user override any principle (with a warning) but **default to the principle** when generating programs or recommendations. When defaults are derived from `new`'s HIGH-confidence citations, the warning should mention "this default is from peer-reviewed literature."

### 3.1 Starting point — existing constraints draft

A previous AI session has already produced a Phase C v1 draft at:

  `hybrid-training-design-constraints-draft1.md` (sibling file)

It contains 65 testable constraints across 6 categories, derived from v1 + v2 + this plan only. It was produced **before** `hybrid-training-research-new.md` existed. Your Phase C job is to refine that draft by integrating `new`, not to start fresh — see Phase C in §8 for explicit integration rules.

---

## 4. Architecture

### 4.1 Stack

| Layer | Choice | Rationale |
|---|---|---|
| **Framework** | Next.js 15+ (App Router) | Server Components + Server Actions remove the "API route" boilerplate. |
| **Language** | TypeScript (strict) | Non-negotiable. |
| **Database** | PostgreSQL via Supabase OR Neon | Multi-tenant from day one. Row-level security. Generous free tier. PostgreSQL is the right primitive for relational training data (sessions → sets → movements, programs → blocks → days). |
| **ORM** | Drizzle ORM | TypeScript-first, generates types from schema, fast migrations. |
| **Auth** | Better Auth OR Supabase Auth | Email + password, magic link, Google + Apple SSO from day one. Both have generous free tiers. Better Auth gives more control; Supabase Auth is bundled with the DB. |
| **Styling** | Tailwind v4 + shadcn/ui | Battle-tested. |
| **State / data** | TanStack Query (React Query) | Server-as-source-of-truth. |
| **Forms** | React Hook Form + Zod | Standard. |
| **Hosting (web)** | Vercel | Native Next.js. Generous hobby tier; cheap on Pro. |
| **Hosting (DB)** | Supabase or Neon | Both have generous free tiers; both scale. |
| **File storage** | Cloudflare R2 (S3-compatible) | Cheap, no egress fees. For user avatars, progress photos, exports. |
| **Email** | Resend | Modern, simple API, generous free tier. |
| **Analytics** | PostHog (self-hostable later) | Free tier, with proper consent flow. |
| **Error tracking** | Sentry | Free tier covers solo dev. |
| **Payments (later)** | Stripe | Industry standard. Defer until pricing is real. |
| **iOS shell** | Capacitor 7 | Defer to Phase 2 unless mobile-first is mandatory. |

### 4.2 Repo layout

Monorepo with pnpm workspaces.

```
hybrid-training-app/
├── apps/
│   ├── web/                  Next.js app (UI + server actions + API routes)
│   └── ios/                  Capacitor shell (Phase 2)
├── packages/
│   ├── domain/               Pure TS: scheduling logic, periodization helpers,
│   │                         RPE math, load models, etc. Heavily tested.
│   ├── db/                   Drizzle schema + migrations + zod schemas
│   ├── ui/                   shadcn/ui components shared between web + native
│   └── engine/               The hybrid programming engine — implements v2's
│                             ceiling math, archetype budgets, bucket pressure,
│                             stall diagnosis. Heavily tested.
├── infra/                    Terraform / Pulumi (if needed) — defer.
├── .github/workflows/        CI + deploy + cron
├── AGENTS.md
├── HANDOFF.md
├── CHANGELOG.md
└── README.md
```

### 4.3 Data model (high-level)

> **Important:** `hybrid-training-research-v2.md` §10 already specifies an engine-flavored data model (User, Block, BucketState, RegionState, Ceiling, Workout, Diagnosis). When v2's shape conflicts with the table below, **v2 wins** — it's more thought-through. This section captures the orthogonal infrastructure tables (auth, profiles, audit, notifications) that v2 doesn't cover. Keep both consistent when laying down the Drizzle schema.

Tables — RLS-protected by `user_id` everywhere except shared catalogs:

| Table | Purpose | Notes |
|---|---|---|
| `users` | Auth identity | From Better Auth / Supabase Auth. Don't extend it; create a `profiles` row. |
| `profiles` | App-level user data | `displayName`, `timezone`, `units` (kg/lb), `bodyweightKg`, `createdAt`, etc. 1:1 with `users`. |
| `movements` | Movement library | Shared seed data + per-user custom. Organize by **pattern + region** per v2's vocabulary. Fields: `pattern`, `primaryRegions[]`, `equipment`, `primaryMuscles[]`, `secondaryMuscles[]`, `isCompound`, `interferenceCost` (from `new` §1.2), `notes`. |
| `archetypes` | Engine archetype definitions | Seed data + admin-managed. Strength Anchor, Hypertrophy Anchor, Endurance Anchor, Concurrent Hybrid, Maintenance / Recovery (per v2 §4). Each row has a `definition` JSONB carrying the stress-budget allocation, weekly template, deload rule, entry condition, exit rule. |
| `programs` | A user's running program | `userId`, `name`, `archetypeId` (FK to `archetypes`), `startedAt`, `completedAt`, `definition` JSONB (per-program overrides), `targetWeeks` |
| `blocks` | A mesocycle within a program | `programId`, `sequenceIndex`, `kind` (accumulation/intensification/realization/deload/test), `weeks`, `startedAt`, `completedAt`, `definition` JSONB |
| `block_days` | A planned day within a block | `blockId`, `weekIndex`, `dayIndex`, `kind` (strength/cardio/rest/active-recovery), `definition` JSONB |
| `sessions` | An actual training session | `userId`, `blockDayId?` (nullable — ad-hoc sessions allowed), `performedAt`, `durationMin?`, `notes?`, `sessionRpe?` (overall session RPE), `completedAt`, `bucketCoeffs` JSONB (6-bucket allocation per v2 §3.1), `regionCoeffs` JSONB |
| `set_logs` | Per-set strength logs | `sessionId`, `movementId`, `weightKg`, `reps`, `rpe?`, `kind` (warmup/main/back-off/accessory/tendon), `percentOfTm?`, `notes?` |
| `cardio_logs` | Cardio session logs | `sessionId`, `modality`, `durationSec`, `distanceKm?`, `avgHrBpm?`, `avgPaceSecPerKm?`, `hrZones?` JSONB |
| `wellness` | Daily wellness entries | `userId`, `date`, `sleepHours?`, `fatigue?`, `soreness?`, `bodyweightKg?`, `notes?` |
| `bucket_state` | Rolling load state per user × bucket | `userId`, `bucket`, `acuteLoad`, `chronicLoad`, `recoveryMultiplier`, `updatedAt`. Per v2 §3.2. |
| `region_state` | Rolling load state per user × region | `userId`, `region`, `accumulatedLoad`, `capUsageFraction`, `updatedAt`. Per v2 §3.9. |
| `ceilings` | Per-user × bucket recovered tolerance | `userId`, `bucket`, `baseCeiling`, `modifierStack` JSONB, `finalCeiling`, `computedAt`. Per v2 §3.10–3.11. |
| `goals` | User goals | `userId`, `kind` (strength/hypertrophy/race/bodyweight/etc.), `target?`, `targetDate?`, `priority`, `status` |
| `events` | Race / event calendar | `userId`, `name`, `date`, `kind` (5k/10k/half/full/ultra/cycling/multisport/…), `priority` (A/B/C), `target?`, `result?` |
| `limitations` | Active limitations | `userId`, `area`, `severity`, `startedAt`, `resolvedAt?`, `adjustments` JSONB (movement swaps, region caps) |
| `notifications` | In-app inbox | `userId`, `channel`, `title`, `body`, `dueAt?`, `readAt?`, `deepLink?`, `idempotencyKey?` (DB unique constraint for cross-device dedupe) |
| `audit_log` | Server-side action log | `userId`, `action`, `tableName`, `recordId?`, `payload` JSONB, `at`. Append-only. |

Phase 0 doesn't need all of these. Start with `users`, `profiles`, `movements`, `sessions`, `set_logs`, `cardio_logs`, `wellness`. Add the rest as features land.

### 4.4 Auth + multi-tenancy

- Every table (except shared catalogs like `archetypes` + seed `movements`) has a `userId` column.
- **PostgreSQL Row-Level Security** policies on every table: `USING (user_id = current_setting('app.user_id')::uuid)`.
- Server actions set the session variable from the auth context before any query.
- Audit log is append-only (no UPDATE / DELETE).
- Account deletion is a hard requirement (GDPR Article 17). Build the "delete my data" endpoint in Phase 0, even if the rest of the app is minimal.
- Data export ("give me everything you have on me") in Phase 1.

### 4.5 Privacy / GDPR / Data residency

- EU users: data hosted in EU region (Supabase / Neon both support eu-central). Default to EU.
- Cookie consent banner from day one (use a vetted library; don't roll your own).
- Privacy policy + ToS pages before public launch. Use a template (e.g. Termly).
- No PII in URLs, logs, or telemetry without consent.
- Email is the only PII required at signup. Display name is optional.

### 4.6 Performance / cost targets

| Metric | Target | Why |
|---|---|---|
| Time to log a set | < 500ms server-to-paint | Mid-workout latency tolerance is low. |
| Session-write cost | < 1ms server time per set | Cheap to remain on hobby tiers up to ~10k users. |
| Cold DB query cost | < 50ms p95 | RLS + Postgres + good indices easily clear this. |
| First-load JS bundle | < 200 KB compressed | Mobile data tolerance. |
| Lighthouse perf | > 90 on the logging page | Non-negotiable for in-gym UX. |

### 4.7 Server-as-source-of-truth, client-as-cache

The client is a cache, never the source of truth. All writes go through server actions which validate auth, run RLS, write to Postgres, and return canonical state. Reads use TanStack Query with stale-while-revalidate. No client-side databases (no Dexie, no IndexedDB persistence beyond TanStack's normal cache). Offline support is a Phase-3 feature (Service Worker + sync queue with conflict resolution backed by a real CRDT or operational-transform library), not a Phase-0 default.

This is a load-bearing decision. Client-first architectures with last-write-wins sync are intrinsically fragile in multi-device scenarios — they cause data-loss incidents that compound over time. Server-first eliminates that class of bug.

---

## 5. Phased roadmap

Each phase is roughly 4–6 weeks of evening work for a solo dev. Multiply by team size or reduce for full-time.

### Phase 0 — Foundation (no features visible yet)

**Definition of done:** an empty app deployed at a real URL, with auth, multi-tenancy, and the dev/CI loop working end-to-end.

- Next.js 15 app scaffolded, deployed to Vercel
- Postgres provisioned (Supabase or Neon), Drizzle schema for `users` + `profiles` + minimal seed `movements`, RLS enabled and verified
- Auth working: email/password + magic link + Google SSO + Apple SSO. Account-delete endpoint live.
- CI: lint, typecheck, unit tests, build, deploy on push
- `AGENTS.md`, `CHANGELOG.md`, `HANDOFF.md`, `README.md` in place
- Sentry + PostHog wired with proper consent flow
- Privacy policy + ToS pages (placeholder content acceptable for now)
- One end-to-end test: user signs up, logs in, gets profile page, deletes account
- **Multi-user e2e test:** sign in as same user on two browser contexts, mutate state on both, verify the server-canonical state matches expectations. This catches sync-style bugs that single-user testing misses.

**Out of scope:** any training features. This phase exists to make sure the multi-user plumbing is rock solid before you build on it.

### Phase 1 — Logging (the only thing that matters for an MVP)

The app's job is "log what I did today and remember it." Nothing else.

- Movement library: seeded with ~250 movements organized by pattern + region (per v2 vocabulary). Include common run / bike / row / swim entries.
- Log a strength session: pick movements, log sets (weight, reps, RPE, kind, notes)
- Log a cardio session: modality, duration, distance, avg HR
- Log daily wellness: sleep, fatigue, soreness, bodyweight
- View today's activity + last 7 days
- View per-movement history (chart of weight × reps over time, PR detection)
- Mobile-first layout for the logging screens — this is where users spend the most time
- Export all data as JSON (GDPR data portability)

**Out of scope:** programs, periodization, AI, planning.

### Phase 2 — Programming (the differentiator)

This is where the app starts being useful beyond a generic logger with cardio.

- `archetypes` table seeded with 5–6 archetype-derived templates (from v2 §4):
  - Strength Anchor archetype
  - Hypertrophy Anchor archetype
  - Endurance Anchor archetype
  - Concurrent / Hybrid archetype (the default for most users)
  - Maintenance / Recovery archetype
- Program engine: read an archetype definition + user inputs (1RM estimates, goals, days/week, equipment), generate a `program` + `blocks` + `block_days` following the v2 planning pseudocode (§11)
- Run a program: today's session is auto-populated from `block_days`; user logs against the plan
- Track progress: per-bucket load trends, per-region accumulated load, per-archetype ceiling utilization, RPE drift
- Calendar view (week / month) of planned + logged sessions
- Manual taper rules (no AI yet): user marks an A-priority event, app suggests a 1–2 week volume cut per v2 + `new` guidance

**Out of scope:** AI-generated programs (those come in Phase 4). The user picks an archetype and parameters; the engine generates.

### Phase 3 — Hybrid features

The hybrid story is the moat.

- Event calendar with priority tiers (A/B/C)
- Endurance plan integration: weekly Z2 / quality / long session slots tied to the strength program
- Multi-bucket load model: per-bucket pressure + recovery multiplier + region caps + ceiling equation per v2 §3, with per-modality interference costs from `new` §1.2
- Race-week taper suggestions (rule-based, not AI)
- Modality-aware scheduling: scheduler knows running has higher interference cost than cycling per `new` §1.2 and proposes substitutions when interference would block a high-priority strength session
- Strava integration: pull cardio activities, match to planned slots
- Garmin integration (later — Connect API is annoying)

### Phase 4 — AI layer (backlog until Phase 3 is solid)

Only build this when the foundation is reliable.

- Coach agent: Q&A, limitation triage, modification suggestions
- Programmer agent: generate a custom program from a free-text user description, calling out to the v2 archetype engine
- Periodizer agent: block-sequencing recommendations + race taper + deload timing using v2's stall-diagnosis decision tree
- Chat orchestrator with tool-use (Anthropic / OpenAI / OSS via OpenRouter)
- Preview-before-write pattern: every AI-driven write goes through a typed proposal schema validated by both client + server, the UI renders a real before/after diff, snapshots persist so undo works
- AI memory implemented as a **per-user wiki** (Karpathy pattern — see §6.10): the coach agent maintains per-user markdown pages on limitations, goals, recurring themes, recent stalls, PR history. The chat snapshot is a query against this wiki, not a flat list of facts. Pages cross-link ("your March shoulder flare-up correlated with three weeks of high-volume pressing — see `themes/pressing-volume.md`"). Storage is cheap; reasoning quality lift is large.
- Per-user rate limits + monthly token budget enforcement
- Server-side prose↔tool consistency check: scan assistant text for "I scheduled X" / "the proposal below" patterns; if no matching tool call, force a retry within the same turn

### Phase 5 — Monetization (only if there's demand)

- Free tier: log strength + cardio + wellness + 1 program at a time, no AI
- Pro tier (~€5–9/mo): unlimited programs, AI access (with monthly token cap), Strava sync, advanced analytics, data export to PDF / CSV
- Annual discount
- Stripe Checkout + Customer Portal
- Family / team plans only if requested

---

## 6. Engineering practices

### 6.1 Branching + deploy

- Main = production. Pushes auto-deploy.
- Feature branches → PR → CI must pass → merge to main.
- No long-lived branches. Trunk-based with small PRs.

### 6.2 Testing

- Domain logic in `packages/domain`, `packages/engine`: unit tests with Vitest. Coverage threshold ≥ 80% for these packages.
- Integration tests for server actions + RLS policies: Vitest + a real Postgres test instance (use Docker locally; testcontainers in CI).
- E2E tests for the critical paths (auth + log + program-run) with Playwright.
- Multi-user / multi-device e2e tests for any feature that touches shared state — catch sync-style races that single-user testing misses.
- No tests in `apps/web` for UI logic that isn't reusable. Test domain, test routes, skip components.

### 6.3 Migrations

- Drizzle migrations checked in. Every PR that changes schema includes the migration.
- Migration naming: `YYYYMMDD-NN-description.sql`.
- Backwards-compatible migrations only on main (column add → fill → switch → column drop in separate PRs).

### 6.4 Observability

- Sentry for client errors + unhandled server errors.
- PostHog for product analytics (with consent).
- Structured logging server-side. JSON to Vercel logs.
- One health-check endpoint that exercises DB + auth.

### 6.5 Security

- RLS on every user-data table.
- All server actions verify the auth session before touching data.
- Rate limiting on auth + write endpoints (use Upstash Redis free tier).
- CSRF tokens on state-changing endpoints (Next.js handles most of this).
- Content Security Policy + secure cookie settings.
- Quarterly dependency audit. Renovate / Dependabot enabled.
- No secrets in the repo. Vercel + Supabase env vars only.

### 6.6 Documentation discipline

- `CHANGELOG.md`'s `[Unreleased]` updated every PR that ships user-visible behavior.
- `AGENTS.md` updated when conventions change.
- ADRs (Architecture Decision Records) for any choice that takes > 30 minutes to debate. Keep them in `docs/adr/NNNN-title.md`.

### 6.7 Pre-push CI gate

- Pre-push git hook runs `pnpm typecheck && pnpm test && pnpm build` and blocks the push on failure. Tedious to set up once, prevents an entire class of production-broken-by-lint deploys.
- CI verifies all three workflows (CI, Security, Deploy) reach success after every push to main. A failed Deploy with a passing CI is a real failure mode — auto-revert is worth the engineering cost.

### 6.8 Schema discipline

- Before adding any persisted field, the proposer must answer two questions: (1) what removes it? (2) is it observable from outside the engine? Fields that fail both go in a `definition` JSONB blob, not a column.
- ADRs for any decision to add a new top-level table column.

### 6.9 Single home for derived state

- Every piece of derived state has one canonical function in `packages/domain` or `packages/engine`. UI never re-derives — it imports the function. Server cache layers store the function's output, not its inputs.
- When two functions compute the same thing, that's a bug, not a coincidence.

### 6.10 Knowledge as a maintained wiki, not RAG over docs

Following Karpathy's [personal-knowledge-base pattern](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f), the engine's domain knowledge is treated as a **persistent, LLM-maintained wiki** rather than ad-hoc RAG over raw documents.

**Three layers:**

1. **Raw sources** (immutable) — `docs/research/` in the repo. Holds the three research papers (`v1.md`, `v2.md`, `new.md`), plus any future cited papers, blog posts, or expert interviews. Never edited.
2. **The wiki** (LLM-owned) — `docs/knowledge/`. Markdown pages per archetype, per bucket, per region, per modality, per movement family, per monitoring metric, etc. Each page is cross-linked, cites the raw sources, and is rewritten incrementally as new sources arrive.
3. **The schema** — `docs/knowledge/AGENTS.md` (separate from the repo-root `AGENTS.md`). Defines ingest workflow, citation format, lint rules, page templates. Co-evolves with the wiki.

**Two index files** (per Karpathy): `index.md` (catalog of all pages with one-line summaries) and `log.md` (append-only chronological record of ingests, queries, lints, with `## [YYYY-MM-DD] kind | title` prefixes for grep).

**Build-time extraction.** A script in `packages/engine` parses the wiki at build time and extracts structured Drizzle seed data (movements, interference coefficients, archetype budgets, ceiling defaults). Tests verify the wiki's numerical claims match what's encoded. This prevents the "markdown drifts away from code" failure mode.

**Operations** (mirror Karpathy):
- **Ingest** — when a new source enters `docs/research/`, the LLM reads it, updates affected wiki pages, appends to `log.md`.
- **Query** — when answering a design or training question, read the wiki first; cite sources via the wiki's already-resolved citations.
- **Lint** — periodic health check: contradictions, stale claims, orphan pages, missing cross-references, data gaps. Run quarterly or after every batch of new sources.

The design-constraints document is a **special wiki page** — it's the testable contract surface that CI enforces, but it sits alongside the rest of the wiki and is maintained the same way.

---

## 7. Open questions for the next AI session

These need answers before / during Phase 0. Ask the project owner before assuming.

1. **Which DB?** Supabase (auth + storage + DB bundled, slight vendor lock-in) vs Neon (DB only, more BYO but more flexibility).
2. **Auth library?** Better Auth (newer, full control, more code) vs Supabase Auth (bundled, less code, vendor-tied).
3. **Region?** EU-central if GDPR-first; us-east otherwise. (Recommend EU.)
4. **Pricing intent?** Free + Pro from day one (helps shape the data model) OR free for all + pricing later (delays the Stripe work).
5. **Domain name?** Choose early — affects email sender domain.
6. **Methodology naming?** The engine is methodology-pure (see §1). Confirm: zero external program names in the catalog, data model, or engine. Marketing comparisons only.
7. **Native iOS day one or web-first?** Recommend web-first, Capacitor wrap in Phase 2.
8. **Public launch criteria?** Define before Phase 3. (e.g., "100 users using it weekly for 4 weeks" or "personal use is rock solid for 3 months").

---

## 8. Onboarding protocol for the next AI session

This is a phased read / extract / clarify / build protocol. Don't skip phases; don't reorder them. **Do not write code before Phase E is complete.**

### Phase A — Orientation (~15 minutes)

Read this document (`hybrid-training-app-plan.md`) end-to-end. Note the §7 open questions; you'll resolve them in Phase D.

### Phase B — Domain knowledge (~150 minutes total)

Read all three research files in order. They build on each other and cross-validate.

**B1 — Read `hybrid-training-research-v1.md` (~45 min).** Conceptual framework. Take notes especially on: the priority-weighted concurrency model (§1), the five structural rules (§2), the conditioning-modality interference profile (§3), the durability architecture (§4), the mesocycle archetypes (§5), the anchor-filler model (§11), and the recommended default product stance (§13).

**B2 — Read `hybrid-training-research-v2.md` (~60 min).** Engineering spec. Critical sections: the ceiling-calculation model (§3, all sub-sections), mesocycle archetype specifications (§4), user-tier inference (§5), the stall-diagnosis decision tree (§6), the AI-readable data model (§10), and the planning pseudocode (§11). The math in §3 is the heart of the engine — understand it before extracting constraints.

**B3 — Read `hybrid-training-research-new.md` (~45 min).** Literature-grounded translation rules. Critical sections: the modality interference table (§1.2), the MV/MEV/MAV/MRV framework under concurrent stress (§2.1), the polarized 80/20 data (§3.1), the Baar tendon framework (§4.2), the deload logic (§5.3), the monitoring stack priority (§6.2), the architectural skeleton (§9), and the pre-mortem (§10). **Every section ends with a "Translation to app logic" code block — these are lift-ready engineering inputs.** Note any HIGH/MODERATE/LOW confidence labels next to claims that contradict v1 or v2 — those are Phase D resolution items.

### Phase C — Extract / refine design constraints (~60 minutes)

**Starting point exists.** An earlier AI session has already produced a Phase C v1 draft at:

  `hybrid-training-design-constraints-draft1.md` (sibling file)

It contains 65 testable constraints across 6 categories (canonical units, allocation, sequencing, load model, monitoring, archetypes), all derived from v1 + v2 + this plan. **It was produced before `hybrid-training-research-new.md` existed** — and so does NOT integrate the literature citations, the modality interference table, the MV/MEV/MAV/MRV framework, the polarized 80/20 data, the Baar tendon framework, the monitoring-stack priority, or the pre-mortem failure modes from `new`.

Your job in Phase C: **read the draft, then refine it by integrating `new`.** Specifically:

1. For every existing constraint, check whether `new` agrees, adds nuance, or contradicts. Update the citation line + constraint text accordingly (see the draft1 file's status banner for explicit rules).
2. Add new constraints for principles `new` covers that v1+v2 didn't surface — the modality interference table, MV/MEV/MAV/MRV under concurrent stress, the 6-hour AMPK/mTORC1 refractory window, the Baar tendon framework with specific isometric protocols, the monitoring-stack priority, the polarized 80/20 distribution, and pre-mortem-derived constraints (e.g. explicit override path with consent).
3. Apply confidence labels at the end of every constraint:
   - **3-source agreement → HIGH** (encode as strict default)
   - **2-source agreement → HIGH-MODERATE** (encode as default)
   - **1-source only → MODERATE-LOW** (flag for Phase D review)
   - **In `new` cited as `HIGH` from peer-reviewed meta** → upgrade one tier
4. Surface conflicts in a `## Open conflicts` section. These go to the project owner in Phase D.

Target: **60–100 constraints**. The draft is at 65; integrating `new` should add 15–30 more without padding.

Save the refined result as `hybrid-training-design-constraints.md` (drop the `-draft1` suffix) in the same folder for now. It will move to `docs/knowledge/design-constraints.md` of the new repo when the repo exists.

**Also bootstrap the wiki structure** (per §6.10 — Karpathy pattern). In the same folder, create:

- `hybrid-training-index.md` — one-line catalog of all five hand-off files (plan + 3 research + design-constraints) with a short blurb each, organized by role (sources / wiki / schema). This is the seed of `docs/knowledge/index.md`.
- `hybrid-training-log.md` — append-only log with `## [YYYY-MM-DD] kind | title` entries. Seed with the historical ingests we already know about (the day v1 was ingested, v2, `new`, the draft1 constraints extract, and this Phase C refinement as the latest entry). Brief — 1–2 lines per entry. This is the seed of `docs/knowledge/log.md`.

Both files become the wiki's navigation surface and survive the move into the new repo.

### Phase D — Resolve open questions with the project owner

Pause and ask. Items to resolve:

1. The §7 open questions in this plan (DB, auth, region, pricing intent, domain name, methodology naming confirmation, day-one platform, public-launch criteria).
2. Every conflict you surfaced in your `design-constraints.md` Open conflicts section.
3. Anything in the research you couldn't reconcile.

**Do not assume a default for any of these.** RLS misconfiguration and conflict-resolution defaults are all "ask, don't guess" categories.

### Phase E — Reference docs (browse, don't memorize)

- Drizzle ORM — Postgres section: https://orm.drizzle.team
- Whichever DB the owner picked: Supabase RLS guide OR Neon multi-tenancy guide
- Next.js Server Actions docs
- Whichever auth the owner picked: Better Auth OR Supabase Auth docs

### Phase F — First commits

Now you can start §9.

---

## 9. First commits in the new repo

A concrete starting sequence the next AI can follow on day one:

1. `pnpm create next-app@latest` with TypeScript, Tailwind, App Router. Reject the defaults that don't fit (e.g. ESLint config — replace with a stricter config).
2. Add pnpm workspace at root; move the `next-app` into `apps/web`. Create empty `packages/domain`, `packages/db`, `packages/engine`, `packages/ui`.
3. Add Drizzle: `drizzle-orm`, `drizzle-kit`, `postgres` client. Wire to a Supabase / Neon dev DB.
4. First Drizzle schema: `users` (managed by auth), `profiles`. First migration. Verify it runs in CI.
5. Auth setup: Better Auth or Supabase Auth. Wire signup + login + magic link. One protected page (`/app`) that shows the current user's email.
6. Account delete endpoint: hard delete of the user + cascade to `profiles`. Verify with a test.
7. RLS policy on `profiles`: `auth.uid() = user_id`. Verify another user can't read your row.
8. Multi-user e2e test (Phase 0 definition-of-done item): two browser contexts, both mutate, verify server-canonical wins.
9. Sentry + PostHog wired. Privacy policy + ToS pages stubbed.
10. Vercel deploy. Custom domain (or vercel.app placeholder if domain isn't picked).
11. CI: lint, typecheck, unit tests, build, deploy. Pre-push git hook installed.

If those 11 steps are green, Phase 0 is done. Start Phase 1.

---

## 10. Signal-quality criteria

The new AI should ask the project owner (or stop and prompt) when:

- A choice that affects multi-tenancy or RLS is ambiguous (don't guess — RLS bugs are catastrophic).
- A scope creep happens (e.g., "while we're here, add social features" — no, defer to backlog).
- A library choice impacts hosting cost meaningfully (e.g., a self-hostable feature that pushes onto a paid tier).
- A user-data migration is required (always pause, review, write the down-migration too).
- A privacy / GDPR question comes up.
- A design constraint or research-document interpretation feels ambiguous.

The new AI should NOT ask the project owner when:

- A library choice is a micro-decision (e.g., `clsx` vs `classnames` — just pick).
- A naming choice for an internal function (just pick).
- Test framework configuration (use Vitest, move on).
- File structure inside `packages/` (mirror the layout in §4.2).

---

**End of plan.** Hand the next AI session four things:

1. This file (`hybrid-training-app-plan.md`).
2. The conceptual framework (`hybrid-training-research-v1.md`).
3. The engineering spec (`hybrid-training-research-v2.md`).
4. The literature-grounded translation rules (`hybrid-training-research-new.md`).

Plus the starting-point constraints draft (`hybrid-training-design-constraints-draft1.md`) which the next AI will refine in Phase C.

The next AI should start with the Phase A → F protocol in §8. No coding before Phase E.
