# Hybrid Training App — Knowledge Index

**Purpose:** Catalog of all hand-off files for the hybrid training app project. Organized by role in the Karpathy personal-knowledge-base pattern (plan §6.10): raw sources are immutable; wiki pages are LLM-maintained; the schema governs ingest, citation, and lint workflows. This file is the seed of `docs/knowledge/index.md` in the eventual repo.

**Last updated:** 2026-05-19

---

## Raw sources (immutable)

The three research files. Never edited; new sources appended here when ingested.

| File | One-line summary |
|---|---|
| [`hybrid-training-research-v1.md`](./hybrid-training-research-v1.md) | **Conceptual framework.** Anchor-filler model, stress-budget concept, five structural rules, durability-as-loading framing, aesthetics-as-explicit-programming, conditioning-modality interference profile, six-layer app architecture. ~72KB, ~1500 lines. |
| [`hybrid-training-research-v2.md`](./hybrid-training-research-v2.md) | **Engine math spec.** Ceiling equation, recovery multiplier (GRM), bucket pressure, interference modifier, region caps, five archetype specs with stress budgets, user-tier inference (BTS), stall-vs-suppression diagnosis decision tree, AI-readable data model, planning pseudocode. ~143KB, ~2500 lines. The math in §3 is load-bearing. |
| [`hybrid-training-research-new.md`](./hybrid-training-research-new.md) | **Literature grounding + translation rules.** Citations with HIGH/MODERATE/LOW confidence labels, modality interference table (Wilson 2012 HIGH), MV/MEV/MAV/MRV under concurrent stress, polarized 80/20 distribution (Seiler 2010 HIGH), Baar tendon framework (Baar 2017 HIGH; Kongsgaard 2009 HIGH), monitoring-stack priority, "Translation to app logic" code blocks per section, pre-mortem failure modes. ~64KB, ~730 lines. |

---

## Wiki (LLM-maintained)

The maintained-by-AI layer. These pages are rewritten as new sources arrive; they cite raw sources via the index. The eventual home is `docs/knowledge/` in the repo.

| File | One-line summary |
|---|---|
| [`hybrid-training-app-plan.md`](./hybrid-training-app-plan.md) | **Master orchestrator.** Scope, product identity, architecture (stack, repo layout, data model, RLS, GDPR), 6-phase roadmap, engineering practices (testing, observability, security, schema discipline, knowledge-as-wiki §6.10), 8 open questions, AI onboarding protocol (Phases A–F). |
| [`hybrid-training-design-constraints.md`](./hybrid-training-design-constraints.md) | **Testable engine contract — Phase D resolved.** 108 testable constraints (103 active + 5 ⏸ [BACKLOG]) across sections A–V. Phase C structure (A–T) preserved; sections **U** (MVP scope contract — 2026-05-19) and **V** (active limitations + load-recency soft block) added in Phase D. All 22 original Open Conflicts resolved (20 closed, 2 deferred with HRV); plan §7 verdicts captured. Each constraint cites every supporting source + HIGH / HIGH-MODERATE / MODERATE-LOW confidence label. Backlog-marked constraints kept as forward contracts (engine MUST NOT depend on them in v1; restored when input source returns). CI will enforce each active constraint as a unit test in `packages/domain`. Ready for Phase E. |
| [`hybrid-training-design-constraints-draft1.md`](./hybrid-training-design-constraints-draft1.md) | **Phase C draft 1 (historical).** Predecessor of design-constraints.md. 65 constraints derived from v1+v2+plan only, before `new` existed. Retained for diff/lineage. Will be deleted once `design-constraints.md` is reviewed in Phase D. |

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
