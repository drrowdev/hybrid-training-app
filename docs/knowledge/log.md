# Hybrid Training App — Knowledge Log

**Purpose:** Append-only chronological record of all ingests, queries, lint passes, and refinements to the wiki. Format: `## [YYYY-MM-DD] kind | title` so the log is greppable by date and operation kind. Per the Karpathy pattern adopted in plan §6.10. Seed of `docs/knowledge/log.md` in the eventual repo.

**Operation kinds:**
- `ingest` — a new raw source landed in `hybrid-training-research-*.md` (or, post-repo, in `docs/research/`)
- `extract` — wiki pages produced from raw sources (most notably `design-constraints.md`)
- `refine` — wiki pages updated to integrate a new ingest or to act on a Phase D decision
- `query` — a notable Q&A against the wiki worth recording (e.g., "what did the engine decide for an archetype transition?")
- `lint` — health-check pass for contradictions, stale claims, orphan pages, missing cross-references
- `decision` — a Phase D decision applied (resolves an Open Conflict)
- `bootstrap` — meta-operation: creating or restructuring the wiki itself

---

## [2026-05-19] ingest | hybrid-training-research-v1.md
Conceptual framework landed (~72 KB, ~1500 lines). Owns: anchor-filler model, stress-budget concept, five structural rules, durability-as-loading framing, aesthetics-as-explicit-programming framing, conditioning-modality interference profile, six-layer app architecture. First raw source; sets the vocabulary used by v2 and `new`.

## [2026-05-19] ingest | hybrid-training-research-v2.md
Engine math spec landed (~143 KB, ~2500 lines). Owns: ceiling equation, GRM, bucket pressure, interference modifier, region caps, five archetype specs with stress budgets, BTS user-tier inference, stall-vs-suppression diagnosis decision tree, AI-readable data model, planning pseudocode. Builds on v1's vocabulary.

## [2026-05-19] ingest | hybrid-training-research-new.md
Literature-grounding & translation rules landed (~64 KB, ~730 lines). Owns: citations with HIGH/MODERATE/LOW labels, modality interference table (Wilson 2012 HIGH), MV/MEV/MAV/MRV under concurrent stress (Schoenfeld 2017 HIGH; Israetel MODERATE-HIGH), polarized 80/20 (Seiler 2010 HIGH; Stöggl & Sperlich 2014 HIGH), Baar tendon framework (Baar 2017 HIGH; Kongsgaard 2009 HIGH; Alfredson 1998 HIGH), monitoring-stack priority (Plews 2013 HIGH; Helms 2016 HIGH), pre-mortem failure modes, "Translation to app logic" code blocks per section. `new`'s confidence labels are the primary tiebreaker for numerical-threshold conflicts.

## [2026-05-19] extract | hybrid-training-design-constraints-draft1.md
First Phase C extraction. 65 testable constraints across 6 sections (A–K), derived from v1 + v2 + plan only — produced BEFORE `new` existed. Authority tags `[EV] / [DEF] / [DEF→cal]`; no confidence labels (those come in the refinement). 12 Open Conflicts surfaced for Phase D. Retained for diff/lineage.

## [2026-05-19] refine | hybrid-training-design-constraints.md (Phase C v2 — integrate `new`)
Refined `draft1` by integrating `hybrid-training-research-new.md`. Expanded from 65 → **104 constraints** across sections A–T:
- Existing constraints (A–K) updated with `new` citations + HIGH / HIGH-MODERATE / MODERATE-LOW confidence labels.
- New sections added: **L** modality interference hierarchy (Wilson 2012), **M** volume landmarks MV/MEV/MAV/MRV + concurrent modifier (Schoenfeld 2017, Bickel 2011), **N** polarized aerobic distribution + VO2max/alactic defaults (Seiler 2010, Stöggl 2014, Helgerud 2007), **O** tendon/Baar framework + bulletproofing stack + 10% rule (Baar 2017, Kongsgaard 2009, Magnusson & Kjaer 2019), **P** monitoring stack priority + composite deload trigger + HRV-as-trend (Plews 2013, Helms 2016, Walker 2017), **Q** protein floor + body-comp phases + life-stress modifier (Morton/Phillips meta), **R** year / block / week / day architectural skeleton, **S** pre-mortem-derived guardrails (override consent path, adherence-over-optimality, soft interference, tendon prep gating, schema discipline), **T** aesthetics landmarks (per-priority hypertrophy targets, transition protection, body-comp drift).
- Open Conflicts expanded from 12 → **22 items** (OC-1..OC-22) for Phase D resolution. New conflicts surface where `new` quantifies what v1/v2 left qualitative (e.g., OC-13 7-day HRV trend vs daily; OC-14 strength-block hard-conditioning floor; OC-17 DC-P4 composite deload vs v2 GRM-based deload; OC-19 emphasis-block weekly templates `new` vs v2; OC-20 modality separation scheduler-layer vs ceiling-layer).
- Methodology purity reaffirmed (plan §1, owner-confirmed): zero external program names in catalog, data model, or engine. Marketing comparisons only.

