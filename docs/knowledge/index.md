# Hybrid Training App — Knowledge Index

**Purpose:** Catalog of all hand-off files for the hybrid training app project. Organized by role in the Karpathy personal-knowledge-base pattern (plan §6.10): raw sources are immutable; wiki pages are LLM-maintained; the schema governs ingest, citation, and lint workflows. This file is the seed of `docs/knowledge/index.md` in the eventual repo.

**Last updated:** 2026-06-01

---

## Raw sources (immutable)

The three research files. Never edited; new sources appended here when ingested.

| File | One-line summary |
|---|---|
| [`hybrid-training-research-v1.md`](./hybrid-training-research-v1.md) | **Conceptual framework.** Anchor-filler model, stress-budget concept, five structural rules, durability-as-loading framing, aesthetics-as-explicit-programming, conditioning-modality interference profile, six-layer app architecture. ~72KB, ~1500 lines. |
| [`hybrid-training-research-v2.md`](./hybrid-training-research-v2.md) | **Engine math spec.** Ceiling equation, recovery multiplier (GRM), bucket pressure, interference modifier, region caps, five archetype specs with stress budgets, user-tier inference (BTS), stall-vs-suppression diagnosis decision tree, AI-readable data model, planning pseudocode. ~143KB, ~2500 lines. The math in §3 is load-bearing. |
| [`hybrid-training-research-new.md`](./hybrid-training-research-new.md) | **Literature grounding + translation rules.** Citations with HIGH/MODERATE/LOW confidence labels, modality interference table (Wilson 2012 HIGH), MV/MEV/MAV/MRV under concurrent stress, polarized 80/20 distribution (Seiler 2010 HIGH), Baar tendon framework (Baar 2017 HIGH; Kongsgaard 2009 HIGH), monitoring-stack priority, "Translation to app logic" code blocks per section, pre-mortem failure modes. ~64KB, ~730 lines. |
| [`hybrid-training-bodyweight-addendum.md`](./hybrid-training-bodyweight-addendum.md) | **Bodyweight-only corrections + additions to the framework.** What stays the same (interference, aerobic base, autoregulation, recovery, tendon timeline) and what changes materially (relative-strength model, discrete progression tree, posterior-chain gap, tendon shifts upstream, interference mix, mixed-modal classifier, aesthetics bias). 7 explicit app-design implications. ~85 lines. Source for `bodyweight-progression-plan.md`. |

---

## Wiki (LLM-maintained)

The maintained-by-AI layer. These pages are rewritten as new sources arrive; they cite raw sources via the index. The eventual home is `docs/knowledge/` in the repo.

| File | One-line summary |
|---|---|
| [`hybrid-training-app-plan.md`](./hybrid-training-app-plan.md) | **Master orchestrator.** Scope, product identity, architecture (stack, repo layout, data model, RLS, GDPR), 6-phase roadmap, engineering practices (testing, observability, security, schema discipline, knowledge-as-wiki §6.10), 8 open questions, AI onboarding protocol (Phases A–F). |
| [`hybrid-training-design-constraints.md`](./hybrid-training-design-constraints.md) | **Testable engine contract — Phase D resolved.** 108 testable constraints (103 active + 5 ⏸ [BACKLOG]) across sections A–V. Phase C structure (A–T) preserved; sections **U** (MVP scope contract — 2026-05-19) and **V** (active limitations + load-recency soft block) added in Phase D. All 22 original Open Conflicts resolved (20 closed, 2 deferred with HRV); plan §7 verdicts captured. Each constraint cites every supporting source + HIGH / HIGH-MODERATE / MODERATE-LOW confidence label. Backlog-marked constraints kept as forward contracts (engine MUST NOT depend on them in v1; restored when input source returns). CI will enforce each active constraint as a unit test in `packages/domain`. Ready for Phase E. |
| [`hybrid-training-design-constraints-draft1.md`](./hybrid-training-design-constraints-draft1.md) | **Phase C draft 1 (historical).** Predecessor of design-constraints.md. 65 constraints derived from v1+v2+plan only, before `new` existed. Retained for diff/lineage. Will be deleted once `design-constraints.md` is reviewed in Phase D. |
| [`ai-roadmap.md`](./ai-roadmap.md) | **Deferred UX & feature items.** 8 features parked for a later wave (#9 /races, #10 /injuries, #11 Training Profile, #12 calendar view modes, #13 phase auto-shift, #14 "what is this?" inline help, #15 AMRAP→e1RM vs entered 1RM, #16 TAPER auto-detection with Accept/Dismiss). Each item: rationale, current gap, UX sketch, dependencies. Build-order recommendation at the bottom. Created 2026-05-23. |
| [`bodyweight-progression-plan.md`](./bodyweight-progression-plan.md) | **7-phase plan for bodyweight progression.** Operationalises the bodyweight addendum into shipped code. DAG-based skill trees (~75 nodes across push H/V, pull H/V, squat unilateral/bilateral, hinge, planche, lever, flag, muscle-up, handstand, core), multi-page onboarding assessment (rep tests + skill chips + hinge-gap ack), TUT-gated progression, mixed-modal classifier, strength-mass drift detection. Decision matrix (A–F) at the bottom — pending project-owner confirmation before Phase 1 dispatches. Created 2026-05-24. |

---

## Schema

Files governing how the wiki itself is maintained.

| File | One-line summary |
|---|---|
| [`hybrid-training-log.md`](./hybrid-training-log.md) | **Append-only chronological record.** Every ingest, query, lint pass, and refinement is logged with `## [YYYY-MM-DD] kind \| title` prefixes for grep. See Karpathy pattern (plan §6.10). Seed of `docs/knowledge/log.md`. |
| (future) `docs/knowledge/AGENTS.md` | Will define ingest workflow, citation format, lint rules, page templates. Lives only after the repo exists; for now its conventions are embedded in plan §6.10 + the design-constraints.md citation rules. |

---

## Anticipated future wiki pages

Created as the repo lands and the engine is built. Each will cite back to the raw sources via the format established in `design-constraints.md`:

- `knowledge/archetypes/balanced.md`, `.../strength-biased.md`, `.../aesthetic.md`, `.../engine-biased.md`, `.../rebuild.md`
- `knowledge/buckets/neural.md`, `.../mechanical.md`, `.../metabolic.md`, `.../impact.md`, `.../axial.md`, `.../tissue.md`
- `knowledge/regions/foot-ankle-calf.md`, `.../knee.md`, `.../hamstring-posterior.md`, `.../adductor-groin.md`, `.../lumbar-trunk.md`, `.../shoulder-scapular.md`, `.../elbow-forearm.md`
- `knowledge/modalities/cycling.md`, `.../rowing.md`, `.../running.md`, `.../rucking.md`, `.../swimming.md`, `.../sled.md`
- `knowledge/movement-families/squat.md`, `.../hinge.md`, `.../press.md`, `.../pull.md`, `.../carry.md`
- `knowledge/monitoring/wellness-4q.md`, `.../rpe-rir.md`, `.../hrv.md`, `.../bar-speed.md`
- `knowledge/tendon/baar-isometric-protocol.md`, `.../heavy-slow-resistance.md`, `.../alfredson-eccentric.md`
- `knowledge/themes/` — per-user cross-referenced notes maintained by the coach agent (Phase 4)

Each new page is appended to this index. Each new ingest appends to `hybrid-training-log.md`.

## Feature design docs (LLM-maintained, repo-only)

Per-feature design notes that capture rationale, data model, UX, engine deltas, build sequence, and open questions before a major feature ships. Living documents updated as features land.

| File | One-line summary |
|---|---|
| [`docs/design/two-a-days.md`](../design/two-a-days.md) | **Two-a-day sessions.** Pre-build design (status: prep). AM + PM session split for hybrid users. Data model: `sessions.slot`, `sessions.planned_at`. Engine: per-slot interference math. UX: dual cards, AM/PM toggle in custom builder. References DC-D1 / DC-D2 / DC-D3 / DC-L1 / DC-L3 / DC-K4 / DC-S3. Preference column `profiles.allows_two_a_days` shipped 2026-05-21 (commit `fba1f38`). Build kicks off next sync. |

| [`docs/design/pre-session-checkin.md`](../design/pre-session-checkin.md) | **Pre-session check-in (planned).** 2-slider fatigue+soreness widget -> GRM advisory card. Persists on existing `sessions.fatigue` + `sessions.soreness` columns (no migration). DC-P1, DC-C5/C8, DC-K4, DC-S3. Build queued. |
| [`docs/design/mobile-polish-pwa.md`](../design/mobile-polish-pwa.md) | **Mobile polish + PWA install (planned).** Touch-target audit, sticky bottom action bar on session log, big stepper inputs, PWA manifest + service worker for home-screen install on iOS/Android. Plan-§3.5 gym-floor-first. Build queued after pre-session. |
| [`docs/design/hypertrophy-accessories.md`](../design/hypertrophy-accessories.md) | **Hypertrophy accessories (planned).** Per-strength-pattern curated pools (squat/bench/deadlift/OHP), default-on for Hypertrophy Focus only. Per-muscle volume rollup on stats using DC-T1 22-muscle taxonomy + DC-M2 concurrent volume modifier. No new schema. Build queued after mobile polish. |

| [`docs/design/prs-and-tm-progression.md`](../design/prs-and-tm-progression.md) | **PRs + auto TM progression (planned).** Three PR kinds (weight, reps-at-weight, e1RM); AMRAP-driven confidence-gate TM bump suggestion with 28-day cooldown, hard gates (cooldown, no-duplicate proposal, active limitations), and soft-signal scoring (heavy-week top-set outperformance + GRM<0.93 fatigue mask). Block-complete secondary trigger. Auto-deload after 2 GRM-real misses. New tm_history table + tm_change_reason enum. Per-lift TM trend chart. Build queued. |
| [`docs/design/accessory-schema.md`](../design/accessory-schema.md) | **Accessory schema — research-grounded redesign (2026-05-21).** Supersedes the v1 design in `hypertrophy-accessories.md`. Accessory scheduling backed by data across all archetypes (Strength / Hypertrophy / Endurance / Concurrent-Hybrid / Maintenance / Rebuild) including two-a-day variants. |
| [`docs/design/brand-identity.md`](../design/brand-identity.md) | **Brand identity — S×C (updated 2026-08-06).** Compact sage diamond mark used consistently across navigation, authentication, icons, native/PWA launch screens and social assets. Consumer brand `S×C`, domain `getsxc.app`; expanded descriptor retired. |

## Decisions / ADRs

Architecture Decision Records under `docs/adr/`. Each ADR is finalised
when it lands; superseding decisions land as a new ADR rather than an
edit.

| ADR | One-line summary |
|---|---|
| [`0001-stack-choices.md`](../adr/0001-stack-choices.md) | **Phase 0 stack.** Next.js 16 + TS strict + Drizzle + Supabase + Tailwind v4 + Vercel. Reasoning for each choice and the alternatives considered. |
| [`0002-ai-architecture.md`](../adr/0002-ai-architecture.md) | **Retired architecture (2026-08-06).** Historical in-app model-provider design; all code, routes, SDKs and persistence removed by migration 0121. |
| [`0003-mcp-dual-path.md`](../adr/0003-mcp-dual-path.md) | **Retired architecture (2026-08-06).** Historical external tool-server design; endpoints, authorization code and persistence removed by migration 0121. |
| [`0004-endurance-anchor-dual-main-lift.md`](../adr/0004-endurance-anchor-dual-main-lift.md) | **Endurance Focus dual main lift (2026-05-29).** Post-Huiberts 2024, the Endurance archetype now prescribes squat + hinge as a dual main lift; Concurrent Hybrid template trimmed to match. Shipped in PR #197. |
| [`0005-frequency-aware-dual-main-lift-folding.md`](../adr/0005-frequency-aware-dual-main-lift-folding.md) | **Frequency-aware folding (2026-05-29).** When weekly slot budget is tight, secondary main lifts fold into the primary day instead of being dropped. Shipped in PR #198. |
| [`0006-balance-all-archetypes-low-frequency.md`](../adr/0006-balance-all-archetypes-low-frequency.md) | **Balance Strength + Hypertrophy at low frequency (2026-05-29).** Demotes bench-press / overhead-press anchors so ADR-0005 folding produces symmetric prescriptions across archetypes at low weekly frequency. Shipped in PR #199. |

---

## Tooling artifacts

Scripts and CI guards that protect the data layer / schema.

| File | One-line summary |
|---|---|
| [`packages/db/scripts/check-migration-drift.ts`](../../packages/db/scripts/check-migration-drift.ts) | **Migration drift guard.** Cross-checks `packages/db/drizzle/meta/_journal.json` against `drizzle.__drizzle_migrations` by SHA-256 of each .sql file and fails if any expected migration is missing from the DB. Wired into the pre-push hook (full mode) and CI (offline file-shape mode). Catches the migrator silent-skip bug. Run via `pnpm --filter @hta/db db:check`. |