## [2026-05-19] bootstrap | hybrid-training-index.md + hybrid-training-log.md (wiki seeds)
Created the two navigation files that survive the move into the new repo (per plan §6.10 Karpathy pattern). `index.md` catalogs raw sources / wiki pages / schema, plus anticipated future per-archetype / per-bucket / per-region / per-modality / per-monitoring-metric wiki pages. `log.md` (this file) seeds the chronological record with the five historical entries above plus this bootstrap entry. Every future ingest, refine, decision, lint, or notable query appends here.

---

## [2026-05-19] decision | Phase D session — MVP scope set, 20/22 OCs closed, plan §7 mostly answered
Owner Phase D session collapsed the constraints document's open items. Headline scope decisions: (1) **Wearable health data (HRV, RHR, bar speed) → backlog.** Constraints DC-P3, parts of DC-C4 / DC-C5 / DC-H3 / DC-H6 marked ⏸ [BACKLOG] with binding contracts preserved. (2) **AI layer (entire Phase 4) → backlog.** No coach/programmer/periodizer/chat orchestrator in v1. (3) **Daily self-reported health beyond a 2-slider check-in → backlog.** DC-P1 reduced from 4-question to **Fatigue 1–5 + Soreness 1–5** only (~5s widget). DC-P5 (sleep), DC-Q1 (protein), DC-Q3 (life-stress), DC-O6 (symptom gates), region-tap niggle all → ⏸ [BACKLOG]. (4) **Bodyweight stays MVP** (onboarding + weekly nudge); DC-T3 body-comp drift preserved. (5) **Strava integration promoted from Phase 3 → Phase 1.** Unlocks DC-J8 mileage ramp, DC-L1 modality math, DC-P4 signal 4 (Z2 pace at fixed HR). (6) **Region freshness becomes a first-class engine concept** (new DC-C14) — derived from the per-region load ledger (v2 §3.2) + movement→region catalog (plan §4.3). Replaces deferred daily symptom input for "is this region beat up" decisions; quads-day-after-squats works without asking the user. (7) **Active limitations** kept as a structured profile-level table (new §V: DC-V1/V2/V3) — set when injured, cleared when resolved; binding input for safety hard-blocks (DC-D5/D7/J9 revised accordingly). Asymmetry: injuries hard-block, recent-load fatigue soft-warns (DC-V2). (8) **Engine posture: grounded but not blocking.** Only true hard-blocks are tendon refractory (DC-J5), active-limitation gates (DC-V1 + DC-D5/D7/J9), and RLS/auth violations. Everything else warns + cites + records override (DC-K4 / DC-S1). OCs closed: 1–4, 6–12, 14, 16, 18–21. OCs modified: 5, 15, 17. OCs deferred (tied to HRV): 13, 22. Plan §7 verdicts: Supabase (Q1), Supabase Auth (Q2), EU-central (Q3), free + pricing later (Q4), web-first (Q7), methodology-pure confirmed (Q6); domain (Q5) and public-launch criteria (Q8) owner-decides. New sections: **U** MVP scope contract, **V** active limitations. New constraints: DC-C14 region_freshness, DC-V1/V2/V3 limitations + load-recency. Revised constraints: DC-C4, DC-C8, DC-D5, DC-J3, DC-P1, DC-P4. Backlog-marked: DC-O6, DC-P3, DC-P5, DC-Q1, DC-Q3. Constraints count: 104 + 4 new = 108; backlog-marked: 5. Zero open conflicts remaining for the MVP build.

## [2026-05-19] decision | Q5 + Q8 closed — Phase D fully wrapped
Owner resolved the last two plan §7 items: **Q5 (domain)** deferred — personal Gmail as Resend transactional sender for v0; no custom-domain DNS work in Phase 0; re-open before any public marketing or paid-tier launch. **Q8 (public launch criteria)** accepted as written: personal-use rock-solid for ≥ 8 weeks + anchor-compliance ≥ 90% + zero data-loss incidents + ≥ 1 external alpha user logging for 4 weeks. Engine-level KPIs added to launch-readiness gate. Zero open items remain for Phase D. Owner instruction: keep model (Claude Opus 4.7 1M) for Phase E + F; do NOT switch down. Next: Phase E (browse reference docs) + Phase F (first commits per plan §9). Constraints document final for v1 build.

---

## Conventions for future entries

- One entry per operation; do not coalesce.
- Date in ISO `YYYY-MM-DD` in the heading. Time only if multiple entries per day need ordering.
- One short body paragraph; reference DC-* identifiers, OC-* identifiers, and source `§` numbers freely.
- `lint` entries summarise findings, then link to or reference any follow-up `refine` entries that result.
- `decision` entries close one or more OC-* items; record the chosen resolution and what it changes in `design-constraints.md`.
- When a new wiki page is created, append a `bootstrap` (initial) or `refine` (subsequent) entry AND update `hybrid-training-index.md`.
