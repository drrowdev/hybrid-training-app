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

## [2026-05-29] refine | atomic user workflow boundary
Program deployment and editing, season replacement, session completion, bodyweight progress, and structured HYROX replacement now use transactional database boundaries. Active visible plans, program instances, and seasons are serialized per user and protected by unique constraints; bodyweight progress is reconciled from persisted set logs so edits, deletes, and plan fills cannot leave stale progress.

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

## [2026-05-21] decision | Two-a-day feature prep — preference captured, design doc landed
Owner scheduled two-a-day sessions as the next major feature. Prep step landed today: (1) `profiles.allows_two_a_days boolean` column added (migration 0013), default `false`. (2) Onboarding Schedule step gets a checkbox capturing the preference; copy explains engine support is deferred. (3) User-facing copy renamed `archetype` → `focus` across the onboarding wizard, plan/new picker, and TM settings (engine code keeps `archetype`). (4) Feature design doc landed at `docs/design/two-a-days.md` — covers rationale, data-model deltas (`sessions.slot`, `sessions.planned_at`, composite index), UX changes (Today/Log dual cards, custom builder AM/PM toggle), engine changes (`buildPrescription` two-slot compile + per-slot interference math), out-of-scope list (no per-session timezones, no AI slot recommendation), 12-step build sequence, and open questions (time-of-day input, mid-block toggle behaviour). No new constraints needed — DC-D1 / DC-D2 / DC-D3 / DC-L1 / DC-L3 / DC-K4 / DC-S3 already cover the behaviour the planner needs. Build kicks off next sync. Commit: `fba1f38` (rename + preference), `upcoming` (design doc).

## [2026-05-21] decision | Two-a-day feature shipped (tad-01..12)
Full 12-step build sequence from `docs/design/two-a-days.md` landed across five commits on top of the earlier prep step. Migration 0014: session_slot enum, sessions.slot + planned_at, planned_sessions.slot + planned_at, composite unique on (block, week, day, slot), and profile AM/PM window defaults (07-09 / 17-19). Engine types: DaySlot on every DayTemplate variant, daySlot()/daySlotKey() helpers, daysForFrequency now orders AM before PM. Curated focus variants: Strength + Hypertrophy + Endurance get twoADayDays arrays (Rebuild stays single-session per design); DC-D2 strength-first ordering enforced; DC-L1 VO2 stays single. Custom builder gains per-day AM/PM toggle when allows_two_a_days = true. Today + Plan UI: dual-card layout, per-card AM/PM badges, two-a-day wrapper with DC-D1 cited warning ("Robineau 2016 HIGH"). Settings: editable toggle post-onboarding. Stats: AM/PM session count tile + last-30-day two-a-day total. Tests: 20 vitest cases in apps/web covering effectiveDays, DC-D2 strength-first, DC-L1 VO2 isolation, slot uniqueness, distinct-day budgeting. Commits: `a061bf2` (foundations), `fa721ac` (custom + variants + picker), `622f45f` (UI + settings + actions), trailing commit (warnings + stats + tests). All 12 todos closed; CI + build + typecheck green. Active limitations: planned_at is recorded but not yet auto-populated from profile AM/PM windows (deferred to Polish pass); per-slot stress-bucket accounting via DC-C7 deferred to engine work (no engine code in v1).

## [2026-05-21] decision | Three next features planned — pre-session, mobile, accessories
Owner confirmed three features for the next major build pass: (1) Pre-session check-in (Fatigue + Soreness DC-P1 sliders -> GRM advisory card; smallest scope, immediately useful), (2) Mobile polish + PWA install (gym-floor UX + home-screen install; highest UX value before any external alpha), (3) Hypertrophy accessories (curated per-pattern pools driven by DC-T1 22-muscle taxonomy + DC-M2 concurrent volume modifier). PRs + auto TM progression deferred to a separate session per owner preference. Three design docs landed at `docs/design/pre-session-checkin.md`, `mobile-polish-pwa.md`, `hypertrophy-accessories.md` — each carries scope contract, constraints already encoded, data-model deltas, UX changes, build sequence, and open kickoff questions. 21 SQL todos staged (5 psc + 8 mob + 8 acc) with dependencies. Build kicks off next sync starting with the pre-session widget (smallest scope; unlocks GRM plumbing). No constraints work needed — DC-P1, DC-C5/C8, DC-K4, DC-S3, DC-B4, DC-M1/M2, DC-T1, DC-L4 already cover the behaviour required.

## [2026-05-21] decision | PRs + auto TM progression planned (model adopted from a reference app)
Owner shared a reference PR + TM auto-suggestion model from a prior app. Honest comparison vs my initial sketch concluded the reference model is materially superior: three PR kinds (weight, reps-at-weight, e1RM) vs my collapsed e1RM-only; AMRAP-driven scoring vs my fuzzier 'block-complete' trigger; confidence gate with hard gates + soft signals replaces the classic 'reps-over-target' progression heuristic which over-fires on conservatively-set TMs; 28-day cooldown + injury gates; idempotency via deterministic trigger_key; long-running fatigue mask. Adopt that model's logic wholesale with two surgical additions: (1) RPE-based 1RM (Zourdos 2016 / Helms 2018 chart) as a preferred path when RPE is logged, taking the conservative of (Epley, RPE-based); (2) the per-session GRM as one more soft signal in the gate (-1 when GRM<0.93). Long-running fatigue aggregate deferred — this app has no aggregated weekly load yet; per-session GRM carries the readiness signal in v1. Race-prep window also deferred — no race calendar yet. Design doc landed at `docs/design/prs-and-tm-progression.md`. 14 SQL todos staged with dependencies. Build queued after green light.

## [2026-05-21] refine | Methodology-purity scrub on PR/TM feature
## [2026-05-21] refine | Methodology-purity scrub on PR/TM feature
Stripped external-program branding from every artifact shipped in the PR + auto TM progression feature, per DC-Q6 methodology-pure operation (engine + UI + docs are brand-agnostic). Replaced with research / practitioner-consensus citations: Zourdos 2016 + Helms 2018 (RPE-RIR autoregulation), broader RTS / Sheiko / Helms / Cube programming literature (small-progression cadence + 90% TM convention), Israetel autoregulation (overreach + deload protocols). Renamed code identifiers `five_three_one` -> `peaking_wave`, intensity label legacy peak label -> `Heavy peak`, "Wk3" -> "heavy-week" in comments + tests, legacy 90% citation -> "conservative 90% rule". UI strings cleaned: wave description, onboarding goal copy, soft-signal reason labels. Design doc + wiki index + log + design-constraints DC-S5 + ADR-0001 also scrubbed. No engine behaviour change; this is pure rename / re-citation. CI verification pending.

## [2026-05-22] refine | Power emphasis wired end-to-end
Block wizard step-2 `Add power emphasis` toggle now persists + influences accessory selection. New `training_blocks.power_emphasis boolean` column (migration 0022). Three new functional role tags — `power_olympic` / `power_plyometric` / `power_ballistic` — applied to 24 existing seeded movements (migration 0023; Olympic derivatives, plyo/SSC work, ballistic throws/swings). Accessory picker takes `powerEmphasis: boolean`; when true it inserts a power-bias pass between functional and aesthetic (one 3–5 rep explosive accessory) and trims aesthetic budget by one slot to protect the RFD signal (Schoenfeld 2017 power vs hypertrophy stimulus). Tendinopathy flag still suppresses high-strain-tendon power candidates (DC-J5 / DC-O3 honoured). Wizard `state.power` previously dropped on submit — now sent on the `createBlock` FormData. No external program names introduced (DC-Q6). Unit tests + e2e exercise toggle persistence + power-tagged picks.

## [2026-05-23] refine | Power emphasis Phase 3 — engine-deep wiring
Phase 1+2 only biased accessories; Phase 3 makes the toggle meaningful at the main-lift level. Three engine changes + wizard UX polish: (1) Main-lift intensity clamp + reps rewrite — when power on AND archetype is strength-led (strength_anchor / hypertrophy_anchor / concurrent_hybrid), top-set load is capped at 90% TM (Sale 1992 / Häkkinen 1985 force-velocity peak power lives at 40–70% 1RM) and any set above 85% has its reps rewritten to 3, with a compensatory acceleration cue attached to meta (Schoenfeld 2017 velocity-cued execution). No-op on endurance / rebuild / maintenance. (2) Pre-session PAP / PAPE primer — when power on AND day is strength, a power_potentiation item (3 × 3–5 reps, full intent + 4–8 min rest before the main lift) is prepended to the prescription. Picker matches the day's primary lift to a tagged movement (squat → power_plyometric lower-body, bench → power_ballistic upper-body, deadlift → posterior plyo/ballistic, OHP → power_olympic / overhead ballistic). Honours blocked regions + tendinopathy (DC-J5 / DC-O3). Citations: Seitz & Haff 2016, Boullosa 2018. (3) Soft block-length recommendation — Step 4 review shows an info card when power on noting 3-week blocks tend to outperform 4-week marathons. Actual block weeks unchanged. Wizard UX: step-2 disclosure copy on the toggle ('Trades top-end strength for explosive output…'), step-2 toggle stays hidden on non-power-eligible archetypes (already implemented), sidebar shows a click-to-expand ⚡ Power chip listing what's affected. New power_potentiation PrescriptionItemKind + optional meta: Record<string, unknown> on PrescriptionItem (kept off the typed top level per schema-discipline §6.8). Unit tests: +11 covering clamp / reps rewrite / pattern matching / tendinopathy gating / no-op on non-strength-led archetypes. E2E: extended to assert week 3 squat-day top set ≤ 90% TM with reps = 3 and first prescription item is power_potentiation, plus a new test for toggle hide-on-endurance + sidebar badge. No external program names (DC-Q6).


## [2026-05-23] refine | Walked back manual sleep tracking — deferred to health integration
Removed all UI affordances + writers for wellness.sleep_hours. Owner decision: sleep will arrive later via Apple Health / Google Fit; no manual entry in the meantime. Surfaces: (a) pre-session check-in (DC-P1) sleep chip row deleted — DC-P1 now reads literally as written (No mood, no energy, no sleep); (b) /app/stats overview sleep card removed; (c) /app/stats/wellness section A2 (Sleep) removed, sibling sections A1/A3/A4/A5 retained — section ids deliberately non-contiguous to mark the gap; (d) /app/stats/blocks index `Avg sleep` KPI tile removed; (e) /app/stats/blocks/[id] `Avg sleep` wellness tile + sleep compare section removed. Writers removed: startCheckInSession no longer accepts sleepChip; 
ecordDailyCheckIn silently ignores any inbound sleepHours / sleepChip form fields. Helpers deleted (unused after writer removal): sleepHoursForChip, SLEEP_CHIP_VALUES, SleepChip, sleepBucket, sleepBucketColor, SleepBucket, 
ollingMean (was only consumed by A2), entire pps/web/src/lib/stats/sleep-trend.ts. Schema: wellness.sleep_hours column intentionally kept (reserved for health-integration auto-fill — see comment in packages/db/src/schema/wellness.ts); no migration. DC-P5 footnote added noting the deferral. Tests removed: the E2E `pre-session sleep chip persists` (session-log-desktop), sleepHoursForChip mapping suite, sleepBucket boundary suite, 
ollingMean suite, sleep card / section / KPI assertions across 3 e2e specs (replaced with 	oHaveCount(0) guards). Test count goes DOWN; that's the intended marker that the surfaces are gone.

## [2026-05-23] refine | DC-K1 recovered-week qualification + smarter ceiling (feat/smarter-ceiling-dc-k1)

Replaced the placeholder "28d average × 1.05" ceiling base with the canonical DC-K1 / DC-C9 formula: median weekly tonnage across the user's last 3 recovered weeks, with a DC-C13 cold-start ladder (1-2 recovered → confidence 0.80, 0 recovered → min(last 4 weeks) × 0.9 + confidence 0.80). Added `isRecoveredWeek(week)` in `packages/engine` (pure helper, 5 failure paths + NULL-pass policy + zero-logged-sessions informativeness guard) and `getWeeklyRecoveryRollup(userId)` in `apps/web/src/lib/engine`. New ceiling explainer + recovered-weeks badge on /app/stats/engine section D; new "Recovered weeks: N of 12" tile on /app/stats/wellness. Updated DC-K1 in design-constraints to spell out the canonical rule and cite this PR as the implementation reference.

## [2026-05-24] refine | smarter tier detection — declared + 4-input weighted formula (feat/tier-detection-onboarding)

Replaced the placeholder `getUserTier` BTS (60 + 40 × completion-fraction) with a transparent contributor-by-contributor weighted sum. New pure helper `packages/engine/src/tier-detection.ts` exposes `classifyBodyweightRatio` / `classifyAbsoluteThreshold` / `computeTier`: each main lift contributes 0.20 (×BW path) or 0.10 (absolute-kg fallback) toward the tier its e1RM gates into; anchor adherence (12w) weighs 0.10, schedule regularity 0.05, recovery check-in fill rate 0.05. Top weighted sum wins; declared experience (lt_1y / 1_3y / gte_3y from onboarding) anchors the verdict per DC-G1 with DC-K4 soft-warn semantics when observed signals disagree. Query layer `apps/web/src/lib/engine/tier-detection.ts::gatherTierInputs` maps movement slugs back to STRENGTH_ROLE_CANDIDATES, reads bodyweight + TMs + planned/completed sessions + fatigue/soreness check-ins. Onboarding wizard Profile step reworded to the years-anchor copy (Beginner · ≤1y, Intermediate · 1-3y, Advanced · 3+y). New Settings section to update experience post-onboarding; mid-flow change records a DC-K4 custom override event (`kind: 'training_experience_change'`, from/to in context blob). Engine page section E now shows declared label, confidence badge with contributor count, contributor breakdown, soft mismatch warning, sessions-until-next-gate estimate. 17 new vitest cases in packages/engine; updated getUserTier suite in apps/web; new e2e specs for onboarding-experience + settings-experience flows + section E intermediate assertion. No new dependencies; legacy `btsToTier` kept for back-compat.

## [2026-05-23] extract | ai-roadmap.md
New wiki page bootstrapped: `docs/knowledge/ai-roadmap.md`. Captures 8 deferred UX & feature items (#9 /races, #10 /injuries, #11 Training Profile, #12 calendar view modes, #13 phase auto-shift, #14 `what is this?` inline help, #15 AMRAP→e1RM vs entered 1RM, #16 TAPER auto-detection) parked from the active Today→Cmd-K→stats wave. Each item: rationale, current gap, UX sketch, dependencies. Build-order recommendation at the bottom. Cross-references the open-question status on #3 notifications inbox and #8 daily training brief which were not assigned to either lane.


## [2026-05-24] refine | EmptyState primitive + audit pass on empty cards (feat/empty-state-pattern)

Shipped a shared `apps/web/src/components/ui/EmptyState.tsx` primitive (two variants: `card` full-replacement + `inline` in-card) and applied it across every audited empty surface so every blank card now answers `what unlocks this` in one short, prescriptive sentence (DC-Q1 plain-language priority). Surfaces touched: Today page (Up next this week + Recent activity + GoalsCard); /app/stats overview (active-block strip, adherence, PRs, region freshness, volume, bodyweight); /app/stats/wellness (bodyweight, fatigue/soreness, motivation, prediction-accuracy — e2e text anchors preserved by substring); /app/stats/engine (region freshness, bucket pressure, recent overrides); /app/stats/blocks index + [id] detail (no main-lift sets, no RPE creep); /app/freshness (grey-muscle explainer below the grid); /app/sessions (empty list with +New CTA). Adherence intentionally skipped — owned by #17 run-plan adherence card. No new deps; inline styles + `--cp-*` tokens to mirror existing components; all `data-testid` selectors preserved; 6 new vitest cases pin title/body/action/inline-vs-card shape. Roadmap doc updated with a `Closed — moved to active wave` section noting the pattern is now the standard.

## [2026-05-23] refine | Methodology-purity scrub on shipped UX/docs (chore/scrub-brand-refs)
Follow-up to DC-Q6 methodology-pure operation. Removed forward-looking external-program references introduced during the UX wave that just shipped (Today redesign / Cmd-K / topbar / heatmap / muscle-grid / empty-state). Edits: `EmptyState.tsx` + `TopBarRight.tsx` doc comments dropped the brand prefix; `docs/knowledge/ai-roadmap.md` title and every section rationale reworded to describe the gap on its own merits without naming any external app; `docs/knowledge/index.md` summary line updated; `docs/design/accessory-schema.md` external-program citation replaced with `practitioner consensus across strength-coaching literature`; this log's recent entries cleaned. No engine or UI behaviour change.


## [2026-05-23] decision | AI chat FAB deferred for dedicated planning
The AI chat FAB (originally tracked as #7 in the UX wave) is removed from the active build queue and added to `docs/knowledge/ai-roadmap.md` as a deferred item. Rationale: anything AI-touching needs its own planning pass — model selection, prompting strategy, conversation persistence, privacy posture, allowed actions, cost model, fallback behaviour, and quality bar are decisions that shouldn't be made in passing as a UI affordance. The roadmap entry lists 8 open questions that must have written answers before a UI surface is built. Build-order recommendation updated; the AI chat is now item 9 in the deferred queue, gated on its own ADR.



## [2026-05-24] refine | Accessory intensity matrix (feat/accessory-rir-intensity)
Added a research-grounded RIR / RPE / tempo prescription layer for accessory + tendon items. The strength engine continues to drive main lifts off %TM via the standard 4-week peaking wave on `training_blocks.weekProfiles`; accessories now carry an autoregulation cue instead — implemented in `apps/web/src/lib/planner/accessory-intensity.ts` as two pure functions: `inferAccessoryBucket()` (compound | isolation | isometric | plyometric | tendon) and `accessoryIntensity({ archetype, bucket, weekIndex })`.

Bucket detection runs off the catalog's `bulletproof_roles` / `functional_roles` / `primary_muscles` / `is_compound` columns plus a slug-keyword fallback for legacy items. Matrix output is attached to each `PrescriptionItem` (now extended with optional `targetRir`, `targetRpe`, `tempoEccentricSec`, `holdSec`, `intensityCue` fields on the JSONB blob — no migration needed, drizzle column type is `jsonb` in `packages/db/src/schema/planner.ts`). Existing planned sessions without RIR fields render gracefully via fallbacks in `MovementFocusView.tsx` and `movement-summary.ts`.

**Matrix shape** (base × archetype, with week-of-block modifier on top):
- **Bilateral compound** (RDL, leg press, goblet squat): strength_anchor RIR 2–3, hypertrophy_anchor RIR 1–2, endurance_anchor RIR 3, concurrent_hybrid RIR 2, rebuild RIR 3 + 3s tempo, maintenance RIR 3.
- **Isolation** (curl, lateral raise, leg extension, pulldown, fly): strength_anchor RIR 2, hypertrophy_anchor RIR 0–1 (last set to failure cue), endurance_anchor RIR 3, concurrent_hybrid RIR 2, rebuild RIR 2, maintenance RIR 3.
- **Isometric** (carry, plank, wall sit, dead bug): hold 20–60s depending on archetype; week-4 deload drops to 60% of base duration.
- **Plyometric / power** (broad jump, jump squat, med ball throw): max intent · 3–5 reps · 2–3 min rest. No RIR modifier — Behm & Sale 1993: neural / RFD adaptation, not metabolic.
- **Tendon** (HSR, copenhagen plank, eccentric heel raise): 3s eccentric tempo at RIR 2 (RIR 3 on endurance / maintenance). Baar 2017 / Kongsgaard 2009.

**Week modifier:** weekIndex 0 (ramp) +1 RIR; weekIndex 1 (build) and weekIndex 2 (push) baseline; weekIndex 3 (deload) +2 RIR. Isometric: deload-week holds = 60% of base duration. Plyometric: ignores modifier.

**Citations** (kept in source comments + this log, never in user-facing UI copy):
- Helms 2018 — autoregulation via RPE/RIR is the appropriate cue for accessories (1RM-based load doesn't translate to isolation work).
- Schoenfeld 2017 — RPE 7–9 (RIR 1–3) effective for 6–12 rep hypertrophy; RPE 7–8 (RIR 2–3) for 12–20 rep work.
- Israetel — MEV → MAV → MRV volume landmarks; RIR tightens at the volume peak, opens up on deload.
- Baar 2017 / Kongsgaard 2009 — HSR tendon work needs 3 s+ eccentric at sub-maximal load; time-under-tension, not failure.
- Behm & Sale 1993 — plyometric / power work uses max intent at low rep counts; RPE/RIR don't apply.

**UI:** the focus card now renders a chip (`RIR 1–2`, `Hold 30–60s`, `3s lower · RIR 2`, `Max intent`) + a plain-English cue under the weight readout when an item carries no %TM. Brand purity preserved — no methodology names in any cue copy; ESLint-friendly regex assertion in the test suite blocks regressions. Collapsed-card summary chip (`movement-summary.ts`) now reads `3×10 @ RIR 1–2` or `3 × 30s hold` instead of a bare `3×10`.

**Tests:** 141 cases on `accessoryIntensity` (5 buckets × 6 archetypes × 4 weeks + targeted value locks + a brand-purity regex sweep), 9 cases on `inferAccessoryBucket`, 1 unit test verifying main items never get RIR / cue fields. New Playwright spec `accessory-rir-cue.spec.ts` drives a seeded session and asserts the chip + cue render.

## [2026-05-24] refine | Equipment-aware accessory picker (feat/equipment-aware-picker)
The dynamic accessory picker now consults profiles.equipment and drops candidates the user cannot perform. Two pure helpers — inferRequiredEquipment(movement) (slug-pattern heuristic, first-match-wins, conservative) and isEquipmentAvailable(req, equipment) (per-implement availability check) — wired into pickAccessoriesForSession via an optional quipment parameter; createBlock and createCustomBlock load it via 
esolveEquipment(profile). Main lifts bypass the filter entirely because they are resolved upstream from the user's training maxes, not from the picker catalog. Heuristic stance: when a slug doesn't clearly imply a specific implement (e.g. pallof-press, lateral-raise-machine with no MachineType-disambiguating token) it falls through to odyweight_or_generic and is always allowed. Better to over-include than over-filter — a thin pool from over-filtering looks like a bug to the user, while an over-inclusive pick is just one swap away.

## [2026-05-24] refine | Equipment step in onboarding (feat/onboarding-equipment-step)
Adds an Equipment step between Profile and Training maxes in the onboarding wizard so the picker has equipment context from the user's first block. Tier 1 surfaces the four presets (Commercial gym / Home gym / Travel-hotel / Custom) as tap cards; Tier 2 inline-expands the existing `EquipmentEditor` for fine-tuning. Persists via `updateEquipmentV2`. The gate is unchanged — existing users without `profiles.equipment` are not re-routed; their picker falls back to the commercial-gym default via `resolveEquipment`.

## [2026-05-24] refine | Bodyweight-only support (feat/bodyweight-only-path)
Closes the gap where users training without a barbell still got prompted for main-lift training maxes and saw the block creator crash on missing TMs. Three threads: (a) `equipment-presets.ts` gains a fifth preset `bodyweight_only` with zeroed bars / no loadable kit / pull-up bar on (the realistic floor for bodyweight programmes), plus `hasLoadableMainLift(equipment)` and `presetKeyForScheme(equipment)` helpers — the latter reverse-detects a bodyweight shape even when the saved `preset` field disagrees. (b) The onboarding wizard now derives `needsTrainingMaxes` from the freshly-tapped preset card and skips the Training Maxes step entirely when the user has no loadable main-lift; the ProgressPills row shrinks to four dots, and going back to Equipment + swapping the preset re-introduces the TM step. (c) `createBlock` no longer errors out with "No TM set for..." when `tmByMovementId.size === 0` — it falls back to a per-day first-candidate movement (purely as a row anchor), passes `omitMainStrength=true` to `assemblePrescriptionItems` so the strength branch emits only the accessory + tendon picks (the picker already filters by equipment from PR #86, so a bodyweight setup yields push-up / pull-up / single-leg / plank variants), stamps a `notes` row on the block ("Bodyweight-only block ÔÇö main-lift progression coming soon. Accessories programmed per RPE/RIR."), and titles strength days from `day.title` rather than the catalog-fallback movement name. New `BodyweightOnlyBanner` client component surfaces on Today + Plan with localStorage-backed dismissal (`cp-bw-banner-dismissed-v1`). Settings ÔåÆ Training maxes explains the empty state when bodyweight-only. Soft stance: no bodyweight progression engine in this pass ÔÇö the banner copy and roadmap entry acknowledge the gap.

## [2026-05-24] extract | bodyweight-progression-plan.md
7-phase implementation plan for bodyweight-only progression. Operationalises hybrid-training-bodyweight-addendum.md (also added in this commit). Phase 1: skill-tree DAG schema + catalog seed. Phase 2: 3-page onboarding assessment (rep tests + skill chips + hinge-gap ack). Phase 3: engine prescription with archetype × week × node matrix + skill-CNS scheduling. Phase 4: TUT-gated progression engine. Phase 5: mixed-modal classifier + hinge compensator. Phase 6: strength-mass drift detection. Phase 7: loaded bodyweight (deferred). Decision matrix A-F pending project-owner confirmation before Phase 1 dispatches.


## [2026-05-24] refine | BW progression Phase 1 — schema + catalog (feat/bw-phase1-schema-catalog)

Migration 0042 adds movement_nodes + bw_progress + extends training_maxes
with bw_node_id (CHECK weight OR bw_node_id). 75 nodes seeded across 15
families (push H/V, pull H/V, squat uni/bi, hinge, planche, levers, flag,
muscle-up, handstand, core). effectiveDifficulty helper exported.
Validation tests pin the DAG shape (no cycles, every family has an entry
node, every prereq resolves).

## [2026-05-24] refine | BW progression Phase 2 — assessment onboarding (feat/bw-phase2-assessment)

3-page assessment wizard replaces TM step for bodyweight_only users.
Page 1 rep tests (push-up, pull-up, squat, plank), page 2 12-chip skill
grid, page 3 hinge-gap acknowledgement. Maps to bw_progress entry nodes
per family with skill-chip overrides. Migration 0043 adds
profiles.bw_assessment_completed_at. Settings → Bodyweight progression
preview page shows current node per family.

## [2026-05-25] refine | BW progression Phase 3 ÔÇö engine prescription (feat/bw-phase3-engine-prescription)

bwPrescription matrix returns sets/reps/RIR/tempo/hold per (node, family,
archetype, bucket, week). Strength/hypertrophy/endurance branches with
research-grounded defaults; deload week 3 scales down. createBlock writes
prescription_json on bodyweight_only paths. MovementFocusView renders
prescription cue + hides weight column for BW main lifts.

## [2026-05-26] refine | BW progression Phase 4 ÔÇö TUT-gated progression engine (feat/bw-phase4-tut-progression)
Pure progression engine (apps/web/src/lib/planner/bw-progression.ts) decides
advancement per family based on weeks-at-node (>=2), accumulated time-under-
tension vs. anchor-scaled threshold (anchor x 12 for skill / isometric_capable,
anchor x 6 otherwise; floor 60s / ceiling 1500s), and over-completion of the
last 2 sessions (reps +2, hold +3s, tempo_reps +1; RIR>=1, cleanForm).
Migration 0045 adds bw_progression_events audit table (RLS self_read/self_write).
Server hooks in lib/sessions/bw-set-logging.ts accumulate TUT per logged set
and evaluate + persist advancement on completeSession. Planner stamps
nextNodePreview onto each BW PrescriptionItem so MovementFocusView can render
a 'Next:' chip + gate-state popover (weeks/TUT/recent counter). Settings ÔåÆ
Bodyweight progression page gains TUT progress bar, weeks badge, and a Recent
progressions list (last 10 events). Brand-purity (DC-Q6) preserved.

## [2026-05-24] refine | BW progression Phase 5 -- mixed-modal + hinge compensation (feat/bw-phase5-mixed-modal-hinge)
classifySessionModality buckets sessions into 7 classes; mixed_modal
(strength + cardio) gets 1.25x stress multiplier per addendum 6.
maybeInjectHingeCompensation adds tempo/isometric hinge work when the
session would otherwise lack posterior-chain loading (addendum 3),
gated by acknowledged hinge gap. Migration 0046 stores modality +
effective_stress_load on planned sessions. Session header shows modality
chip; settings page shows current hinge compensation state.


## [2026-05-24] refine | BW progression Phase 6 -- stall + drift detection (feat/bw-phase6-drift-detection)

runDiagnostics surfaces 7 signal kinds: stall_at_node (soft 4wk / hard
6wk), aesthetics_drift_upper_strong (upper/lower ratio >= 2.5),
aesthetics_drift_pull_dominant (pull/push > 1.6), tendon_load_undercooked
(skill family TUT < anchor x 8 after 3wk, anchor >= 50), cns_overreach_risk
(>=5 skill-focused sessions in 14d), hinge_gap_active (no hinge work 14d),
regression_risk (>3 missed sessions/family/14d with positive TUT). Pure
read-only module -- never writes back to bw_progress. Dashboard surface
(BwDiagnosticsSection) renders top 5 by severity with All-clear chip on
empty; session recap surfaces up to 2 family-relevant signals. Migration
0047 adds bw_diagnostics_snapshots (jsonb, capped at 100/user, RLS
self-only). Snapshots captured at session completion + block creation.

## [2026-05-25] refine | BW progression Phase 7 -- loaded bodyweight (feat/bw-phase7-loaded-bw)
bwMultiplier table assigns leverage-equivalent ratios to ~30 loadable nodes
(pull-up = 1.0, archer = 1.4, one-arm = 2.0). effectiveTrainingMaxKg
bridges BW to the existing TM model. bwPrescription extended with
externalLoadKg + loadSource (dip_belt / weighted_vest / ankle_weights /
band_assist with negative kg). suggestLoadOrVariant heuristic biases
toward variant advance when load >= 30% bodyweight (addendum 1).
Migration 0048 adds bw_progress.target_external_load_kg and
bw_progression_events.load_kg_at_advance. Session UI shows load badge +
stepper; settings page shows Apply-suggestion button per family.
Equipment editor gains dipBeltMaxKg, ankleWeights, and bandStrength
fields (additive to existing accessory shape). Multipliers are
intentionally rough -- they exist for stress budgeting, not precise
load math; DAG node + clean rep history remain the source of truth.
## [2026-05-25] refine | Pre-workout check-in removed (fix/remove-prework-checkin)

The /app/sessions/start/[plannedId] interstitial is gone. Tapping `Start workout` now goes straight to the session log. Daily recovery logging lives on the Today page (HowRecoveredCard); a new profiles column show_today_recovery_card + settings toggle lets users hide it. Migration 0049.


## [2026-05-25] tooling | Migration drift guard (feat/migration-drift-guard)

Script `pnpm --filter @hta/db db:check` cross-checks `_journal.json`
against `drizzle.__drizzle_migrations` by SHA-256 and fails if any
expected migration is missing. Wired into the pre-push hook (full mode
against the configured `DATABASE_URL`) and CI (offline file-shape mode,
since the repo currently has no shared dev-DB secret in Actions).
Catches the migrator silent-skip bug that lost migrations 0043, 0045,
0046, 0048, 0049 from this project's dev DB earlier in the BW
progression work. Hashes the raw file bytes (matches the algorithm
the migrator actually writes to the tracking table) with an
LF-normalized fallback so a CRLF Windows checkout still matches a
row that was applied from a LF (Linux/CI) checkout.

## [2026-05-25] refine | Step 5 schedule: layout fit + drag-drop + banner copy (fix/step5-layout-dnd-and-banner)

- 7-day grid uses minmax(0, 1fr); cells no longer overflow the column.
- Drag-and-drop alongside tap-swap. Reducer state gains dragSourceIdx +
  dragOverIdx; same swap/move semantics as the click path.
- Replaced prominent saved-pattern banner with a muted footer line +
  inline Reset link. Removed the standalone Reset button (one
  affordance, not two).
## [2026-05-25] fix | date format propagation — getFormatProfile helper + sweep of stats / bodyweight-progression / limitations surfaces

## [2026-05-25] fix | strip internal DC-* codes from user copy (plan TissueStackCard, stats/engine page, planner conflict tooltips, engine derivations) + gate tissue-stack-deficit banner on (block age >= 7d) AND (>=1 completed session in last 7d). Added regression-guard test + 4 gating cases.

## [2026-05-25] refactor | bucket warm-ups separately from working sets (PR #113)
- `MovementGroup` gains `slotBuckets { warmup, working, accessory }` (back-compat with existing `itemIndices`).
- Focus-view caption + dot strip scope `Set X of Y` to the active bucket so warm-ups no longer inflate the working-set count.
- Defensive `humanizeSlug` fallback in `groupPrescriptionByMovement` — hinge-comp injection now reads `Hip hinge` even when only the slug is set.

## [2026-05-25] chore | compress plan-page vertical chrome (PR #114)
- Block-overview heatmap cell height 18->12, card padding 16->12.
- Month calendar empty cells minHeight 84->44.
- Legend moved into a '?' button next to filter chips; defaults to collapsed everywhere.

## [2026-05-26] feat | restructure /plan session card by prescription kind (PR-A)
- Replaced flat `Set 1..N` list (which mis-numbered accessories as main-lift sets) with structured sections: warm-up (collapsible) / main work (top-set chip) / accessories / posterior-chain support (hinge-comp) / tendon / cardio.
- New helper `lib/plan/prescription-grouping.ts` groups items by kind + movement, dedupes per movement_id, splits hinge-compensation accessories via `meta.hinge_compensation`.
- Rewrote `summarisePrescription` header line to `<MainLift> -- N working sets + M accessories` variants (TM/percentages moved into the card body).

## [2026-05-26] feat | /plan layout shift — hero up-next, two-column, denser calendar (PR-B)
- New `UpNextHero` at the top of /plan: large primary Start CTA for today's session (AM card primary on two-a-days), low-contrast Skip; rest-day variant peeks the next planned session.
- Right-rail `UpNextRail` shows the next 3 upcoming sessions with secondary Start buttons — only the hero owns the page's single primary CTA.
- Two-column layout at ≥1024px (PlanViews + block strip left, rail right), single-column stack below; uses inline `<style>` block (matches profile-page pattern).
- `BlockHeatmapStrip` replaces the old multi-row `BlockCalendar`: 4-week × 1-row horizontal heatmap, one cell per day, colored by status.
- Past completed sessions in the week list render at 0.55 opacity; today stays full strength. Future-day Start buttons inside the week list are secondary (one primary per page).
- New pure helper `lib/plan/up-next.ts` (`selectUpNext`) + 6 unit tests covering today/upcoming/two-a-day ordering/shape counts.

## [2026-05-26] feat | /plan empty-state + edge-case polish (PR-C)
- New pure helper `lib/plan/block-state.ts` (selectBlockState) classifies the hero into 'no-block' | 'future' | 'completed' | 'no-session-today' | 'active'; 7 unit tests cover the matrix.
- UpNextHero gains future-block countdown (with 'Preview week 1' disclosure), reworded rest-day card, and a celebratory 'Block complete' variant that hosts the existing EndBlockForm as primary CTA.
- Future-block state mutes the calendar + rail so the shape is visible without competing with the countdown.
- PlanViews filter chips: zero-result state now renders an inline 'No <strength|cardio> sessions in this view' block with a single 'Clear filter' text button.
- Tissue-stack banner audit: gating verified (>=7 days since block start AND >=1 completed session in last 7 days). No change needed.
## [2026-05-26] feat | /plan UX excellence sweep (PR-D)
- Day-group date header now always renders (TUE · 05-26) so the dense full week list has a clear visual anchor; dropped the per-card date suffix (Problem 2 from the original /plan brief, deferred by PR-A).
- Skipped sessions get a one-glance distinction: warning-token left-border accent + 0.75 opacity + warning-tinted background, so they read as 'intentionally bypassed' instead of blending with completed.
- `describeRowExternalLoad` helper + plan-card chip surface the planner's bw.externalLoadKg / loadSource (e.g. `+10 kg vest`, `-15 kg band`) on accessory / hinge-comp / tendon rows.
- Filter chips persist across reloads + browser back/forward via `?filter=` URL sync (router.replace, no history spam).
- A11y: BlockHeatmapStrip cells expose a real aria-label on the clickable Link (date + state) and mark rest-day cells aria-hidden; UpNextHero ShapeStrip swapped from aria-hidden=true to role=img with an aria-label summarising the warm-up / main / accessory / cardio counts.
- Skipped (A) row overflow menu: existing Un-skip button is already full-width + prominent — verified, no menu chrome added. (F) top-set chip already correctly tags the heaviest main-kind set (back-off excluded). (H) hinge-comp already detected via meta.hinge_compensation. (I) cardio sections already render via CardioSection. (C) heatmap + calendar already use status-token vocabulary consistently. (K) no dead code surfaced after the layout shift.

## [2026-05-26] refine | Today + plan perf wave (PRs #134-#139)
Client-side range toggles + cached auth (#136), loading skeletons on slow routes (#137), parallel awaits + N+1 fixes + indexes (#138), aggregated prior-bests RPC + hygiene wins (#139). /plan calendar/timeline view + filters + drawer drill-down (#133). Cuts Today + /plan first-paint substantially.

## [2026-05-26] refine | Cmd-K palette + Today redesign (#42, #43)
Quick-jump command palette across /app/*; Today page redesigned to H1 + two-column shell + data rail + 'How recovered' card + activity grouping.

## [2026-05-27] refine | External cardio source + HR zones (PRs #159-#168)
Planner reserves cardio days and defers prescription when external source owns the truth (#159). Strava-fed cardio classified from HR + duration (#160). Three HR-zone methods shipped (%Max, %HRR, %LTHR) with editable percentages per method (#161, #172). Engine consumes HR-aware buckets + per-region load when zones are available (#167). Wellness sliders feed recoveryMultiplier (#166); effective_stress_load recomputed from logged sets + cardio (#165). Anchor adherence requires a logged anchor set + uses main-lift role names (#163, #164). Cardio-swap excludes unclassified movements (#168).

## [2026-05-28] refine | Engine hygiene + modality-aware scalar (PRs #178-#184)
Consolidated actual-session-load reads (#178); deduped CARDIO_SCALAR + tightened alactic classifier + documented recovery-scale split (#180). Stage-A continuous concurrent-training scalar replaces discrete buckets (#181). User limitations wired into accessory + power filters (#182). Beginner-only accessory volume ramp for first 3 weeks (#183). Per-region load-spike warning banner on Today (#184).

## [2026-05-28] ingest | ADR 0002 — AI architecture (Explain v1 + BYOAI)
Dual contract: in-app Explain v1 chat surface backed by pluggable LlmProvider (Anthropic / OpenAI / Gemini), keys held in a pgcrypto vault keyed by AI_KEY_ENCRYPTION_KEY. Filed at docs/adr/0002-ai-architecture.md (#185). Implementation landed in #186 (BYOAI plumbing, vault, Settings UI, observability scaffolding) and #187 (Explain v1 chat surface + getEngineSnapshot tool + eval fixtures). Migration 0069.

## [2026-05-28] refine | Limitations v2 lifecycle (#189)
Bilateral side + muscle-level filter + per-exercise allow + event lifecycle (active / paused / resolved) + Today banner. Migration 0070.

## [2026-05-28] ingest | ADR 0003 — MCP server + in-app chat dual path
Streamable HTTP MCP endpoint at /mcp/[...mcp]/route.ts with OAuth 2.1 bridge, PKCE, single-use authorization codes (mcp_consumed_codes), HMAC-signed bearer tokens via MCP_TOKEN_SIGNING_KEY. 8-tool catalogue shared by the in-app chat (orchestrator v2, #195) and external MCP clients. PR A (#194) shipped the server + catalogue; PR B (#195) rewired orchestrator v2. ADR at docs/adr/0003-mcp-dual-path.md (#193). Migrations 0071 + 0072.

## [2026-05-28] refine | AI settings UX (#188, #190, #191, #196)
Dropped the master ai_opted_in switch in favour of collapsible MCP + BYOAI cards (#196, migration 0073). Inline 'i' button explaining key storage + privacy (#188), rewritten end-user disclaimer (#190), 'Bank-level encryption' framing (#191).

## [2026-05-29] ingest | ADR 0004 — Endurance Focus dual main lift
Post-Huiberts 2024 the Endurance archetype now prescribes a dual main lift (squat + hinge); Concurrent Hybrid trim fix accompanies (#197). docs/adr/0004-endurance-anchor-dual-main-lift.md.

## [2026-05-29] ingest | ADR 0005 — Frequency-aware dual-main-lift folding
When weekly slot budget is tight, secondary main lifts fold into the primary day instead of being dropped (#198). docs/adr/0005-frequency-aware-dual-main-lift-folding.md.

## [2026-05-29] ingest | ADR 0006 — Balance all archetypes at low frequency
Demote bench-press / overhead-press anchors in Strength + Hypertrophy archetypes so ADR-0005 folding produces symmetric prescriptions at low weekly frequency (#199). docs/adr/0006-balance-all-archetypes-low-frequency.md.

## [2026-05-29] refine | Mobile UX overhaul (PRs #200-#210)
Scrollable /plan calendar + mobile nav cleanup (#200); month prev/next + title (#201); MORE -> settings + week-only plan view + full-screen swipe-dismiss drawer (#202). Preview-workout route as secondary CTA (#203, #204). Today hero at-a-glance summary, deduped HR cap, copy unified on 'workout' (#206, #207). /plan polish: remove block tooltip, add overdue count, unify history link styling (#205). Cardio in-session rebuild: log form + descriptions + clean layout (#208) -> full active-session UX overhaul + Strava autofill wiring (#209) -> Mockup B + Strava webhook + shared RPE button-grid picker + unified '+ Add to workout' (#210).

## [2026-05-29] refine | Strava integration end-to-end (PRs #210-#212)
Push-subscription webhook at /api/integrations/strava/webhook with idempotent strava_event_log dedup (migrations 0075 + 0076), single-activity sync, historical import via /app/settings/integrations + transparent skip summary (#211), onboarding step as second-to-last (#212), 3-state autofill banner on cardio sessions (suggested -> applied -> ready-to-finish) that locks the form after apply so the user only adds RPE + finishes. Manual pnpm run strava:subscribe registers the subscription per env.

## [2026-05-30] refine | Quick workout entry on Today (#213)
Inline dashed card + bottom-sheet picker + three server actions (startQuickCardioSession / startQuickStrengthSession / repeatRecentSession) for off-plan + rest-day logging without going through the planner.

## [2026-05-30] refactor | Hybrid completion guard extraction (#214)
Shared sessionPrescribesStrength helper now drives every 'did the session finish?' branch: logCardioSession, applyStravaAutofill, finishStravaAppliedSession, importStravaHistory auto-link. Prevents a cardio log from prematurely marking a hybrid session complete when the strength block is unlogged. Migration 0074 adds cardio_logs finish-uniqueness as a belt-and-braces backstop.

## [2026-05-30] refine | Settings reorg + cancel workout (#215)
/app/settings/integrations sub-hub consolidates Strava + AI cards. HR-zone method picker labels rewritten plain-language (%Max / %HRR / %LTHR). Cancel workout button on empty in-progress sessions stops abandoned starts piling up in history.


## [2026-05-30] refine | .mailmap contributor consolidation (#217)
Non-destructive collapse of 11 historical author identities to drrowdev + Copilot on the GitHub contributors page. No SHA rewrites.

## [2026-05-30] refine | Cardio hero consistent for all kinds (#218)
Z2, tempo, alactic, mixed get the same hero treatment as VO2. New cardioOneLinerForKind + kind-based Intensity fallback in cardio-preview-rows. Cross-kind regression test iterates every key in CARDIO_DESCRIPTIONS.

## [2026-05-30] refine | Taper + post-race recovery lifecycle (#219)
Interactive opt-in banners replace the advisory taper card; race check-in card the day after event_date; computeRecoveryWindow scales by distance x modality x tier x priority (Hikida 1983 / Nieman 2007 / Byrne 2002 / Newham 1983 / Dupuy 2018). Engine applies active modifications in buildPrescription. Migrations 0077 + 0078 (RLS fix from review).

## [2026-05-30] refine | Today hero uses SessionPreviewBody compact (#220)
Hero card now renders SessionPreviewBody variant=compact for one-source-of-truth with the Preview page. TodayHeroSummary deleted. Preview workout link dropped (redundant). Quick workout card moved above This Week.

## [2026-05-30] refine | Focus muscle groups (#221)
Per-block aesthetic specialisation: user picks 0-2 muscles from a 12-group allowlist; substitution-with-cap bias preserves total session set count. Forearm tendon-gate silently downgrades when elbow/forearm ATL spikes. Migration 0079 (training_blocks.focus_muscles). CP-2 row #34 added; engine-live updated.

## [2026-05-30] refine | Quick workout UX sweep (#222)
Inline duration chip picker replaces 30-min hardcoded default; single + Add to workout (kills regression); edit cardio page in min + M:SS/km via shared lib/cardio/units.ts; context-aware edit (prescription-only / logged / Strava-readonly); strength empty-state placeholder; cardio block renamed cardio session; hybrid finish bar clarifier.

## [2026-06-01] decision | Brand identity locked — SxC (docs/design/brand-identity.md)
Consumer brand SxC (Strength x Cardio), domain getsxc.app. Wordmark Archivo Bold 700 + green x multiplier glyph; descriptor STRENGTH x CARDIO in JetBrains Mono 500 wide-tracked (.28em). Iron palette + accent green mapped to existing --cp-accent/--cp-text. App changes: header H glyph -> theme-adaptive S x C live-text wordmark (TopNav.tsx); Archivo via next/font as --font-brand + OpenGraph/Twitter metadata (layout.tsx); charcoal app-icon master + favicon swapped; outlined-path brand SVGs under public/branding; 1200x630 OG card public/og-image.png. Spec doc added to index under Feature design docs.

## [2026-08-03] decision | SxC becomes canonical for TB3 strength programming
Ported the verified Forge TB3 behavior into SxC's existing program-engine, materialization, Supabase and logger architecture. Operator, Fighter and Zulu now use the TB3 75/80/85/75/80/peak wave, 3–5 work-set ranges, named 100% peak sessions and prescriptive fixed loadouts; Operator includes weighted pull-ups plus the day-5 deadlift replacement, Fighter keeps deadlift at 1–3 sets, and Zulu includes its 70/75% light passes plus 3–5×8–10 supplemental wave. Added the 25-week Activation on-ramp with Base, test, Armor, Operator Blue/Black, explicit week-15 deload, peak/test weeks and Vertex/Breacher phases. Catalog-backed movement resolution materializes unanchored circuit/explosive work without fake training-max rows, while missing percentage anchors remain explicit and can be established by Activation's test weeks. Optional sets are concrete logger slots but excluded from required completion; the recap offers them explicitly instead of recording declined optional work as skipped. Forge remains a reference until live SxC parity is proven; its storage/sync/UI layers are not copied.

## [2026-08-03] refine | Instant session logging performance pass
Profiled the authenticated Program → Start → Log → Finish flow in Playwright at 1280×720 and 390×844, then optimized the measured hot paths. Set logging now paints optimistically and arms Finish without a router refresh; IndexedDB reuses one connection and indexed counts; unaffected movement cards are memo-isolated; set_index allocation is atomic in Postgres; last-set hints use one RPC instead of one request per movement; BW catalog reads run in parallel. Completion ownership, RPE/duration aggregation and stamping are one RLS-protected RPC; stats, block progression, TM and BW bookkeeping run after the response. Finish uses a stable pending state followed by full summary navigation. Production measurements: set POST 969→455 ms desktop and 658→405 ms mobile; completion action 3710→334 ms desktop and 3440→338 ms mobile; summary visible 4910→1750 ms desktop and 4410→1680 ms mobile; session-flow CLS 0.550/1.016→0.000/0.000. A delayed-network Playwright test proves card state and Finish arm within 500 ms while the server response is held for 1.2 s.

## [2026-08-04] fix | Activation phase schedules include conditioning
Activation now materializes its programmed conditioning alongside strength: Base adds three LSS days, Armor adds two 60-minute LSS days, Operator adds two HIC/work-capacity days, and Vertex adds two hills/HIC days. Phase-start summaries are derived from the active sessions at each segment boundary instead of the generic template placeholder. Starting at Armor now shows and deploys 4 strength, 2 cardio and 1 rest day; the rebased 20-week plan contains 86 sessions. Cardio-only training prescriptions materialize with the cardio role, while test and deload roles remain authoritative.

## [2026-08-04] fix | Correct TB3 Ab Triad and Armor lift roles
TB3 Ab Triad prescriptions now materialize three separate catalog movements for three rounds of 5 hanging leg raises, 5 hanging knee raises and 5 toes-to-bar in both Activation and Zulu. Armor A1 rack pulls use the four-set main-lift dose throughout Armor; weighted pull-ups follow the main wave on B1 and the three-set second pass on B2. Back extension remains supplemental and supplemental-only movements now render under a dedicated Supplemental lifts section instead of Main lifts.

## [2026-08-04] fix | Reconcile Activation Armor with the TB3 source table
Supersedes the prior Armor B-day interpretation: B1/B2 main work is Bench plus Row only; Pull-ups or Inverted Rows belong to Supp B with Overhead Press. Activation setup now selects one Supp A variant (Reverse Hyper plus Ab Triad or Back Extensions plus Ab Triad) and one Supp B variant (Pull-ups plus Overhead Press or Inverted Rows plus Overhead Press) for all Armor weeks. The complete source matrix is enforced: week 1 uses 4x8 at 70% on D1/D2 and 3x8 at 75% on D4/D6; week 2 uses 4x5/3x5 at 80%; week 3 uses 4x3/3x3 at 85%; Deadlift tapers 3/2/1; supplemental work is 3-5x8-10 at 65/70/75%, with max reps allowed for bodyweight pulls; conditioning remains two 60-minute LSS sessions and no HIC. Structured set/rep ranges and optional sets now survive materialization and render accurately across plan, preview and logger surfaces. Direct Armor starts require every loaded Armor max, while Base starts may establish them later; new maxes inherit the active TB loading basis.

## [2026-08-04] refine | Align optional-set hierarchy between drawer and preview
Workout-drawer optional sets now place the muted optional marker beside the set number on the left, matching the workout preview, while the right prescription column contains only load and rep targets. Optional rows use a wider label column, the fully opaque muted text token, and a narrow-screen wrap so the hierarchy stays readable without dimming the prescribed work or colliding with long movement names.


## [2026-08-04] refine | Simplify Today hero hierarchy
Today now keeps program identity and full Week X of Y progress in the page eyebrow, removes the Strava stale pill and posterior-chain load banner, and drops duplicate program/week chips plus the ambiguous top-set chip from the hero. Hero movement counts are role-specific, and the compact prescription renders separate Main Lifts and Supplemental Lifts cards while the full workout preview remains unchanged. The removed top-set provenance query and region-spike query also shorten the Today read path.


## [2026-08-05] refine | Rebuild Plan around program phases and readable weeks
Plan is now the macro review/edit surface rather than another workout launcher. The active program, current engine-owned phase and completion progress lead the page; Edit and History stay visible while recovery, start-new and end-program actions move into a keyboard-safe overflow. The duplicate This Week rail, nested timeline scroller, modality filters and bottom controls card are removed. Program becomes a full-width phase/week accordion with completed, current, attention and upcoming states, date/load summaries and readable two-column agenda rows that stack on mobile; Calendar remains secondary. Plan's shared session drawer keeps reschedule, skip, notes and prescription edits but removes Mark done and overdue Log now, which remain owned by Today. Mid-program offsets are persisted and inferred for legacy instances, inserted recovery weeks become explicit one-week phases, and non-Monday/pre-start/post-end blocks share the materialized Monday calendar model.


## [2026-08-05] refine | Distinguish completed workouts inside the current week
Completed workout rows in the expanded Plan agenda now inherit the completed-week visual language: neutral settled surface, green success edge, success date and Done badge. A whole day receives the treatment only when every scheduled session is complete; mixed two-a-days style only their completed workout, preserving the unfinished session's planned state.


## [2026-08-05] refine | Strengthen dark-theme completion and unify Season chrome
Completed workouts now use a materially stronger success-tinted surface, 6px success edge, inner outline and high-contrast Done badge in the dark theme. Season adopts the same Program/Calendar/Season segmented navigation, body typography, 16px cards and global button hierarchy as the redesigned Plan views; completed and active season blocks also use the corresponding settled/current state treatments.


## [2026-08-05] refine | Add versioned customized Tactical Barbell programs
Standalone Tactical Barbell templates can now run as a backend-marked Customized derivative while retaining the canonical TB engine, percentages, set/rep waves and peak progression. The weekly overlay supports movable strength and open conditioning days, rehab-only days with user/clinician-entered prescriptions, and movement selection per stable strength slot; Activation remains fixed and is rejected server-side. Customized identity and the editable display name persist independently, forward edits freeze current and completed work, active limitations take precedence, and Program/History expose a permanent Customized badge. Canonical no-overlay output remains byte-identical, including explicit regression coverage for Operator, Fighter and Zulu peak sessions.


## [2026-08-05] refine | Keep Season inside the active-program Plan shell
Season now behaves as the third local Plan view alongside Program and Calendar whenever an active program exists. Switching tabs preserves the active-program identity, actions, completion progress, dimensions and responsive shell while replacing only the content pane with the long-range roadmap. The standalone Season page remains available only for the edge case where a roadmap exists without an active program.


## [2026-08-06] refine | Add phase-aware customized Activation
Activation can now run as Tactical Barbell - Customized without weakening the canonical 25-week program. A version-2 overlay gives Base, Armor, Operator and Vertex independent session placement, optional conditioning, open-day rehab and canonical movement-slot removal or compatible replacement; each replacement inherits the source slot's main/supplemental/core rules while loading from its own benchmark. Protected test/peak weeks remain engine-owned and accept only unambiguous derived mappings. Start-point and forward-edit boundaries lock irrelevant/past phases, active limitations evaluate every effective work and milestone movement, and canonical/identity overlays remain byte-identical. The existing positive customization marker supports v2 without a database migration.


## [2026-08-06] refine | Regenerate untouched workouts later in the current week
Forward Edit program now freezes calendar slots through today instead of freezing the entire current week. Completed, started and skipped sessions remain immutable anywhere in the plan, while untouched sessions after today can be deleted and regenerated even when they fall later in the same week; pre-start blocks can still regenerate week zero. The reconciliation remains collision-safe against preserved slots and keeps the same block, program instance, history links and completed-session statistics.


## [2026-08-06] refine | Redesign customized program editing and rehab placement
The customized TB/Activation editor now presents each program slot as a clear source-slot/current-exercise row with searchable access to every non-cardio exercise in the catalog. Catalog-backed selections use their exact movement id and saved 1RM when present; otherwise they become manually loaded and never inherit the source movement's weight. Server-side catalog membership and active limitations are authoritative. Activation exposes a persistent rehab protocol panel for movement, side, sets/reps or hold, load and clinician instructions; phase day chips can add rehab either to an empty day or as a separate PM session alongside strength/conditioning. Standalone customized TB uses the same searchable library for adding exercises, and all choices restore in forward Edit program.


## [2026-08-06] refine | Make customized workout ordering intuitive
Activation edit cards now derive their visible Strength/Conditioning ordinal from the current weekday order while retaining A1/B1/etc. only as secondary prescription identity. Selecting a weekday already occupied by an enabled workout atomically swaps the two day assignments instead of requiring an empty intermediate day. Disabled conditioning sessions may change their placeholder day without displacing active workouts. Stable session keys, movement choices, rehab overlays and milestone mapping remain unchanged.


## [2026-08-06] refine | Keep customized workout cards in calendar order
Activation phase session cards now render in selected weekday order. An occupied-day swap therefore moves both workout cards to their new visual positions immediately, while stable A1/B1 prescription identity and all persisted customization data remain unchanged.


## [2026-08-06] remove | Retire AI and unify launch branding
Removed the in-app chat, session explanation/review controls, provider settings, API and MCP routes, model SDKs, eval/tooling code, and their tests. Migration 0121 deletes provider credentials, chat history, assistant memories, observability and authorization metadata, and provider profile fields; the retained user-owned notes field is presented only as Training notes and exported under training_notes. The compact SxC diamond mark now drives landing/login, favicon, PWA/native icons and splash screens, and social metadata; the expanded descriptor and legacy wordmark assets are retired.


## [2026-08-07] refine | Link TB3 AB Triad logging by round
TB3 AB Triad keeps nine granular set slots across Hanging Leg Raise, Hanging Knee Raise and Toes-to-Bar, but now carries typed circuit identity through the program adapter. The Focus Strip advances 5 leg raises -> 5 knee raises -> 5 toes-to-bar, rests after each completed round, and repeats for three rounds with round/movement guidance. Existing materialised canonical sessions are inferred from the exact three slugs, 3x5 dose and stored AB Triad note, so upcoming workouts gain the flow without regeneration; partial or legacy-swapped triads remain unlinked. Full engine, adapter, logger, legacy-reload and authenticated browser coverage preserves distinct set-log movement attribution.


## [2026-08-09] fix | Complete prescribed cardio in one tap
Pure prescribed cardio sessions, including Tactical Barbell Activation LSS cardio_external days, now expose one Mark done action that preserves an existing manual cardio log or creates one from the planned duration, completes the session and returns to Today. The strength-only finish gate and redundant full cardio form are removed from this path. Hybrid sessions remain in progress until strength is logged. Session creation uses a conditional planned-slot claim with orphan cleanup, duplicate cardio inserts are treated idempotently, and completed session duration is stamped from the retained cardio logs. Authenticated coverage proves a manual 51-minute log is preserved and a fresh 60-minute LSS records 60 minutes.


## [2026-08-09] refine | Group AB Triad as one Activation builder slot
The customized Activation builder now presents canonical AB Triad as one atomic program slot with its fixed Hanging Leg Raise -> Hanging Knee Raise -> Toes-to-Bar sequence and 3 rounds x 5 linked-logging cue. Remove/Restore applies to all three underlying source slots together, while saved prescriptions, movement attribution and live logging remain granular. Existing partial or noncanonical compositions are surfaced explicitly as custom and are only reset when the user chooses Restore. Authenticated create/edit coverage verifies one row, atomic removal/restoration and saved edit restoration.


## [2026-08-09] refine | Separate current and completed Plan day states
Plan week days now use distinct visual semantics: completed days retain the sage success fill and left edge, while Today uses a neutral elevated surface, bright neutral inset outline and high-contrast Today marker. A day that is both Today and complete keeps the neutral current-day surface/outline, the green completed edge and both Today and Done labels. Data-state markers and authenticated computed-style coverage verify the states differ by background and shadow; labels ensure color is not the only cue.


## [2026-08-09] refine | Normalize AB Triad row and seed Landmine Squat to a Box
AB Triad now uses the same builder row styling and Exercise/Change/Remove controls as every other movement. Change replaces the whole slot with one selected library movement by keeping one 3x5 source slot and removing the other two, preventing tripled replacements; Restore AB Triad explicitly restores the three canonical linked movements. Migration 0122 and the TypeScript seeds add Landmine Squat to a Box as a supported, moderate-axial compound squat requiring a barbell and box, with catalog muscle/region metadata plus setup, execution steps, cues and common mistakes. Seed, migration, picker create/edit and visual-parity coverage pass.

## [2026-08-09] add | Seed standing banded four-way hip protocol
Four global, separately loggable movements now represent the standing banded four-way hip protocol: flexion, extension, abduction and adduction. Each direction is unilateral, support-assisted and carries protocol/direction metadata plus its own low-anchor setup, four controlled steps, cues and common mistakes. Abduction/adduction receive the hip-stabilizer role; extension targets glutes/hamstrings without false lumbar loading. Because the current muscle enum has no hip-flexor category, flexion deliberately uses region/protocol metadata with no false quad/adductor muscle surrogate, and the shared seed invariant records that narrow exception. Migration 0123 idempotently seeds the catalog rows and instruction content.

## [2026-08-10] fix | Scope tissue-stack warnings to planner-owned archetypes
The Plan tissue-stack deficit audit now runs only for predefined archetype-planner blocks that actually own the DC-O4 durability floor. Packaged programs including Tactical Barbell, 5/3/1, Green Protocol, HYROX and Hybrid are excluded through their durable program identity, including customized variants. A positive archetype allowlist also suppresses legacy program placeholders, user-built day-by-day custom blocks, null identities and unknown block types while preserving the warning for eligible legacy planner archetypes.

## [2026-08-10] fix | Keep Today rehab and weekly summary consistent
Today no longer shows the generic Two-a-day literature notification. The shared This week rail now renders every same-day session in slot order and labels rehab correctly instead of collapsing the day to its first row. Tactical Barbell forward edits may refresh a pristine rehab session scheduled today so protocol changes reach the preview immediately, while today's non-rehab work and any rehab with completion/skip state, explicit time, notes or per-session movement edits remain frozen. Legacy unmarked remove-only edits are preserved by comparing the stored row against a reconstruction of the prior program setup before rewriting.

## [2026-08-10] add | Assign named rehab protocols by Activation day
Rehab previews now show the actual prescription dose as sets x reps or sets x hold and label clinician-authored work as Rehab instead of exposing the internal tendon kind. Customized Activation v3 supports up to eight named protocols, each with its own movements and loading, plus an independent day-to-protocol assignment in every phase. Existing v2 plans restore as Protocol 1 and preserve legacy session references until saved as v3. Only assigned protocols in reachable phases participate in limitation checks and materialization; partial rows block Save, program switches clear drafts, and two-protocol create/edit coverage verifies persistence and restoration.

## [2026-08-10] fix | Make Today workout CTAs reflect real session state
Today now distinguishes Start, Continue, View and Restore from the linked session's active/deleted/completed state instead of treating every raw planned-session link as in progress. Cancelled unfinished sessions are presented as unstarted and can safely restore/reuse their existing session without a 404, link clearing or duplication; deleted completed workouts require explicit restoration from Trash. The same deleted-aware link state now governs planner/history rows, adherence, heatmap, progress, block completion, movement swap links and adaptive remaining-session/deload paths so UI and statistics cannot disagree.

## [2026-08-10] fix | Hide settled workouts from Today primary cards
Today now renders primary workout cards only for unfinished, unskipped planned sessions. Completed and skipped rows remain visible in This week, history and recent activity, while the full planned day still drives all-logged state and AM/PM context. Partial days therefore keep only the pending card; completed-plus-skipped days show the logged summary; all-skipped plans show No remaining workouts rather than a false Rest day; unrelated activity cannot make an all-skipped plan look logged.

## [2026-08-10] fix | Expand rehab prescriptions into granular logger sets
Foreign-program rehab now uses the same one-prescription-item-per-loggable-set storage contract as planner-generated accessories, so a 5x15 / 3x10 / 3x10 / 3x10 protocol produces fourteen Focus Strip set slots instead of four. Migration 0124 idempotently expands existing rehab rows only when no set logs exist, preserving prescription-item attribution for started work. Clinician-authored rehab groups and set buckets are labeled Rehab rather than exposing the internal tendon kind.

## [2026-08-10] fix | Fill every planned rehab set idempotently
Same as planned now tracks fulfillment per prescription item and copy rather than deduplicating an entire movement/kind after its first set. The planner supports expanded and legacy collapsed prescriptions, partial fills, deleted middle copies and movement swaps. Each planned set uses a deterministic UUID derived from session, item, copy, movement and kind, then duplicate-ignoring upsert makes repeat and concurrent taps idempotent without suppressing legitimate sibling sets.

## [2026-08-10] fix | Count unloaded rehab work in completed summaries
Completed-session set totals now count real non-warmup work independently from tonnage, so unloaded rehab and bodyweight reps, timed holds and distance-based work remain completed even without external weight. Warmups, skipped rows and empty rows stay excluded, while tonnage still requires positive load and reps. Same as planned now persists the same rep, hold-duration or distance target shown by the individual logger through one canonical prescription resolver. Authenticated browser coverage follows a fourteen-set mixed rep-and-hold rehab workout from bulk fill through persisted rows, completion and the reloaded 14 / 14 summary.

## [2026-08-11] fix | Separate supported wrist rehab variants
General wrist curls, reverse wrist curls and dumbbell pronation/supination remain distinct strength movements. The catalog now carries separate unilateral bench-supported dumbbell variants for wrist flexion, wrist extension, radial deviation and forearm rotation, each with explicit forearm-on-bench setup and controlled rehab instructions. Migration 0126 restores the general rows and seeds the three missing supported variants.

## [2026-08-11] fix | Keep Activation edit summary on the current phase
The final program summary now derives an edited Activation plan's week from its absolute current program position instead of resetting to Base. Rehab sessions assigned in the phase being edited therefore appear in the summary count, including plans that originally started from a later phase; new-program summaries continue to use the selected start point.

## [2026-08-11] refine | Embed same-day rehab in strength warm-ups
Rehab assigned to a day with strength now materializes as a provenance-tagged warm-up section inside the strength prescription, preserving one planned row, one live session and one progression event. Today, Preview, Plan and the live Focus Strip surface rehab separately from accessories, show that its duration overlaps the warm-up, start with rehab, provide section progress/navigation and require every rehab set to be logged or explicitly skipped before completion. Rehab-only days and cardio-plus-rehab days remain separate. Migration 0127 folds only untouched pairs from active plans, stores rollback provenance in JSONB metadata and has a conflict-safe down migration; started, skipped, scheduled, noted or user-edited rows remain unchanged.

## [2026-08-15] fix | Warm-up anchoring, swap attribution, session restart and AB Triad tier
Five owner-reported defects, root-caused and fixed together.

**Warm-up ladder was anchored wrong.** `percentLadder` multiplied the top working set's %TM instead of anchoring to TM, so the shipped `40/50/60` default became 34/42.5/51% TM at an 85% top set — a first warm-up below an empty bar. The app-wide default now derives from `GLOBAL_WARMUP_PERCENTS`/`GLOBAL_WARMUP_REPS` in `@hta/program-core` (40/60/80 x 5/5/3) rather than restating them, guarded by a lockstep test. New pure `roundWarmupLoadKg` adds an empty-bar floor and plate-pair rounding, with bar weight resolved once in `lib/sessions/bar-kind.ts` so the live logger and server materialization can no longer disagree; absent bar weight means no floor, so dumbbell, machine and bodyweight work is untouched.

**5/3/1-style programs get a TM-anchored ramp.** `WarmupScheme` gained an optional `anchor` ("top_set" | "training_max") inside the existing `profiles.warmup_scheme` JSONB — no column, no migration — defaulting to "top_set" so stored payloads stay valid and byte-identical. The 5/3/1 engine ramp is a flat 40/50/60% of TM x 5/5/3, identical in every week (200 kg TM: 80/100/120 in the 5s, 3s and 5/3/1 weeks alike, replacing 67.5/100/135 -> 75/112.5/150). Wired at both the engine layer, which emits absolute kg, and the swap-rebuild layer, which regenerates %TM and would otherwise silently re-anchor the ramp. The `program-core` comment claiming the work-set ramp mirrored 5/3/1's default was factually wrong and has been corrected.

**Main-lift swap kept the old lift's loads.** Swaps now clear stale `targetWeightKg` and regenerate warm-ups against the replacement's TM; rehab items keep their hand-entered load with a DC-K4 warning, since it is their whole prescription. Replacements with no TM retain blank warm-up slots and warn rather than losing the ladder. Mid-workout the prescription item COUNT is held constant — `set_logs.prescription_item_index` is a live join key, and re-indexing would mis-attribute logged sets and break `client_log_id` dedupe — so a swap needing more slots declines and says so (DC-K4).

**"Swapping a main lift lowers the set # by 1" (root cause).** Attribution was `indexLinkedSetIds.has(id) || set.movementId === group.movementId`. A forward-only swap retargets the item while `set_logs.movement_id` correctly keeps the movement performed, killing clause 2; clause 1 could not cover a second set at one index or a NULL index, so those rows vanished from the card, dot strip and "X of N". Fixed read-side in a single canonical `lib/sessions/movement-attribution.ts` — an item accepts its current movement plus its swap lineage — and the logs are never rewritten, because the lifter really did perform the original movement. `meta.swapLineage` is now an append-only chain so a chained A->B->C swap keeps the intermediate attributable; `meta.swappedFrom` still records the original-original for back-compat. Separately, swap candidates excluded only the original movement, so a hinge-pattern replacement already present in the session merged two cards into one (3 -> 2) with no logged sets at all; candidates now exclude in-session movements, search results flag them, and identity keying keeps a swapped block on its own card.

**Deleted workouts resumed where they left off.** `startSessionDirect` deliberately resurrected the soft-deleted session (`deleted_at = null` then redirect), restoring its old logs. It now clears the stale `planned_sessions.completed_session_id` link and inserts a fresh session, leaving the prior attempt in Trash. Two leaks fixed alongside: movement statistics counted soft-deleted attempts, and `region_state` was never recomputed on delete — nor on restore, which would have left Undo permanently lossy.

**AB Triad tier.** Hanging leg raise, hanging knee raise and toes-to-bar move from assistance to supplemental (engine-owned; no migration). Knock-ons are deliberate and owner-visible: rest 90s -> 120s (+4.5 min session estimate), protection from volume autoregulation (ADR 0013) and from limitation-driven auto-swap (ADR 0014, so a hip-flexor or lumbar limitation now warns instead of substituting), and eligibility for PR/TM proposals when loaded.

## [2026-08-15] decision | Capture prescribed-vs-actual on set_logs (ADR 0070)
set_logs recorded only what was lifted, so reducing load or cutting reps mid-session was invisible while skips and swaps were fully audited, leaving the engine unable to tell whether preceding sets landed as programmed. Reconstruction from prescription_item_index is unreliable because the taper and recovery transform reorders main and tendon items behind accessories and drops items outright, so the stored index addresses a transformed array, and main lifts hold a percentage rather than a load that survives a training-max change. Migration 0128 adds target_weight_kg, target_reps and a prescribed JSONB blob carrying optionality, set and rep ranges, effort target, AMRAP flag, percentage and its 1RM-or-TM basis, since a scalar cannot distinguish a discretionary Tactical Barbell cluster set from a missed one. Targets are submitted by the client from what was displayed and then corroborated server-side within tolerance behind a movement and set-kind identity guard, because re-resolving at insert reads current training-max and modification state and would persist numbers never shown after an offline replay; a mismatch stores NULL rather than a substituted figure. Immutability is enforced by a trigger since row-level security grants table-wide update, and the resolver refuses to record the logger's last-logged-weight fallback as a prescription. Skipped sets keep their snapshot because the deviation is the whole prescribed set. No backfill is possible, so every consumer treats NULL as unknown rather than on target, and the export documents that contract.
## [2026-08-15] refine | Surface prescribed-vs-actual passively (ADR 0070)
The snapshot captured by migration 0128 now reads back in two places the user visits by choice rather than mid-set. Completed sessions gain one neutral line comparing logged work to the prescription, and block analytics gains a Prescribed vs actual section showing the share of sets that landed as written, the share under target, average load against plan, and optional work declined. Both are descriptive and never suggest a response, because adjusting load and set count is the lifter's judgment; the value the app adds is remembering a block's worth of those decisions rather than issuing advice. A declined discretionary set counts as compliance rather than a shortfall, matching cluster templates that prescribe a range like three to five sets, and warm-ups are excluded so a ramp weight cannot register as a pullback. Sets without a snapshot are counted separately as unknown and never as on target, so blocks predating the migration render exactly as before and the section is simply absent rather than claiming adherence that was never measured.

## [2026-08-16] fix | Implement-aware weight steps and no rehab effort prompt
The logger's plus/minus weight buttons always moved 2.5 kg, the smallest pair of plates on a bar, which is meaningless on a dumbbell rack: a bench-supported wrist rehab set prescribed at 5.5 kg jumped straight to 8 kg on one tap. The step size is now resolved per movement in a single place, `lib/sessions/load-increment.ts`, which reuses the existing `resolveRequiredEquipment` resolver so the authoritative `movements.equipment` tag decides and the slug heuristic only fills gaps. Dumbbell work steps 1 kg; bars, machines, cables, kettlebells and unidentified movements keep the plate default. Either/or tags follow the resolver's existing first-listed-implement rule, so a barbell-or-dumbbell movement stays on plate jumps. Imperial uses 2 lb rather than a fractional step, because the display layer rounds pounds to whole numbers and could not honour 2.5 lb exactly. The prescribed target load is deliberately unchanged and still rounds to 2.5 kg, since that rounding also runs server-side during plan materialization and the two must agree.

Rehab sets no longer ask "how did it feel?". Rehab is prescribed by protocol at a deliberately sub-maximal load, so soliciting an effort rating invites autoregulation of a load that is not meant to be autoregulated, and nothing downstream consumes a rehab effort value; the picker joins warm-ups and bodyweight-node sets in the "no meaningful effort signal" exclusion. Effort already recorded against a rehab set is preserved on edit rather than cleared.
## [2026-08-16] decision | Replace antagonist auto-pairing with user-authored links (ADR 0071)
The block-level "Superset accessories" toggle inferred which lifts to pair from an anatomical antagonist table, and the inference was the problem rather than the feature: the lifter could not choose the members, main lifts were excluded outright because pairing required matching accessory kinds and equal set counts, pairs appeared and disappeared as the ADR-0013 end-slice trimmed accessory volume, and more than two members had no representation at all. It is replaced by explicit per-slot links of any size, expressed as the `circuit` primitive the engine already used for the AB Triad, so the logger, the preview and the duration estimate all understand one representation end to end. Links are stored in their own versioned envelope beside `customization` rather than inside it, because the wizard only builds a customization when the template is customized while links must also reach canonical Operator, Fighter and Zulu and Activation, and because the customization schema is a strict union whose parse failure would take the whole blob down with it; keyed by the engine's own series keys, one flat map covers every Tactical Barbell shape and Activation links are phase-scoped for free. Milestone sessions are refused at both the schema and engine layers since the unqualified key collapses repeats of the same test session across weeks that derive from different predecessor phases. Members are the canonical `sourceMovement ?? movement` identity so a link survives a substitution, which surfaced a latent bug where the Activation Armor supplemental swaps rebuilt the entry without that identity.

Links resolve against emitted items rather than the lift list, because a member can vanish for reasons the list does not show, and a link missing any member is dropped whole rather than rendering a half-bracket. `rounds` is the lowest required set count across members, and sets beyond it fall out of the rotation and log solo at full rest — a per-set fact, so the adapter stamps `circuit.round` while expanding a multi-set item, since every expanded set otherwise carries an identical copy of the circuit. That per-set distinction forced a rework of the logger, which had read the circuit off a movement's first item: on an anchored main lift that item is a warm-up carrying no metadata, so main-lift links were invisible, warm-ups counted as rounds, and trailing sets were never offered by navigation yet still demanded by completion, leaving the Finish bar unable to arm. The ADR-0026 rule that pairing never feeds volume selection is now enforced by an explicit pricing mode on the estimator, with the ADR-0020 governor asking for solo pricing, instead of resting on the fact that no path happened to produce grouping metadata before it ran. Migration 0129 drops both `superset_accessories` columns, with the rollback SQL inlined because the drift guard journals only forward migrations; the code release must ship first, since the plan queries, the logger and the wizard all select them by name. No prescription or set_log is migrated, so existing blocks keep identical prescribed work and only lose the auto-paired brackets.
## [2026-08-16] decision | mobile logger rehaul — session dock + movement navigator
Rebuilt the in-session logging surface around measured gym-floor ergonomics rather than screen-agnostic layout. Findings came from driving the real components at iPhone SE / 14 / 15 Pro Max viewports and measuring the DOM; the plan was reviewed against two external models before implementation.

**Measured failures in the pre-change build**
- Primary CTA sat at the end of a scrolling card, so its position depended on card height: **below the fold in all three sections at 375x667**, and underneath the fixed tab bar on the accessory section at 390x844.
- The on-screen numeric keypad (~336px) fully covered the CTA; `scrollIntoView` only rescued the input.
- Section navigation rendered only when the day contained rehab (`hasEmbeddedRehab`), so an ordinary day had no way to move between groups.
- The movement queue was 725px of chips inside a 358px window — 2 of 5 movements reachable, no peek/gradient/arrow.
- `supplemental` was folded into `main` by `focusSectionFor`, so back-off work was never addressable.
- Five different denominators for one lift on a single screen (11 / 6 / 3 / 3 / 6).
- 7 of 30 interactive elements under 44x44; 13 text nodes under 12px.
- `docs/design/mobile-polish-pwa.md` had already specified a sticky bottom action bar and "primary actions in the bottom 40%". It was never built.

**Changes**
- New `SessionDock` owns the bottom region (CTA + rest countdown + navigator trigger), pinned above the tab bar and publishing `--cp-session-dock-h` so the scroll container reserves exact space. The CTA remains a real submit button via `form=`, so the existing `onSubmit` path is untouched.
- `RestTimer` gained an `inline` mode; it previously fought the dock for the same fixed band.
- New `MovementNavigatorSheet` replaces the conditional section chips and the clipped queue. Always available, grouped Rehab / Main / Supplemental / Accessories, linked A1/A2 bracketed.
- `focusSectionFor` now returns four sections; `supplemental` is first-class.
- Chrome above the movement name cut from 294-375px to **133px** (56% -> 20% of the fold on an SE). Skip-rehab and reorder moved below the card.
- Touch floor enforced: dot pips, the how-to badge, the number fields and the skip links all now clear 44x44.

**Guarantees now pinned by tests**
`e2e/logger-ergonomics-mobile.spec.ts` drives a dev-only fixture at `/dev/logger-preview` (404s outside development, no DB/auth needed) and asserts: CTA inside the viewport and topmost at its centre for every movement x every phone size; navigation present with and without rehab; no navigator row clipped; supplemental addressable; supersets bracketed; every control >= 44x44; rest timer never overlapping the CTA.

**Open question deferred:** whether to hide the global tab bar during an active session. The external review recommended it (one owner of the bottom region, no accidental navigation away from a live session); it was not done here because it removes app-level navigation mid-workout and the reachability numbers pass without it.

## [2026-08-16] decision | mobile logger — durability pass (undo, offline vocabulary, resume, dock ownership)
Follow-up to the same-day logger rehaul. Closes the four items the external review raised that the first pass deferred.

**Dock owns the bottom region.** The global tab bar is now hidden while the session dock is mounted (`html.cp-session-live`), and `--cp-bottomnav-h` is zeroed so the dock and rest timer stop offsetting for a bar that is not there. Two stacked fixed bars cost 133px of a 667px screen and a mis-tap on "Plan" mid-set dropped the user out of a live workout. This was explicitly deferred in the first pass because **the session page had no exit affordance** — hiding global nav without one would have trapped the user. The navigator sheet now carries an explicit "Leave workout · your logged sets are saved" row, so leaving is deliberate and states what happens to the work.

**Offline vocabulary.** `OfflineSyncBadge` distinguished only offline / syncing. It now names the real state — `Saved on this device` / `Couldn't sync N` / `Syncing N…` / `All sets synced` (transient) / silent — and `SessionWorkArea` tracks a separate failed count from outbox entries with `attempts > 0 && lastError`. The failure mode being designed against is a user in a gym basement believing their work was dropped and re-logging it. The badge is never a blocker and never implies logging is unavailable.

**Undo.** Logging is optimistic and the CTA is now a large docked target, which makes a mis-tap both easier and more consequential. A logged set offers `Logged 100 kg x 5 · Undo` for 8 seconds, rendered as a row INSIDE the dock so it stacks with the rest row rather than covering the CTA the way a floating toast would. Undo only appears once the real row id comes back — an offline-queued set has no server row to delete, and offering undo for it would delete nothing and lie about it.

**Interruption recovery.** New `lib/sessions/session-resume.ts` persists active movement, cursor, unsaved draft and an **absolute** rest deadline to localStorage, restored once on mount and cleared on finish. Notes:
- `RestTimer` already derived remaining time from wall-clock (`Date.now() - start`), so a throttled interval while backgrounded was never the bug; the bug was that the start instant lived only in memory and did not survive a reload or process eviction.
- A draft is scoped to the movement AND slot it was captured on (`draftAppliesTo`) — restoring a squat's 115 kg onto a lateral raise would be worse than restoring nothing.
- State older than 6h, from another session, or from a backwards-moving clock is discarded rather than restored.
- 19 unit tests in `__tests__/session-resume.test.ts`. The suite runs in the `node` environment, so storage is stubbed rather than pulling in jsdom.

Mobile e2e grew to 11 cases; the new ones pin dock ownership + a reachable ≥44px exit, the undo guard, and that no dock row (rest, undo) can cover the primary action.

## [2026-08-16] fix | Finish prescribed cardio in one tap from the drawer
The Today "This week" drawer rendered Mark done as a link to the session screen, where an identical Mark done had to be pressed again to finish a pure prescribed cardio slot. The drawer now completes the session in place via the existing `markExternalCardioComplete` action, which resolves or lazily creates the session, writes the cardio log, completes the session and is idempotent on re-click. The one-tap path is gated on `prescriptionItemsHaveStrength` — the same predicate the action uses for its own pure-cardio check — so the drawer can never offer a finish the server would refuse; hybrid and strength-only slots keep the navigation link because they still need sets logged. The drawer closes and refreshes through the parent so the rail does not go stale, and a failed finish surfaces inline instead of losing the drawer.

## [2026-08-16] refine | One preview surface: the Today hero opens the shared drawer
The Today hero's Preview CTA linked to a standalone read-only route that duplicated the "This week" rail drawer, so the app had two near-identical preview surfaces. Preview is now a hash anchor that opens the SAME rail drawer, which already listens for the session hash and resolves it across all planned days rather than only the rendered week. A plain anchor is used deliberately because a client-side pushState navigation would not fire the hash change the rail listens for. The orphaned route, its smoke test and the planned-id guard that existed solely for it are removed; `SessionPreviewBody` remains as the Today hero's compact at-a-glance summary. Folding that component into the drawer body is still deferred, so the shared vocabulary is kept identical to keep visual drift obvious in review.

## [2026-08-17] refine | Edit a finished session from the drawer, and add the set you missed
The drawer's Edit button offered the prescription editor for a completed session, which edits the plan rather than what was actually lifted. For a finished slot Edit now navigates to the full session view, the single home for correcting what happened; unfinished slots keep the in-drawer prescription editor. The summary card's duplicate "View full session" link is removed so one destination has one affordance, and a defensive guard keeps the prescription editor from appearing if a session completes while the drawer is open.

Per-set correction already worked on a completed session through the read-only card's per-row Edit links. What was missing was adding a set the prescription never had a slot for, so the completed movement card gains a collapsed "Add a set" disclosure: read-only stays the default posture, and opening it shows an override-and-warn notice rather than blocking. The set is recorded normally and the session stays complete — `completed_at` is untouched, because this is a record correction, not a resumed workout. Un-completing would cascade into block completion, the Today rail and the plan's done state.

Post-hoc sets carry a NULL prescription item index, the one value that can neither collide with nor shift an existing index; pass one of attribution claims only rows with a valid in-range index, so an unlinked row is always attributed and never misattributed. A new single-home helper re-stamps the derived state frozen at completion — the actual stress-load stamp and the region ledger — gated on completion so a live workout pays one indexed lookup and nothing else, and best-effort so a recompute failure never loses the logged set. Wired into both the add-set and edit-set paths. Bump, deload and PR-recalibrate proposals stay gated to in-flight sessions, but a genuine post-hoc personal record still surfaces, which is why the form exposes set kind with a smart default: only main and supplemental rows feed record detection and training-max recalibration. Session duration stays wall-clock and is deliberately not recomputed.

## [2026-08-17] refine | Trim the post-session summary to numbers that carry information
Tonnage is removed from the completed-session card. It summed weight times reps over non-warm-up sets, so bodyweight, timed holds and carries contributed exactly zero and an unloaded session under-reported badly, while light high-rep work scored the same as heavy work. The value is still computed and still decides whether the strength tiles render at all; it is simply no longer a headline. Effective stress load was considered as a replacement and rejected: for strength it is hard sets times a modality multiplier, which is 1.0 for a pure strength day, so it would have printed the same number the Sets tile already shows. It stays a cross-modality currency for mixed and cardio days rather than a strength metric.

The personal-record tile now renders only when there is a record to report; a permanently visible tile whose usual value is zero spent a fifth of the row saying nothing happened. The card also had an uppercase eyebrow directly above a heading repeating the same words, so the eyebrow is gone and one heading remains.

The prescription-fidelity line now leads with what landed as written. Reporting only deviations made a near-perfect session read as a list of misses and left the denominator to be inferred, which is exactly how it was misread in practice.

## [2026-08-17] decision | Strava integration removed — paid API, permanently dead

Strava now charges for API access and the owner will not subscribe, so the
integration can never sync again. It was removed rather than left dormant: a
dead OAuth surface invites users to connect an account that will never work,
and every Strava-gated branch was a permanent false condition sitting in live
code paths.

**Deleted — ingestion.** The whole `apps/web/src/lib/integrations/strava/`
tree (`actions.ts`, `client.ts`, `import-history.ts`,
`link-external-cardio.ts`, `match.ts`, `sync-row.ts`, `sync.ts`,
`webhook-handler.ts`, `write-activity.ts`, `zones-from-stream.ts`,
`zones-from-summary.ts` and their tests); the OAuth callback
`app/api/strava/callback/route.ts`; the push-subscription webhook
`app/api/integrations/strava/webhook/route.ts`; and the two subscription CLI
scripts (`apps/web/scripts/strava-subscribe.ts`,
`strava-list-subscriptions.ts`) plus their `package.json` entries.

**Deleted — UI.** `app/app/settings/strava/page.tsx`; the entire
`app/app/settings/integrations/` sub-hub (it contained exactly one card, so a
zero-integration hub had no reason to exist) and its tile on the settings hub;
`StravaPoweredBadge`, `StravaStaleSyncTrigger`, `StravaAutofillBanner`,
`StravaConnectionActions`, `StravaImportHistory`, `StravaSyncPill`,
`StravaConnectStep` and their tests; the top-bar sync indicator in
`TopBarRight` (its only data source was `strava_connections.last_synced_at`);
the cmd-K Strava page entry; the autofill/finish server actions
(`applyStravaAutofill`, `finishStravaAppliedSession`) and their branches in
`CardioLogForm`; the HYROX activity matcher (`findMatchingStravaActivity` and
the `HyroxStravaMatch` plumbing) — HYROX completion is now manual-only; and
the onboarding "Connect Strava" step, which takes the wizard from 6 steps to
5 (Welcome → Profile → Equipment → Training maxes → Start training).

**Deleted — analytics, by explicit owner decision.** The three Strava-gated
cards `HrZonesCard`, `PacePRsCard`, `RunPlanAdherenceCard` and their data
modules `lib/stats/pace-prs.ts` and `lib/stats/run-plan-adherence.ts`, plus
their call sites in `StatsCommandCenter` and the stats routes. Not re-homed,
not preserved.

**Relocated, not deleted.** `lib/integrations/strava/` was never
self-contained; three of its modules were general-purpose cardio domain logic
with non-Strava consumers. They now live in `apps/web/src/lib/cardio/`:

- `classify-cardio.ts` — `cardioEslFromKind` drives cardio **effective stress
  load** (`lib/engine/actual-session-load.ts`), and `classifyCardio` powers the
  manual "link an already-logged activity to a planned cardio slot" feature
  (`lib/sessions/link-activity.ts`, PR #640). Logic unchanged.
- `modality-region.ts` (was `mapping.ts`) — `MODALITY_REGION` attributes
  cardio load to regions for `cardio_logs` rows with no `movement_id`
  (`lib/engine/region-ledger.ts`, `lib/hyrox/materialize-actuals` tests). The
  Strava-only exports (`MAP`, `mapStravaActivity`, `categorizeSkip`, the
  `SKIPPED_*` sets) were dropped.
- `hr-histogram.ts` — `zonesFromHistogram` re-buckets the retained
  `cardio_logs.hr_histogram` when the user changes HR bands
  (`lib/settings/hr-zones-actions.ts`). This is a live engine path over
  retained history, so `hr-zones-actions.ts` and `HrZonesSettings.tsx` were
  **kept**, contrary to the brief's tentative deletion. `histogramFromStream`
  was dropped — no stream will ever be fetched again.

`lib/stats/hr-zones.ts` was also **kept** despite being listed for deletion: it
is the shared HR-band math behind the Endurance-progress card, the HR-zones
settings page, cardio classification and cardio summaries — a different
surface from the deleted `HrZonesCard`. Its `strava_connections` gate and its
`{ kind: "no-strava" }` state were removed; users with no HR data now fall
through to `no-hr-data` instead of being told to connect an account.

**Deliberately retained — no destructive migration was written.** All Strava
DB columns stay: `cardio_logs.strava_activity_id`, `external_source`,
`hr_histogram`, `hr_zones`, `inferred_kind`, `inferred_confidence`, and
`sessions.strava_activity_id`. This is the owner's real training history, and
`inferred_kind` still feeds effective stress load for every historical cardio
row. The `strava_connections` and `strava_event_log` tables are now orphaned
but were **not** dropped; a drop migration (with its down-migration) is
proposed for separate owner approval. `strava_connections` holds dead OAuth
access/refresh tokens — a standing privacy consideration even though they can
no longer be exchanged for anything.

One judgement call worth flagging: `EditCardioForm`'s `strava-readonly` mode
was removed rather than retained. It forced externally-imported cardio rows to
be read-only with a "edit in Strava and re-sync" instruction — a dead end now
that the upstream can never exist. Those historical rows are now normally
editable.

Test suite: 382 files / 4305 tests → 365 files / 4152 tests
(−151 from 18 deleted test files, −5 net from in-place edits, +3 from a new
`lib/cardio/__tests__/modality-region.test.ts`).

## [2026-08-17] decision | Drop the orphaned Strava tables and re-freeze imported cardio
Two follow-ups to the integration removal, both owner-approved.

Migration 0130 drops `strava_connections` and `strava_event_log`. Neither has had a reader or writer since the integration was deleted. The first held per-user OAuth access and refresh tokens — dead credentials that can no longer be exchanged for anything but were still live-format third-party secrets sitting in the database with no owner and no expiry-driven cleanup; the second held raw webhook bodies containing athlete identifiers. The rollback is documented inline in the migration rather than as a sibling down-file, because the drift guard requires every SQL file under drizzle to carry a journal entry and only forward migrations are journalled. It restores structure, not rows, so a dump should be taken first. Training history is untouched: every retained cardio and session column stays, and inferred kind still feeds effective stress load. The orphaned schema definition, its re-export and the export route's excluded-secrets declaration are removed now that the tables are gone.

Externally-imported cardio rows are read-only again. The removal had made them editable on the grounds that the "edit upstream and re-sync" instruction was a dead end, which was true of the instruction but not of the reason: an imported row is a faithful copy of what a device measured, so hand-editing a recorded heart-rate average silently corrupts the record. The freeze is now keyed on import provenance rather than on any particular provider, and the copy states that the row is kept as recorded without naming an upstream that no longer exists.

## [2026-08-18] decision | A configured warm-up ladder wins over a program's published ramp
`profiles.warmup_scheme` governed only natively assembled blocks. Every program engine hardcoded a ramp and never read the setting, so "Skip warmups" still produced three sets in 5/3/1, Tactical Barbell, Zulu/HT, HYROX and Green — contradicting the column's own schema comment, which promises `setCount = 0` "disables auto-warmups entirely".

Only 5/3/1 publishes a warm-up as part of its method; `program-core` states outright that the other four have none, and they were hardcoding the app's OWN default ramp — the very ladder the setting exists to configure. So ignoring the lifter there had no methodology justification at all, only 5/3/1 did.

Owner decision: programs supply a DEFAULT, not a mandate. The stored value is now read as a tri-state — NULL ("never chose") keeps each program's own ramp, any stored ladder wins everywhere including inside 5/3/1 and including `setCount: 0`. The absent/present distinction is load-bearing: migration 0039 added the column with no backfill and the settings editor is its only writer, so NULL provably means "never touched" rather than "picked the default". Without it, honouring explicit choices would strip 5/3/1's ramp from every lifter who never opened the screen. `resolveWarmupPreference` reads the raw column; `resolveWarmupScheme` collapses NULL and is now documented as unusable where that difference decides whether a program ramp applies — both swap loaders were resolving too early and had to move onto the preference.

Seam is a new optional `PlatformContext.warmupRamp`, matching the existing optional-context pattern, carrying a canonical `WarmupRamp` that `program-core` now owns; `@hta/wendler` keeps `WarmupConfig`/`WarmupAnchor` as aliases so no public API breaks. An empty ramp emits no items — how "skip" reaches an engine.

Closes a second, pre-existing defect: TB/Zulu-HT/HYROX/Green were absent from `PROGRAM_WARMUP_SCHEMES`, so an unstarted session generated with the hardcoded ramp was rebuilt by a swap using the user's ladder, leaving one movement on a rung count its neighbours did not share. They are registered with the shared ramp their engines already default to, derived from `GLOBAL_WARMUP_RAMP` rather than restated.

DC-K4 is satisfied without a migration: the editor names the program whose warm-up a choice replaces (derived — a program qualifies only when its registered default differs from the shared ramp), a "Follow the program" preset writes SQL NULL so the choice is reversible, and the override is audited via the existing `custom` event type on the deliberately-loose `engine_override_events.context` JSONB. Behaviour changes only for newly generated sessions; existing prescription snapshots are never rewritten, per 0039's forward-only note and ADR 0016.

Also corrected the settings preview, which showed a 40/60/80 ladder as "34% TM" and read like the setting had been ignored. It now names both number spaces ("40% of top set = 34% TM").

See ADR 0072.

## [2026-08-18] decision | Rebuild the training profile page; relocate accessory volume; drop body-comp phase
A UI-simplification pass on `/app/settings/profile` turned into a correctness pass, because tracing what each control actually influenced found that two of the four were describing behaviour the engine does not have.

**Body composition phase had no consumer at all.** `body_comp_phase`, `phase_started_at` and `phase_target_weeks` were written by settings and read only by the admin block-review export as reporting metadata; `lean_out` appears in no planner file. The control told users that during a cut the app "pulls back top-end intensity slightly and protects strength via heavy, low-volume work" — that behaviour was never built. The UI is removed and migration 0131 drops all three columns and the `body_comp_phase` enum, with the rollback documented inline. The stored values are discarded deliberately: nothing consumed them, so every row holds whatever the user last picked in a control that did nothing, and no derived state or history keys off them. DC-Q2 and DC-T3 move to ⏸ [BACKLOG] — they stay forward contracts, but restoring phase-aware prescription must re-add its own input rather than inherit values collected while nothing read them.

**Accessory volume was mislabelled and misplaced.** `profiles.effort_preference` was presented as a global "how much optional accessory work your strength days carry — applies to every program you run". It has two code paths and only one is reachable: ADR 0016's hypertrophy effort anchor is guarded on `hypertrophy_anchor`, and the Hybrid program hardwires `concurrent_hybrid` while deliberately not surfacing the other six archetypes, so that path is dead in production. Its one live effect is shifting 5/3/1 assistance volume one notch along light → standard → high (ADR 0047). It therefore moved into 5/3/1's own Loadout step in the wizard. `WendlerInstance.assistanceVolume` and its setup parsing already existed; only the setup schema and UI were missing. Deploy resolves wizard value → legacy profile column → `standard` through a pure `resolveAssistanceVolume`, so in-flight blocks and clients cached before the field stay byte-identical and no data migration was needed.

**Training experience stays global**, and this was the judgement call worth recording. The obvious symmetry would have moved it into the wizard too, but it gates the accessory catalog band filter for every archetype, the assistance unlock floor for 5/3/1, Tactical Barbell accessories and clusters, tier detection, main-lift TM band selection, event recovery and onboarding. HYROX already opts out of the gate because it collects its own per-block experience, so "global default with a per-program override where warranted" was the established pattern; relocating the global would have silently ungated 5/3/1 and TB, handing beginners Olympic and plyometric variants.

**A latent bug surfaced during the trace.** `applyRecoveryPlan` mapped experience to a tier using the pre-migration-0052 names (`untrained | novice | intermediate | advanced | elite`). Every lookup missed and fell through to the tier-2 default, so `computeRecoveryWindow`'s TIER_MULT (1.5 for untrained down to 0.75 for elite) never applied — a first-time marathoner and a ten-year athlete received identical recovery windows. It now composes the shared `resolveDeclaredExperience` + `declaredExperienceToTier` helpers, with regression pins asserting the legacy names resolve to null rather than silently landing on a tier.

The page itself went from four collapsible groups nested three border levels deep to two always-open cards grouped by effect (Calibration: experience + strength standards; Measurement: units), each leading with its current value rather than burying it in a dim 11px chip. Display name is not repeated here — it is already click-to-edit on the profile identity header. Four candidate layouts were built behind a dev-only route and compared at desktop and mobile widths before one was chosen; that route is deleted now the layout has shipped.

Still open: ADR 0024 built a real cross-archetype accessory-volume lever on `training_blocks.accessory_volume`, complete with a duration-governed candidate ladder and a recommendation module, but no UI has ever written to it — `setupHybrid` does not pass it — so every block runs at the `medium` default. Either wire it into the Hybrid wizard or retire it; leaving a fully-built, fully-tested lever that nothing can reach is how the accessory-volume mislabelling happened in the first place.

## [2026-08-18] decision | Wire ADR 0024 accessory volume into the Hybrid wizard
Closes the item left open by the training-profile pass earlier today.

ADR 0024 built a complete per-block accessory-volume lever — Low trims the lowest-value aesthetic movement while leaving the durability and functional floors intact, Medium is the byte-identical identity, High adds items and sets and is then walked back down by the ADR 0020 duration governor until the session fits its time budget — plus a recommendation module and three dedicated test files. No UI ever wrote to it. `setupHybrid` never passed `accessoryVolume`, so `training_blocks.accessory_volume` sat on its `medium` default for every block ever created.

It is now a select in Hybrid's Loadout step. `HybridInstance` is structurally `BuildBlockAssemblyContextInput`, which already carried the optional field, so the wiring was the setup-schema entry plus a conditional pass-through in `setupHybrid` — conditional because an absent wizard value must leave the key unset (legacy instances and Season deploys predating the field then fall through to the engine's own `medium` default rather than being pinned by an explicit write). The deploy path now also writes the resolved level onto the block row, so the column stops disagreeing with the instance for anything that reads blocks rather than instances.

Scope note worth recording, because the obvious generalisation is wrong: this lever is Hybrid-only and should stay that way. It lives in the archetype engine under `lib/planner/`; 5/3/1, Tactical Barbell, Green and HYROX run through the `lib/platform/` adapters and never touch it. Each program already has its own accessory model — 5/3/1 shifts an assistance level along light → standard → high, TB and Green resolve a fixed per-template cap, HYROX has no accessory injector at all — and "accessory volume" genuinely means something different in each. TB is the tempting case, since its cap is just a number, but the wizard copy tells users that Tactical Barbell deliberately does not add accessories; a volume dial there would fight the program's own identity. Collapsing these into one global control is exactly the mistake that produced the mislabelled `effort_preference` dial removed earlier today.

A ProgramPicker render test now pins that the Loadout step actually surfaces every Hybrid setup field. That guard is the point: the failure being fixed was not a broken lever but a correct one that no screen offered, which no engine-level test could catch.

## [2026-08-18] decision | Enforce app-before-database deploy order in CI
Migration 0131 (dropping the body-composition columns) is the first destructive migration where getting the order wrong takes production down rather than merely leaving it inconsistent: the previous build SELECTs those columns by name, so dropping them out from under it 500s the training-profile page.

The repo's model is already app-first — Vercel deploys on merge, migrations are applied afterwards by dispatching a guarded workflow — but nothing enforced the second half. `prod-migrate` only declared `needs: ci`, which proves the code is green, not that Vercel finished shipping it. Dispatching while a deploy was still building, or after one had failed and rolled back, would have applied the drop against the old build. The only thing standing in the way was remembering to check.

`prod-migrate` now refuses to touch the database unless the Vercel integration has recorded a SUCCESSFUL `Production` deployment for the exact commit being migrated. That needs no new secret: `vercel[bot]` writes standard GitHub Deployment records, readable with the workflow token plus a `deployments: read` permission. The step runs first, before checkout costs anything, and distinguishes the failure modes in its summary — still building, failed, superseded by a newer deploy, or no record at all.

The escape hatch is an `allow_undeployed` dispatch input, defaulting false. It exists because a hard requirement on a Vercel record would otherwise lock out any future migration if the integration were removed, and because a purely additive migration legitimately does not need the app to ship first. Using it logs a warning into the job summary.

The guard was exercised against the live API before merging — a genuinely deployed commit passes, a branch commit carrying only a Preview deployment fails, an unknown SHA fails, and the bypass works — and every non-success deployment state (pending, failure, inactive, unrecognised) was driven through a stubbed API to confirm only `success` proceeds.

Worth stating explicitly, since it is now enforced rather than conventional: every migration on main must be backwards-compatible with the build already serving traffic, and destructive changes ship in two steps — the code removal first, then the migration once that release is live. The db README and the PR template now say so, and the PR-time migration warning tells the merger to wait for the deploy rather than just to dispatch.

## [2026-08-18] decision | One back link everywhere, and two duplicate surfaces collapsed
A consistency sweep of the back-link chrome found the shared `BackLink` / `PageHeader back` treatment already in use on 25 sub-pages, with the four tab roots (`/app`, `/app/plan`, `/app/stats`, `/app/settings`) correctly bare. Four surfaces were out of step and are now aligned: `/app/recovery/injuries` and `/app/sessions/[id]` gained the shared link, `/app/onboarding/bw-assessment` had a hand-rolled lowercase anchor replaced by `PageHeader`, and the program wizard gained an exit hatch it never had — its own "Back" button walks the step rail, so a user who entered from onboarding or the palette had no way out. The wizard keeps its bespoke sage header; only the link was injected, and `--cp-link` was added to the skin's alias block so the hover state resolves. The wizard's exit targets Today rather than Plan on a fresh run, because `/app/plan` redirects blockless users straight back into the wizard; editing implies an active block, so that path targets Plan. `/app/program` now also matches the Plan tab in both nav matchers, which previously left the wizard with no active tab.

Two of the gaps turned out not to be chrome problems at all but unresolved information architecture, and were escalated rather than papered over. Both were duplicate surfaces where the better implementation sat at the worse URL.

Events: `/app/races` carried the richer client (edit modal, result capture, taper timeline) while `/app/settings/events` — the URL the Settings hub, the avatar menu and the More tab all point at — carried a plain add/remove form. Owner decision: keep the rich implementation, keep the Settings URL. `/app/settings/events` now renders the former races page and `/app/races` is deleted outright, along with the superseded `lib/planner/events-actions`. The palette's static entry and its per-event deep-link anchor both repoint; the stale `revalidatePath("/app/races")` is dropped.

Training profile: `/app/profile` had no inbound link anywhere in the app, but was the only UI for three live settings — the display name, `ai_notes`, and the `am_window_start` / `pm_window_start` two-a-day windows the Today page reads to place morning versus evening sessions. Deleting it would have stranded all three. The display name is the sharpest case: the training-profile rebuild earlier the same day had just dropped its field on the stated grounds that the name was click-to-edit on the `/app/profile` identity header, which is true but unreachable — that page has no link into it from anywhere. All three move into `/app/settings/profile` first, as `SettingCard`s in the idiom that rebuild established: the windows and the name through `updateProfile`, which now also accepts both start times and derives the two-hour end span exactly as the retired action did, and the notes by reusing the existing editor component moved under `components/settings`. Everything else on the page duplicated `/app/settings/profile` or `/app/settings/bodyweight`, so the route and its five orphaned components go.

Also corrected: `e2e/injuries-page.spec.ts` asserted an `<h1>` matching "injuries" against a page whose heading has read "Limitations" for some time.
## [2026-08-18] decision | Split Rack Pull out of Block Pull Deadlift
Reported from use: swapping a Tactical Barbell strength slot to Rack Pull rewrote the lifter's Deadlift entry on the 1-rep-maxes screen to "Block Pull Deadlift".

The catalog never had a Rack Pull. `STATIC_ENGINE_MOVEMENTS` faked one by pointing the engine key `rack-pull` at the `block-pull-deadlift` row with a display-name override. That row is also a member of `STRENGTH_ROLE_CANDIDATES.deadlift`, so one catalog movement served two anchors at once: a 1RM entered under "Rack Pull" landed on a Deadlift-role candidate, and `buildBenchRoles` — which picks the first candidate in role order carrying a saved max — then re-anchored Deadlift onto it. The inverse was equally wrong and pinned by a test: `engineKeysForSlug("block-pull-deadlift")` returned `["rack-pull"]`, so a lifter who genuinely trains block pulls had that max read back by the engines as a rack pull. Pins and blocks are different implements with different ranges and different loads; sharing a row was never right, only cheap.

`rack-pull` is now its own catalog movement and the engine key points at it. `block-pull-deadlift` keeps no exact engine binding, so it falls back to the broad deadlift role — which is exactly what it is. Rack pull is deliberately NOT added to `STRENGTH_ROLE_CANDIDATES.deadlift`: it owns a dedicated engine key, and a movement cannot hold both a specific key and a broad-role candidacy without reintroducing the same double-anchor. That is the general rule worth remembering here, not the narrower "partial ROM is not a deadlift" — block pull is also partial, and stays a legitimate variant.

Migration 0132 carries the data. Owner decision was to move every existing reference — maxes, TM history and suggestions, logged sets, session movements, planned prescriptions, including logged history — onto Rack Pull, on the grounds that the shared row was in practice being used as one. It does that by renaming the existing row in place rather than repointing tables: the UUID is preserved, so every foreign key follows atomically and only the denormalised `movementSlug` / `movementName` copies inside prescription JSONB need rewriting. A fresh, empty Block Pull Deadlift row is then inserted. The one-time move is guarded on the absence of a global `rack-pull` row; the definitions and instructions below it are plain upserts, so a re-run is a no-op. The rollback re-merges by deleting the new row and renaming back, and says plainly that this cascades away any block-pull data recorded after 0132.

Deploy order note: the app ships first (enforced by `prod-migrate`), so between deploy and migration the `rack-pull` slug does not exist yet. Both `buildBenchRoles` and `buildPlatformContext` skip unresolvable catalog slugs, so the gap degrades to a missing Rack Pull row and a skipped Activation item rather than an error — the same shape as migration 0122, which added `landmine-squat-to-box` for code that already referenced it.

## [2026-08-19] refine | State a session link once, on the rows; collapse Activation phases by default

Reported from use, in order: the superset "is shown twice", then "remove the *Rest after X* text", then "make the Base phase not be automatically expanded".

The duplication was self-inflicted. The previous change put the link where the lifter reads the session — a `SUPERSET A1` badge and an accent rail on the program-slot row — but left `SessionLinkEditor`'s member list in place beneath the slot. Two statements of one fact, and they disagreed: the panel listed stored `members` (canonical engine slots) while the row badge counts `linkStations` (what the lifter picked), so a two-pick superset containing the AB Triad read as `A1..A4` below and `A1..A2` above. The rows won, on the same grounds as before. `SessionLinkEditor` is now only the CREATOR — the picker, the locked-movement note, and the main-lift warning (DC-K4) — and Unlink plus reorder moved onto the row with the label. "Rest after X" left with the panel and is deliberately not reinstated: rest following the last station is what a superset means, so the line restated the diagram.

`LinkBadge` and `rowLinkClass` moved out of `ProgramPicker` into their own module. The motive was testability, not tidiness: the wizard rows sit behind customise mode and an expanded phase, which a Node-env static render cannot reach, so the assembled JSX had never been exercised — only its inputs (`slotLinkBadges`) and its CSS names. It now has 16 tests. Extracting it also surfaced a real inconsistency: the custom-builder rows composed their link classes inline and omitted `linkedRowStart` / `linkedRowEnd`, so the rail never capped there. `rowLinkClass` now takes the base class as a parameter — Activation rows pass `activationMovementRow`, custom-builder rows pass `""` because they are styled by a descendant selector — and both get the same caps.

## [2026-08-19] decision | Two Tactical Barbell wizard state-loss bugs — dose overrides dropped on re-edit, stale session links leaking across template switches

Two confirmed defects, fixed together because both are the wizard silently discarding state the lifter already committed.

**Dose overrides on a custom row didn't survive re-entering the wizard.** Editing a deployed TB block hydrates `customSessionMovements` from the saved customization, but the hydration initializer only copied `movement` / `sourceMovement` / `role` / `kind` — never `doseOverride`. A lifter who had added, say, a 4×12 accessory row would see it reset to the row's default dose the moment they reopened the wizard, and saving any *other* change (swapping an unrelated movement, adjusting a different slot) would deploy that reset dose and permanently overwrite the one on file. The fix copies `doseOverride` through when present, and the hydration transform was pulled out of the component into a new exported pure function, `hydrateSessionMovements` (`session-slot-editing.ts`), used by both the wizard and the tests. One test drives the real `editContext.customization` render path and asserts the rendered row still reads "4 × 12" on re-entry; a second, separate test chains `hydrateSessionMovements` straight into the real `slotPayloadEntry` with the row completely untouched, proving a no-op edit/save keeps the override all the way to the deploy payload — not just through hydration alone.

**Switching template or program reset every per-template draft except `sessionLinks`.** `pruneLinksToMovements` already existed and was tested, but nothing called it at a template or program switch — every other draft field (customization, rehab selections, start schedule) was cleared, but superset/tri-set links kept pointing at the old template's slots. Three failure shapes followed: stale links vanish from the UI the moment their series key stops resolving (nothing tells the lifter they were dropped); switching to a *different* TB template that happens to reuse the same `slot-N` key can silently reattach a link to an unrelated pair of lifts, which then deploys; and switching away from TB entirely left the links present but hidden, where server validation (before this fix) only checked them when a customization blob existed — a canonical, uncustomized deploy sailed an orphaned link straight through.

Fixed in three parts, all required together:
- `pruneLinksAcrossSeries` (new, pure, in `session-link-editing.ts`) re-keys a whole `sessionLinks` map against a new template's real series membership: a series key the new template doesn't have is dropped entirely (never carried over on the *chance* it means something), and a key that survives is pruned member-by-member via the existing `pruneLinksToMovements`, so a link that partly survives (one lift swapped, one kept) keeps what's still valid instead of being dropped wholesale. `seriesMovementSetsForTemplate` projects that membership from the real template shape — weekly split/cluster templates via their `sessionSeries` (or the `slot-N` cluster fallback when a template has none), Activation separately via its phase sessions, since Activation's keys are never `slot-N` and forcing it through the same fallback would manufacture series the engine never uses. This membership only covers strength series; a `rehab.*` key is dropped by the same prune, which is safe rather than a regression — the very same switch already resets which rehab protocols are attached (`setSelectedProtocolIds([])` etc., pre-existing), and deploy always rebuilds `rehab.*` links fresh from the attached protocol's library entry rather than reading them back out of `sessionLinks` state (`pruneRehabLinks` + `rehabLinkEntries` in `ProgramPicker.tsx`), so a stale `rehab.*` key here would never have reached the deployed program either way. A new test proves this composition end to end: prune a switch's `rehab.*` key away, then show the attached protocol's link still reappears correctly in the deploy-time payload.
- `ProgramPicker` now calls this at both switch points: the reactive template-switch effect, and `selectProgram()` (the non-TB branch clears `sessionLinks` outright, since no series exists to validate against).
- Server-side, `createProgramInstance`'s orphan-strength-link check moved off its old `customization && isTbCustomizationV1` gate and now runs unconditionally for any TB `sessionLinks`, sourced from one canonical `strengthSeriesMembership()` helper (weekly via `tbTemplateSeries`, Activation via `activationCustomizationKey` / `activationPhaseForSession`, both overlaid with customization when present) — so a hidden, orphaned link fails closed on deploy regardless of whether a customization blob happens to be attached, closing the gap a customization-only gate left open for canonical templates and for Activation.

Tests: `seriesMovementSetsForTemplate` and the switch-time pruning are exercised against the real `ZULU_TB3` / `OPERATOR` / Activation-phase fixtures already in `ProgramPicker.test.tsx` (not synthetic membership objects), including the specific reused-`slot-2`-across-templates leak scenario, the "nothing changed, nothing pruned" case, and the rehab-links-survive-deploy composition above. `pruneLinksAcrossSeries` itself has 7 unit tests in `session-link-editing.test.ts`. Server validation has 5 new tests in `apps/web/src/lib/platform/__tests__/actions.test.ts` built from real `@hta/tacticalbarbell` template exports (canonical + customized weekly, canonical Activation) rather than hand-typed fixtures, and were confirmed (via a temporary revert) to fail without the fix. Not covered, and called out here rather than papered over: `ProgramPicker.test.tsx` is a static, single-mount Node render with no jsdom, so the live re-render that fires the template-switch effect itself cannot be driven end-to-end in that harness — coverage stops at the pure functions the effect calls, which is where the actual decision logic lives.

Two things reviewed and deliberately left as-is: `strengthSeriesMembership` and `seriesMovementSetsForTemplate` are two independent computations of the same membership (server vs. client, `TbTemplate` vs. `PickerTbTemplate`) — both now carry a comment cross-referencing the other so a future slot/series change gets checked against both, rather than merging them, which would reach outside this fix's scope. And `tbTemplateSeries` (server) / `sessionSeriesFor` (client, which `seriesMovementSetsForTemplate` builds on) both fall back to a template's static `defaultCluster` for a session with no per-session `fixedMovements` — Gladiator/Mass/Grey Man, and Zulu I/A too — rather than the lifter's actual resolved cluster. For a template like Zulu I/A, whose `clusterMin`/`clusterMax` differ, `clusterEditable` is genuinely true, so a lifter really can pick a cluster diverging from `defaultCluster`, and this fallback does not track that pick. It stays safe only because both sides share the exact same blind spot: client-side pruning and server-side validation are both blind to the live cluster in the same way, so a link naming a movement outside `defaultCluster` is pruned client-side at the same switch it would be rejected server-side — the two don't drift apart from each other, even though neither reflects the lifter's true cluster. This is a pre-existing property of both functions (already relied on by an existing slot-claim check elsewhere in `actions.ts`), not something this fix introduces or worsens; documented inline rather than reworked, since making either side track the actually-resolved cluster is a separate, larger change (threading the live cluster through both `strengthSeriesMembership` and `seriesMovementSetsForTemplate`) outside this fix's scope.

No migration; no change to engine loading semantics (#791 untouched).

Activation phases now start collapsed. `open={phaseIndex === firstOpenPhase}` expanded whichever phase contained the start week, which for a fresh program is Base; one open phase pushes the other three off-screen behind a wall of session rows, so the list stopped reading as a list. The start-week signal is not lost — that phase's summary now says "Starts here", alongside the existing "Before start / Past · locked" markers. Two `tb-customized-desktop` blocks had been reading Base content without opening it and now click its summary first, matching how they already handle Armor and Operator.

## [2026-08-19] decision | Bound Playwright setup in CI so an apt stall cannot eat the whole e2e job

The e2e job failed twice consecutively at exactly 20m16s with no test output. The cause was not a test: `playwright install --with-deps chromium` reached "Switching to root user to install dependencies..." and then emitted nothing until the job's own `timeout-minutes: 20` killed it. Zero specs ran, and the job reported as a plain red X — indistinguishable at a glance from a genuine regression, which is the expensive part. The same stall had already cost a re-run earlier in the day on a different PR, so it is intermittent rather than one bad runner.

Three changes, all about bounding the blast radius rather than chasing the apt mirror:

- Browsers are cached at `~/.cache/ms-playwright`, keyed on the lockfile hash, so the download is skipped outright on a hit.
- System dependencies move to their own step with `timeout-minutes: 5` and `continue-on-error: true`. `ubuntu-latest` already ships the shared libraries headless Chromium needs — `--with-deps` targets bare containers — so this is belt-and-braces. If it is skipped AND a library genuinely is missing, Playwright fails at browser launch with an explicit message, which is a much better signal than a silent stall.
- The browser install itself gets `timeout-minutes: 6`.

Worst case is now ~11 minutes of setup with the tests still getting their turn, instead of a 20-minute wall and nothing to read.

## [2026-08-19] refine | Rehab movements can be supersetted, with a station spanning both sides

Requested from use: "I'd like to superset/giant set also rehab movements."

Rehab links reuse the existing `sessionLinks` envelope under a new series key, `rehab.<protocolId>`. They are deliberately NOT a field on `rehabProtocolSchema`: that schema is `.strict()` inside a `.strict()` versioned union, so an older deployed build would reject the unknown key and — because the customization is `safeParse`d as one unit — drop the WHOLE customization. That hazard is why the link envelope exists separately in the first place. Keying by protocol also gives the right scope: a protocol is authored once and assigned to several days and phases, so its supersets travel with it rather than being re-declared per assignment. Legacy needs no special case; `activationRehabProtocols` already normalises the V1/V2 shapes to `protocol-1`, so both resolve through `rehab.protocol-1` and keep resolving after an upgrade to V3. The stored `rehabProtocolId` provenance stays null on those paths, so the link key is carried separately as `linkProtocolId` rather than derived from emitted metadata.

Three things had to differ from the strength path, each found by rubber-ducking the plan before writing it:

**A station can span several items.** A protocol addresses sides as separate rows sharing one `movementId`, and `movementIdentityKey` keys rehab cards as `rehab:<movementId>` with side excluded — so left and right are ONE logger card. Link members are therefore movements, and the wizard offers one entry per distinct movement. This also forces the round stamp: `participatingItemIndices` falls back to "the first `rounds` required slots of the group", which is right only when a station is one item per round. That holds for the engine's AB Triad and fails for rehab — unstamped, a 3-left/3-right Copenhagen station would have put only the LEFT sets in the rotation and orphaned every right-side set to solo work. An earlier reading of this codebase concluded stamping was optional because the AB Triad does without it; that reasoning does not generalise.

**Circuit ids had to be namespaced.** `applySessionLinks` uses the stored link id verbatim and ids are unique only within a series, so both editors mint `link-1`. Once rehab is prepended into the day's strength prescription the logger groups circuit candidates globally by id, so two unrelated `link-1`s would present four groups for a two-station circuit, fail `buildLinkedCircuitByMovementId`'s completeness check and silently drop BOTH — breaking the existing strength feature. Materialised ids are now `rehab:<protocolId>:<linkId>`; stored ids are untouched.

**Members are re-emitted contiguously**, as the strength path already does, because the preview only brackets consecutive rows.

Two integrity gaps closed while wiring it. `findOrphanedLinkMembers` reads an unknown series key as "no movements available", so rehab keys had to be added to the map or every rehab link would have been rejected as orphaned on deploy. And protocol ids are reused as ordinals while `removeRehabProtocol` pruned assignments but not links — delete `protocol-2`, create another, and it silently inherited the old superset. Links are now pruned on protocol deletion, on movement removal, and when a row is re-pointed at a different movement; Activation deploys additionally reject a link naming a protocol that no longer exists.

## [2026-08-19] decision | Rest countdown becomes opt-out, read by its own query to survive the deploy window

Requested from use: a settings toggle to turn the inter-set rest timer off.

The behaviour is deliberately narrow: OFF suppresses the COUNTDOWN, not the rest. Nothing downstream keys off the timer — saving a set drives auto-advance and completion, and `suppressRestForItemIndex` already produces a no-timer state mid-superset — so the off state is well-trodden rather than novel. `restSecondsForSet(kind, { restTimerEnabled })` wraps the existing `restSecondsForKind` and returns 0 when disabled, which every caller already handles (`RestTimer` documents `seconds=0` as "render nothing"). All three loggers go through the wrapper so the question "should a countdown start?" has one answer in one place.

`restSecondsForKind` stays preference-free, and the session-duration estimate keeps calling it. That is a decision, not an oversight: the lifter still rests when the countdown is off, so an estimate that dropped rest would model a session nobody performs — the same reason ADR 0071 forbids the superset presentation from feeding the duration governor.

**The deploy window was the real design constraint.** This repo is app-first, database-second (the deploy-order guard in `ci.yml` refuses to migrate until Vercel has shipped the commit), so there is a period where the new build runs against a schema without `rest_timer_enabled`. PostgREST fails the WHOLE request on an unknown column, so naming it in the session page's existing profile SELECT would have taken equipment, plate inventory, units and date formats down with it — silently resetting all of them to defaults for every user until the migration was dispatched. A per-column `?? true` cannot rescue that; there is no row to read a column from. The preference is therefore read by its own small query that treats any error as "not migrated yet, default on", and the existing selects are untouched. Once 0133 is applied everywhere the helper can be folded in and the extra round-trip dropped.

Two smaller traps, both worth recording. A persisted rest deadline outlives the preference, so the resume-after-reload path is gated too and no deadline is written while the timer is off — otherwise turning it off, reloading, and getting a countdown back would look like the setting had failed. And starting a rest is now a full state transition (`setRestSeconds(secs)` unconditionally, deadline cleared when 0) rather than a conditional start, so a countdown from an earlier set cannot survive the toggle.

Also learned: a `"use server"` module may export ONLY async functions. The read helper's default constant broke the entire module for every importer, and typecheck did not catch it — only `pnpm build` did. Read and write are now separate modules, which is the right split anyway since the read is server-only and never needed to be an action.

## [2026-08-19] fix | The Plan drawer's last logging affordance follows the others behind `allowLogging`

Reported from use: a cardio session drawer had no Mark done but still offered "Link a logged activity" — read as Strava residue left behind by migration 0130.

Neither half of that reading was right, and both are worth recording because the surface invites the same mistake twice.

**"Link a logged activity" is not Strava.** Strava has no references left anywhere in `apps/web/src`. `getLinkableActivities` queries the user's OWN completed `sessions` joined to `cardio_logs`; the control attaches one to a planned slot through the same classify-and-attribute path the old auto-linker used, so HYROX load attribution survives. What retired with Strava was the AUTOMATIC linker, which only ever fired for `cardio_source='external'` blocks at sync time. The manual control is what remains useful without it — a cardio session logged before the day was swapped, or on an internal-cardio plan, otherwise has no route back to its slot. Deleting it would have removed a working feature. Both file headers still described the retired sync behaviour, which is what made it read as dead code; they now say plainly that the candidates are the user's own sessions.

**Mark done's absence was deliberate**, recorded on 2026-08-18: Plan became the macro review/edit surface, and Mark done plus overdue Log now moved to Today, where they remain. A test already asserts "the logging actions must still be absent" for `allowLogging={false}`.

The real defect was the inconsistency between those two facts. `LinkActivityControl` was rendered on `session.isCardio && !done && !skipped` alone, outside the `allowLogging` gate its siblings sit behind — so a review-only drawer still offered a way to complete a cardio slot while the sanctioned ways were correctly hidden. Owner decision: keep Plan review-only. The gate now wraps the whole `drawer-cta-extras` region rather than each child, which also stops an empty flex wrapper and its 12px margin being left behind.

## [2026-08-19] decision | Rehab protocols become a user-owned library bound to programs by reference

Rehab protocol authoring moves out of the program wizard into Settings. A protocol is now a first-class row (`rehab_protocols`) attached to a program through `program_rehab_bindings`, so it outlives the program it was written for and an edit reaches the live plan automatically. See ADR 0073 and migration 0134.

The binding table exists instead of a `libraryId` field in `setup_input.customization` because that blob is strict-validated and this repo deploys app-first, database-second: the previous build would reject a stamped blob, and `edit-context.ts` safeParses it, so the wizard would silently open without the user's rehab. A real FK also makes "cannot delete a protocol a program uses" a database guarantee, and legacy V1/V2 blobs have no named-protocol array to stamp at all.

Local protocol ids are preserved for existing attachments and are the library uuid for new ones. The old ordinal ids were reused by position, so a swap could hand one protocol's supersets — and its `removedEmbeddedRehabSourceRefs` tombstones — to an unrelated protocol.
## [2026-08-23] decision | Zulu's supplemental lifts become visible in the wizard, and editable without losing their prescription

Reported from use: the Zulu loadout step looked as though Tactical Barbell prescribed four main lifts and nothing else, so the "Add accessory work" toggle read as the only route to any extra work.

The engine was right and the wizard was wrong. TB3 Zulu has emitted supplemental lifts since it was rebuilt — overhead press plus the AB Triad on A days, barbell row and back extension on B days, 3-5x8-10 on the 65/70/75 wave — and tests pin them. What was missing was any way to see that: the card copy still described the earlier edition's user-chosen 4-lift cluster, and step 2 showed only frequency, length and loading basis.

Underneath sat a real defect. A customized session's lifts were identified by movement key alone, and prescription rules match on that key, so swapping the exercise in a supplemental slot silently promoted it to main work at the session's main percentage. The same root cause let a week-6 peak slot be filled by an unrelated supplemental once its own lift was removed, and made a reassignment between two slots compare equal to the untouched template and be discarded.

A slot is now a first-class identity that survives substitution - the mechanism Activation's Armor picker already used, wired into the weekly path. Supplemental slots gained Change and Remove alongside main ones, removal is stated back rather than blocked (DC-K4), and slot claims are validated structurally and against the selected template at deploy. Step 2 lists each day's main and supplemental lifts from the template itself, so the prose cannot drift again. See ADR 0074.

Deliberately left alone: the accessory injector can still stack ab isolation onto the AB Triad, which is a muscle-overlap question rather than a slot one; and Zulu I/A, Gladiator, Mass and Grey Man remain on the earlier edition, their copy accurate for what they currently are.

## [2026-08-23] decision | Tactical Barbell accessories move from an invisible checkbox to the session editor

Owner feedback on the ADR 0048 accessory toggle: "the whole checkbox is confusing as the user doesnt really know what it does."

Fair reading of what it did. You ticked a box, chose some muscles, and nothing appeared - the movements were picked for you later, out of sight, first visible once the plan existed. Its copy also asserted that Tactical Barbell adds no accessories, which was never true of Zulu.

Meanwhile the wizard already had a place where a user picks the movements in a session, three steps away behind "Customize template", and its "+ Add exercise" was broken for the purpose: an added movement carried no slot, matched no prescription rule, and was emitted as main work at the session's sets and reps. A bicep curl was prescribed 3-5x5. Two surfaces for shaping a session, one invisible and automatic, one hidden and mis-prescribing.

Now there is one. The loadout step's per-day preview became the editor: every row is Main, Supplemental or Accessory, with Change, Remove and Add accessory. Added movements carry an explicit accessory role - stated, never inferred from a missing slot, because pre-slot customizations have no slot on any entry and inferring would turn their main lifts into curls - and are prescribed at the dose ADR 0048 derived from the book. The picker offers only movements that suit that dose. Templates that previously refused accessories now object in the place the work is added, and only once it has been added.

Kept deliberately: the auto-picking injector and its deploy parameter, unchanged, for Green Protocol (periodised across several templates, no per-session editor to move into) and for blocks already deployed with it - their accessory selection rotates per session, so there is no faithful conversion into one repeating row, and deleting the injector would strip work from a live plan on its next edit. Editing movements no longer renames a block: displayName became optional on the customization overlay.

See ADR 0075. ADR 0048 is superseded for Tactical Barbell and still governs Green Protocol.

## [2026-08-23] decision | Green Protocol drops the accessory checkbox too

Follow-up to the same-day Tactical Barbell decision, on owner instruction: "remove the box for green protocol too, it's a tb program."

Correct on the substance - Green Protocol is Tactical Barbell periodised across phases, running Operator, Fighter and Zulu-HT at different points. Keeping an auto-picking checkbox on one and not the other would have left the confusing control alive in the app for no reason other than implementation convenience.

The consequence is honest and worth stating: Green has no per-session editor to move the choice into, because its sessions are not a fixed weekly series - each phase resolves a different template per session ref. So a new Green block now carries no accessory work at all, which is what the book prescribes by default anyway. Giving Green the same per-session editor is open work.

Blocks already deployed with auto-picked accessories keep them, Green included: the injector and its deploy parameter are untouched and still run on re-deploy, with a single control in the wizard to keep or clear. The muscle-emphasis multiselect is gone entirely; a legacy block re-deploys against the standard set.

ADR 0075 updated - it now supersedes ADR 0048 outright rather than for Tactical Barbell only.

## [2026-08-23] fix | Three regressions caught in review before the session-editor change merged

Pre-merge review of the Tactical Barbell session-editor branch found three defects, all in the seam between a stored customization and the new slot model. Recorded because two of them would have silently corrupted an existing user's plan rather than failing loudly.

**A pre-slot customization's own lifts would have been demoted to accessory work.** The deploy builder derived "this is accessory work" from `slotOf(...) === undefined`. Customizations written before slots existed carry no slot on any entry, and a lift swapped under the old flow has a `catalog:<uuid>` movement key that matches no slot - so on the next edit it was rewritten with `role: "accessory"`, and the engine then forced it to 3x8-15 with no percentage and no warm-up. A loaded main lift became an unloaded 3x12. The role is now carried from the payload and never derived. The engine's own test already asserted the correct contract - a slotless entry is main work - so the wizard was the party that was wrong.

**The first edit on an untouched session deleted every lift in it.** `removeSeriesMovement` and `replaceSeriesMovement` started from `current[seriesKey] ?? []`, and the fallback to the template only fires when the key is absent - `[]` is not nullish. Two reachable paths leave the map empty on mount (editing a block with no stored customization, and the `?program=tactical-barbell` deep link on the default template), and `canDeploy` then blocked deploy with no message. Both mutators now seed from the template.

**A new block's own accessories were misread as the old automatic ones.** `accessoriesEnabled` was inferred as "any stored item of kind accessory", but a user-added movement materialises as exactly that kind. So a hand-built Zulu block came back on edit looking like an auto-picking one and re-enabled the retired injector, adding work the user never asked for. The user's own picks are now excluded by movement id. `setup_input` never persisted the `accessories` parameter, so exclusion is the only signal available for blocks deployed before this.

The riskiest logic was extracted into `session-slot-editing.ts` as pure functions with their own tests, mirroring how `session-link-editing.ts` was split out: it had been unreachable from the test suite because it lived inside the component and the project's test environment has no DOM, which is why static-markup tests missed all three.

## [2026-08-24] decision | A recovery week's content belongs to the program, not to one shared recipe

Owner, reading the Tactical Barbell 3 deload spec, asked whether the app's recovery week was general rather than TB-specific. It was, and the code said so outright: ADR 0049 chose "5/3/1's loading principle" for every program, and `buildDeloadWeek(sources)` took only the sessions - it could not have known which program the block ran.

The two methodologies make opposite trades. 5/3/1 Forever's deload cuts the WEIGHT hard and keeps the reps (40/50/60% of TM x 5). TB3 keeps the weight moderate and cuts the VOLUME ("Approx 3 sets x 3-5 65-70%RM per session"). Handing a TB lifter Wendler's numbers is not a rounding difference, and it sits badly with the rule that engines are faithful encodings of their own source.

Checking the builder surfaced three more defects, all from mirroring the next week and easing only the main-lift percentage. Warm-ups passed through untouched, so a block whose next week is peak week produced warm-ups heavier than the entire recovery session. Easy cardio was never shortened, so a 90-minute long run survived a week meant to reduce volume. Bodyweight and fixed-load mains got no reduction at all, just a cue. And a fourth from the loading basis: TB states percentages against the true 1RM, but the logger multiplies by the block's stored tm_percent, so an unscaled 65 on a 90% training max landed at 58% of the lifter's real max - under the book's range.

Each program now states a RecoveryWeekPolicy and the platform places it: engines never see a stored prescription and never materialise a row, so the boundary holds. TB gets 3 sets x 3-5 at 65% of the true max, 5/3/1 keeps its ramp off the training max, Green rests to match the deload weeks already in its own phase grid, HYROX keeps easy aerobic work. A natively assembled block gets an explicitly generic policy rather than any book's numbers relabelled as a default. The percentage is the lifter's to set, with the program's range stated and a warning - never a refusal - outside it.

Left open deliberately: the "deload after Peak Week" prompt TB3 names as its rule of thumb. A plain TB block ends in a peak week, so it is the most predictable deload point in the program, but surfacing it needs a suggestion to survive the block being marked complete and needs recommendation identity to stop being one-per-block - a user-data migration, and therefore its own decision. TB3's calisthenics-circuit alternative is also deferred; it is a structurally different week rather than a lightened version of your own.

See ADR 0076. ADR 0049's placement, insertion and off-program model are unchanged.


## [2026-08-25] decision | The program says when a recovery week is due, and where it goes

ADR 0076 moved the recovery week's content into the program. This closes the other half: when one is due, and where it lands.

Both were platform guesses. "When" was a 24-week counter standing in for TB1's dephasing guidance, which knows nothing of TB3's actual rule - "a good rule of thumb is to deload after Peak Week". Operator, Fighter and Zulu end a block with three maximal singles; the counter fired on arithmetic instead, so a lifter finishing a 6-week Operator block was advised nothing until week 24.

"Where" was the more dangerous of the two, because it looked right. `getDeloadWeekPreview` derived the insertion point from `Date.now()`. For the user-initiated control that is correct - "I am tired now" means "after this week". For program-advised placement it means a lifter who logs their last peak session on Sunday and taps the prompt on Thursday gets the light week wherever Thursday happens to fall, potentially inside the next block. A correct prompt with a wrong placement is worse than no prompt, because nothing tells the lifter to doubt it.

A program now declares its own `recoveryBoundaries` - a key, the session refs that must be settled, and the copy. TB derives them from each template's own peak-week test sessions, so Gladiator, Mass and Grey Man declare none and correctly raise no post-peak deload; the 24-week counter survives only as their fallback, which is the guidance that actually applies to them. Activation keeps its own week-15 deload.

Placement resolves the boundary's refs against live `planned_sessions` rows rather than computing `block x blockWeeks + finalWeek`, because an earlier inserted recovery week has already shifted everything after it. When those sessions are no longer in the plan the preview returns nothing at all: a boundary we cannot see is one we must not guess at. The client only ever sends a boundary key, never a week number.

Two pre-existing defects had to go first. Recommendations were unique on (user_id, block_id, kind) while every engine block of an instance shares ONE training_blocks row - so block 2's "retest your maxes" was swallowed by block 1's, and a per-block deload prompt would have multiplied the same bug. Migration 0135 adds `occurrence_key`; NULL still means "once per plan". And `insert_deload_week` had no lock and no duplicate check, so a double-tap inserted two weeks; migration 0136 locks the block and returns the existing week index instead.

The prompt now clears when the week lands rather than when the link is clicked, so a failed insert leaves the advice standing. When the peak week is the last week of a plan there is nothing to insert before it, so the wizard offers to lead the next block with the recovery week - closer to TB3's "between blocks" than stretching a finished block.

Still unsupported: TB3's "and Work Capacity blocks". This app has no work capacity block as a domain concept, and inventing one to satisfy a sentence would be worse than omitting it.

See ADR 0077.

Review before merge found five defects, two of which would have shipped as silence rather than as errors. The unique index used `COALESCE(occurrence_key,'')`, which makes it an EXPRESSION index - and Postgres cannot infer one of those from the plain column list PostgREST sends for `on_conflict`. Every recommendation insert would have failed with 42P10, and since the write result was never checked, the symptom would have been no retest nudge, no deload prompt, no error and a green test suite. The column is now NOT NULL DEFAULT '' with a plain index, and the upsert checks its error. The second: the idempotency guard tested `role = 'deload'`, which is how every program tags its OWN programmed deload week - so a lifter standing the week before their scheduled deload would have pressed "take a recovery week", been told it worked, and got nothing. Inserted weeks now carry their own provenance marker.

The third was the anchoring hazard in a costume. Session refs are instance-independent, so a fresh deploy of the same template contains byte-identical refs: advice raised by a FINISHED block resolved perfectly well against the block that replaced it, and would have scheduled the light week six weeks out. Resolution is now scoped to the recommendation that raised it, and pending advice is retired when its block is archived.

See ADR 0077.

## [2026-08-24] fix | Weighted dip joins the library, and a removed lift can be put back

Two owner reports from the same session, with different causes.

The library had `weighted-pull-up` as its own movement but no weighted dip - only a Parallel Bar Dip, which is loadable but does not answer a search for "weighted dip". The catalog was inconsistent with itself: the app's own convention is that a weighted variant earns its own row when it is trained as a strength lift, so its history and loaded max stay separate from the bodyweight version. Owner confirmed they want it tracked separately. Added as `weighted-dip`, mirroring the pull-up entry.

The equipment tag is the trap. `requirementFromEquipmentTag` matches by SUBSTRING, and the only string that routes to a dip belt is `dip-belt`; anything else returns null and the slug heuristic takes over, which for this slug has no branch at all and lands on the permissive default. A plausible-looking tag like `dip-bars-belt` would therefore have offered the weighted dip to every lifter, belt or no belt. Review caught that my first write-up of this named the wrong failure - it claimed a pull-up bar, which is what happens to `dip-parallel` and `dip-ring`, not to this slug. The tag is therefore the belt rather than the bars - the belt is the scarce item anyway - and a test pins both the working tag and the failure mode. Noted but not fixed: `weighted-pull-up`'s own `bar-belt` tag has the same gap, so the app does not currently know a weighted pull-up needs a belt either.

The rollback is guarded rather than a plain DELETE. A global movement can be picked the moment it exists, so by the time anyone rolls back it may be referenced by set_logs, training_maxes, a stored prescription or a saved customization. It is removed only while nothing refers to it: a catalog entry nobody can find again is a smaller problem than logged history losing its exercise.

Separately, removing a lift from a TB session was one-way - the dropped lift rendered as dead text with no control to undo it. That is the defect under the report that Zulu's supplemental count is "locked to two": you could go down to one, but never back. `restoreSlot` puts the TEMPLATE SLOT back, carrying its canonical sourceMovement and kind, because the slot is what the engine matches its prescription rules against; rebuilding the row as a bare movement would return a supplemental lift as main work at the main-lift scheme.

Review caught that the first version of that change made a fully removed AB Triad both invisible and unrestorable, because the only thing rendering "Restore AB Triad" was a swap check that returns false when the row is absent. Worse than the behaviour it replaced, which at least still named the lift. The triad is now restored whole from either state - `abRule` prescribes it as one unit, so a half-restored triad would state three rounds against a single lift.

Owner decisions taken this session, to be implemented next: the AB Triad becomes a properly selectable engine-owned circuit rather than a search alias; and a Zulu day may carry more than two supplemental lifts WITHOUT a warning, on the grounds that TB3 leaves supplemental volume to the lifter - so choosing three is not an override of a principle-derived default and DC-K4 does not apply.

## [2026-08-25] fix | A weighted pull-up's max counts bodyweight, so a percentage of it is a total

A weighted pull-up is maxed the way weighted calisthenics has always maxed it: bodyweight plus whatever hangs off the belt. An 85 kg lifter doing a pull-up with +25 kg has a 110 kg max. The lift kind that says so - `weighted-bw`, "anchored on a kg 1RM that INCLUDES bodyweight" - had been declared and documented in the Tactical Barbell templates since the templates were written, and nothing ever implemented it. The prescriber had branches for unanchored work and for pure bodyweight work anchored on max reps, and everything else fell through to the barbell path. So 70% of 110 kg became 77 kg hanging off a dip belt, and the shared warm-up ladder then asked for 31 / 46 / 61 kg on the way there.

The correct answer at 70% is 77 kg of total system load, which for an 85 kg lifter is a plain bodyweight pull-up. That is not an edge case: anyone whose max is under roughly 1.4x bodyweight spends the lighter weeks of a wave adding nothing at all.

The fix has two halves because the load is computed twice. The engine now has a `weighted-bw` branch that takes bodyweight off the total, floors the result at a bodyweight set, and ramps its warm-ups on the system load before converting each step - collapsing the repeated sub-bodyweight steps, so a ramp reads "bodyweight x5, then +2.5 kg x3" instead of three identical sets. That half only reaches warm-ups, though, because the adapter keeps `percentTm` and discards the engine's weight for working sets: the app re-derives kg from the saved max in three separate places (the plan materialiser, the live logger, the prescribed snapshot), each with its own copy of `tm x percent`. Fixing the engine alone would have changed nothing a user sees. Those three now share one resolver in `@hta/domain`, which takes an optional bodyweight offset.

Which movements need the offset is read from the catalog's `body_weight_loaded`, not only from a flag on the stored item. That is deliberate: it means a program deployed before this change stops prescribing 77 kg without the lifter rebuilding it. Newly generated items also carry `systemLoad` so the adapter knows a 0 kg warm-up is a prescription ("bodyweight") rather than an unresolved load - previously it was dropped, and the logger then prefilled the last belt load the lifter had used, which is the opposite of a warm-up.

Two supporting corrections. The 1RM field for a belt-loaded movement now says what it collects ("bodyweight + added"), and its estimator asks for added weight and adds bodyweight before the formula - the number was previously ambiguous, and the app never said which one it wanted. And TM-anchored PR detection is suppressed for these movements: it compares the weight on the belt against a bodyweight-inclusive max, so it could never fire and displayed an estimated 1RM that meant nothing.

No migration. `systemLoad` is additive inside the prescription JSONB. Existing maxes are not reinterpreted: a value entered as added-weight-only now resolves to a bodyweight set, which is too light rather than too heavy.

Deferred: assisted (band / machine) pull-ups for a lifter whose percentage lands well under bodyweight, and rebuilding historical pull-up e1RMs against the bodyweight recorded at the time of each set.

---

## [2026-08-24] fix | One Copenhagen, and lunges the catalogue never had

Two library entries described the same exercise. `copenhagen-plank` was seeded by the leg-isolation helper and `copenhagen-side-plank` by the tendon helper - same setup, same cues, same region, same equipment, and because `derive-roles.ts` keys off `metadata.protocol` and a `/copenhagen/` slug match, the same derived roles on both. Nothing distinguished them but which array they were declared in.

The isolation row survives. `tb-accessories.ts` hard-filters `pattern = 'isolation'`, so the tendon copy could never be drawn as accessory work, and nothing anywhere selects candidates by `pattern = 'tendon'` - the prescription item kind of that name is a separate concept. The tendon copy added a library entry and no capability.

Merging exposed a dosing bug in the row we kept. `copenhagen-plank` was listed literally in `TENDON_KEYWORDS`, and the tendon test fires before the isometric one, so a Copenhagen was prescribed as ADR 0041 rep-based HSR - eight reps with a three-second eccentric - when it is a hold. Removing the keyword lets it fall through to the isometric bucket and be prescribed for time. It was only survivable before because the duplicate, which did land in the isometric bucket, masked it.

Migration 0138 moves history rather than dropping it (owner-confirmed). That is not ceremony: `set_logs` and `session_movements` reference `movements(id)` ON DELETE RESTRICT while `training_maxes` and `tm_suggestions` CASCADE, so a bare DELETE would either fail outright or quietly destroy a training max depending on what the lifter had logged. Where a unique key collides - a second training max, a pending suggestion, a session already holding both - the survivor's row wins.

Separately: the catalogue had no lunge at all. Split squats, Bulgarians, ATG, Cossack, and a HYROX-only sandbag lunge, but nothing that steps. Three consumers already assumed otherwise - the muscle map carried `lunge` and `walking-lunge` fanout keys for slugs that were never seeded, migration 0019 tagged `forward-lunge` / `reverse-lunge` / `walking-lunge` with the `single_leg` role in UPDATEs that matched nothing, and `accessory-schema.md` lists them as examples of that role. The single-leg pool was thinner than every reader of those files believed.

Migration 0139 adds forward and reverse lunges in bodyweight, dumbbell and barbell, tracking the split-squat pair's attributes with axial load and the experience gate scaling by implement. Roles are spelled out in the SQL: `deriveAccessoryRoles()` runs only while building `SEED_MOVEMENTS` in TypeScript, so a migration-inserted row without them would be invisible to the picker until someone ran a full reseed.

Kept to the six asked for. Walking, curtsy and lateral lunges and step-ups stay unseeded, and the two dead muscle-map keys were left alone rather than tidied as a passenger on this change.

---

## [2026-08-24] refine | The rest of the lunge family, and where a step-up's adductor tag belongs

Follows the previous entry. Walking lunge, step-up, curtsy lunge and lateral lunge, ten rows across bodyweight / dumbbell / barbell, seeded by migration 0140. Migration 0019 had already named `walking-lunge`, `step-up`, `step-up-db`, `step-up-bb` and `curtsy-lunge` in UPDATEs that matched nothing, so the slugs were chosen years ago by a migration that could never find them.

Three calls worth recording, all of which came out of review rather than out of the first draft.

**The step-up keeps its adductor tag.** A step-up barely loads the groin, and `accessory-schema.md` casts it as the low-impact single-leg fallback, so the draft dropped `adductors` to keep it available under an adductor flag. That is a silent overrule of a safety gate dressed up as a catalogue attribute. `affected-movements.ts` matches a limitation on muscle tags, and the project's stance is override-and-warn with the user holding the allow-list - not a row that quietly lies about what it loads. If the filter is too coarse, the filter is what to fix.

**The lateral lunge's primary region is `adductor_groin`, not `knee`.** It loads the trailing adductor under a lengthening bias. A limitation matches on `primary_region` only - `secondary_regions` is never consulted - so filing it under the knee like its siblings would have let a groin flag miss the one movement in the family that most deserves to be caught. Mirrors `cossack-squat-loaded`.

**The box a step-up needs cannot be expressed.** The equipment inventory has no box or bench field, so `bodyweight-box` would filter nothing, and it would additionally read as externally loaded to `carriesExternalLoad` and win the advanced-tier loadable ranking bonus. Equipment is tagged plainly and the box is named in the setup text, which is where the user actually reads it. A test pins that, because the setup string is now the only place the requirement exists. Modelling a box in the inventory is a separate change and was not made here.

The curtsy lunge sits at experienceMin 1 rather than 0. Ten new unilateral entries move the tier-0 single-leg share of the accessory pool up by roughly ten points, and a cross-behind step is not a foundational staple; gating the niche one curbs the distortion without curating by implement.

No barbell curtsy and no barbell lateral lunge. The threshold applied was "commonly programmed under a bar", which `step-up-bb` clears and those two do not.

The dead `walking-lunge` key in the muscle map became live for the first time and was rewritten to match its siblings. The `lunge` key stays dead and untouched - it names no slug and inventing one to justify it would be the tail wagging the dog. The 0139 rollback guard was also widened: it checked `training_maxes` but not `tm_suggestions`, `tm_history` or `cardio_logs`, all of which cascade or null on movement delete.

## [2026-08-25] decision | A weighted pull-up with nothing on the belt is a max-reps set

Owner-confirmed follow-up to the system-load fix. That change made the lighter weeks of a wave resolve to a bodyweight pull-up, which is correct - but it left the loaded prescription in place around it, so the set read "3-5 x 5, submaximal, stop short of failure" with no weight. TB3 does not run the loaded rep scheme at bodyweight. With nothing left to add, the set is repped out, which is what keeps a light week driving the pull-up forward instead of being five easy reps.

The engine already had a `bodyweight` lift kind that prescribes a PERCENTAGE OF MAX CLEAN REPS (a 20-rep max at 75% = 15 reps), citing TB1. Reusing it here was the obvious move and is wrong on the data: that kind reads its anchor as a rep ceiling, and a `weighted-bw` movement's anchor is a kg system max. The app has no max-rep count for a weighted pull-up at all - `pullUpMaxReps` exists only for lifters who came through the bodyweight-only onboarding assessment, which is exactly the population that does not have a weighted pull-up. Choosing the percentage reading would therefore have meant collecting a second number from every lifter. Owner chose the open set.

So a `weighted-bw` lift whose added load resolves to zero now carries `isAmrap`, drops the loaded rep CEILING (`repsMax` - a range is a loaded-set instruction), and drops the "stop short of failure" cue, which directly contradicts an open set. The template's rep count stays as a floor, so the set reads as "5 reps+" rather than losing its anchor entirely. Loaded weeks are untouched.

The set count is deliberately not collapsed: all 3-5 sets are max-reps sets, matching how the adapter already expands a multi-set working item into one loggable slot per set.

Not revisited: PR detection stays suppressed for these movements. Repping out a bodyweight pull-up is exactly where a REP pr would be meaningful, but the saved max is a kg system load, so there is nothing here to fire against yet. That wants a max-reps anchor of its own.

## [2026-08-24] decision | Supplemental work is the lifter's to add, and is dosed by the day it joins

The other half of "Zulu's supplemental count is locked to two". Removal became reversible earlier; this is the add. The only add path hardcoded `role: "accessory"`, so anything the lifter added took the accessory dose - 3x8-15 near failure, no percentage, no warm-up - and there was no way to add work at the SUPPLEMENTAL dose of 3-5x8-10 at 65/70/75%.

Owner decided a day may carry more supplemental work than the book lists, and explicitly WITHOUT a warning: TB3 says the amount of supplemental work is ultimately up to the lifter, so choosing three is not overriding a principle-derived default and DC-K4 does not apply. Recorded because the reasoning is the interesting part - DC-K4 governs overrides of what the method prescribes, not choices the method hands to the lifter.

The design question was what an added supplemental should be prescribed AS. It carries no template slot, so no prescription rule matches it by name. Rather than invent a dose or restate the numbers in a second place, it BORROWS one: `supplementalDonor` picks a supplemental slot the day already has, and the added lift resolves its rules through that slot's key. It therefore tracks the week automatically - 65 in week 1, 70 in week 2, 75 in week 3 - and inherits the warm-up ramp, because it is reading the same rule the template's own supplemental work reads.

Which slot lends the dose is the whole correctness question. Two are wrong to borrow from. Circuit members: the AB Triad's rule is 3x5 with a note naming its three movements, so lending it prints that circuit against an unrelated lift. And bodyweight supplementals: their rule carries `percent: null` and a max-reps note, so a loaded lift would inherit no percentage at all. Review caught the second - Activation's Armor B days list pull-ups BEFORE the overhead press, so "first supplemental slot" picked the bodyweight one. Not reachable from the wizard today, since Activation persists through a different shape entirely, but it is the same failure the triad exclusion was written to prevent and it is now pinned.

Review also caught that the first tests exercised a branch production cannot reach. Deploy stamps a `kind` on every catalog movement - `barbell` when the lifter has a 1RM, `unanchored` when they do not - so a test payload with neither took a third path that emits a percentage but no weight and no warm-ups. The PR's central claim, that an added supplemental inherits the day's warm-up ramp, was true and untested. Both real paths are now covered, with the added lift given a 1RM distinct from the donor's so "loaded off its own max" actually means something.

A day with no supplemental work of its own has no dose to lend; the lift falls back to the accessory dose. The wizard does not offer the control there, so it is a defined fallback rather than a reachable state.

## [2026-08-26] decision | Rehab attaches to a Tactical Barbell session, not to a day it takes over

A weekly Tactical Barbell block could only run rehab on a day it gave up entirely. The customization blob encodes rehab as a DAY TYPE — strength OR conditioning OR rehab OR rest — so `rehab as the warm-up of a strength day` had nowhere to live. The engine had supported that placement since migration 0127 and Activation has used it all along; only the weekly shape could not ask for it.

Placement now lives in a sibling envelope on the wizard payload rather than inside the customization. That blob is a strict union parsed as one unit, so an older build meeting an unknown key drops the WHOLE block configuration, not just its rehab — the hazard ADR 0071 avoided for the session links, avoided again the same way. What the wizard writes into the customization is unchanged in shape: a rehab-only day is a rest day, and the blob says nothing about rehab at all.

A session is addressed by its SERIES KEY, not by a weekday. The user attaches rehab a step before the schedule is set, and reproducing the engine's seating rule in the wizard is wrong the moment a template carries a conditioning or test session — the wizard's series list filters those out while the engine counts them. Resolving the key at materialisation is exact, and rehab follows its session when the schedule moves. It resolves against the session with that key whatever its role, or rehab would vanish in a peak week — the week a lifter is most loaded.

A weekly block runs several protocols, one per placement — knee rehab on squat day, shoulder rehab on press day. Which protocols a block is attached to is DERIVED from where they run rather than tracked beside it: one chosen and then taken off every session is not attached, so its supersets and its library binding go with it. Keeping them would fail the deploy for a protocol with supersets, and leave a block claiming rehab it never runs for one without.

Two pre-existing bugs surfaced in the same path and are fixed here. The Settings sync path replaced a program's protocol bindings with an empty list, so the first edit synced and no later one ever did. And a newly deployed weekly block bound its protocol under the library uuid but materialised its links under the synthetic legacy id, so rehab supersets were dropped and Settings edits never reached it.

See ADR 0078.

## [2026-08-24] decision | The AB Triad is addable, because it is a circuit and not an exercise

Owner could not find the AB Triad in the exercise library. It was never there: it is not a movement but an engine-owned circuit of three - hanging leg raise, hanging knee raise, toes-to-bar - run as three rounds of five. All three ARE in the library individually, so the honest reading of the report was that adding them by hand gives three loose ab exercises rather than the circuit. Owner chose the engine work over a search alias.

The mechanism turned out to already exist, in two halves that had not met. `hasCompleteAbTriad` reads `sourceMovement ?? movement`, and a user-added lift carries no `sourceMovement` - so three rows keyed by the canonical slugs are detected as the complete circuit by code that predates this change. And the just-landed `role: "supplemental"` made added rows expressible at all. What was missing was the dose: on a day with no triad rule, the added members would have borrowed the day's supplemental dose - 3-5x8-10 at 65% - which is not what a triad is. The rule is now exported as `AB_TRIAD_RULE` and consulted directly for an added triad, so the numbers come from one place whether the template prescribed the circuit or the lifter did.

`addGroup` is all-or-nothing and refuses when any member is already present: two thirds of a triad is three ab exercises wearing its name, and two triads sharing a movement would give that movement two circuit identities.

Review found a real one. `collapseGroup` and `restoreGroup` were written when a circuit could only be a set of template slots, so they rebuild rows as `{ sourceMovement, movement }` - correct then, and role-destroying now. Swapping an added triad for one exercise produced a row claiming a slot the session does not have; `slotPayloadEntry` then emitted neither the role nor the slot, and the engine prescribed it as a MAIN lift at a percentage of a max the lifter had never set. Restore made it worse by doing the same to all three. The fix keeps the head's identity for restoration AND its role for prescription - the identity is wizard bookkeeping that `slotPayloadEntry` drops for a roled row, so the engine never sees it.

Two smaller ones: the circuit entry was filtered against the exercise currently filling each row rather than against slot identities, so a swapped circuit still occupied its slots and the button rendered but did nothing; and a peak-promotion assertion compared against a field `PrescribedItem` does not have, so it could never have failed. The second is the more instructive - the test package excludes test files from typecheck, so a nonexistent property reads as `undefined` and the assertion passes vacuously. It now asserts on the label, with a second assertion pinning that the label is what a triad item is actually called.


## [2026-08-25] fix | Supplemental work takes no warm-up ramp

Owner: "I dont think supplemental lifts need warmup. They are usually targeting the same muscle groups as the main lifts."

Correct, and the code disagreed with itself. `includeWarmup` defaults to true and only a prescription rule turns it off. Activation's two supplemental rule factories both declared `warmup: false`; Zulu's did not. So on Zulu B the barbell row - 3-5x8-10 at 65% - got the shared 40/60/80% ramp, meaning warm-up sets at roughly 26%, 39% and 52% of the lifter's max, AFTER they had already pulled heavy deadlifts in the same session.

The reasoning holds across every TB template, because supplemental work always follows main work on the same pattern: Zulu A benches and squats then presses overhead; Zulu B deadlifts and does weighted pull-ups then rows; Activation's Armor B benches and rows then does pull-ups and presses. TB3 prescribes no warm-up for supplemental work either - the ramp was purely this app's default.

One line, in the `zuluSupplementalRules` factory rather than repeated across its five week rules.

Owner chose to extend it to supplemental work the LIFTER adds as well, overruling the rubber-duck's suggestion to keep the ramp there. The duck's case was that an added supplemental need not overlap - weighted dips on a deadlift day warm nothing for pressing - which is true, but the owner's call is that they will warm up themselves rather than have the app decide. The inheritance falls out for free: an added supplemental borrows the donor slot's rule, so it borrows `warmup: false` with everything else, and the test asserting the opposite was inverted.

Blast radius, checked before the change: only the session duration estimate moves, because `estimateSessionSeconds` prices warm-up sets. Hard-set counts, effective stress load, muscle volume, the ADR-0013 budget and the recovery-week builder all already exclude warm-ups. Forward-only - materialised `planned_sessions` keep the prescription they were written with, so a deployed block is not rewritten under a lifter who may already have logged against it.

Also corrected in the same conversation, though it was copy rather than code: a mock-up line claiming accessory work is "dropped first if the week runs heavy". ADR-0013 trims only "when the user has accepted an over-budget volume nudge", and limitation swaps are equally an offer - a main lift "is never auto-changed". The app does not change a program on the lifter's behalf, and the line said it did.


## [2026-08-25] decision | One add button, and every row says what it will be

Owner: "This setup with +Add accessory and +Add supplemental buttons is now very weird. There should be only one button."

The buttons were the symptom. The cause is that a session row showed only the movement name - no sets, no reps, no percentage anywhere in the editor - so the two buttons differed by something the screen never showed. Adding a second button had made an existing gap visible rather than creating one.

The literal request could not be met. Operator, Fighter, Gladiator, Mass and Grey Man prescribe NO supplemental work, so a single button called "+ Add supplemental" would take away the ability to add anything on five of the seven templates. It is "+ Add exercise", and the work type is chosen AFTER picking the exercise, where Supplemental can be disabled with its reason and Accessory can be disabled for a movement that cannot be run for 8-15 reps to failure - a protection the old accessory-only picker gave by filtering its list, which a review-caught test stopped me from dropping.

Owner also rejected copy describing what the app does automatically: "The app shouldn't make any changes in the program on behalf of the user." Checked, and he is right - ADR-0013 trimming happens only "when the user has accepted an over-budget volume nudge", and a main lift "is never auto-changed" by limitation handling. Both are offers. The line went, and with it my earlier argument for keeping the two doses apart; the honest difference is loading, not fatigue management.

The dose is derived in the engine, not the wizard. `applyPrescriptionRules` is extracted verbatim from `prescribe`'s rule loop and both now call it, so the row and the workout read the same rules and a row cannot promise numbers the session will not deliver. `tbSlotDose` states the BLOCK's range rather than one week's - this editor edits a repeating session, so "65%" would be wrong for five weeks out of six.

Two engine subtleties the display forced into the open. A rule that sets `reps` without clearing the scheme's `repsMax` leaves a range the session never states, so the AB Triad's 3x5 read "5-8"; the engine's own `repsLabel` wins where every week agrees on one. And an `unanchored` slot takes `prescribe`'s no-weight branch however its rules resolved, so stating a percentage would promise a load that never arrives.

Review found five, two of which mattered. The work-type panel highlighted `addKind` while the Add button computed a different role, so on every template except Zulu the option shown as selected was the one that would not be used - the same invisible-difference problem, reintroduced inside the fix for it. And the Supplemental gate read the optional `dose` DISPLAY field rather than the slot's existence, which would silently have disabled supplemental work on a day that prescribes it. Also: `pendingAdd` survived a template switch onto an identically-keyed `slot-1`; the accessory copy promised a sets/reps control that is a follow-up; and a fixture claimed a dose the engine does not produce, unnoticed because the assertion checked only that the element existed.

## [2026-08-25] decision | The lifter sets the volume; the program keeps the loading

Fourth and last of the session-editor pieces. A row the lifter added can now carry their own sets and reps, edited in place. Load is not editable and was never on the table: a percentage is of a training max, so a typed one needs a max they may not have set and means nothing on a bodyweight movement.

The override is applied AFTER `applyPrescriptionRules`, not instead of it. That ordering is the whole design - the week's percentage still resolves through the rules, so an overridden supplemental keeps tracking the wave across the block, and only the amount of work changes. It clears the rule note, because a note describing sets the lift no longer does is worse than no note.

Only work the lifter added can take one. A template lift's dose is the program, and editing it here would be editing the book rather than the session, so both the schema and the engine require `role` before they will look at a dose.

TB3 leaves supplemental volume to the lifter, so there is no warning for exceeding the book - DC-K4 governs overrides of what the method PRESCRIBES, not of a freedom it grants.

Three layers now share one set of limits (`TB_DOSE_BOUNDS`, exported from the engine) because review found them disagreeing. The wizard let Save through at 30 sets, the deploy schema capped at 20, and the whole submission came back rejected quoting a number with no hint which row produced it. The gate now names the offending number where it blocks, and a test asserts every dose Save accepts is one the schema accepts, so the two cannot drift apart again.

The engine re-checks the same limits when reading stored data. A schema that runs on write cannot vouch for a blob written by an older build or edited by hand, and the old defensive parse used `Number()`, so it would have accepted "4", 2.5 and 500 - all things the schema refuses.

Activation is defended in the engine, not only in the schema. It has no dose editor, its overrides deliberately kept the base shape, and `entriesFromValue` is shared - so a dose reaching it from a hand-written blob would have been honoured by a surface with no way to show or remove it. It is now dropped where storage is read.

Review found four. The one that mattered was the Save/schema disagreement above. It also caught a test that could not fail: it claimed to prove that editing only the numbers still counts as a change, but asserted something an earlier test already covered, and the code it guarded was dead - an entry carrying a dose always has a role, no template entry ever does, so the comparison already differed before the dose was consulted. The dead segment and its confident, wrong comment are gone. The replacements were each confirmed to fail with their guard removed, and one of them passed for the wrong reason on the first attempt, which is exactly why they were checked.

---

## [2026-08-25] fix | The sliding leg curl, and a bodyweight tag that could be overruled into a machine

The catalogue had three machine leg curls and the Nordic family, and nothing in between: no hamstring curl for a lifter with neither a machine nor an anchor. Added `sliding-leg-curl` - supine, heels on sliders, hips bridged.

Adding it surfaced a trap in the planner. `inferRequiredEquipment` normalises hyphens to underscores and matches substrings, so `sliding-leg-curl` becomes `sliding_leg_curl`, hits the `leg_curl` branch, and requires a leg-curl MACHINE. The movement whose entire selling point is needing no machine would have been filtered out for every lifter without one - and no equipment tag could rescue it, because `requirementFromEquipmentTag` returns null for a bodyweight tag and the slug heuristic then decides. Verified against every tag worth trying: `bodyweight`, `floor`, `mat`, `sliders`, `bodyweight-sliders` all resolved to the machine.

The fix is in `resolveRequiredEquipment`: a tag that explicitly offers bodyweight can no longer be overruled into a FACILITY requirement (machine / machine-generic / cable). Owning a machine is binary, so "can be done with bodyweight" and "needs a machine" is a flat contradiction and the tag wins. The bug is that the null return conflates "no opinion" with "explicitly bodyweight".

Slug-inferred FREE-WEIGHT requirements were deliberately left alone. The audit found exactly one row affected either way: `hsr-calf-raise-db`, tagged `dumbbell-or-bw`, resolves to requiring dumbbells even though the tag and its display name both offer bodyweight. Arguably the same bug - ADR 0034 added that row specifically as the machine-free Achilles option - but widening the fix would change which movements an equipment-poor lifter is offered for a tendon-floor guarantee, which is a real engine change and deserves its own decision rather than riding along in a catalogue addition. Raised with the owner; pinned by a test either way so the machine fix cannot quietly widen.

Two attribute calls came out of review rather than the first draft. The emphasis avoids the words "strain-prevention": `deriveAccessoryRoles` matches that phrase and adds `alfredson_eccentric`, the symptomatic-only rehab protocol carrying DC-O4 floor weight 0. The Nordic legitimately holds that role. A general accessory holding it would be filed as injury work and never picked normally - a mis-tag that no test would have caught and no user would have been able to explain. And eccentric demand went into `eccentric_load_score`, the first-class column the picker actually reads when demoting heavy-eccentric work under concurrent stress; `metadata.eccentric_cost` is descriptive only, so declaring it there alone would have claimed a property that did nothing.

`high_strain_tendon` stays false. The Nordic sets it; a slider curl is a real eccentric but not a clinical high-strain protocol, and the flag feeds stress-bucket weighting.

The sliders are not modelled. The equipment inventory has no slider field, so a `sliders` tag would filter nothing while implying a precision it does not have - the same conclusion reached for the step-up's box in 0140. The tag is plain `bodyweight` and the requirement is named in the setup text, pinned by a test because that string is the only place it exists.

---

## [2026-08-25] fix | The equipment tag is now believed, and the GHD back extension exists

Two things, one of them the follow-up flagged in the previous entry.

**The deferred calf-raise fix.** `hsr-calf-raise-db` - display name "HSR Calf Raise - DB/BW", tag `dumbbell-or-bw` - resolved to REQUIRING dumbbells, because the slug ends `_db` and the bodyweight escape hatch returned `null` rather than an answer, letting the slug decide. Migration 0094 added that row specifically so the ADR 0034 Achilles HSR guarantee could be met machine-free, and a two-letter suffix quietly undid it.

The consequence was worse than one mislabelled row. Probing every `foot_ankle_calf` movement against the equipment presets: `iso-calf-hold` and `hsr-calf-raise` both need a machine, and `hsr-calf-raise-db` needed dumbbells. So a bodyweight-only lifter - or a home gym without dumbbells - had NO available `hsr` source in the calf region at all. The hole 0094 was written to close was still open.

`requirementFromEquipmentTag` now returns `bodyweight_or_generic` for a bodyweight-capable tag instead of `null`. The tag is an answer, not an absence of one. That subsumes the narrower facility-only override added in 0141, which is deleted. Blast radius was measured before the change by resolving every bodyweight-tagged row both ways: exactly one row moves, and it is the broken one.

The cost is that the slug can no longer add hardware a bodyweight tag omitted, so the tag is now the only thing standing between a lifter and a movement they cannot do. A pull-up mistagged `bodyweight` would simply be offered to someone with no bar. That is a catalogue-data failure rather than a resolver one, and it is now pinned by a catalog-integrity test rather than left to a second, contradicting authority.

**GHD back extension.** Added `back-extension-ghd`. Not a duplicate of `back-extension-45`: that one is the angled hyperextension bench, this is the glute-ham developer, which holds the torso horizontal so the lever is longest at the top and the range is larger. Different apparatus, different strength curve.

Attributes are set explicitly rather than inherited. The `hinge(...)` seed helper is built around the deadlift and defaults to a `knee` secondary region and lats/forearms/traps secondary muscles. Nothing is held during a back extension and the knees are anchored rather than loaded - and those columns drive limitation filtering, so inheriting them would let an elbow or knee flag reach a movement it has no business touching. The existing 45° row does inherit them; that is left alone rather than corrected as a passenger.

Also left alone, deliberately: `back-extension-45` is tagged `ghd-machine`, which is wrong - a 45° bench is not a glute-ham developer - and adding a genuine GHD movement means two apparatus now share one tag. The obvious tidy-up is a regression. `isBodyweightCapableEquipment` treats every `machine` tag as requiring an entered weight EXCEPT one containing `ghd`, so retagging it to a hyperextension-bench tag would make the logger demand a load for an unweighted back extension. Correcting it properly means coordinated changes in equipment resolution and bodyweight logging, which is its own change.
## [2026-08-26] fix | A reserved conditioning day says its name and stops

Owner, with a screenshot of the Today hero: "a lot of unnecessary text for the conditioning days ... instead of repeating the same information in all boxes."

Four boxes, one fact. The card showed a description, an INTERVALS row, a PROTOCOL row and an INTENSITY row, all saying the lifter picks the session. Three of the four came from a single boilerplate sentence stored in `protocolNote` and then shredded by the note parser, which splits on commas and labels the pieces. The fourth was a fabricated intensity.

The INTERVALS row is worth naming: the parser identified an interval scheme with `/[×x]/`, which matches the plain letter x. The sentence ended "recorded externally", so the card confidently reported a sentence fragment as the day's interval prescription. Now a count is required on both sides - `4 × 4 min`, `6-10 × 10-15s` - and the check lives in a named helper with the failing case as a test.

The root cause is that prose was stored in a field meant for a protocol hint. Three producers did it and three surfaces each hand-rolled a check to hide it again, each knowing about a different subset, so it always leaked somewhere: the Today hero showed one string, the plan drawer suppressed a second, the live session page appended " Tap Mark done when finished." to a third. Producers now write nothing, `cardioProtocolNote` recognises the legacy strings in one place for plans already in the database, and all three surfaces read through it.

No intensity is invented for external cardio. "Follow prescribed effort" under a card that prescribes nothing is a row that says nothing; a real `hrCap` still shows.

`cardio_external` no longer has a description at all, and left `CARDIO_DESCRIPTIONS` entirely - it is the one kind with nothing to teach. Its copy had also drifted into "so the engine can account for the load", banned outright by the UI copy rules, and it was pinned there by a test requiring every description to exceed 40 characters. A length floor over a map that had grown to include a kind with nothing to say is a test that mandates padding; the kind left the map rather than the floor being lowered.

Owner chose the empty result over a short line: an open day shows the title and the buttons, nothing between. A sentence there would restate the heading directly above it.

Ducked with GPT-5.6, which found three blockers. The largest: my heading fix would have replaced one duplicate with another, because the dedup that decides whether to SHOW a heading resolved the name separately from the card that renders it - so the two could disagree, which is exactly the bug. Both now call `cardioDisplayName`. It also rejected my discriminator for "this day has no plan", which inferred it from absent fields and would have silently deleted a real HR target from a HYROX or Green session that legitimately uses the same kind; suppression is keyed to known placeholder prose, never to a kind or to absence. And it caught that skipping the producers would leave the bad copy live on two other surfaces.

One new test passed while the bug it named was still present - the placeholder is dropped before the parser runs, so the x case never reached the code under test. Every new test here was then re-checked by breaking its guard first.
Review found three. The one that mattered was mine: the plan drawer falls back to a one-line formatter when it finds no target, protocol or note, and that formatter prints `protocolNote` raw - so suppressing the placeholder one line above merely re-labelled it from "Protocol" to "Detail", and on a new plan carrying nothing at all the formatter emitted its own sentinel and the day read "Detail: cardio". At that point in the code the only real datum left is the duration, which the pill beside the name already shows, so the fallback could not produce anything that was not on screen twice; it is gone. That surface had no test at all - it does now, and both cases fail with the fallback restored.

Review also caught a weakened assertion of mine: replacing a pinned sentence with `toContain("Mark done")` looked like asserting behaviour but "Mark done" is the CTA, rendered whether or not the body it claimed to test renders at all. The body element gained a testid and the test asserts on that. Same lesson in the negative form elsewhere: a `not.toMatch(/Follow prescribed effort/i)` guard would have gone quiet the moment that constant was reworded, so it now asserts the row's absence by testid.

## [2026-08-29] fix | The logger stops deciding you are done, and will take a half kilo

Two reports from one workout: "the cursor moves to the next movement when I finish the 3rd required set, even though I would want to do all 5", and "I couldn't write 27,5 kg for the db row."

**Leaving at the minimum.** Tactical Barbell writes 3-5 sets; the materialiser emits five slots and flags the last two `optional`. Two predicates in `MovementFocusView` treated an optional slot as already satisfied, so the third set meant "movement finished" and the strip advanced. The second one is the same blind spot in a different place: `cancelEdit` exits the movement when the required slots are covered, so backing out of an edit after set three also walked out. Both now ask `isMovementFullyCovered`, a new pure helper: every slot, optional included.

`isMovementComplete` keeps its required-only meaning. It drives the "completed" chip, and a movement whose prescribed work is done IS complete; the logger is asking a different question - "is there anything left here" - and conflating the two is what caused this. The two disagreeing is now asserted, so neither drifts into the other.

The advance loop itself was left alone. `handleSkipRest` writes every remaining slot and then reports a hardcoded `isLast: true`, so a guard in the parent's `onSaved` - my first plan - would have read a coverage set containing only the cursor slot and refused to advance, breaking "Skip remaining sets". The duck caught that before it was written; review confirmed the reasoning and found the same stale-coverage bug already live for skip inside a linked circuit, which is pre-existing and left for its own change.

Leaving early is now the only thing that leaves early, which promotes "End movement" from a 12px underlined link to a real button.

**The half kilo.** The weight field was `type="text"` controlled by a NUMBER: `value={someNumber}`, `onChange` doing `Number(text)`. Typing "27." parsed to 27, the field re-rendered from the number, the dot vanished, and the next keystroke gave 275. A comma never parsed, so nothing was committed and the controlled value snapped straight back - the character could not be typed at all. Between them there was no route to 27.5, on a scale that snaps storage to 0.5 kg. The field now holds TEXT while focused and derives the number from it. Both separators are accepted because the owner is European and the keyboard offers what the locale offers.

Parsing is a strict decimal grammar, not `Number`, which also takes "0x1f", "1e3" and " 12 ". A keystroke that would break the grammar is dropped rather than stripped out of the middle: "2a7" silently becoming 27 is worse than the "a" not appearing. Because every state the field can hold parses, there is no invalid state to guard the log button against.

Two live loggers had the identical broken input and now share one field. A third copy in `SessionLogClient` was left alone - the component is never rendered, only its types are imported.

**Testing.** Review's sharpest finding was that the unit tests proved nothing about either fix: revert both components and all twelve stay green, because the pure helper and the pure parser were never where the bugs lived. Both bugs are in the component layer, and the repo has no jsdom or RTL on purpose. The coverage that actually fails is Playwright, against fixtures that already exist - the DB-free `/dev/logger-preview` for typing "27,5", and the seeded strip for logging three of five and staying put.

Writing those exposed a hydration race in the shared `openNavigator` helper: a tap landing before the client component hydrates is swallowed, and the sheet never opens. It fails roughly one run in three on a slow machine and was silently costing retries. The tap now retries; `setNavOpen(true)` is idempotent so it is safe.

## [2026-08-29] fix | Skip remaining sets lets you out of a superset

Carried over from the previous review, which found it while checking something else: "Skip remaining sets" did not move the lifter off a linked-circuit station. It wrote every open slot of the movement and then told the parent about one of them - the cursor's. The parent rebuilds coverage from that report, and a circuit's round-major lookup reads it directly, so the rounds that had just been skipped still looked open, the lookup pointed back at the station the lifter was already standing on, and nothing moved. Parked on a movement with nothing left to do, with only the navigator sheet as a way out.

The report is now collected as each write lands, so what the parent is told cannot drift from what was stored, and a run that stops half way reports the half that succeeded rather than nothing.

`isLast` is gone. It was a second answer to "is this movement finished", computed in the child while the parent held the same inputs - and both bugs in this area came from two places disagreeing about that question. The parent decides, once.

The decision moved out of the component into `lib/sessions/focus-advance`. It was inline in a component the suite cannot drive - no jsdom, no RTL, deliberately - which is why these kept being invisible. `hasOpenWork` also folds in the rule from the previous fix: optional sets count until covered or declined.

The pure tests do not catch a component regression, which is the lesson from the last two rounds, so the guard is a Playwright test driving the real skip. It needs the first station done and round one of the second behind the lifter - the only state the bug is reachable in - so the DB-free preview fixture gained a `supersetlast` variant. Confirmed failing with the fix reverted before being kept.

Review found one, and it was mine: on a partial failure the new code closed the skip menu, which is the only surface `skipError` renders on, so the lifter got a success buzz and no message while slots went unwritten. The menu now stays open when a write fails, and the coverage report still goes out so the parent's picture stays truthful. It also caught a test whose name promised more than its assertion added - it repeated the case above it - now reshaped to cover skipping the FIRST station, where the rotation must continue rather than end.

## [2026-08-30] fix | A rescheduled workout survives a plan refresh

A Zulu workout moved to a later day could disappear when Edit plan or a rehab-library sync refreshed the active week. The move changed only its calendar coordinates, while the forward rewrite's preservation check looked for started work, notes, a time, or a prescription edit. On Sunday it therefore deleted the moved row as "untouched"; the freshly generated copy still belonged to its original earlier weekday, and the forward-only boundary correctly refused to insert that past slot. The week lost the workout entirely.

Manual moves and swaps now stamp a durable marker inside the prescription, and both displaced rows receive it as part of the same updates that move them. Each write is guarded by the prescription snapshot it read, so a movement edit landing at the same time aborts the move instead of being overwritten. Forward rewrites preserve the marker and deduplicate by the engine's stable session reference, so a moved workout cannot also reappear on its original day. A narrow compatibility guard protects older unmarked moves when their only generated replacement is already in the past. Preserved moved strength rows also match their generated counterpart by stable reference so an attached rehab protocol can still refresh in place.

The same review found that Edit plan did not account for user-inserted recovery weeks. Those rows are now preserved and fresh program weeks are shifted around them before reconciliation, so a refresh cannot remove the recovery week or pull later training seven days forward.

No schema migration: the marker lives in the existing prescription metadata. Added regression coverage for the reported Sunday loss, future-position deduplication, explicit schedule edits, marker recognition, successful swaps, rollback of marker/time changes, and recovery-week offsets.

## [2026-08-31] fix | The belt-load subtraction reached one producer of three

Reported as warm-up sets of "+40kg" and "+80kg" on a weighted pull-up. That is the shared 40/60/80% ladder applied to a bodyweight-inclusive max with nothing taken off, which the earlier system-load fix was supposed to have made impossible. It had fixed the one producer it was looking at.

The first miss is the interesting one, because it is a design fault rather than an oversight. `kind` was carried ALONGSIDE the movement in a cluster entry, so every path that builds one had to remember to attach it. The "run your own cluster" mode saves bare movement strings, `entriesFromValue` only set `kind` when an entry carried one explicitly, and an untagged `weighted-pullup` therefore missed the `weighted-bw` branch and fell through to the barbell path. An 118 kg max at 85% became a 100 kg working set ramped +40/+60/+80 - exactly the report. Belt-loading is a property OF THE MOVEMENT, so `defaultLiftKind` now derives it and no caller has to know.

Second: Zulu/HT is a separate engine whose cluster is a bare `string[]` with no per-lift kind at all, so it could never have been fixed by tagging entries. It now recognises a belt-loaded movement by the movement itself. Its two duplicated heavy/back-off blocks became one helper, since the duplication is what let the two drift apart in the first place.

Third, and the one that actually reaches the lifter's existing plan: fixing the engines does nothing for sessions already materialised. An absolute warm-up target on a system-load movement WITHOUT the `systemLoad` marker was written by a path that never subtracted, so it is read as a total and corrected in the resolver - the same catalog-driven strategy that fixed the working sets, now covering the ramp.

`apps/web/src/lib/planner/warmups.ts` emits warm-ups carrying `percentTm` rather than an absolute, so it already resolved correctly through the shared resolver and was left alone.

Review before merge caught three defects in that work, one of them a regression the fix introduced. The legacy reinterpretation first keyed off the catalog's `body_weight_loaded`, which is a broad "takes a belt" capability - it covers push-ups, ordinary dips and rehab movements like `eccentric-chin-up`, whose `targetWeightKg` is the lifter's own hand-entered number stored verbatim. A 10 kg rehab load would have silently resolved to 0. It is now warm-ups only, which is the only place the bug could occur. Second, `resolveSetSnapshot` fetched bodyweight only when a percentage was present, so for a legacy warm-up the server would have expected the uncorrected number and rejected the corrected one the logger displayed, losing the prescribed snapshot. Third, Zulu/HT's optional peaking cue overwrote the note telling the lifter the set is bodyweight.

No migration. Nothing is rewritten in storage; the correction happens at resolution.

## [2026-09-01] refine | Offline logging durability contract

Offline strength, cardio, and session completion writes now persist through one explicit enqueue contract before network calls. Transient and uncertain results stay FIFO-queued, only typed validation failures are dropped and surfaced, all fallback client ids are RFC 4122 UUIDs, and reload hydrates prescribed plus freestyle overlays into the finish gate without double-rendering after sync. Cardio completion and ad-hoc cardio now carry `client_log_id` through the same durable path. No migration: existing idempotency columns and constraints are sufficient.

## [2026-09-01] fix | A substituted movement owns its loading maths

The whole-codebase review found a critical sibling of the weighted pull-up bug. Tactical Barbell lets a lifter replace a template slot with any catalog movement, but the saved customization chose the loading kind from the SLOT being replaced. Putting a normal Barbell Row into the Weighted Pull-up slot therefore kept `weighted-bw`: at 75% of a 120 kg max for an 82 kg lifter, the engine subtracted bodyweight and prescribed 7.5 kg instead of 90 kg. The reverse was dangerous: putting the new Weighted Dip into a Bench slot treated its bodyweight-inclusive max like a barbell max and prescribed +90 kg on the belt instead of +7.5 kg.

The first fix at the wizard boundary was not enough. Independent review found that deploy's `normalizeCustomMovement` unconditionally rewrote every catalog movement with a max to `barbell`, clobbering the corrected client value before it reached the engine. This also meant old customizations could never heal.

Loading kind is now derived from the selected catalog movement in one pure function: no saved max is `unanchored`; a bodyweight-loadable movement with a saved max is `weighted-bw`; any other movement with a max is `barbell`. The wizard uses it instead of inheriting the old slot, and deploy repeats the derivation from the trusted catalog row rather than trusting the client or stored blob. Existing customized plans therefore correct themselves the next time they are edited/deployed.

No migration. The catalog already owns `body_weight_loaded`, and the training-max and session-load paths already use that column to mean the saved max includes bodyweight.

## [2026-09-01] refine | Align persisted and live recovery load state

DC-C14's regional recovery calculation now has one pure daily-load derivation for both the persisted ledger and the live snapshot. It applies the same strength and cardio rules, skips, warm-up filter, defaults, region weights, and user-local day conversion in both places. Completed-session edits now use one guarded refresh path; removing the final logged item writes zero actual session load while a session originally completed without logs still preserves its planned adherence meaning. Failed reads or the final write stop the actual-load refresh before a partial value can be saved. Regression coverage includes Los Angeles and Helsinki midnight/DST boundaries plus a persisted-versus-live differential fixture. No migration: existing session and planned-session fields carry the required state.

## [2026-09-01] fix | Auth redirects, equipment tags, and block weeks use one answer each

Three independent correctness gaps now resolve through shared helpers. Auth completion accepts only app-relative paths and rejects absolute, protocol-relative, backslash, control-character, malformed, and repeatedly encoded redirect targets. Equipment tags for bars, rings, and tracked alternatives now preserve the actual requirement, including either/or and all-of combinations, with the complete seed tag set pinned by a catalog snapshot. Active-block features now choose the block week from the containing Monday and the user's local calendar date at an explicit instant, including mid-week legacy starts and DST edges.

No migration. These changes reuse existing equipment and block fields.

## [2026-09-01] fix | TM banners and auto-deload used the wrong history

Three confirmed bugs, one PR.

Auto-deload looked across every block and sorted only by week number. An old high-week miss could pair with this block's first miss and offer a deload too early. An old high-week hit could hide two real misses this cycle. The walk now stays in this block and uses actual session time, then created time, then week/day. A missing session is skipped, not counted as a hit. Miss math and the 10% drop are unchanged.

TM banners were built only at Finish, and they guessed AMRAP from notes or "at least 5 reps". A stored 3+ set logged for 4 reps never appeared. A programmed 5 did. Editing or deleting the set after Finish left the banner up, because the database nulls the link instead of dropping the row. Finish, later edits, and deletes now share one pending-only rewrite. Accepted and declined rows stay put. Identical dismissed offers are not brought back. Heuristic thresholds are unchanged.

## [2026-09-01] fix | Five engine-to-adapter contract breaks

A contract audit across every engine and the platform adapter found five places where what an engine prescribed and what the lifter was shown had drifted apart. All five are fixed together because they share one shape: the engine said something true, and the layer that reads it assumed a different meaning.

HYROX two-a-day emitted the afternoon session twice. The timeline already publishes a separate `-pm` ref for the second session, and `locateCell` already resolves it, so appending the same work onto the morning prescription put every evening station in both sessions. The morning ref now prescribes only its own session. Titles, tags and completion-station mapping are unchanged, and a materialization test asserts the morning row is byte-identical to the same ref built with two-a-day switched off.

Green ran every lift 11% heavy for anyone using the optional training max. Green has no top-level basis - it holds one nested strength engine per slot, each with its own `useTrainingMax`/`tmPercent` - but three call sites read a Green instance as if it were a Tactical Barbell one, found nothing, and concluded "true max", seeding 100%. A 125 kg engine target rendered as 140 kg. `greenStrengthBasis` is now the single home for that question and returns the basis the nested engines agree on, or `null` when they do not: a single `tm_percent` column cannot describe two divergent bases, and guessing is what caused this.

Writing the round-trip test for that exposed a second, latent layer. Tactical Barbell and Zulu/HT both round the training max to the plate increment BEFORE applying the session percentage, and the alignment seeded the raw percentage, which multiplies in the other order. Independent review established that this is currently inert: the app plate-rounds the training max at a hardcoded 2.5 kg, the engines default to the same step, and at that step the two orders agree. They stop agreeing at any other step. The alignment now seeds the engine's ROUNDED ratio - what the 5/3/1 branch already did - which reproduces the engine exactly whatever the step, and no longer depends on the app's increment matching the engine's. Recorded because the first version of the test asserted a discrepancy production cannot currently produce; it now models the real renderer and pins the case that does diverge.

`body_weight_loaded` was answering two different questions. It marks a movement that CAN be done with no external weight - lunges, step-ups, push-ups, inverted rows, eccentric chin-ups - and the training-max, session and catalog-substitution paths read it as "the saved max INCLUDES the lifter's bodyweight". Those are not the same claim, and the previous entry in this log records the moment the second reading was written down as if it were settled. A 70% forward-lunge off a 100 kg max for an 80 kg lifter resolved to 0 kg. Today only the explicitly weighted pull-up and weighted dip carry a bodyweight-inclusive max, so that fact now lives in `packages/domain/src/movement-load-identity.ts` as a catalog-slug and engine-key identity table rather than in a boolean whose name promises something broader. Ordinary bodyweight logging is untouched; the capability question keeps the column. No migration: nothing new is stored, and because catalog identity now WINS over the `systemLoad` marker on an already-materialised item, plans built under the old rule correct themselves on read. The marker is still honoured for movements the catalog cannot resolve.

Green's deload week materialised empty. The engine emitted the guidance as a standalone note, and the adapter folds a note into the item before it - with no item before it, the note was dropped and the session had nothing in it. The guidance is now a `cardio_external` item, which is the representation the schema documents for a session that carries no movement, duration or intensity. It is deliberately given no duration: four of the five phases already have three easy aerobic days in a deload week, and inventing a 30-minute session would add a fourth. It classifies as restorative and carries no stress load. The alternative - branching per phase - would leave those four phases with no deload session at all, which is the bug.

Green's public I/CAT phase delegates its pull-up assistance to Zulu/HT, whose source note reads its wave percentage as a share of MAX REPS for bodyweight, or of the 1RM if the lifter adds weight. The item names the bodyweight pull-up, and the percentage was carried as `percentOfTm`, which the adapter reads as a share of a LOAD - so a lifter with a pull-up entry saw a fabricated kilogram target on a bodyweight set. The percentage is gone; the table's own rep figure is the prescription, and the source's 3-5 set range is now expressed as one, which the adapter fans out as five slots with the last two optional. An intermediate version of this fix derived the reps by spending the percentage against the lifter's own recorded rep max. Independent review killed it, correctly: `assistPct` ascends across the wave alongside the heavy and back-off intensity columns while `assistReps` descends alongside their rep columns, so no single rep max reproduces 12/10/8 from 60/65/70%. Deriving from it would have handed anchored lifters ASCENDING assistance volume while their barbell work de-loaded, and silently replaced source data for some lifters and not others.

Every fix has an end-to-end engine-to-adapter-to-materialize test citing DC-K4.

Adding three test files to `apps/web` turned a latent test-harness fault into a red suite. Twenty-four suites import the module under test from INSIDE the test body, so the first test in each absorbs the whole module graph's resolution cost against Vitest's 5s default. That is load time, not test time. Under the extra parallel load one suite tipped over, and because a timed-out test keeps running, its in-flight call landed in the next test's recorded calls and failed that one too - a cascade that reads like a second bug. Confirmed against the base commit: the timeout reproduces there as well, on a different suite. Raised `testTimeout` and `hookTimeout` for the web package rather than restructuring twenty-four files.

Three things were deliberately left alone. A pull-up rep max shares the `one_rm_kg` column with real one-rep maxes and is displayed with kilogram units in roughly eight places; that is a pre-existing product question about where a rep count should live, not an engine-contract break, and it needs a schema decision rather than a patch. `activeProgramTmPercent` still seeds a raw whole-program percentage on manual 1RM entry while the alignment pass seeds a per-movement rounded ratio - two answers to one column, inert at the default plate step, and pre-existing for plain Tactical Barbell; the manual value is overwritten on the next deployment. And Green Outcome's combined session is intentional and test-locked, so it is unchanged.

## [2026-09-01] fix | Legacy warm-up ramps written under the old bodyweight rule

Separating "can be lifted with no external weight" from "the saved max includes bodyweight" fixed every load computed from that point on, but it did not fix loads already written down. A plan materialised under the old broad rule stored an ordinary lift's warm-up as an absolute kilogram with the lifter's bodyweight ALREADY SUBTRACTED, plus a `systemLoad` marker and no percentage to fall back on. Catalog identity now correctly overrules that marker, so the subtraction is no longer re-applied - but the stored number is still the subtracted one. A 110 kg top set for an 80 kg lifter, whose ramp was always 55 / 82.5 / 110, sat on disk as 0 / 2.5 / 30 and was shown as 0 / 2.5 / 30. The lightest rung is worse than wrong: `addedLoadFromSystemLoad` clamps at zero, and a stored zero resolves to no prescription at all, so the logger falls back to whatever was lifted last time.

The recovery lives in `packages/domain/src/legacy-system-load-warmup.ts` and runs in memory on read. Nothing is written back and no marker is erased on disk, so provenance survives and the repair can be revised. It has a single gate, and it refuses rather than guesses. A block is only recovered by REPLAYING the original writer: take the movement's own following main set for a percentage anchor and a training max, take the configured warm-up ladder and the bodyweight on file, and re-run the exact arithmetic that produced the stored block, collapse rule included. If the replay reproduces the stored slots exactly, slot for slot, it has proved all three inputs at once and it also says which rung of the ladder each surviving slot came from, so the block is restated off the ladder. If it produces anything else, nothing changes. A rung nothing can place is left unprescribed; it is never filled with a heavier guess.

The single gate covers a rung stored ABOVE zero as well, which is less obvious than it looks. Adding bodyweight back to such a rung inverts the subtraction, but only if the bodyweight on file is still the one that was subtracted. A lifter who has gained five kilos since the plan was written would see a 82.5 kg rung restated as 87.5 - heavier than they were ever asked for. Only the replay can rule that out, so nothing is recovered without it.

Three details of the writer had to be mirrored rather than assumed, which is why the repair replays it instead of reasoning about it. `buildSystemLoadWarmupItems` COLLAPSES consecutive rungs that round to the same added load, and it keeps the FIRST of each duplicate run, not the last - so a 40/60/80 ladder under a 110 kg top set for an 80 kg lifter stores two slots that came from rungs one and three, and the light survivor is the 40% rung. An earlier version of this repair assumed the survivors aligned to the ladder's tail and called that same slot 60%, loading 66 kg where 44 kg was correct. It floors rather than rounds. And it substitutes the shared ladder whenever the configured one is anchored to the training max, which the ramp resolver here repeats. Blocks are contiguous runs, not everything sharing a movement id, so two independent ladders for one movement in one session recover off their own anchors instead of being merged.

Once the replay has proved which rung each slot came from, the whole block is restated off the ladder rather than only the clamped rung. The stored figure was floored to a plate step only because bodyweight had to come out of it first; an ordinary lift has no such subtraction, and its ramp is rounded at the surface against the lifter's own bar and plates. So the 80% rung of a 110 kg top set is restated as 88, and the logger then shows whatever 88 rounds to on the equipment that lifter actually owns.

An earlier design detected the condition per movement and regenerated the whole ramp from today's configured scheme. Independent review rejected it on seven counts, of which two were decisive: today's scheme is not necessarily the scheme that wrote the plan, so regeneration would silently REPLAN a session the lifter had already partly performed; and collapse means slot count alone cannot tell you which rungs you are holding. A second review then caught that the surviving rungs were being inverted with today's bodyweight before the replay had validated anything, which could return a heavier load than the lifter was asked for. The version that shipped never replans - it restates, and only after a byte-exact replay has proved it is looking at the right plan, the right ladder and the right bodyweight. Set counts, rep counts, ordering and array length are untouched, so `prescription_item_index` keeps addressing the same slot and already-logged sets stay attached; the one cue that is cleared is the stale "bodyweight" label on a rung that now carries load, in both the field name the engine uses and the one the adapter persists.

Two residual ambiguities are accepted deliberately. A clamped rung holds no information whatsoever, so the configured ladder is the only thing that can speak for it - which is what the task specifies, and it is the same ladder every other surface uses for that lift today. And the top set follows the movement's current training max, which is how every main set in the session already renders, so a recovered ramp cannot disagree with the set it leads to.

The plate step the replay floors against is the writer's own, so it is read from one place - `DEFAULT_ROUNDING_KG` - and threaded explicitly through all three surfaces rather than each of them defaulting to 2.5 on its own.

The restatement is applied at all three places a load is resolved - the logger's prescription, the fill, and the per-set snapshot the server corroborates a submission against. The snapshot mattered most: had it been left out, the server would have expected the uncorrected number and rejected the corrected one the lifter was looking at, and it also has to round warm-ups the same way the logger does or the same rejection happens one plate at a time. In the fill it runs BEFORE autoregulation and manual modifications, so those transforms see a real ramp rather than a subtracted one. The plan preview needs nothing; it derives kilograms only from a percentage and never renders a stored absolute.
---

## [2026-09-01] refine | The single-arm Bulgarian split squat, and a role it deliberately does not carry

Added `bulgarian-split-squat-db-single-arm`. One dumbbell rather than two: the legs do the same work as `bulgarian-split-squat-db`, but the load is offset, so the lateral trunk holds it isometrically and the balance demand is side-on rather than front-to-back.

This was the weakest distinctness case brought so far, and it only clears the bar because the instructions say WHICH hand. Left as "hold one dumbbell" the row would be ambiguous, a lifter could reasonably log either version against it, and it would be the two-Copenhagen situation again. The setup specifies the hand opposite the front foot, and a test pins that, because that sentence is the whole difference from the sibling.

`obliques` is tagged as a secondary muscle on top of the seed helper's defaults, so an oblique or trunk limitation catches this where it would not catch the symmetrical version. Same honest-tagging principle as the step-up's adductors.

The interesting decision is a role it does NOT carry. Offset-load trunk bracing is precisely what `anti_rotation` describes, and `suitcase-carry` is in that pool on exactly that basis - so excluding this looks inconsistent. It is not. The Hybrid archetype requires `single_leg` and `anti_rotation` weekly, resolves them in that order, and deduplicates by movement id only. A row carrying both roles could therefore be seated as the trunk-stability slot in a session that had already taken a Bulgarian split squat for the leg slot: the lifter ends up with two split squats and no trunk work. The distinction that holds is the muscle map - a suitcase carry weights obliques 1.0, this weights them 0.25. There the trunk demand IS the exercise; here it is incidental to leg work. The roles are asserted exactly rather than by `toContain`, so a future helper change cannot quietly add it.

`high_strain_tendon` matches the two-dumbbell sibling: identical knee position and deep-flexion loading, and the flag feeds the tissue/impact stress bucket. Flagging one and not the other would be incoherent. Note that the first draft justified this by the tendinopathy filter on power picks - which is wrong, since that filter requires a power role the movement does not have. Same error class as the earlier `metadata.eccentric_cost` mistake: claiming behaviour that does not exist. Corrected before shipping.

Not touched: the pre-existing inconsistency where `bulgarian-split-squat-db` is flagged `high_strain_tendon` and `bulgarian-split-squat-bb` is not, despite the barbell version carrying more load. Real, but its own decision.

Naming note: the catalogue is inconsistent about where "single-arm" goes - `db-row-single-arm` and `single-arm-pulldown` in display names, against `overhead-tri-ext-db-single` rendering as "(single DB)". The Bulgarian family prefix was kept so all three variants sort together, with "single-arm" in the parenthetical because that is what the movement is called and what a lifter will search for.

## [2026-09-01] fix | Online logger state/error-handling defects (rollback, resume, swap, delete)

Five confirmed defects in the online (non-outbox) logging path, all sharing the same shape: state advanced or persisted before an error result was actually checked.

`SessionWorkArea.logSet` registered optimistic strength-set state (`registerStrengthLog`) for every log, including freestyle ones with no overlay, but the rollback-on-rejection code lived behind `if (overlay) { ...; return; }` — a freestyle log's rejection never reached it. `hasStrengthSets` stayed `true` forever, so Finish could enable with zero persisted sets. The reconciliation decision (drop the overlay row, roll back the provider registration, confirm the server id) is now one pure, independently tested function, `planLogSetOutcome`, keyed on whether optimistic state was registered at all — never on whether it had an overlay — so a rejected freestyle log rolls back exactly as completely as a rejected prescribed one.

`MovementFocusView.handleSubmit` called `onSaved` — which lets the parent FocusStrip advance `activeId` to a different movement — before `addStrengthSet` resolved. The component instance is reused (not remounted) across the active-movement switch, so a validation rejection surfaced its error on whatever movement the strip had already advanced to, and a slow success could also fire `onSaved` after the lifter had already manually navigated away from this slot. Fixed by moving `onSaved?.(...)` inside the `.then()` success branch (after the `result?.error` check returns early) and guarding it with a new pure helper, `shouldFireOnSaved`: the group key submitted is captured at call time and compared, via a live ref, against whatever movement is active when the promise resolves, so a manual navigation that happens while the write is in flight wins over the late `onSaved`.

`FocusStripLogger`'s `activeId` initializer read resume state (`localStorage`) directly inside its `useState` lazy initializer. This is an SSR hydration bug: the server render has no `window` and always falls back to `firstOpenId`, while the client's first (pre-hydration) render already has `localStorage` and can return a different movement — a markup mismatch React silently discards, and the specific mismatch masked the resume bug in earlier testing (`renderToStaticMarkup`, which never runs effects, could only observe the initializer's synchronous read). Separately, even when a resume key WAS honored, movement A would mount first, and `MovementFocusView`'s own persistence effect would overwrite the saved cursor/draft/rest-timer with A's blank state before the lifter ever saw B's draft restored. Both are fixed together: `activeId` now always initializes to `firstOpenId` (identical server/client markup), and a new one-shot mount effect resolves the real target via the existing `resolveInitialActiveKey` and flips `activeId` plus a new `resumeReady` flag in one batched update. `MovementFocusView` receives `resumeReady` as a prop and gates both its own resume-restoration effect and its persistence effect behind it, so neither can fire against the wrong (first-open) movement in the brief pre-resume window.

`swapActiveMovement` ignored the `planned_sessions` read error (falling through toward freestyle `session_movements` handling for what might be a planned workout), wrote its audit record (`recordOverrideEvent`) before the actual persistence mutation, and ignored every UPDATE/RPC error, always returning `{ ok: true }`. A reload could then either revert the swap or leave both movements attached. Fixed by adding an explicit error check after every read/write/RPC — `planned_sessions` read, `sessions` ownership read, `sessions` prescription read, `planned_sessions` UPDATE, `sessions` UPDATE, `add_session_movement`/`remove_session_movement` RPCs — returning `{ ok: false, error }` on any failure instead of falling through, and moving the audit write to after the mutation succeeds.

`deleteSet`/`deleteCardio` already throw on a Supabase delete error as of #792's recovery-load unification; this PR only adds `UndoBanner.onUndo` branching on `resolveRestoreOutcome`/`planUndoBannerAction` — surfacing a `restoreError` inline (button stays live for retry) instead of dismissing on a failed restore, and moving `clearAutoDismiss()` before the fetch so a slow/failed restore can't race the 10 s auto-dismiss timer.

Offline-outbox logic (owned by a separate PR) was left untouched throughout — the freestyle rollback fix in particular affects only the online-resolved branch of `logSet`, after the outbox enqueue/dequeue calls.

Tests: extended `swap-actions.test.ts` and `focus-advance.test.ts`, and rewrote every component/action-level assertion that had previously only checked source text into genuine behavioral tests against the extracted pure decision functions — `planLogSetOutcome` (rollback, five scenarios), `shouldFireOnSaved` (stale-navigation guard), `resolveInitialActiveKey` (resume selection), and `planUndoBannerAction` (recovery affordance survives a failed or network-error restore). `FocusStripLogger.test.tsx`'s SSR tests now assert the hydration-safety property directly: initial `renderToStaticMarkup` output is `firstOpenId`-based regardless of resume state, since `renderToStaticMarkup` never runs the effect that applies resume. Full `apps/web` suite, `tsc --noEmit`, and `eslint` all clean; independent code-review pass found no issues.

No migration.

## [2026-09-01] refine | Bodyweight measurements share one commit

The daily bodyweight prompt and Settings were each saving a dated measurement and the profile's current measurement in separate requests. A failed second request, or overlapping saves, could leave the two values out of sync. Both paths now use one authenticated transaction that locks the user's bodyweight write, updates the dated row, and updates the current profile value together. The daily prompt still preserves existing notes, while the Settings form continues to replace its note.

## [2026-09-01] decision | Record bodyweight external load with the set

External belt, vest, and assistance values are actual set data, not ordinary strength weight. They now live beside the set they belong to, so bodyweight progress can safely replace a set's derived history after an edit or deletion. Older rows retain an unknown external value instead of fabricating one; the existing history stays intact.

## [2026-09-01] refine | Persist the offline completion receipt

The authenticated completion RPC now accepts a durable offline outbox UUID.
The UUID is stored with the first completion in the same transaction, so
retries return a replay result without moving the completion time or repeating
once-only work. Online completions retain no receipt. The rollback refuses to
drop a recorded receipt.

## [2026-09-01] refine | Safe bodyweight progress rollout

New bodyweight progress updates use the new set-write transactions. Direct writes from an older app keep their existing single update, preventing a migrated database from crediting the same set twice. New logging, editing, deletion, and plan-fill paths use the transaction; only a database that has not received migration 0144 uses the older path.

## [2026-09-01] refine | Preserve queued completion upgrades

Legacy offline completion entries can have non-UUID identifiers. Completion
normalizes those identifiers to no receipt so the queued session still
completes, while valid UUID identifiers retain durable replay protection.
## [2026-09-01] refine | Offline replay ordering and completion hydration

Independent review of the offline logging durability work found that a newly
queued write could still reach the server ahead of an older queued write, and
that a queued completion was not remembered after reload. Foreground writes now
defer to the FIFO flusher whenever an earlier durable operation exists. Finish
also queues completion behind pending session work and hydrates the queued
completion state from the outbox.

A second review found that every PostgreSQL unique conflict was being treated as
an idempotent cardio replay. Cardio replay now confirms that the exact
`client_log_id` already exists before acknowledging a conflict; unrelated
conflicts remain retryable. No migration.

## [2026-09-01] refine | Durable completion and cardio reload hardening

Completion requests now use the durable outbox path even while online, retaining
the intent and resume state through uncertain or transient responses and clearing
both only after server confirmation. Reloaded cardio forms detect queued
`cardio_session` entries before allowing another submit, and completed cardio
sessions copy duration and RPE from the canonical idempotent row without rerunning
completion side effects. No migration.

## [2026-09-01] fix | Require durable storage before session completion requests

Session completion now refuses to send a request when IndexedDB cannot store the
recovery entry. This keeps the completion intent honest on clients where local
storage is unavailable; ordinary writes may still use a successful server
response when local queue storage is unavailable. No migration.

## [2026-09-01] refine | Offline logging durability hardening

Offline set, cardio, and completion writes now share one durable enqueue-and-claim contract. Transient failures remain queued with bounded retries, deterministic validation and ownership failures are surfaced as dropped entries without wedging FIFO replay, completion receipts retain their UUID key through the transition RPC, and queued cardio state hydrates safely across reloads. IndexedDB hydration failure leaves cardio usable through the direct fallback while reporting reduced durability. No schema change was added; completion receipt persistence integrates with the pending transition contract in PR #799.

## [2026-09-01] fix | Scope offline status to the active session

Session status now re-reads pending and dead-lettered entries for the active
session after each global flush, and completion refreshes are scoped by session
id. Work queued for another session can no longer change the current session's
badge or resume state. No migration.

## [2026-09-01] fix | Preserve legacy completion entries during replay

Completion replay now forwards a UUID receipt only when the queued entry has
one. Older timestamp-keyed completion rows pass a null receipt and remain
eligible for normal success or retry handling. An IndexedDB upgrade fixture
covers reading those rows from an existing outbox. No migration.

## [2026-09-05] decision | Pool swimming architecture proposed for owner approval

Recorded proposed ADR 0079 after inspecting the live single-active-program
constraints, standalone session logging, offline completion and program-owned
recovery boundaries. The proposal keeps swimming independent of primary block
replacement while sharing calendar composition and one cardio workload path.
Claude Opus 5 challenged the design; ownership foreign keys, generic-write
guards, reproducible decision inputs and pause/trash behavior were tightened.
Additive swim storage and access policies require owner approval before
implementation. No migration or user-facing swim behavior has shipped.

## [2026-09-05] decision | Swimming fills assigned cardio days

The owner approved additive swim-data storage and access-rule implementation,
without authorizing a production migration. Combined swimming must be selectable
as the progressive workout source for an existing program's cardio days:
Tactical Barbell keeps strength and its assigned cardio slots, while swimming
supplies their content without duplicate workouts or load. The swim week follows
the actual slot availability, including recovery weeks. Claude Opus 5 reviewed
the binding refinement. The owner selected return to the program's regular
cardio workouts when swimming is paused; started/completed swims retain history.
ADR 0079 and its index entry now record the accepted implementation direction.

## [2026-09-05] decision | Defer production region migration and resume swimming

The owner moved the production Stockholm relocation back to the roadmap to
resume the original standalone and combined pool-swimming delivery. A Stockholm
test project and separate empty rehearsal destination were provisioned, but no
live data was exported or restored, no source database objects/settings were
changed, and Vercel's live region was not changed. Rehearsal resources are paused
to return free-plan capacity to swim testing. The roadmap records the remaining
approval, access, restore and cutover gates; production remains in Dublin.

## [2026-09-05] refine | Native pool swimming contracts and evidence

Added the original pool-swimming knowledge page and DC-SW1 through DC-SW9.
Separated native course arithmetic, optional 200/400 assessment, bounded
heuristics, immutable issued history, lifecycle and shared workload contracts.
The independent evidence supports directional choices, not universal safe ramps,
injury probabilities or adult-novice critical-speed validity. Added explicit
outcome signals and revision thresholds for uncalibrated dose/rest/progression
rules. This records implementation contracts, not production migration or
completed database/browser acceptance. Combined cardio-slot binding remains the
next slice.

## [2026-09-05] refine | Standalone swimming implementation and acceptance boundary

Connected standalone setup, optional assessment, multiweek workouts, native
actual logging, FIFO offline completion, reviewed next-week decisions and
pause/resume/history to Today and Plan. Structured results feed the existing
load ledger once and are included in personal exports. Additive migration 0145
includes authenticated atomic writes, ownership checks and an empty-only
rollback; no remote migration has been applied.

Local domain/engine, web, typecheck, build and static mobile/desktop review
support integration confidence only. The dedicated test still needs owner-local
database/admin credentials, migrated catalog data and genuine authenticated
database/browser acceptance. Setup remains off by default; standalone is not
release-proven. Combined cardio-slot content and Garmin remain separate work.

## [2026-09-05] refine | Readable poolside controls and review fixes

Replaced storage-shaped pool/event inputs and split text entry with ordinary
distance inputs and optional split rows. Compact set groups preserve existing
repeat-progress identities, with mark-next/undo and individual controls; result
summaries show actual native distance. Failed form submissions retain inputs.
Independent review also closed per-slot time-budget loss during reissue,
inactive-plan skip mutations, and unnecessary cardio-history blob reads.
Local checks do not replace the still-pending real database/browser acceptance.

The existing Vitest runner now has its matching coverage provider and a
`test:coverage` command enforcing the 80% contract across the full domain and
engine packages.

## [2026-09-06] verify | First real Postgres/RPC acceptance pass, cloud-only

Added a narrow, loopback-only local test mode to the RPC and Playwright
hosted-ref guards (`SWIM_RPC_TEST_LOCAL`/`E2E_SWIM_LOCAL` +
`SWIM_TEST_PROJECT_REF=local`), keeping the existing hosted-ref guard
unchanged otherwise. Used it to run the full migration chain, the movement
catalog seed, and the `storage-rpc.smoke.test.ts` suite against a disposable,
synthetic Postgres/Auth/REST stack for the first time (19/24 passing with
real SQL/RPC round trips). Found one reproducible test-fixture bug (an
expected error code unreachable due to constraint-check ordering) and one
reproducible suspected hang (repeating `swim_update_plan` with stale
arguments) — neither fixed yet; see HANDOFF.md for detail. Playwright and the
`packages/db/integration-tests` RLS/region-ledger scripts were not reached.
Narrowly fixed the movement-catalog seed's TLS handling
(`packages/db/seeds/db-ssl.ts`) to allow disposable loopback Postgres without
weakening the hosted/`verify-full` default. No production, billing, or merge
action taken.

## [2026-09-06] refine | PR802 limited guard, fixture and acceptance reporting follow-up

Bound local E2E fixture/app URLs to the same normalized origin and isolated
ownership, composite FK and duplicate-session RPC assertions (DC-SW8), retaining
independent primary-program isolation (DC-SW7). The existing web Vitest runner
passed 108 pure guard cases. Documented its unchanged 20-second timeouts and
per-case JSON command in the swim wiki. Revised RPC assertions remain unexecuted:
the reporter attempt failed before collection on an unresolved dependency;
frozen install also encountered unavailable checked-in tarball hosts.

One bounded official Supabase CLI/Docker attempt exited during schema
initialization; no healthy reference stack or fresh database acceptance was
obtained. The terminal initialization cause was not retained, and the prior
stale-update hang is still undiagnosed. See HANDOFF.md for evidence limits.
No SQL/grant/migration, workflow, hosted database, combined-mode or merge changes.

## [2026-09-06] refine | Fail-closed swim RPC acceptance reporting

The web RPC command now overrides `passWithNoTests` and validates its JSON with
existing Node/tsx tooling. The ledger requires the exact smoke file, at least 30
unique passing cases and consistent explicit Vitest 2.1.9 counts, including
nested-suite counters; missing, malformed, partial and non-passed reports fail.
Focused existing-runner tests cover the reporting gate independently of database
readiness. The printable ledger records SHA/config/case evidence without raw
failure messages; original diagnostics remain private until scrubbed.
This reporting refinement is not fresh RPC, mobile or shared-load acceptance.

## [2026-09-06] verify | Approved loopback reference startup blocked before application acceptance

At source `c811a505d4a6b2b06f5d55f1b3b97753aa415cf1`, verified PR802's
approved plan/authority hashes and recorded all 30 RPC cases plus the broader
ADR0079/DC-SW1–SW9 acceptance criteria before execution. Offline frozen
installation succeeded. One official CLI 2.116.0 startup on the approved
task-owned, loopback-publishing, default-NAT bridge exited 1 after 98.79 seconds:
Storage bootstrap failed resolving the project database container name
(`getaddrinfo EAI_AGAIN`). Postgres had reached readiness; no application
migration/catalog, RPC, mobile or shared-load acceptance ran. This is retained
platform-startup evidence, not a SQL failure or diagnosis of the stale-update
hang. No retry or substitute network/stack followed.

Captured project-container membership and the sole published loopback mapping,
retained private diagnostics and image digests, then verified removal of all
three task containers, the database volume and the exact bridge. Full service
readiness and external reachability were not established. See
[`HANDOFF.md`](../../HANDOFF.md#latest-pr802-runner-local-reference-acceptance)
for evidence limits and the explicitly unmet criteria. Only acceptance
documentation changed; no runtime/SQL/grant/dependency/workflow, combined-mode,
merge or deployment action was taken.

## [2026-09-06] verify | Prearmed reference observation narrows bootstrap hypotheses

At `ebe4a672a13b86f7490acd7c001463c45a6d31ea`, executed approved PR802
plan 5559384497 with live project-container and exact-network event streams
armed before one official CLI 2.116.0 startup. It exited 1 after 64.28 seconds,
without retry: Storage again reported DB-name `getaddrinfo EAI_AGAIN`.
During Storage execution the DB advertised the expected DNS name and remained
on the same network until after Storage failed. This contradicts H1/H2 at the
observed metadata/timeline level, not proof of working DNS. All three generated
resolver files were captured without exec and matched; H3 remains unresolved.
No application migration, RPC, mobile/offline or shared-load acceptance ran;
the full pre-execution inventory remains unmet. The CLI removed the exact task
containers, volume and bridge, verified absent within the total bound. See
[`HANDOFF.md`](../../HANDOFF.md#latest-pr802-runner-local-reference-acceptance)
for timestamps, hashes, image-reference differences and capture limitations.
No runtime, SQL, fixture, dependency, workflow or environment-policy repair.

## [2026-09-06] refine | Implement isolated manual swim reference acceptance

Implemented coordinator authorization 5560014710 on PR802: existing CI manual
inputs, isolated non-cancelling swim concurrency, an expected-SHA preflight,
guarded official disposable-stack orchestration and focused pure Vitest tests.
The runner reuses the canonical local-target/report helpers, checks unchanged
migrations/catalog and records sanitized stage/ledger evidence with exact-resource
cleanup. HANDOFF and the swim wiki describe the coordinator's review/dispatch
boundary. No workflow dispatch or database startup occurred in this implementation
turn. No runtime swim, SQL/schema/RLS/grants, fixtures or dependencies changed;
the broader standalone acceptance inventory remains unmet.

## [2026-09-06] refine | Preserve safe acceptance failures and private command output

Corrected the reporting and log-writer defects in the
[acceptance runner@ecb267f](https://github.com/drrowdev/hybrid-training-app/blob/ecb267f239d08a13a0e10dbeec4648c09983054d/apps/web/scripts/swim-acceptance.ts)
under PR802 authorization 5560307838. Locally authored guard reasons are distinct
from withheld parser/error details; primary, source-verification and cleanup
failures remain separate. Command logs use exclusive append creation with 0600
permissions. Production-used helper regressions and unchanged canonical-helper
tests passed (183 tests); web typecheck, scoped ESLint and secret scanning passed.
CodeQL found no Actions alerts; JavaScript analysis was skipped because its
database was too large, so that scan remains unverified. No workflow dispatch,
database/container execution or live acceptance occurred. Standalone
release acceptance remains outstanding; coordinator review is next.

## [2026-09-06] refine | Mirror safe swim acceptance summaries to job stdout

Under PR802 authorization 5560545875, the
[reporting path@33ec5343](https://github.com/drrowdev/hybrid-training-app/blob/33ec5343d6a018327678fa0f7a40a6f0ed853c52/apps/web/scripts/swim-acceptance.ts#L61-L64)
now publishes the same sanitized/escaped summary to stdout with the literal
`[swim-acceptance-summary]` marker before appending `GITHUB_STEP_SUMMARY`.
Append failures still throw; existing primary/secondary/cleanup handling remains.
All 185 targeted helper/report/config tests, web typecheck and scoped ESLint
passed in the cloud workspace. No helper, database or workflow was executed.
For failed run 34044560802 at that source SHA, the primary cause, database stages
reached and cleanup outcome remain unobserved. No workflow, guard, runtime swim,
SQL, dependency or network changes; standalone acceptance remains outstanding.

## [2026-09-06] refine | Handle absent Docker Health in selected inspection

Under [PR802 authorization 5560849623](https://github.com/drrowdev/hybrid-training-app/pull/802#issuecomment-5560849623)
(verified UTF-8 SHA-256 `f066c6317268982f52387e7e809279a971ee5373c5a9524cd5571a7c41952c0e`),
corrected the [selected template@fcb1003](https://github.com/drrowdev/hybrid-training-app/blob/fcb100353077af1c12c80dd89bebe7db89106219/apps/web/scripts/swim-acceptance.ts#L30-L36)
to use optional-map `index` lookups, retaining `.Id` for Docker's JSON-map fallback.
[Docker CLI v28.0.4 source@b8034c0](https://github.com/docker/cli/blob/b8034c0ed70494a90c133461d145cd072d920d7c/cli/command/inspect/inspector.go#L99-L134)
confirms strict missing-key handling after typed execution fails.
[Run 34046741441](https://github.com/drrowdev/hybrid-training-app/actions/runs/34046741441)
passed core CI, identity and default-service startup (exit 0, no timeout,
`EAI_AGAIN` false), then failed inspection/readiness with process exit 1 before
migrations/catalog/RPC. Four Health-bearing snapshots and 11 unavailable
observations do not establish a Health-less service count; raw Docker stderr
was not retrieved, so exclusive runtime causation is unproven. Cleanup remains
unconfirmed. All other selected fields, guards and stdout reporting are unchanged.
All 197 targeted helper/report/config Vitest tests, web typecheck and scoped ESLint
passed. Fixtures/static-template checks do not execute Docker's Go renderer.
No runner, Docker/Supabase/database execution, workflow dispatch or merge occurred;
coordinator review and a later exact-head run must verify rendering and cleanup.
Full standalone acceptance remains outstanding; no DC-SW1–SW9 contract changed.

## [2026-09-06] refine | Classify official bootstrap jobs only during startup

Implemented [PR802 authorization 5561109891](https://github.com/drrowdev/hybrid-training-app/pull/802#issuecomment-5561109891)
(verified UTF-8 SHA-256 `fa4881aee0995da3b45921c4f0c8fb930629c39c35afd3126fadcb50d238c2ee`).
[Run 34049409389](https://github.com/drrowdev/hybrid-training-app/actions/runs/34049409389)
at `f57f16ab9ebc29f2c2f3bbb0fba8d9a4323ee97b` stopped on an official unnamed
Realtime bootstrap job, not unsafe publication or DNS failure; optional-Health
inspection and both cleanup paths succeeded. The
[observer@f57f16a](https://github.com/drrowdev/hybrid-training-app/blob/f57f16ab9ebc29f2c2f3bbb0fba8d9a4323ee97b/apps/web/scripts/swim-acceptance.ts#L334-L374)
now uses a separate startup validator: both exact project labels, the existing
single-network/mode check, no host publication, volume-only mounts and nine exact
approved image references with at most one valid SHA-256 digest suffix.
`/supabase_` names still take the original named path; the
[13-service readiness contract@f57f16a](https://github.com/drrowdev/hybrid-training-app/blob/f57f16ab9ebc29f2c2f3bbb0fba8d9a4323ee97b/apps/web/scripts/swim-acceptance-guards.ts#L131-L143)
and ownership-checked cleanup are unchanged. The first safe classified violation
is retained before stopping startup. All 271 targeted helper/report/config Vitest
tests, web typecheck and scoped ESLint passed; fixtures/static wiring are not real
Docker/DB acceptance. No runner, Docker/Supabase/DB, workflow execution or merge
was performed. Coordinator delta review and a later exact-head run remain pending;
migrations/catalog/RPC and full standalone acceptance remain unproven.
No DC-SW1–SW9, image/runtime/network configuration or swim-feature change.

## [2026-09-06] refine | Correct our pinned-default service assumption

Implemented [PR802 authorization 5561453075](https://github.com/drrowdev/hybrid-training-app/pull/802#issuecomment-5561453075),
with its UTF-8 body hash verified. Our prior 13-service assumption (including the
historical entry above) incorrectly treated optional imgproxy as a default.
The [native init/template/gate sources@997a1e6](./pool-swimming.md#pinned-default-service-contract)
establish exactly 12 services. The runner now validates the fresh generated
config before startup and retains current inspected service-name differences
before readiness, without changing service flags or any health request.
Exact service/membership, ownership, publication and cleanup checks remain.

[Run 34051805797](https://github.com/drrowdev/hybrid-training-app/actions/runs/34051805797)
at `9257aeb20582edf681aac49b2a00d3a5f9efc226` passed core/identity, official
startup and cleanup, then failed the old exact-set assertion before application
migrations/catalog/RPC. Historical snapshots are not current membership or
exclusive-causation proof. All 317 targeted helper/report/config Vitest tests,
web typecheck and scoped ESLint passed; these are not Docker/DB acceptance.
No runner, container/database execution, workflow dispatch or merge occurred.
All 146 migrations/catalog, 30 actual RPC cases and the frozen standalone
DC-SW1–SW9 inventory remain required. No acceptance waiver, workflow, SQL,
dependency, runtime/image/version/network change; coordinator review is next.

## [2026-09-06] refine | Add safe RPC failure diagnostics without changing acceptance

Implemented [PR802 authorization 5561913579](https://github.com/drrowdev/hybrid-training-app/pull/802#issuecomment-5561913579)
at source `27971943ca9b34fa75d85c57793f1e74b667a7e3`; its exact API body
SHA-256 matched `7431dc1bbb483fb71a571569e040e6398ca246b4382d8d77dbb7e7899c8119c2`.
[Run 34054970331](https://github.com/drrowdev/hybrid-training-app/actions/runs/34054970331)
passed core/identity, official 12-service readiness, existing HTTP probes, all
146 unchanged migrations, catalog seed/consistency and cleanup. RPC execution
was **2/30 passed, 28 failed, none pending/todo, no process timeout**. Many failures
share `createPlan`; root cause remains unknown. Earlier run facts above remain
historical evidence, not the latest result.

The third Vitest reporter writes a bounded exclusive private sidecar; its reader
publishes only validated classifications, canonical case/phase/RPC associations,
allowlisted context and normalized-message SHA-256 groups through the existing
sanitized summary. Missing, invalid, overflow and collector-failure evidence is
explicit. Canonical JSON, process result, minimum 30-case gate, existing health
requests and cleanup remain unchanged. No SQL/schema/access policy, workflow,
RPC suite/config/payload/assertion, dependency or runtime feature changed.

All 391 targeted workspace helper/report/config tests, web typecheck and scoped
lint passed; synthetic reporting fixtures are not real swim acceptance.
No Docker/Supabase/database execution, workflow dispatch/rerun or merge occurred.
Independent exact-head review precedes the coordinator's next new-head run.
The full standalone DC-SW1–SW9 inventory remains required before combined work.

## [2026-09-06] refine | Correct RPC diagnostic identifier and denial context

Implemented [PR802 authorization 5562164313](https://github.com/drrowdev/hybrid-training-app/pull/802#issuecomment-5562164313)
at source `418beb8f662a7f8267609d73fac9c4b32a7452f3`; exact API body SHA-256
matched `619b805adb8f0fc776dce98baa57f40ca2a714cad58abfce6770692d197baeaf`.
[Run 34059019498](https://github.com/drrowdev/hybrid-training-app/actions/runs/34059019498)
passed official default-service startup/readiness, all existing HTTP probes,
146 unchanged migrations, catalog consistency and cleanup. RPC outcomes remain
**2 passed, 28 failed, none pending/todo, no process timeout**. Complete diagnostics
with zero invalid records show one shared `42501` permission fingerprint and
`swim_create_plan`; the denied object remains unknown. Static grants do not prove
runtime privileges; missing `P0001` does not prove `auth.uid()` completed.

Only the reporter/projector, its focused tests and status documentation changed.
The compile-time vocabulary now includes source-anchored schemas, helpers,
validators and related objects. Closed `deniedKind` follows the selected `42501`
cause's bounded message and appears only in associations. Unknown permission kinds
are counted separately from invalid records/collector failure. Exact membership,
strict validation, private-file/bounds/no-throw guarantees and the original
code/category/fingerprint group key remain; canonical JSON, 30-case acceptance,
outcomes and cleanup are unchanged.

All 458 targeted reporter/helper/report/config tests, web typecheck and scoped
lint passed in the coding workspace. These are synthetic reporting checks, not
live acceptance. No database/container/workflow execution, SQL/access-policy
repair, feature work or merge occurred. Independent exact-head delta review
precedes one new-head run through the unchanged reference workflow. If richer
context still lacks a relevant target, stop vocabulary passes and propose bounded
read-only privilege evidence. Any remedy needs owner approval and a reviewed
additive migration with rollback. Full standalone DC-SW1–SW9 acceptance remains
required before combined implementation.

## [2026-09-06] refine | Add bounded read-only auth privilege evidence

Implemented [PR802 authorization 5562400372](https://github.com/drrowdev/hybrid-training-app/pull/802#issuecomment-5562400372)
from `fc364e2534e361c378e0f88a887c3504b44bc009`; exact API body SHA-256
matched `75145b0b21f9a2196dcff9aca3782859c68fdbf7f8b7f663d848879164fb5f86`.
[Run 34061180463](https://github.com/drrowdev/hybrid-training-app/actions/runs/34061180463)
passed core/identity, official default-service readiness, 146 unchanged migrations,
catalog consistency and both cleanup paths. RPC remains **2 passed, 28 failed,
none pending/todo, no timeout**; all failures identify schema `auth`, with zero
invalid records or unknown permission kinds. Runtime grant authority remains
unobserved; no further reporter-vocabulary change is needed.

The [fixed observation](./pool-swimming.md#read-only-auth-privilege-evidence)
uses the existing verified private postgres channel between catalog checks and
RPC, with READ ONLY, a 5-second statement timeout, a 10-second command maximum
within existing deadlines, and unchanged capture/termination bounds. Only strict
booleans/closed enums enter the sanitized manifest. Missing/ambiguous objects,
duplicate fields/settings, malformed output and process failures become explicit
unavailable evidence. The original RPC gate, reports, process outcome and cleanup
remain authoritative. Effective EXECUTE is not proof that migration 0145 granted it.

All 293 targeted acceptance-helper tests, web typecheck and scoped lint passed.
These are synthetic reporting tests, not live privilege or standalone acceptance
evidence. No database/container/workflow execution, access repair, migration,
feature/UI work, service/network change or merge occurred. Independent exact-head
review and fresh guards precede one new-head manual run; insufficient evidence
requires reassessment, not an identical rerun or diagnostic expansion. Any access
correction remains a separate owner decision with reviewed additive migration and
rollback. Standalone DC-SW1–SW9 acceptance remains required before combined work.

## [2026-09-07] refine | Swimming identity integration Slice A

Implemented [Slice A](https://github.com/drrowdev/hybrid-training-app/pull/802#issuecomment-5566040440)
and its [reviewed integration contract](https://github.com/drrowdev/hybrid-training-app/pull/802#issuecomment-5566040448).
Core `5e3c938f23fcefcca5e51f09937e93ee68d92664` is independently accepted;
0146/down/journal/core tests are unchanged. The runner now requires 147 migrations
and observes the closed helper/service/ten-function contract, retaining evidence
on legitimate helper absence and identifying default PUBLIC ACLs as unsafe.
Boundary enforcement follows the attempted canonical RPC stage, preserving RPC
as primary on failure and separately recording failed boundary evidence.

All 315 focused helper tests, web typecheck and scoped lint pass. These are
synthetic/source checks, not runtime repair proof; the original 30 RPC tests were
not modified or executed. Last actual run 34063418887 at
`1af9874f7e88700a2b8687beadffd79b28818d59` remains 2 passed / 28 auth-schema
failures. [Current status](./pool-swimming.md#identity-integration--slice-a-current-status):
Slice B and real 147-migration/native-RLS/RPC/service/down-up proof remain pending.
No database/Docker/Supabase/workflow execution, service/network/dependency change
or merge occurred. No Slice-A-only manual run; exact-head review of the complete
integrated proof bundle precedes execution. Full standalone DC-SW1–SW9 acceptance
still precedes combined swimming; Garmin remains later.

## [2026-09-07] refine | Swimming identity integration Slice B

Implemented [Slice B](https://github.com/drrowdev/hybrid-training-app/pull/802#issuecomment-5566424679)
on accepted Slice A `45533beb`, preserving accepted core0146/down/journal/tests.
Runtime checkpoint `39519785` adds one exact source-verified down/up round trip
through the same owned private postgres channel, three isolated service cases
per phase, private normalized ten-function ACL comparison and deferred proof
enforcement after restored-state RPC. Procedural DDL/consistency failures stop;
ordinary failed evidence cannot mask the canonical RPC attempt after restore.
Three additive HTTP helper-access cases are required after the unchanged
canonical gate, including service callability; no original case was changed.

Focused synthetic helper/config/report tests, typecheck and scoped lint are not
real runtime proof. The original HTTP suite was not executed. Last actual run
34063418887 at `1af9874f7e88700a2b8687beadffd79b28818d59` remains **2 passed /
28 auth-schema failures**. Real147/native-RLS/RPC/service/down-up proof remains
pending after independent exact-integrated-head review and coordinator-only
temporary execution. No database/Docker/Supabase/workflow execution or merge
occurred. [Current status](./pool-swimming.md#identity-integration--slice-b-current-status).
Standalone DC-SW1–SW9 acceptance still precedes combined swimming; Garmin is later.

## [2026-09-07] refine | Shared completion 148 remainder integration

Completed the [approved remainder](https://github.com/drrowdev/hybrid-training-app/pull/802#issuecomment-5569058128)
on accepted runtime `b338e0d7`, with coherent HTTP/proof checkpoint `df790b09`.
Original 30 RPC cases and accepted runtime/SQL remain unchanged. Authenticated
helper access now asserts Alice's/Bob's exact own IDs; anonymous helper denial
and service UUID-or-null callability remain. Three shared HTTP cases add owner
non-swim completion/receipt/replay, cross-owner empty-result/non-mutation and
anonymous denial. Six mandatory names require 36 cases; collection-only inspection
found 36 unique cases (33 literal `it` declarations plus three parameterized rows).

Closed 146/147/148 expectations and ordered 0147 down/0146 down/0146 up/0147 up
retain five phases and 15 service contexts. Added negative tests flip all 11
shared fields at each level, cross-check 147↔148, and independently mismatch
restoration while restored147/restored148 boundaries match.
526 focused static migration/helper/round-trip/config/report tests, web typecheck
and scoped ESLint passed. The 148 integration is implemented but **has not run
against the real temporary stack**; last actual147 run 34096598017 remains
**24/33 passed**, and `40001`/remaining completion behavior are not proved resolved.
No database/Docker/Supabase/workflow execution or merge occurred.
Exact-head review and subsequent temporary execution remain coordinator-owned.
[Current status](./pool-swimming.md#shared-completion-integration--current-148-status).
Full standalone DC-SW1–SW9 acceptance still precedes combined swimming and Garmin.

## [2026-09-07] refine | Shared completion syntax repair and normal acceptance restoration

Nonqualifying [run 34137048733](https://github.com/drrowdev/hybrid-training-app/actions/runs/34137048733)
at `07ef1d5e4a695352621d1c945050d137c2aa3413` localized complete structured native
SQLSTATE `42601` to phase `migrate`, migrationIndex `147`, statementIndex `0`,
without SCID. Shutdown and main/final cleanup closed; Core CI passed; no HTTP
cases executed. The syntax-only up/down repair parenthesizes the shared-body-hash
IF CASE so its internal THEN does not terminate the PL/pgSQL condition.
Historical hashes remain pinned; no function body, attribute, ACL or journal
changed, and the evidence does not establish an ACL cause.

Normal acceptance is restored in source; the diagnostic branch remains dormant
and unchanged. Evidence tests gate only POSIX-private-file fixtures on Windows
and pin both unchanged migration scripts. Focused static checks do not establish
runtime acceptance. Ordinary acceptance remains pending exact-head review and
coordinator-owned execution. No database/container/workflow execution or merge
occurred in this repair.
[Current status](./pool-swimming.md#shared-completion-integration--current-148-status).

## [2026-09-07] refine | Exact anonymous completion ACL correction and caller guard

[Run 34154417199](https://github.com/drrowdev/hybrid-training-app/actions/runs/34154417199)
at `4b1f51afffa4976c26016097ca939661e9417112` produced complete `P0001` at
147/0, `SCID` acl/pre/shared `ftfttttt`: direct `anon`/`PUBLIC` grants exist,
the old exact set fails, and grantor/EXECUTE/no-grant-option shape matches.
Other grantees are not ruled out. Coherent 0147 up/down now require the exact
prior set including both anonymous grants, revoke both on up, and restore the
normalized prior grants on down; raw ACL ordering is not promised. Historical
hashes and strict abort conditions remain pinned; helper/body/RLS/journal are
unchanged.

Completion returns the existing auth result before RPC only for positively
absent identity, including the official missing-session error. Other Auth errors
retain the cookie-bearing RPC path; signed-in permission errors remain transient.
Normal acceptance is restored in source. 522 focused synthetic/static tests,
web typecheck and scoped lint passed; runtime acceptance remains pending
exact-final-head review and the coordinator's ordinary 148 run. No database/
container execution, workflow dispatch/rerun or merge occurred here.
[Current status](./pool-swimming.md#shared-completion-integration--current-148-status).

## [2026-09-07] refine | PR803 browser finishing integration

The coordinator confirms the database milestone passed. Code checkpoint
`230f09b0` wires the first four-case browser execution: R1 sealing after command
reaping, process-primary failure projection, workflow control-path/child-env
separation, pinned installation checks, consumed-source coverage, and awaited
shutdown with slow success distinguished from genuine failure. R1 is unchanged.
All 575 focused stage/acceptance/helper tests, web typecheck and scoped lint
passed on the GitHub runner; no browser/database execution or workflow dispatch
occurred here.

Real browser reference remains pending the coordinator's combined R1+R2
exact-head review and core CI in parallel, then **one normal-148 +
four-browser-case reference** after all gates and fresh checks. These static
results establish neither full standalone DC-SW1–SW9 nor production acceptance.
[Current status](./pool-swimming.md#shared-completion-integration--current-148-status).

## [2026-09-07] refine | PR803 collection-only loader regression and shutdown fix

The pinned real Playwright `--list` regression reproduced exit 1 along the
config/browser-helper/reporting/migration-evidence import boundary (loader code
unknown). A pure extraction retains the same authored-error WeakMap and reporting
exports; collection now exits 0 with exactly four known mobile cases and no
executed results. Next 16.2.6 own-stop exit 143 is separately pinned and tested.
Report absence is distinguished only after ticket/root validation; symlinks and
other file errors remain rejected. 256 scoped tests, web typecheck and scoped
lint pass. No live reference, server, browser, database or workflow dispatch ran.

## [2026-09-08] refine | PR805 first expanded swimming cohort wired; live pending

The first-four milestone passed in
[run 34176424048](https://github.com/drrowdev/hybrid-training-app/actions/runs/34176424048)
at `4f2aa4af480f61df83bbc38b09f29afbbbf5729b`, including normal 148 migrations,
15 service contexts and 36 HTTP cases. Opus 5 turn 19 accepted integration and
turn 20 accepted both A source cases.

Checkpoint `3c060e3d` wires exactly the unchanged original four plus A1
([DC-SW7](./hybrid-training-design-constraints.md#sw-native-pool-swimming-adr-0079-2026-09-05))
and A2 (DC-SW9). Strict catalog-derived collection and execution gates require
six cases across three files, with no missing, skipped, retried or flaky cases.
A1 status assertions use the current-plan summary; A2 is unchanged. Safe success
and failure ledgers include bounded measured final-attempt `durationMs` and
attempt count, not a duration guarantee. Existing execution limits are unchanged.

686 targeted helper/collection/runner tests, web typecheck and scoped lint passed.
The real pinned `--list` collected six identities without execution. Secret
scanning passed; CodeQL analysis was skipped because its database was too large.
No live browser/app-server/database/container run or workflow dispatch occurred.
Six-case live acceptance remains pending coordinator-owned final exact-head
Opus review, core CI, fresh guards and one reference on this branch. B/C remain
unselected; this does not complete all nine gates or establish production
acceptance. [Current status](./pool-swimming.md#shared-completion-integration--current-148-status).

## [2026-09-08] refine | PR805 narrow A recovery; new-head live pending

[Run 34182254665](https://github.com/drrowdev/hybrid-training-app/actions/runs/34182254665)
on `a67123db2f237b82b378c1eb0b9070adb45155c1` passed normal 148 migrations,
15 service contexts, 36 HTTP cases and the original four browser cases; cleanup
was verified. A1 failed at the checked `deleteUser` error assertion in 8.596s;
A2 failed at Log swim visibility after Start in 7.809s. Not test timeouts;
actual error values and causes remain unknown.

Code `4e778395809c88504cd2379b0c189712af642547` corrects A1 to read exactly
one existing global `bench-press-flat` row, preserving all five nonempty primary
snapshots and checked cleanup. Start swim now gates on readiness; its specific
SSR-disabled regression fails before the fix and passes after it. A2 polls the
owned saved workout for `started` and a nonempty session link before its unchanged
Log swim assertion, retaining all native/region/oracle comparisons. This does
not establish the exclusive A2 cause. **Custom-movement account-deletion
regression remains OPEN in C as a privacy/release concern**, not fixed or passed.

265 targeted component/pure tests, web typecheck, scoped lint and secret scanning
passed on the GitHub runner. CodeQL analysis was skipped because its database
was too large. No live browser/server/DB/Docker run, credential access, CI
dispatch, schema/access-rule or limit change occurred in this recovery.
Final exact-head Opus review, core CI and fresh guards precede one new-head
six-case live reference; no new live acceptance is claimed. B/C remain
unselected. [Current status](./pool-swimming.md#shared-completion-integration--current-148-status)
and [DC-SW3/SW7/SW9](./hybrid-training-design-constraints.md#sw-native-pool-swimming-adr-0079-2026-09-05).

## [2026-09-08] refine | PR805 exact B integration after the live six-flow milestone

The immutable `e46c443e8e06cb31616cb6082c3d0fbbbca7c050` six-flow milestone passed
[core 34243771485](https://github.com/drrowdev/hybrid-training-app/actions/runs/34243771485)
and [full 34244354544](https://github.com/drrowdev/hybrid-training-app/actions/runs/34244354544)
(terminal 15:29:26Z). Six cases passed once, zero skipped/flaky/unexpected, in
6844/4962/5278/9967/6815/7525ms; native16, normal148/catalog/5phase4DDL/15contexts/
36HTTP and main/final cleanup passed. No full standalone or release claim.

Code checkpoint `8e5a4a155f6e94a5c4f201074dbd74cdd1c4ca8a`, tested tree
`03f8053d578dd3525587445e6e0ee948989b6099`, imports PR806 head
`32947ae5eb9e99070006e3a74b5c4df0a33dce60`'s exact B blob
`f16b37ee260135344db8adf171f33f57640eef75`. B1/B2 extend the unchanged six with
[DC-SW4/SW5/SW8](./hybrid-training-design-constraints.md#sw-native-pool-swimming-adr-0079-2026-09-05),
preserving A's SW7/SW9 regional-row proof. Closed attribution adds only the B
spec, swim-queries and outbox-core IDs; every declared spec is fingerprinted
inside the single tracked-file invocation. Existing diagnostics and limits remain.

735 targeted tests, actual pinned CLI collection (eight exact triples/four files,
zero results/errors, normal skip policy, private cleanup), web typecheck, scoped
lint and secret scan passed. This is source/collection-only, not live-eight
acceptance. B2's 30s and setup overhead remain unmeasured. No runtime/DB/CI dispatch,
additional agent, product change or branch/stack operation occurred. PR806 remains
frozen source, not a future merge candidate; coordinator closure can follow live
acceptance. PR803/807/808 remain untouched. Wider progression variants and full
standalone gates remain required; see [current status](./pool-swimming.md#shared-completion-integration--current-148-status).

## [2026-09-08] refine | PR805 exact C/D integration with collection blocked

The real eight-flow milestone `95cbfb537884e65e2ec3ba6b67cf3c7ff303628a` passed
[core 34258052509](https://github.com/drrowdev/hybrid-training-app/actions/runs/34258052509)
and [full 34258502119](https://github.com/drrowdev/hybrid-training-app/actions/runs/34258502119)
(17:44:42Z). All eight passed once, zero unexpected/skipped/retried/flaky-labelled
cases, in 5039/2831/4215/7711/4466/5175/3274/4474ms (37185ms total).
Native16/all148/catalog/5phase4DDL/15contexts/36HTTP, core/main/final cleanup passed.
The prior A1 Preview click timeout remains unexplained; preserve its shared 5s
checkpoint and all eight regressions. PR806 is closed unmerged as superseded,
with branch32947 retained. All nine standalone gates remain incomplete.

Code commit `2e831c2313689f44424811aa3ff439be35ebac22`, tested tree
`3ab5bd91777c36b62916f556be7ad635c38751a3`, preserves exact C/D source:
PR807 `327444f02c1849e26b89051c9c755411a0fb760a`, account blob
`045205b5852cbd36f613286cad7465531f7ba03b`; PR808
`bddddd16e355ce5df5a9dcbf50e81c272503b583`, assessment blob
`a2f19c74c1cac7534fed57c67bb7a83e068e5011`. Append C1/C2/D only, eleven identities
across six files (2/2/2/2/2/1), three closed attribution IDs, current-stage
server-only captured local-key binding and its reviewed tests. Preserve the
single fingerprint call, all newer lifecycle tests, limits and privacy protocol.
[DC-SW2/SW5/SW6/SW8](./hybrid-training-design-constraints.md#sw-native-pool-swimming-adr-0079-2026-09-05)
are the new source coverage; SW7/SW9 remain unchanged.

One targeted four-file run: 771 tests passed, one collection regression failed.
Actual pinned Playwright 1.60.0 `--list` used the same dedicated config; safe summary
was `success=false`, exit 1, loader unknown, account-spec attribution. Eleven
exact collected triples/six files, no report errors/results and successful checked
private cleanup remain unproved. No cause is established or source/loader repair
attempted. Typecheck/scoped lint/secret scan passed. CodeQL did not complete
(Actions failed; JavaScript database too large). No live browser/app/server/DB/
Docker/CI invocation, additional worker or branch/stack change occurred.

C2 remains open, with the custom movement and both references preserved until
the real Account Delete action; no cascade/FK cause or survivor proof is claimed.
D's positive rejection/acceptance/history case is unchanged and unexecuted.
Resolve collection before coordinator complete-head review/core/fresh guards and
one normal Native16/14836/eleven-browser reference. PR807/808 stay frozen, unmerged.
No full standalone or production-readiness claim. See
[current status and follow-up bounds](./pool-swimming.md#shared-completion-integration--current-148-status).

## [2026-09-08] refine | PR805 account media scope restores eleven-case collection

Source commit `e2e4862bed308e4ea1270b50d6aaac9bac565ba6`, tested tree
`84f95c16324bdeb903ad5acbc49b539817233f24`, moves the unchanged account privacy
comment and mobile/media `test.use` to file scope; only the obsolete three-line
header is removed. Pinned Playwright 1.60.0 declares media options worker-scoped
in `packages/playwright/src/index.ts`; `common/poolBuilder.ts` disallows worker
fixtures in describe-level use and `common/fixtures.ts` rejects them. No private
error text was read. Ordered trimmed non-empty comparison against `d5936320`
passed (439 lines), exact expected bytes matched, and the actual diff was inspected.
New C blob `911c4ca2c32bea51e6b709311f7752aac34a25af` is intentionally no longer
`045205b5`; D remains `a2f19c74c1cac7534fed57c67bb7a83e068e5011`.

Existing dedicated pinned `--list` regression passed eleven exact triples/six
files, zero executed results/errors and checked private cleanup. Safe summary:
`success=true`, exit 0, `loaderCode=unknown`, `sources=[]`. Web typecheck, scoped
lint and source secret scan passed. The earlier exit-1/account-attribution failure
and 771 passing targeted tests remain historical facts, not rerun results.
No cases executed and no app/account-deletion/cascade failure was observed here.
All fixture/body ordering, A1 checkpoint, original eight, registry, server-only
local-key binding, configured workers/retries, budgets and cleanup remain intact.
No browser/app/server/DB/Docker/CI execution or additional agent was started.

Coordinator next: actual Astra START+TERMINAL/artifact even on failure, then one
complete integration+remainder exact-head Opus review and core-only CI. Only an
accepted full head/core and fresh execution guards permit the first normal
Native16/14836/eleven-browser reference. C2 and all wider standalone gates remain
open; no runtime or production-readiness claim. See
[current status](./pool-swimming.md#shared-completion-integration--current-148-status).

## [2026-09-08] refine | PR805 positive Auth-API deletion boundary C3

Code `bc4ce939ea610563ac515540ac46371eb4572d77`, tested tree
`a247d1df538a01c76cb1ac329837d989fa95e860`, appends only C3 to the existing account
spec and casebook. Original eleven UI identities/order remain (C2 index9, D
index10); C3 index11 is a direct Auth-API acceptance case, not a twelfth UI flow.
Twelve cases/six files have counts 2/2/2/2/3/1. Fresh isolated native-only and
custom-linked accounts reuse unchanged arrangements; each direct deletion must
return no error and prove Auth404/owned-row absence, with linked data intact after
the control deletion. Inline outcomes preserve existing safe source attribution.
No C1/C2/D/fixture/product/SQL/RLS/configuration or diagnostic-protocol change.
Old4/6/8/11 reports and total-preserving missing-C3/D substitutions remain rejected;
duplicate mutation now handles one/two/three-case files.

All 414 targeted helper/collection tests passed after adding the missing twelfth
empty annotation pin. Actual pinned Playwright 1.60.0 `--list` proved twelve exact
identities/six files, zero executed results/errors and checked private cleanup.
Web typecheck, scoped lint, diff check and secret scan passed. Commit author and
committer were explicitly set and verified as Copilot with the 223556219 address,
with both AI trailers. The configured signing service failed before commit
creation; the ordinary fast-forward code commit is unsigned.

Historical [run 34283532254](https://github.com/drrowdev/hybrid-training-app/actions/runs/34283532254)
at `9fe3e4da` passed 10/11 UI flows; only C2 failed (7402ms, line479), with Account
POST HTTP5xx headers, Account location and exact synthetic Auth presence at the
bounded later sample. No Auth code, SQL cause or precise throw site is established.
Native16/normal148/catalog/5phase4DDL/15contexts/36HTTP/core/main/final cleanup passed.
C3 is unexecuted, not a deletion fix or release acceptance. No live activation,
private runtime-log access or repeat UI probe occurred. All caps remain enforced;
coordinator exact-final-head review/core and fresh guards precede one new-head
twelve-case reference on the existing route. See
[current scope and outcome boundaries](./pool-swimming.md#shared-completion-integration--current-148-status).

## [2026-09-09] refine | PR805 owner-approved rollback-only diagnostic source

Checkpoint `c74b5a3f4029f66d0c8c17558a129d476fe9f3db`, tested tree
`bbd5127fe57a6042fc2a30321c3b92c5910d00cf`, adds only the runner integration,
injected helper and focused source tests before this documentation follow-up.
450 tests passed across the two targeted Vitest suites; scoped ESLint, web
typecheck and secret scanning passed. Both commit identities were explicitly
set/verified as Copilot with the 223556219 address and AI trailers.

The owner selected rollback-only checks, not a permanent migration. The source
literal is ON: unchanged Native16/normal148/catalog/Auth5phase4DDL15contexts/36HTTP
prerequisites precede three separately bounded rollback transactions, with the
expected baseline23503 gate before either NO ACTION candidate. All fixture
creation is transactional, tested DELETE uses existing Auth session authorization,
and fresh owned connections verify original tuples/other-FK fingerprint and
fixture absence after every attempt. No compensating mutations or retries.
Safe records and terminal summaries are nonqualifying; all twelve existing UI/API
case sources remain unchanged and this route does not run them.

Run34287396820 at7d0fb2c failed C2/C3; C3 native-only control passed and the linked
graph remained intact before direct Auth admin5xx, without SQLSTATE/constraint.
No repeated UI probe, SQL/stack/browser execution or workflow dispatch occurred
in this source task. Exact-final-head review/core/fresh full-path guards remain
required before one rollback-only run. Remove—not flip—the temporary mode before
repair-head/release acceptance. Candidate outcomes do not select a permanent mode,
prove GoTrue equivalence, or substitute for positive C2/C3 acceptance following a
separately approved repair. No migration149. Contract:
[rollback-only diagnostics](./pool-swimming.md#rollback-only-fk-diagnostics--temporary-source-route),
covering [DC-SW8](./hybrid-training-design-constraints.md#sw-native-pool-swimming-adr-0079-2026-09-05).

## [2026-09-09] refine | PR805 prerequisite attribution without weaker guards

Code/test checkpoint `2749a1c227ebd44833296c1c8b20260b93fe1112`, saved tree
`005d8bdf9ce54169141a516768a7c75759938765` (not tested), appends 26 fixed-order
atomic mismatch flags as snapshot position seven and one strict safe-record
prerequisites union. Original six positions/composites/restoration comparisons,
row-wise FK conjunction with exact count/COALESCE/NULL semantics, missing-role
EXISTS behavior and all pins remain. Only explicit FALSE yields an ID;
matched:false with no IDs remains valid. Safe parsing before assignment retains
observed:false on malformed evidence, with fixed authored assertions and valid
outer-finally publication. Existing runner/main tests and all twelve cases are
unchanged. Write scope is exactly helper/test/HANDOFF/pool-swimming/this log.

Owner-reported [run 34312943325](https://github.com/drrowdev/hybrid-training-app/actions/runs/34312943325)
at `6fd1d43` ended 05:00:59Z: snapshot parsed, grouped prerequisites mismatched,
safe status failed/probes empty. No baseline/fixture/candidate DDL attempted.
Native16/normal148/catalog/Auth5phase4DDL15contexts36HTTP/core/main/final cleanup
passed. No individual role attribute, deletion error or FK cause was observed.
Exact0003/0059 agree with the expected inline RESTRICT FKs; image-owned role
attributes are not repository-pinned, which does not identify a failed property.

Diff check and secret scan passed. Read-only review found an unsupported Vitest
matcher, corrected before the checkpoint. Targeted probe/main Vitest, scoped
lint and typecheck remain unrun under the source-writer execution restriction;
CodeQL was incomplete (Actions failed; JavaScript database too large). No
runtime SQL, stack/browser, production access, raw log content access or CI
dispatch occurred. Author and committer explicitly set/verified as Copilot with
223556219 address and both AI trailers. Signing service failed before creation;
ordinary fast-forward checkpoint is unsigned.

The coordinator still verifies actual Astra START+TERMINAL and preserved
artifacts, then one exact-final-head Opus review/core and fresh full-path guards.
Attribution does not promise deletion measurement. A failing pin must stop the
next reviewed run; owner-super failure requires separately source-grounded
role-fidelity design, not weaker guards or switched authorization. Rollback-only
remains ON/nonqualifying, exhausted Drizzle mode OFF; remove the temporary mode,
not merely flip it, before repair/release acceptance. No migration149 or permanent
FK semantics selected. See [contract](./pool-swimming.md#rollback-only-fk-diagnostics--temporary-source-route).

## [2026-09-09] refine | PR805 existing bootstrap identity correction

Continued exactly from `b9806ec695640c7c8c837d11bd0086e22e4a561e` on the existing
PR805 branch. Owner-supplied run34316110081 ended 05:48:27Z with
`observed:true, matched:false, mismatched:["owner-super"]`, `probes:[]`;
initial session/current user postgres lacked superuser. No fixture/DDL or
deletion measurement occurred; prerequisites/core/cleanup otherwise passed.
Safe15 records retained, raw logs already consumed once and discarded.

Accepted pinned Docker/CLI evidence supports the image's existing
`supabase_admin` bootstrap login, not new privileges. One source constant binds
the helper's local psql user, snapshot identities and setup guard; added
`--no-password`, retaining the owned ID/supervisor/implicit socket. Mandatory
owner-super/Auth/FK pins, Auth SESSION AUTHORIZATION DELETE, four UUIDs per
fixture/26 flags, baseline23503, three rollbacks, forced checks, fresh restoration
and error primacy remain. No main/main-test, migration, policy, role, config,
dependency or account-deletion change.

Code/test checkpoint `1b691eeb082be47af789d2ed3d5204bd9ae69b45`, tested tree
`fafaf4479d0857584a37b067b6ed2fa9ae08955a`: GitHub-workspace targeted probe/main
Vitest 493 passed (87+406), scoped ESLint passed, web typecheck passed; exact
commands in [`HANDOFF.md`](../../HANDOFF.md). An initial command named a nonexistent
main-test file and ran only 87 probe tests; the corrected two-suite command above
passed before saving. Diff/secret checks passed. CodeQL incomplete: Actions
analysis failed, JavaScript database too large; not a security-analysis pass.
Explicit author/committer Copilot 223556219 and both AI trailers verified.

No runtime SQL, stack/browser, production operation or workflow dispatch.
The accepted synchronous consultation supersedes the unavailable reviewer;
no further model chain. Coordinator inspects exact completed source, real core
and fresh whole-path guards before one corrected isolated run. No same-head
rerun/identification-only experiment. Rollback-only ON/nonqualifying, original12
unrun; no permanent149 authorization. See [source evidence and limits](./pool-swimming.md#bootstrap-identity-correction--2026-09-09).

## [2026-09-09] decision | Reversible movement-reference candidate; source checkpoint blocked on UPDATE RLS

Owner approved reversible changes to at most two existing movement-reference
FKs in the owned disposable environment. Assigned parent `1bb56`; source/code
checkpoint `24e10035d4a1f060369ef8384a5d0befc12b65e7`. Added guarded migration0148
and inverse, normal149 count, durable verified-file relationship round trip and
two transactional one-FK necessity assertions; removed obsolete rollback-only
mode/helper/test. Identity146/147/148, five phases/four files/fifteen contexts and
all36HTTP remain. C3 adds strict authenticated transaction-boundary integrity
requests without changing the original twelve identities/six files or C2.

Measured basis: run34321670984 at1bb56 ended07:03:52Z; baseline/immediate
23503/set-logs; both-deferred exactly-one Auth DELETE plus forced ALL checks.
All rolled back, original schema/fixture absence verified; original12 unrun,
intentional nonqualifying stop only. No independently measured second-FK
necessity or full GoTrue/app proof. Historical148 evidence is retained.

Audit confirmed no FK catch-and-continue in original148 SQL; coupled0061/0144
propagate request failures, unrelated0115 duplicate_object and rehab23503 only.
External SQL clients not audited. **Blocker:** 0059 supplies no session_movements
UPDATE policy;0063 grants UPDATE but documents RLS-blocked real updates, with no
later policy. Required authenticated UPDATE cannot reach23503. Strict assertion
retained; no RLS/grant/bypass or acceptance weakening. Owner/coordinator guidance
needed; this is not acceptance-ready.

GitHub source checks: six targeted Vitest suites1125 passed, web typecheck and
scoped lint passed; actual pinned Playwright collection12 identities/six files/
zero executed results. Initial mock typing/lint and collection-credential guard
issues were corrected before successful validation. Code secret/diff scans
passed. Explicit Copilot223556219 author/committer and AI trailers verified;
signing service failed, checkpoint saved unsigned. Exact commands in HANDOFF.
No runtime SQL, Docker/stack, browser execution or workflow dispatch. Candidate
normal149/down/up/necessity/all36HTTP/C2/C3 remain unrun; production separately
gated. [ADR0080](../adr/0080-deferred-custom-movement-references.md) added to index;
pool-swimming/HANDOFF now distinguish current candidate from historical probes.

## [2026-09-09] refine | Resolve UPDATE verification at RLS and FK layers

Preserved candidate `e69153fde6f945ccc72dee0299b0abc587be7282`; correction
checkpoint `123fd1765c8eee33f1e28bad4d622cc631836226`, tested tree
`f0ccfad5161a68c900fcb54c568c0c1bd1abed02`. Coordinator correction resolves the
source-proven validation mismatch, not an application permission bug.
C3 retains four reachable request-end23503 checks, then separately pins the
owned session_movements UPDATE to no error/empty returned array with fresh
unchanged records and missing-parent-reference absence. Native control, linked
identity preservation, actual Auth deletion and full absence checks remain.

The existing durable helper adds one separately named `updateIntegrity` result
after down/up and exactly two unchanged necessity probes. Shared synthetic
Auth/profile/movement/session/set/reference setup and UPDATE live in one
ROLLBACK transaction on the existing owned supabase_admin connection.
Candidate metadata/reference existence/absent generated movement ID are checked;
actual affected-row-one and forced ALL rejection23503/session-movements are
mandatory. Setup errors, zero rows, missing forced check, wrong errors and
unverified restoration fail closed. Fresh connection verifies semantic schema,
other metadata and absence of every generated fixture ID after error/disconnect
too. No compensating DELETE, owner impersonation, RLS/grant/role or migration
change; no new mode, endpoint, fixture, registry change or browser case.

GitHub source checks rerun: six existing Vitest suites **1148 passed**,
web typecheck and three-file scoped ESLint passed. Actual pinned collection
matched **12 identities / six files / zero executed results**, using expired
synthetic credentials and private `/tmp` paths. Code secret/diff checks passed.
Exact commands and collection report location are in HANDOFF. Author/committer
Copilot223556219 and required AI trailers verified. ADR0080/HANDOFF/pool-swimming
now distinguish source proof, owned SQL FK integrity and authenticated RLS denial.
Historical index wording is not updated because this continuation permits only
the exact seven specified paths.

No live SQL, Docker/stack, browser execution or workflow dispatch occurred.
Candidate normal149/down/up/both necessity proofs/UPDATE integrity/all36HTTP,
authenticated RLS denial and positive C2/C3 remain unrun. Original migrations,
identity146/147/148, five phases/four DDL/fifteen contexts, exact cleanup and all
twelve positive cases remain required. No production authorization follows.

## [2026-09-09] refine | Qualify shared catalog column in composed SQL guards

Preserved complete candidate `65050755d7160fc2a355736489a2ea249f99dc70` on PR805.
Coordinator-supplied safe evidence from run34333221283 at that exact head,
ended09:14:26Z: normal149/catalog, original Auth5phase4DDL15contexts/all36HTTP,
Native16/core and main/final cleanup passed. Initial candidate snapshot, whole
down file, original snapshot, whole up file and restored candidate snapshot
passed (`initial/down/up=true`). First set-logs-only necessity returned the Node
outer catch's `unavailable/none/none/false/false/false` default, not a mapped SQL
exception. Fresh schema restoration and fixture absence passed. Second necessity,
UPDATE integrity and all browser12 cases were not executed. Safe14 records
retained; raw logs consumed once and discarded, not reread by this worker.

Source identified an unqualified `bool_and(matched)` over the catalog `props`
column inside DO blocks declaring PL/pgSQL `matched`. PG17's default conflict
rule requires qualification or distinct naming. Shared aggregate now uses
`bool_and(props.matched)`; variables, alias, predicates, NULL/count semantics,
tuples, fingerprints, layout and callers remain unchanged. Ordinary snapshots
have no variable scope; durable up/down use a direct expression. Their passes
did not validate the composed DO blocks. First guard precedes tuple capture,
consistent with the default; no runtime SQLSTATE observed or safe-log42702 claim.

Code/test saved first at `28db9073897243d68ac3873e443bcec6e25c694a`, tested tree
`918154ca482ede5dc1a6cdc17c2b620b69861919`. Existing durable-helper/main Vitest
suites **498 passed** (92/406); scoped ESLint and web typecheck passed in the
GitHub workspace. Exact commands in HANDOFF. Added source-only regression covers
candidate/original snapshots, both necessity strings and UPDATE integrity,
including retained `DECLARE matched` in each affected DO block and absence of
the unqualified aggregate. All prior assertions retained. Secret/diff checks
passed; CodeQL incomplete (Actions failed, JavaScript database too large), not
a security-analysis pass. Author and committer explicitly Copilot223556219;
required AI trailers included.

Updated current HANDOFF/pool-swimming/index and appended this entry only.
Index's stale owner-direction wording is resolved: by65050755, authenticated RLS
denial and owned SQL FK UPDATE verification were separated without permission
changes. No migration0148/down/journal149, main/guard/identity/C3/fixture/browser
registry/config/workflow/dependency/ADR or product permission changes.
No SQL, Docker, browser execution/collection or workflow dispatch here; no
unchanged-head rerun. Coordinator owns next exact-head live validation.
Necessity, UPDATE integrity, authenticated RLS denial and positive C2/C3 remain
unproved. Reversible disposable-only approval remains; no production change or
candidate acceptance claim.

## [2026-09-09] refine | Narrow unreleased movement candidate to measured set_logs minimum

Continued PR805 from exact `0b3b7401ec2a485ee1ea1f0304d2d3e0f09544a8`;
GitHub metadata confirms base `copilot/prepare-mobile-persistence-tests` at
`4f2aa4af480f61df83bbc38b09f29afbbbf5729b`. No branch/PR/base/history change.
Coordinator-supplied safe14 evidence from run34336292485 at0b3b7401,
ended09:47:27Z: normal149/catalog/Native16/Auth5phase4DDL15contexts/all36HTTP/core
and durable initial/down/up passed. First set-logs-only partial candidate
succeeded with matched Auth session/current role, exactly one deleted Auth row,
completed forced ALL checks, restored schema and all fixture IDs absent after
rollback. The two-FK guard correctly stopped before second probe, UPDATE and
browser12. Main/final cleanup verified. Consumed raw logs were not reread;
no unchanged-head retry. The SQL qualification now returns valid evidence.

Narrowed unmerged0148 up/down in place within the existing up-to-two disposable
approval; prior applied candidate stacks were destroyed. Only set_logs changes.
Both exact references remain guarded, but session_movements must always retain
its original RESTRICT/not-deferrable shape and OID; two-deferred-FK databases
fail rather than normalize. Original148 files, journal tags/count149, main call
site, identity levels/phases/DDL/contexts, Auth36 and browser12 remain unchanged.

Catalog normalization now applies only to set_logs OID/mode bits.
session_movements joins full unchanged relationship metadata, including its OID
and every bit; other table/column/index/owner/ACL/RLS/user-trigger fingerprints
remain. Qualified `bool_and(props.matched)` is retained. Durable exact-source
down/up, verified hashes and exact UTF-8 checks remain. Exactly two fresh,
rollback-only controls replace the partial-candidate modes: baseline applies
exact down SQL and requires23503/set-logs; candidate requires Auth-role success,
one row and successful forced ALL checking on the current single-deferred schema.
Each uses the same intact synthetic graph, with fresh schema/fixture-absence
checks after error/disconnect too. No fallback, compensation or new snapshot.

Dedicated UPDATE integrity now targets the generated set_logs row with exact
set/session/original-movement filters, requiring one affected row followed by
forced23503/set-logs and verified rollback. Existing C3 authenticated
session_movements zero-row RLS verification stays unchanged. Source regressions
cover both controls, wrong/incomplete results, stale modes, strict safe schemas,
fresh distinct fixtures, normalization scope and post-disconnect cleanup.

Validation from `/home/runner/work/hybrid-training-app/hybrid-training-app`:

- `pnpm --filter @hta/web exec vitest run src/lib/swim/__tests__/storage-migration.test.ts src/lib/swim/__tests__/swim-movement-reference-roundtrip.test.ts src/lib/swim/__tests__/swim-acceptance.test.ts src/lib/swim/__tests__/swim-browser-acceptance.test.ts src/lib/swim/__tests__/swim-identity-roundtrip.test.ts src/lib/swim/__tests__/swim-rpc-diagnostics.test.ts` — **1175 passed**, including118 helper tests.
- `pnpm --filter @hta/web exec eslint scripts/swim-movement-reference-roundtrip.ts src/lib/swim/__tests__/swim-movement-reference-roundtrip.test.ts` — passed.
- `pnpm --filter @hta/web typecheck` — passed.
- `env -u DATABASE_URL pnpm --filter @hta/db db:check:ci` — offline149 files/entries hashed cleanly; no database execution.
- `pnpm docs:check-drift` — in-repo check passed; private workspace parity not run.
- `git diff --check` — passed; protected migration/journal/main/browser paths unchanged.

New source SHA-256 values (not runtime acceptance):

- `packages/db/drizzle/0148_defer_custom_movement_references.sql`: `40212c4209449a5c148c11ee271f298d9ea2eeac0b114da5a144d5bc98a262b2`.
- `packages/db/rollbacks/0148_defer_custom_movement_references.down.sql`: `7b3a7802217ca9f96ee7d0f18472e9202e9150bf21ef80d4f825f0b09a81fa32`.
- `apps/web/scripts/swim-movement-reference-roundtrip.ts`: `439521bc844d649b690b0b135bff2bcc0e5a1f5a7f829cdd43cf045529622608`.

Updated existing ADR0080/HANDOFF/pool-swimming/index and appended this log.
No new callback, grant/RLS/role, user-data rewrite, production change, SQL/Docker/
browser execution or workflow dispatch. Coordinator-owned exact-head live
down/up/baseline/candidate/UPDATE/Auth36/browser12/C2/C3 acceptance remains
pending; structural SQL success is not GoTrue equivalence or release approval.

Committed implementation `11c94dedc0ea71e6cea44827db289c96e9904164`, whose sole
parent is exact0b3b7401; nine expected files only, AI-coauthor trailer verified.
Secret scan passed. Post-commit CodeQL did not complete: Actions analysis failed,
JavaScript analysis skipped because its database was too large; this is not a
security-analysis pass. Final helper/main Vitest rerun **524 passed** (118/406).
Working tree was clean after the implementation commit; this documentation-only
follow-up records the checkpoint and analysis limitation.

## [2026-09-09] refine | Preserve twelve-case account milestone; append B3/B4/B5 source coverage

Continued exact `bb9aa524f3132ac392b963fc9166f2cc90acfcf3` in existing PR805,
without branch/base/history changes. Coordinator's safe milestone:
[run34339663834](https://github.com/drrowdev/hybrid-training-app/actions/runs/34339663834)
completed10:25:00Z SUCCESS at that exact head. Original12 passed once, zero
unexpected/skipped/flaky, measured total63,937ms. C2 real app deletion, C3 linked
Auth deletion, owner integrity and survivor checks passed.
Native16/normal149/catalog/Auth5phases4DDL15contexts/all36HTTP/core/main/final
cleanup passed. Single-FK down/up, baseline23503/set-logs, candidate Authdelete1
plus forced success, UPDATE23503/set-logs with row1 plus forced checks, and all
schema/fixture restoration passed. GitHub metadata corroborates success; no
private runtime logs reread. Account-deletion blocker closed, not standalone
completion or release.

Code checkpoint `b29c9cc399e4db21341eea2dbf96969485a3105e`, tested tree
`c7e14f0b844f0faefd527f013479bbb5f880ef73`, was saved before documentation.
DC-SW4/SW5/K4 coverage appends real UI plateau Reject, high-effort/missed
warning Override and missing-effort Accept-hold cases to the same B spec.
Canonical histories pin12×2/rest25 hold,11×2/rest25 reduce and unchanged12×2/rest25
respectively. The integer-repeat form has no choice between11 and12; override8
is the nearest downward choice producing the existing seven-length-cap warning,
with canonical27-length future target and no catch-up. Audit inputs/versions,
native results, started/original work, IDs/dates/budgets/counts and reload/re-review
stability are asserted. B1/B2 and all existing fixture/helper implementations
are unchanged by exact source comparison.

Original12 identities/order remain; C2index9,Dindex10,C3index11 and new
B3/B4/B5 at12/13/14. Six file counts2/2/2/5/3/1. Reader negatives retain old4/6/8/11
and add old12-only removal plus all same-total new-case substitutions by B1/B2
or another new case. A shuffled grouped-file regression verifies exact-identity
mapping; test fixture C2 selection no longer assumes flattened file order.
Strict attempts/results/skip/flaky/privacy/per-point annotation gates remain.

Commands in `/home/runner/work/hybrid-training-app/hybrid-training-app`:

- `pnpm --filter @hta/web exec vitest run src/lib/swim/__tests__/swim-browser-acceptance.test.ts src/lib/swim/__tests__/swim-browser-collection.test.ts` — **431 passed** (430 reader,1 collection).
- Existing isolated collection invokes installed Playwright1.60.0 CLI `test --list --config=playwright.swim-reference.config.ts --project=mobile-chromium --reporter=json`: **15 exact identities/six files/zero executed results/errors**; checked private cleanup.
- `pnpm --filter @hta/engine exec vitest run src/swimming.test.ts` — **55 passed**.
- `pnpm --filter @hta/web exec eslint e2e/swimming-decisions-offline-mobile.spec.ts scripts/swim-browser-acceptance.ts src/lib/swim/__tests__/swim-browser-acceptance.test.ts src/lib/swim/__tests__/swim-browser-collection.test.ts` — passed.
- `pnpm --filter @hta/web typecheck` and `git diff --check` — passed.

Secret scan passed. CodeQL skipped test/casebook-only changes as trivial;
not a full security-analysis pass. Terminal commits explicitly override author
and committer to Copilot223556219, with both required AI trailers; local and
remote metadata for the code checkpoint verified. Only the four allowed code/
test paths plus HANDOFF/pool-swimming/this append-only log change.

**New fifteen-case runtime is unrun.** No source/collection standalone gate
closure, SQL/Docker/browser execution, workflow dispatch, hosted access,
Auth/product/schema/permissions/dependency/main/stage/config/workflow changes
or separate model/reviewer chain. Production OAuth reauthentication is outside
this task. Other lifecycle/analytics/scaling/concurrency variants remain.
Unchanged30s/case,300s global,330s command,590s phase,410s server,35m total with3m
cleanup,45m job;63,937ms is a historical measurement, not a future fit promise.

Documentation validation: `pnpm docs:check-drift` passed its in-repo checks
(private workspace parity not run); diff/secret checks passed, exactly seven
allowed paths changed, and the pre-existing knowledge log is an exact prefix.

## [2026-09-09] refine | First fifteen-case outcomes; semantic HOLD equality and B4 budget oracle

Continues exact `da81baacb2a72c5471863ea40cd5b60302b07c0b` on existing
`copilot/new-acceptance-cases`, unchanged base
`copilot/prepare-mobile-persistence-tests` at `4f2aa4af480f61df83bbc38b09f29afbbbf5729b`.
The previous source checkpoint's unrun statements are superseded by the
coordinator's safe15 record for [run34345964317](https://github.com/drrowdev/hybrid-training-app/actions/runs/34345964317),
ended11:36:23Z: all15 ran once,12 passed/3 failed, no skips/flaky cases.
B3 passed. B4 failed at shared helper69 (2,955ms), precise calling comparison
unknown. B5 failed at strict modifications count856 (2,434ms) after correct
dose/issued/revision/provisional checks. Original first setup timed out selecting
Pool length at19 (30,077ms) after the program-page Pool swimming link; cause
unknown. The other11 original cases, including C2/C3, passed. Normal149/catalog/
Auth5phase4DDL15contexts/all36HTTP/Native16/core/single-FK controls/UPDATE
integrity/main/final cleanup passed. GitHub metadata confirms head/end/failure;
raw logs already consumed once and discarded were not reread. No unchanged-head
retry. Account12 milestone atbb9aa/run34339663834 remains valid, not release.

Code/tests committed before docs as `61ab8c36d9536257351330d4b7ff0cb0ba1a1621`,
tested tree `7515548bf7c643a5cb5bb82f64b7b0558b53b2c0`:

- DC-SW4/SW5 product fix: only `futureUpdates`' changed calculation now imports/
  uses existing pure `prescriptionsEquivalent`. Nested key order is semantic
  equality; array order/content remain significant. Both progression and
  benchmark callers preserve scope/history. Equal accepted HOLD may confirm
  eligible provisional work/revision without a false modification. Real changes
  append exactly one previous issued snapshot with the correct decision.
- Eight typed fixture cases cover nested key reorder, provisional/non-provisional,
  started/past/today/out-of-scope freezes, prior history and real dose/array-content/
  array-order changes. Benchmark regression verifies changed pace, original and
  previous snapshot/association. Five reordered-HOLD variants failed on old code
  (32 other action tests passed); all37 action tests pass after the source fix.
- B4-only DC-SW4/SW5/K4 oracle: preserve exact `budget.minutes`. Domain
  `SwimBudget` and engine `buildWorkout`/`sectionsTiming` define accounted time as
  derived work, not the chosen limit. Full canonical issued equality retains the
  correct new `accountedMs`; helper-derived target time must be below suggested/
  prior time.27-versus33, warning/audit/frozen/no-catch-up assertions remain.
  Private comparisons are inlined boolean deep equality at unique executable
  call sites with exact original operands except the budget correction. AST
  verification passed. This does not identify the old helper69 calling site,
  establish all B4 bugs fixed, or explain/fix the separate first-case timeout.

Commands in `/home/runner/work/hybrid-training-app/hybrid-training-app`:

- `pnpm --filter @hta/web exec vitest run src/lib/swim/__tests__/actions.test.ts src/lib/swim/__tests__/swim-actions-refresh.test.ts src/lib/swim/__tests__/proposals.test.ts src/lib/swim/__tests__/safety.test.ts src/lib/swim/__tests__/swim-browser-acceptance.test.ts src/lib/swim/__tests__/swim-browser-collection.test.ts src/lib/platform/__tests__/forward-rewrite.test.ts src/lib/platform/__tests__/progression.test.ts` — **693 passed**.
- `pnpm --filter @hta/engine exec vitest run src/swimming.test.ts` — **55 passed**.
- `pnpm --filter @hta/web exec eslint src/lib/swim/actions.ts src/lib/swim/__tests__/actions.test.ts e2e/swimming-decisions-offline-mobile.spec.ts` — passed.
- `pnpm --filter @hta/web typecheck` — passed after correcting the test fixture's
  standalone definition typing; `git diff --check` passed.
- Existing isolated pinned Playwright1.60.0 `--list` collection verified15 exact
  identities/six files/zero executed results/errors and checked private cleanup.

Secret scan passed. CodeQL did not complete: Actions analysis failed;
JavaScript database too large. Not a security-analysis pass. Explicit terminal
author/committer Copilot223556219 and both required AI trailers verified locally
and remotely. Signing service failed before commit creation; checkpoint saved
unsigned. Publishing pushed the existing commit, without an MCP-created commit.

Only allowed six paths: actions/action tests/B4 spec, HANDOFF, pool-swimming,
append-only log. Original first-case spec entirely unchanged and mandatory in
next changed-head cohort. B1/B2/B3/B5/shared helpers are byte-identical; B5's strict
assertion unchanged. No comparator implementation/other cases/fixtures/registry/
collection/main/stage/config/workflow/engine/domain/migration/permissions/
dependency change, persisted-history rewrite, SQL/Docker/browser execution,
workflow dispatch, hosted access or extra reviewer/model chain. Owner-confirmed
production projectgrhet still has unresolved MCP authorization, unrelated here.
Corrected-head live15 pending; no fifteen-case acceptance or production claim.
All identities/order/bounds remain:30s/case,300s global,330s command,590s phase,
410s server,35m total including3m cleanup,45m job. If the first-case timeout
repeats, coordinator investigates it separately, without retry/navigation guesses.

Documentation validation: `pnpm docs:check-drift` passed in-repo checks (private
workspace parity not run); `git diff --check` and documentation secret scanning
passed. Exact six-file allowlist and append-only log prefix verified; code/tests
remain unchanged from the validated code checkpoint.

## [2026-09-09] refine | Standalone budget and learning source cohort after fifteen-case success

Continues PR805 `copilot/new-acceptance-cases` from exact
`fdf01d865dc09f38e551925266fa604c56a3d40e`, unchanged base
`copilot/prepare-mobile-persistence-tests` at
`4f2aa4af480f61df83bbc38b09f29afbbbf5729b`. No branch/PR/history manipulation.

Latest measured milestone: run34351260981 at fdf01 completed12:34:10Z SUCCESS;
all15 passed once, zero unexpected/skipped/flaky, B3/B4/B5 and C2/C3 passed,
empty failure ledger. Normal149/catalog/Auth5phases4DDL15contexts/all36HTTP/
Native16/single-FK down/up controls/UPDATE integrity/core/main/final cleanup
passed. GitHub metadata corroborates the coordinator's retained summary.
The original first setup case passed21,892ms; its earlier Pool-length timeout
is still unexplained. No causal claim about the semantic-HOLD fix. This closes
progression-branch work, not all standalone/release gates.

Saved code/tests first at `8fecc50c5f4cdd2349d2d1e425d47d90003707e9`, tested tree
`24ae63d66b5b23a1cb794482abf2af952be32af6`. B6/B7/B8 append at15/16/17 in the
existing B spec/describe under DC-SW1/SW2/SW3: useful calibrated10-minute native50m
scaling versus a larger canonical budget; a valid impossible10-minute budget
with form-scoped options/no persistence and budget-only successful correction;
and zero-length/no-stroke/no-assessment learning guidance without any native
plan, workout or session. Real UI actions, retained inputs, canonical storage/
generation comparisons and reload checks; no new product/copy. One initially
considered slow pair was invalid and discarded, never treated as budget proof.

Original15 bodies/identities/order/fixtures and all B1–B5/shared helpers remain
unchanged. Same six files, counts2/2/2/8/3/1; exact noncontiguous B mapping,
C2index9 and existing annotation/privacy rules preserved. Old4/6/8/11/12/15
reports and same-total substitutions/duplicates fail. Old12 removes all B3–B8
but keeps B1/B2; old15 removes only B6/B7/B8, never the B file.

Inside GitHub:472 reader/collection tests (including seven canonical pure
fixture tests spanning all start weekdays),58 existing engine swimming/budget
tests, scoped lint, web typecheck and diff/secret checks passed. Actual installed
Playwright1.60.0 `--list` used the existing private isolation and collected18
identities/six files/zero executed results/errors with verified cleanup.
An old fifteen-entry annotation expectation failed the first reader pass;
only three empty entries were appended, and the full targeted rerun passed.
CodeQL skipped test-only changes as trivial; no analysis pass is claimed.
Exact commands are recorded in HANDOFF. Terminal author/committer and verified
remote identity are Copilot223556219, both AI trailers retained. Publishing
pushed the existing commit, not an MCP-created commit.

Only the seven allowed paths changed: B spec, casebook, reader and collection
tests, HANDOFF, pool-swimming wiki and this append-only log. No other
source/protocol/main/stage/fixture/config/workflow/domain/engine/DB/permissions/
migration/dependency/hosting/network/cost changes. No SQL/Docker/browser execution,
CI dispatch, unchanged rerun, hosted reads, production writes or extra model/
review chain. Owner-reported getsxc production connector access now works, but
was not used. Live18 is unrun; lifecycle/analytics/concurrency/regional-load
variants and free-plan backup/recovery, production migration ordering and
monitoring gates remain. Bounds unchanged:30s/case,300s global,330s command,
590s phase,410s server,35m total/3m cleanup,45m job. Eighteen nominal maxima
are not a fit guarantee; a real overrun must fail honestly.

Documentation validation: `pnpm docs:check-drift` passed offline in-repository
checks (private mirror parity not run), along with `git diff --check` and
documentation secret scanning. Exact seven-file allowlist and append-only log
prefix verified; source remained unchanged from the tested code checkpoint.

## [2026-09-09] refine | Whole-history commit-identity recurrence prevention

PR805 continued from exact `966b906c83873667b27459ed42575da29ed3b377` on
`copilot/new-acceptance-cases`, stacked base
`e2758dadbb110e03794e49d53b47622a6295e988`. Owner-reported history repair
(115 code-identical commits, 88 author corrections, 68 missing App credits)
was already complete; retained tag `swim-identity-checkpoint-31364e5` is evidence,
not authorization for another rewrite. No history was rewritten.

Saved code/test checkpoint `ac209ecb1c8489a65d5626603f866a39e83254f3`,
tree `bdb90c932525e7e6bda6e559ab07a6b3f3473410`. Shared Node checker replaces
the newest-only/non-merge CI scan and precedes the unchanged pre-push quality
chain. Both author and committer must match the exact three-email allowlist;
Copilot198982749 remains rejected. Real PR source/base, full push ranges,
initial/non-fast-forward boundaries, manual default/current commit, complete
feature stacks, multiple proposed updates and deletions are explicit. Remote
default-branch verification prevents stale parent/archive refs from masking
unmerged bad history. Missing/malformed boundaries and Git errors fail closed.
Historical allowed human commits do not acquire retroactive trailer requirements.

22 existing-runner Vitest regressions passed using temporary owned Git fixtures,
including actual pre-push rejection before pnpm/publication. Scoped ESLint,
Node syntax check, web typecheck and offline document drift passed. Read-only
candidate scan found all 121 starting commits allowed against verified
`main@e6ad3b8a358320b651de65f7b9785b409d10eaf4`; actual repository hook checked
122 commits at the checkpoint and passed all preserved quality commands,
including offline149 migration drift. No SQL/hosted/browser/Docker execution.
Secret scan was clean. CodeQL reported no alerts but Actions analysis failed
and JavaScript analysis was skipped for database size; no analysis pass claimed.
The sandbox signing service failed; the saved terminal commit is unsigned,
with explicit Copilot223556219 author/committer and both requested AI credits
verified locally and through GitHub after publishing. Hooks remained enabled.
HANDOFF records commands/results; AGENTS now records durable identity/history rules.

Only the seven authorized identity-code/test/document paths changed. No other
workflow context, swimming source/fixture, product/engine/DC-*/OC-*, schema,
migration, permissions, RLS or dependency change. No extra model/review chain,
new branch/PR, merge/rebase/amend/force push, CI dispatch or disposable reference.
Latest measured swimming remains run34351260981 at original fdf01,
all15 passed12:34:10Z; the 18-case source is not live accepted by this task.
Normal149/Auth36/single-FK/source bounds remain unchanged. Production/main's
0145 single-leg RDL migration versus unmerged swim145–148 ordering still needs
later reconciliation; backup/recovery/monitoring and release gates remain open.

## [2026-09-09] refine | Preserve exact Git identity output

PR805 continued from `5946bd020f637f36388109898f162a284eb9ede8`; tested code
checkpoint `8fac5c3dfac66cb1b5246e5b142e4ed6c1094f60`, tree
`355efedf4575d3ec72fd6f44b2d608b69f27ad45`. Eight red regressions proved
Git stores/projects leading author and trailing committer whitespace unchanged
while the old guard normalized it into allowed identities. Synthetic objects
use normal `hash-object` validation, with complete object/projection assertions.
Git rejected the exploratory newline-in-email object; no bypass was used.

Only terminal LF is removed; exactly two fields are required and signature
display is disabled. Empty-field attribution and trace-based verifier exclusion
are covered. All 33 targeted tests, scoped ESLint, Node syntax, web typecheck
and offline doc drift passed; commands are in HANDOFF. Secret scan clean.
CodeQL returned zero alerts but Actions failed and JavaScript was size-skipped,
not a successful analysis. Terminal checkpoint author/committer and both AI
credits verified locally/remotely; unsigned after sandbox signing failure,
hooks enabled. Full history fetched after the initial shallow push rejection.
Only the four authorized paths change; all prior identity wiring, boundary/tag
policy and 18-case source remain intact. No history rewrite, engine/DC-*/OC-*,
product/DB/RLS/dependency changes or live swimming acceptance.

## [2026-09-09] decision | Accept both official Copilot bots and native author credit

Owner decision supersedes the earlier CLI-only attribution policy. Added only
`198982749+Copilot@users.noreply.github.com` (official cloud bot) to the exact
allowlist, retaining the official CLI bot, owner and GitHub addresses. Both
author and committer still undergo complete introduced-history checking,
including merges, exact whitespace and unchanged event/range/pre-push rules.
Native authorship by either approved bot is sufficient AI credit; human-authored
AI edits still need AI co-author credit. Existing credits/signatures remain
untouched. Prior metadata repairs stay as recorded; all prior rewrite approvals
are consumed. No history rewrite or signature stripping occurred.

PR805 continued from `030160f8afb883cb650ceb6647c290c93c5b6e56`, declared base
`e2758dadbb110e03794e49d53b47622a6295e988`. Code checkpoint
`94193697bbc4d4df692786daaee3c55b9400155c`, tree
`2a9c3d74238d9f9b34ab2e8e30d05fa282eb3091`, was tested and published before docs.
Local/public metadata confirms native cloud author and GitHub committer within
the new policy; the signed commit retains its credits. All 39 targeted tests,
scoped ESLint, Node syntax, web typecheck and offline doc drift passed; commands
are in HANDOFF. Secret scan clean. CodeQL returned zero alerts but Actions failed
and JavaScript was size-skipped, not a successful analysis.

The policy resolves attribution of legitimate cloud output, not code quality
or production readiness. Run34392005044 covers immutable old030160, not this
changed head. All 18 source cases remain unchanged; no new runtime claims.
No full reference or CI dispatch, SQL/Docker/browser execution, production work,
or changes outside the five authorized paths. Builder B owns only the persistence
swimming spec on PR811. Full reference remains gated on completed writers,
inspection of current source and that source's own appropriate green CI.

## [2026-09-09] refine | PR805 immutable E1/E2 integration, twenty-case source only

Continued exact667349dd2bdffad9fda3a4e243681c5d90920840 on PR805, basee2758dad.
Imported only the persistence spec from fee3751810f2b835b221a430a1eabde627daca3d,
blob2e8f7aca4f21b8a4e0849d29acf0dfbcec207cfd; no PR811 merge or future-tip
adoption. Source attribution is native cloud198982749/GitHub noreply.
Published code/test checkpointa5a631caed5a91a03b1421b05a2f17a55c584f60,
tree556b03bc3c93378e433fd6627ab7c72568e900a8, has matching approved local/public
author/committer metadata. Existing credits/history remain intact.

DC-SW1/SW2/SW6 E1/E2 append at18/19, preserving original18 identities/order and
persistence bodies. Same six files/counts2/4/2/8/3/1; persistence2/3/18/19,
B6/7/12–17, C2index9. Historical4/6/8/11/12/15/18 reports assert actual cohorts;
same-total E substitutions fail. Twenty-case failure ledgers retain existing
privacy and annotation memberships. Exact imported fixture-owned cleanup stays.

Actual validation: four web files522 passed including39 identity tests;
domain103 and engine58 passed; scoped lint, web typecheck, offline docs drift
and diff checks passed. Existing private Playwright1.60.0 CLI collection proved
20 exact identities/six files/zero executed results/errors and cleanup. No
worker validation report was assumed. HANDOFF records full commands and the
shallow-history push failure, corrected import transcription, and corrected
identity-test path (initial invocation collected only3 files). Secret scan clean;
CodeQL skipped trivial test/casebook changes, not a successful analysis.

Live20 UNRUN; live18 never accepted. Last full reference remains15/15 atfdf01
run34351260981. Old core34392005044 at030160 does not cover this head. No CI
dispatch, browser/SQL/Docker/hosted-data/production work or extra agent chain.
Only seven authorized paths change; all runtime bounds and Auth/FK controls
remain. Reconcile MAIN/production0145 seed versus unshipped145–148 before release,
not here. Nine standalone gates precede combined implementation; Garmin later.

## [2026-09-10] refine | PR805 frozen A3/A4 integration, twenty-two-case source only

Continued exact1b3653d33442776be18a1923cca0c1813fefcf1e, basee2758dad.
Imported only the lifecycle spec from4122e86b527b2ad6f4fe863ee64d3366457b1d23,
verified blob954b8718785068a8e18df4292a38d5011bf6d438. No PR811 history, other
source files or future tip. Native cloud198982749 author/GitHub noreply committer
verified locally and publicly for published code/test checkpointe42ec6900e0cfe33aadded2aa033229eac1cd5cc,
tested treedc8d621d20c7f75080ec3019d20a29ade8ab70b8. Full130-commit stack
identity check passed; initial shallow-history guard fixed by fetching, not
rewriting or bypassing hooks. Code/tests published before documentation.

DC-SW7/SW8/SW9 A3 replacement/history/primary preservation and A4 offline Finish,
online-context archive, identical queue replay and single history/load append
at20/21. Original20 and A1/A2/helpers/shared fixture remain; lifecycle4/5/20/21,
persistence2/3/18/19, B6/7/12–17, C2index9. Six files/counts2/4/4/8/3/1;
exact-identity mapping, historical4/6/8/11/12/15/18/20 cohorts and same-total
A substitutions pinned. Existing annotations/privacy/source attribution stay;
closed ledgers require22 with no new annotation memberships.

Measured red corrections: initial598/600 passed exposed A2's source-slice
boundary and two missing empty annotation slots. Seven canonical start-day
checks then exposed literal16 as partial (600/607 passed), followed by the
incorrect late-adherence expectation (600/607 passed). Only new A3/A4 changed:
submit issued lengths, retain strict completed/receipt/native-result checks;
assert canonical adherence=true, history=true, late=true, progression=false.
Final lifecycle blobc98b79eb99b1a6c94c40140c7c3bf6bc882f159f. No product,
normalization, count, started-target or history-preservation relaxation.

Final targeted invocation: eleven existing web files607 passed, including
reader496 and installed Playwright1.60.0 real private CLI collection1; exact22
identities/six files/zero executed results/errors and exact cleanup. Domain103,
engine58, scoped lint/web types/offline doc drift/diff passed. Secret scan clean;
CodeQL skipped trivial test/casebook changes, not an analysis pass. Source
assumptions checked against canonical setup/completion/lifecycle/load helpers
and revision source without SQL execution. HANDOFF retains exact commands,
provenance, tested tree and all substantive red corrections.

Freeze22; live20/live22 UNRUN. Last full reference15/15@fdf01 run34351260981.
Old core34392005044 has no failed jobs but does not cover this head. Coordinator
inspects/current-core then ONE new-head22 full reference; no dispatch, live
browser/SQL/Docker/hosted queries, production/cost/backup changes or model chain.
Seven authorized paths only; normal149/identity146–148, Auth5phases4DDL15contexts/
36HTTP, single-set_logs-FK down/up/23503/delete1/UPDATE/restoration, all deadlines
and exact-ID cleanup remain. Reconcile main/prod145 seed versus unshipped swim
145–148 outside this task before integration. Nine standalone gates precede
combined; Garmin later; swimming inside getsxc.app only.

## [2026-09-10] refine | Frozen22 five-failure source corrections on PR805

Continued exact6d17df0 on the existing branch/base. Coordinator's immutable
full22 run34440810700/job102755279732 executed22 once:17passed/5failed,
original15 plus E2/A4 passed; core34440481521 and native/identity/cleanup proofs
passed. Main browser failure remains failure; no raw old logs consumed.
B6/B7/B8 use real scoped combobox semantics; A3 verifies destination/selection
before and after reload. E1's explicit changed-course consent lacked the reason
required by SQL and the canonical constructor; add only yard provenance reason.
Native observations, all positive assertions and all22 identities/order remain.
No product/SQL/fixture-environment/workflow/dependency changes or live execution.
Measured7web files574tests,3domain files103tests,2engine files58tests passed;
scoped lint/typecheck passed. Existing private Playwright1.60.0 actual collection
confirmed22/six files2/4/4/8/3/1/zero execution/errors and exact cleanup.
HANDOFF identifies tested tree and commands. Current-head core and one guarded
coordinator full22 remain; no expansion, production or backup authority.

## [2026-09-10] refine | PR805 B6/B7 summary-scoped course display

Continued exact32e0f40f; coordinator full34442610426 reported20passed/2failed
at later B6/B7 course assertions, with no raw historical error supplied.
Only B6/B7 select/await the stored workout and scope exact course text to the
summary; two existing-harness SSR regressions prove the distinction from step
distances. Five files567 tests, scoped lint, web typecheck and offline doc drift
passed; actual private Playwright1.60.0 collection preserved22/six files2/4/4/8/3/1,
zero execution/errors and exact cleanup. HANDOFF records the tested source tree.
All20 passing cases and runtime safeguards unchanged; new-head full22 pending.

## [2026-09-10] refine | PR805 proven completion-drain overlaps, not historical A2/A3 diagnosis

Continued exact9419d815 on the sole existing PR805 branch/base. Recovered its
omitted B6/B7 source checkpoint: unique whole-workout-page reload equality,
exact budget/course and DB equality retained. Coordinator full34445940362 ran22
once:20pass/2fail/0skip/0flaky,124710ms; B6/B7 pass3131/3350ms. A2 initial-Finish
summary fails745/7711ms before editing (post-start reached, a2-edit unreached);
A3 initial-Finish Edit result fails1003/8213ms. All other20 including A4, native16/
normal149/catalog/identity/Auth36HTTP/FK/core and both cleanup proofs pass.
Main browser failure retained; no raw historical cause invented or logs fetched.

Actual shared flusher plus controlled storage/action promises reproduce initial
and final empty-snapshot/new-entry stranding, and replacement-subscription
notification loss. Corrected baseline12pass/3fail; smallest shared coordination
fix joins results and honors fresh-snapshot requests without retrying a failed
head or overtaking a lease. Published3fe00fae promptly; expanded regression
checkpoint3385edb3/tree81ea3eba3308f356b37d4f59e76f40931783c689. All21 flusher
tests pass, preserving modalities/FIFO/single lease send/transient STOP/
bounded retries/dead letters/offline queues/receipt replay/cleanup.
No UI, action, canonical view, training, DB, ownership or acceptance changes.

Measured12existing suites653pass, including reader498 and private installed
Playwright1.60.0 actual --list: exact22/six files2/4/4/8/3/1/zero execution/errors,
private modes and exact cleanup. Scoped lint/types/offline docs drift/diff and
secret scans pass; full-history identity136commits at source checkpoint passes,
local/public approved native cloud author/GitHub committer verified. CodeQL
returned no alerts but did not analyze successfully (Actions failed; JavaScript
database too large). HANDOFF latest top checkpoint contains commands, exact
tree, baseline evidence and limits. No proof either race caused recorded A2/A3;
no live browser/SQL/Docker/hosted/production work, delegation, rewrite or dispatch.
Freeze22, preserve9419/B2/A4 and all safeguards; coordinator inspection,
exact-head core then ONE new-head full22 pending.

## [2026-09-10] refine | PR805 bounded A4 observations, diagnostics only

Continued sole PR805 writer from8d16d231/basee2758dad without branch/history
changes. Coordinator full34448179711@8d16/reference102777539397 ranALL22 once:
21pass/1fail/0skip/0flaky,89988ms. A2/A3 pass5556/9493ms; B6/B7 pass2035/3330ms.
A4 alone fails8343ms at original lifecycle1180 Edit-result visibility after
reconnect; prior offline receipt/second-context archive/stored equality pass.
Native16/normal149/catalog/identity/Auth36HTTP/FK/core and both cleanup pass.
Main failure retained; no historical raw error/body/row or causal inference.
Proven shared-flusher correction unchanged, not claimed to explain recorded failures.

Published sourceb2d1046bab5aa3d250ff92cee0f5fd7d048e6975,
testeda003709fa29026cbd846a141c5b3a290f14b7e5d. A4-only a4-replay and
a4-replay-transport use existing strict six-key160char/max16 grammar and
caseINDEX21 projection. Backend completion requires exact synthetic session/
expected receipt/valid completion timestamp, independently of finite HTTP class.
Loopback/path/body matching retains the exact original Request for later replay.
Original5s UI assertion runs independently of category/backend; owned deadline,
abort-aware SDK read without automatic retries, timer/listener/promise cleanup
and no post-failure sampling preserve the primary error. Other21 cases and A4
before/after-window source byte-identical; no product/action/DB/fixture changes.

Existing8files687tests pass: membership22, reader/source541, privatecollection1,
flusher21, controls43, actions37, lifecycle9, draft13. Installed Playwright1.60.0
actual --list verifies exact22/sixfiles2/4/4/8/3/1/zeroexecution/errors/private0700/
exactcleanup; reader tests retain0600. Scoped lint/types/offline docs/diff pass;
source secret scan clean, published cloud198982749/GitHub noreply identities
verified. CodeQL zero alerts but no usable analysis (Actions failed; JavaScript
database too large), not a security pass. HANDOFF latest records exact tree,
commands, counts, source evidence and limits. DIAGNOSTICS ONLY, not a bug fix
or runtime pass. No historical logs/transcripts, live browser/SQL/Docker, hosted
data, delegation, dispatch, rewrite or safeguards changes. Coordinator source/
privacy/timebound inspection, exactheadcore then ONE newheadfull22 remain next.

## [2026-09-10] refine | PR805 A3 first-Finish observation remainder

Live source8c9e2f9/basee2758dad verified. Coordinator's accepted22 is
full34450901183@89f63bdd0d6661841eeb24d6f8cc8172299b831d:
22once/zero skip/flaky/86.599s/all11 main stages+both cleanup passed.
First24 full34454551886 attempt1@306f1ae failed A3 initial Finish,
A5 post-purge reload, A6 identity helper:21pass/3fail; MAIN FAILED retained.
Inspected/preserved8c9 A5 destination/removed-before-reload and A6 root0/$K/_part_
corrections. A3 only gains two closed index20 observations of original transport
and matching receipt/UI/alert; unchanged five-second positive goal, no causal fix.
No product or other23 case-body change. HANDOFF records actual local results;
exact-head core then ONE guarded full24 still required. No private worker evidence
or browser acceptance inferred from collection.

## [2026-09-10] refine | PR805 standalone A7 post-start limitation safety

Verified exact live0a0e64fec61074d05651246bb9b6eb1e964d1820/basee2758dad.
Preserved coordinator accepted full34460014574 attempt1:24once/zero unexpected,
flaky or skipped/159461ms/all11 stages/empty failure ledger/both cleanup,
reference102815361640 following exactcore34459459983. Accepted22 and failed
first24 remain honestly recorded;8c9 A5/A6 fixes and0a0e A3 observations untouched.
Appended only A7: real restriction after Start, retained draft and actual receipt/
history/load, rejected future Start and reviewed resume with exact state equality.
Primary protection uses the post-limitation baseline and retains completed evidence.
Closed25 preserves the exact24 prefix; sixfiles2/4/7/8/3/1, A7index24,
no new diagnostic points. HANDOFF records checks and limits. No runtime/browser
acceptance claimed; coordinator exact-head core then ONE full25 still required.
Concurrent scheduling/proposal acceptance, combined and production authority
remain outside this task; backups deferred.

## [2026-09-10] refine | PR805 A7 final-return navigation boundary

Live head1d8e13ae/basee2758dad verified; source/test saved early as32232083.
A7 repeated A5's corrected click/reload race. Added only exact destination and
saved-result waits before its final reload; all original post-reload oracles,
other24 bodies/helpers and closed25/privacy guards unchanged (DC-SW7/DC-SW9).
From `/home/runner/work/hybrid-training-app/hybrid-training-app`,
`pnpm --filter @hta/web exec vitest run src/lib/swim/__tests__/swim-browser-acceptance.test.ts -t 'A7 DC-SW7/DC-SW9: the authored final return'`
failed on unchanged1d8 source (reload called once while destination pending),
then passed1 after correction. Actual authored block executes through existing
transpile/VM tools with independently deferred destination/result and original
post-reload assertion; no browser/network/DB.
`pnpm --filter @hta/web exec vitest run src/lib/swim/__tests__/swim-alert-membership.test.ts src/lib/swim/__tests__/swim-browser-acceptance.test.ts src/lib/swim/__tests__/swim-acceptance.test.ts src/lib/swim/__tests__/swim-browser-collection.test.ts`
passed1022 (25/590/406/1). Installed private Playwright1.60.0 --list:
25/sixfiles2/4/7/8/3/1/zeroexecution/errors; A7index24/A3-A4points20-21 intact.
`pnpm --filter @hta/web exec eslint e2e/swimming-lifecycle-load-mobile.spec.ts src/lib/swim/__tests__/swim-browser-acceptance.test.ts`,
`pnpm --filter @hta/web typecheck` and `git diff --check` passed.
Secret scan clean, mandatory CodeQL skipped test-only changes; unchanged
pre-push hooks passed, native cloud/GitHub identities verified locally/publicly.
HANDOFF records evidence and scope. Accepted24 remains accepted; collection is
not runtime. Coordinator exact-head core and ONE guarded full25 still pending;
A7/concurrency remainder and separate combined/production approvals unchanged.

## [2026-09-10] refine | PR805 A7 filled Notes selector

Exact live524c5935/basee2758dad verified; source/test saved early as5c8b18cb.
Only A7's two Notes lookups use the exact textbox role/name (DC-SW7/DC-SW9).
All value/draft/canonical/safety oracles, final-navigation waits, other24 and
Reason remain unchanged. Coordinator evidence: core34464155869 passed;
full34464675255attempt1 failed24pass/1fail,0flaky/skipped,155281ms. A7 alone
failed9435ms at original Notes lookup line2005; Finish/future Start/resume not
reached. All10 non-browser stages and both cleanups passed; main is not25/25.
No raw log/transcript downloaded or prior worker restarted.

From `/home/runner/work/hybrid-training-app/hybrid-training-app`,
`pnpm --filter @hta/web exec vitest run src/lib/swim/__tests__/workout-controls.test.tsx -t 'A7 DC-SW7/DC-SW9: retained Notes'`
failed before the spec fix at the source-contract check, after proving actual
WorkoutClient SSR filled Notes fails installed Playwright1.60.0 exact-label
matching but succeeds with its textbox engine and exact retained value.
Existing DOM parser plus limited HTML adapter, no copied selector algorithm,
hydration/restore-effect/browser proof or demonstrated notes loss.
`pnpm --filter @hta/web exec vitest run src/lib/swim/__tests__/workout-controls.test.tsx src/lib/swim/__tests__/draft.test.ts src/lib/swim/__tests__/swim-alert-membership.test.ts src/lib/swim/__tests__/swim-browser-acceptance.test.ts src/lib/swim/__tests__/swim-acceptance.test.ts src/lib/swim/__tests__/swim-browser-collection.test.ts`
passed1079 (44/13/25/590/406/1), including actual private pinned --list:
25/sixfiles2/4/7/8/3/1/zeroexecution/errors; A7index24/points20-21 intact.
Scoped ESLint, web typecheck, offline docs drift and diff checks passed;
commands and limitations in HANDOFF. Secret scan clean; CodeQL skipped test-only
changes. Unchanged native hooks passed; source identities verified locally/publicly.
Collection is not runtime: coordinator inspection/exact-head core/ONE full25
pending. Seven of nine gates remain covered; A7/concurrency, combined/production
approvals and deferred backups unchanged. No services, dispatch or product changes.

## [2026-09-10] refine | PR805 owner-approved bounded A7 first-Finish observations

Exact live63235ae3/basee2758dad verified; sole805 writer, early tested6af346d0,
completed sourcec4f7a6fe/treee6f39d70. Owner's “Allow two bounded observations
(Recommended)” permits only a7-finish/a7-finish-transport at index24 inside
the unchanged original five-second assertion. Original Request/pinned decoder,
exact target/session/owner/receipt, one AbortSignal/.retry(false) read and finite
closed UI snapshot; no polling, widened budget, product/schema/RLS change.
Owned waits/listeners/timer settle on success/failure; late results cannot write,
only a failed page may close, and the original assertion error retains priority.
A3/A4 and original24 prefix/shared helpers plus remaining A7 oracles unchanged.

Coordinator latest full34467283585attempt1@632:24pass/1fail/0flaky/skipped,
134031ms; A7 failed9112ms at original2011 Finish summary, after restored
Notes/whole-draft equality passed. Canonical completion/future remainder not
reached. Core34466774500, original24, first10 non-browser stages and both
cleanups passed; main remains failed. No prior worker restart, reference/agent
log/transcript/download-URL retrieval or historical run combination.

HANDOFF records exact six-selector command:1132pass (44/13/29/639/406/1),
source-executing fast/foreign/ambiguous/held/late/success/failure regressions and
strict projection. Actual private Playwright1.60.0 --list passed25/sixfiles
2/4/7/8/3/1/zeroexecution/errors/private cleanup. Scoped ESLint, web types,
diff/secret checks and native source publication hooks passed; local/public
identities approved. CodeQL returned0 alerts but unusable Actions/JavaScript
analysis, not a security pass. Collection is not runtime acceptance or causal
product-fix evidence. Coordinator complete-source/model/ref inspection,
exact-head core/ONE changed-head full25 pending, all flags/limits unchanged.
Seven of nine gates covered; A7/concurrency and combined/production approvals
remain open, existing accounts/deferred backups unchanged.

## [2026-09-10] refine | PR805 canonical completion checkpoint

Refreshed fc360/base e275; prior8788 not restarted. Latest coordinator evidence
is full34478188698attempt1@fc360:22pass/3fail/0flaky/skipped,134775ms; Main
failed, other ten stages and both cleanups passed after green core34477706905.
A3 committed but lacked result UI; A6 DB outcome unknown; A7 passed completion
through2186 then failed the bare alert at2195. Samples are not inferred causes.
Actual component/handler VM+SSR with held stale props reproduced saved-without-
result for direct/auto paths on unchanged production (two intended failures).
Canonical server view now flows through the existing drain and WorkoutScreen;
two A7 safety locations exclude only the exact Next announcer. No diagnostic
expansion. Initial six-selector batch in HANDOFF:935pass, including actual
PRIVATE Playwright1.60 collection25; scoped lint/types passed. Failure/replay
coverage and final security verification pending at this early checkpoint.
No reference/agent logs retrieved, runtime gate dispatched or backend started.
Coordinator exact-head core then one full25 remains required.

## [2026-09-10] refine | PR805 completion confirmation regression coverage

Early tested checkpoint96245055 published with verified allowlisted local/public
identities. Final same six-selector cloud command in HANDOFF:983pass
(79/37/200/26/640/1), including actual PRIVATE Playwright1.60 collection25.
Types and scoped lint passed without warnings. Real action/projection fixtures
cover original receipt, committed native result and shared recompute ordering;
actual component/WorkoutScreen VM+SSR cover canonical display with held stale
props, newer incoming revision, invalid/mismatched/missing confirmation, local
accepted-receipt recovery and explicit existing reload warning. Flusher fixtures
retain fresh-snapshot/FIFO/lease/STOP/dead-letter tests and verify the same server
view reaches overlapping manual/auto and offline replay callers. No second write
on post-commit view/cache failure; recompute replay semantics unchanged.
A7 diff is only its four alert assertions at two safety sites; all observations,
positive Finish/timeouts and original24 unchanged. Existing pinned announcer
proof is supplied historical evidence, not a newly executed probe. Security
verification pending; coordinator core/full25 remains pending and latest runtime
result remains failed22/25, not acceptance of this repair.

## [2026-09-10] refine | PR805 accepted25 and bounded B9 source

Refreshed exact60e5/basee275. Coordinator accepted full34481788221attempt1:
25 passed once,0 unexpected/flaky/skipped,143518ms, all11 stages and both
cleanups after FIRST core34481195293. Eight of nine standalone gates covered;
older failed25 and accepted24/22 remain distinct. Appended only B9/index25
for real same-user concurrent recommendation/date acceptance and genuine stale
rejection, preserving accepted25 and observation grammar. Strict26/sixfiles
2/4/7/9/3/1 private Playwright1.60 collection, scoped lint/types passed.
Initial source batch exposed remaining B-file count8, corrected to9; final
proofs pending. No reference/agent logs fetched, runtime startup or dispatch.
No production change; coordinator inspection/core/one frozen26 remains pending.

## [2026-09-10] refine | PR805 B9 source validation checkpoint

Early ea17f431 published with allowlisted local/public identities. Final
five-selector worker batch passed932 (644/1/66/21/200), including actual
PRIVATE Playwright1.60.0 collection26/sixfiles2/4/7/9/3/1 with zero execution
and exact cleanup. Pinned Next/React encoder exercises original B9 arguments;
accepted B1–B8 source hash and other five spec files remain unchanged.
Scoped lint/types passed. Plan/audit/history and primary/result/region
comparisons use private boolean equality; winning resume preview remains the
oracle and rejected UI retains its inputs. Secret/CodeQL/final publication
verification pending. Runtime B9/core/frozen26 remains coordinator-owned.

## [2026-09-10] refine | PR805 B9 final source handoff

Complete code/tests af5d4fe9 published with verified allowlisted local/public
identities; seven-file scope only. Changed-file secret scan and diff checks
passed. Existing identity guard checked157 introduced commits before publication.
CodeQL requested after code commit, skipped for test/documentation-only changes;
not an analyzed security pass. No product defect was demonstrated by source/
unit/collection work. B9 runtime is unexecuted; coordinator terminal model/refs
inspection, exact-head core FIRST, then ONE frozen26 remain required. All
accepted25 evidence and unresolved combined/production boundaries are preserved.

## [2026-09-10] refine | PR805 B9 schedule-version oracle correction

At refreshed ff133f/base e2758, corrected only B9's ruleVersion operand to
the existing SWIM_SCHEDULE_VERSION; generatorVersion remains SWIM_GENERATOR_VERSION.
The existing resume unit harness captures the real action's appended schedule
decision and executes B9's source equality: old expectation throws, corrected
expectation passes. One affected-selector batch passed63 (783 unselected),
including private collection26 without execution; scoped lint/web types passed.
DC-SW5/SW7/SW8; no product, schema, semantics, diagnostics or frozen26 case change.
Coordinator-supplied full34487229136 attempt1@ff133f failed only B9 after
original25 passed once (147834ms total, B9 7592ms, no flaky/skipped); earlier
core34486576111 passed. Generic same() line71 cannot identify its caller/phase.
Both cleanups passed; main failed. No consumed reference/private logs fetched.
Prior1acdd/be5ad work remains saved; current26 is not accepted. Coordinator
terminal/ref inspection, exact-new-head core FIRST, then ONE full26 remain.

## [2026-09-10] refine | dormant owned primary-cardio link foundation

Owner-approved isolated development only: ADR0079 now records migration0149's
nullable unique owner-checked parent-slot identity and unconditional NULL CHECK.
Column-specific SET NULL retains owner/history. Guarded down rejects bindings or
missing/unvalidated dormancy; later activation must preserve source provenance
and restore the invariant through its own reviewed rollback first.
Normal total150; identity146/147/148, five phases/four original DDLs/15contexts,
Auth36, existing FK proof and frozen26 are unchanged. Existing source registration
covers up/down without broadening the reference path. Focused Vitest455, scoped
lint, DB/web types and offline150/Drizzle checks passed; no live database proof.
HANDOFF separates remaining up/down/ownership/deletion/dormancy proof and atomic
authenticated start/completion/mutation races from this dormant source slice.
Coordinator-supplied full34490583441 attempt1@8c589 accepted all26 once after
exactcore34489951509; all nine standalone gates covered. Historical failures stay
distinct. No consumed logs, runtime dispatch or production migration; production
ordering reconciliation and activation remain separately gated. DC-SW5/SW7/SW8/SW9.
---

## [2026-09-06] bootstrap | Copilot cloud setup workflow
Added the setup-only `.github/workflows/copilot-setup-steps.yml` for future GitHub Copilot cloud-agent sessions. The workflow uses standard `ubuntu-latest`, read-only contents permission, bounded setup steps, frozen pnpm install from the root `packageManager`, Playwright Chromium/Linux dependency installation, and a headless launch check; it intentionally avoids database services, migrations, seeds, secrets, production credentials, build/test duplication, runner changes, firewall changes, and billing changes. It becomes available to cloud sessions only after merge to the default branch and can be verified as an ordinary Actions workflow on this PR branch.

## [2026-09-06] fix | Allow the observed Copilot cloud commit email
Added only `198982749+Copilot@users.noreply.github.com`, observed as the author email on all three PR #801 commits, to the CI identity guard's existing allowlist. Preserved exact author AND committer email matching and the original three entries; clarified local/cloud labels and replaced owner-impersonation/rebase guidance with account-appropriate email guidance. This email-string check is not actor authentication. No engine constraints, setup workflow, dependencies, or other workflow settings changed.

## [2026-09-05] fix | Swapped main lifts use the selected exercise's volume

Tactical Barbell replacements keep their template slot for role, ordering,
links, and supplemental behavior, but movement-specific volume now follows the
exercise actually selected. A Front Squat replacing Zulu's deadlift slot uses
the normal 3–5-set main-lift range instead of inheriting Deadlift's 1–3-set
exception; Activation's deadlift-only range and taper follow the same rule.
The program editor shows the replacement dose before deployment. No migration.

## [2026-09-09] refine | Split single-leg Romanian deadlifts by implement

The movement catalog now carries separate dumbbell and barbell Single-Leg
Romanian Deadlifts with distinct equipment filters, instructions, and load
histories. Migration 0145 updates the existing dumbbell row in place, preserving
its UUID and every linked training max and logged set, then adds the barbell row.
The rollback restores the legacy dumbbell-or-kettlebell definition and refuses
to remove the barbell row after it has user references.

## [2026-09-09] fix | Save larger sessions and time Dead Hangs

Tactical Barbell session edits now accept up to 20 movements, matching the
editor's supported session size instead of rejecting the ninth row with a raw
array-validation error. The editor stops offering another exercise at that
bound. Dead Hang now carries an explicit hold-time dose from customization
through the program engine and adapter, so previews and workout logs use seconds
instead of reps. Existing Dead Hang rows without a timed override use 3 sets of
20–40 seconds. No migration.

## [2026-09-10] decision | PR805 standalone integration and deferred combined handoff

Owner-approved standalone-first integration merges main672e420 into the existing
PR805 native history while retaining the combined foundation at immutable
[064aea85](https://github.com/drrowdev/hybrid-training-app/commit/064aea85c10efd057e9d2485a5957734dee78c36).
Only its dormant migration/schema and specific contracts leave the active chain.
Main's shipped0145 seed is unchanged; four unshipped swimming up/down files
move byte-for-byte to146/147/148/149 with journal timestamps1788912000001–4.
Normal total150, identity function states146/147/148, five phases/four DDLs/
15 contexts/Auth36, old-FK proof and frozen26 are preserved.

One exact-commit feature CI now gates isolated acceptance on core and native
identity success. Safe failure attribution adds bounded allowlisted caller
locations and only unambiguous boolean matcher values, never raw diagnostics.
AGENTS reading paths and meaningful-entry policy are corrected; quarterly wiki
health checks, immutable sources, safety and native authorship remain.
The first focused five-selector batch passed1247/1248; its sole report-shape
expectation was corrected; repaired batch passed1248/1248. Byte comparisons
verified eight renamed SQL files, all146 shipped main SQL/journal entries,
timestamp ordering and unchanged frozen e2e files. HANDOFF and the delivery
report carry final checks.
Accepted34495520676attempt1@064aea is not integrated acceptance and was not rerun
or reread. No services, hosted data, production change or CI dispatch here.
Coordinator gated exact-SHA CI, owner review and release remain pending.
App rollback first, then149→148→147→146; base down refuses retained swim history,
so leave schema/data intact when safe rollback cannot proceed. DC-SW5/SW7/SW8/SW9.

## [2026-09-11] implementation | PR805 standalone swimming usability

Added swimming-first onboarding and an integrated New plan choice; canonical
strength-calendar-aware defaults with submit-time overlap confirmation/audit;
and issued-snapshot technique/effort/focus guidance. DC-K4, DC-SW2/SW3/SW5/SW7/SW9.
The first existing blockless E2E now covers fresh onboarding; frozen26 count is
unchanged. See `pool-swimming.md` and the appended HANDOFF for offline evidence
and pending coordinator-only runtime validation. No schema, RLS, deployment,
account administration or initialized-review access.

## [2026-09-11] implementation | PR805 bounded isolated-review refresh primitive

Published source `a18738bab1fd807825d1299a3fe27238df1a3f31` (early checkpoint
`9c6a3e9a`) adds a separate refresh-only guard/transport/state machine and 101
offline tests, reusing accepted deployment receipt and identity validators.
Only BUILD_SHA may change before a single exact-SHA Preview and stable-UID alias
reassignment. Read-before-write/postverification is not atomic CAS; ambiguous
writes require manual reconciliation, never retry/rollback or data mutation.
Existing review suites passed 920 tests; db and direct strict source typechecks
passed. Automated reviewer unavailable; CodeQL analysis failed/skipped, not a
security pass. HANDOFF records exact commands and limitations. No workflow,
app/E2E/migration/reference changes, credentials/provider/account operations or
26-case rerun. Later workflow wiring and owner usability remain pending.

## [2026-09-11] blocker | Refresh wiring conflicts with frozen CI job digests

At verified feature `2e398072` / main `672e4202`, the required root refresh-test
step changes two historical CI-job digests in the prepare/configure review
suites. Both existing assertions pass (2 passed, 418 skipped); an in-memory
step insertion demonstrates the conflict without changing workflow source.
Those test paths are also outside the accepted refresh-only source allowlist.
HANDOFF records the exact boundaries and requests authorization for narrowly
scoped integrity-test/source-path updates before wiring can proceed. No guards
weakened, source implementation changed, full-suite acceptance claimed, provider
operation performed or workflow dispatched.

## [2026-09-11] implementation | Local isolated-review refresh wiring

Moved the refresh suite into existing package test discovery rather than
modifying the frozen core jobs. Both historical workflow hashes remain intact.
Added actual-dispatch exclusivity checks and a default-off refresh job gated by
core and identity, with source checks before its four step-only credentials.
The five focused suites passed 1,058 tests; direct strict script typechecking
passed. Windows full-web attempts were not accepted because of unchanged
POSIX/symlink restrictions; Linux CI is still required. No application, migration,
reference execution or provider/data changes. See HANDOFF for the bounded
remaining publication and isolated-review operation.

## [2026-09-11] decision | Garmin calendar delivery is part of the owner workflow

The owner clarified that getsxc is for reviewing/editing generated plans and
the Garmin Forerunner 970 is for executing workouts. Dated workouts should be
published to Garmin's training calendar; manual in-app swim logging is not the
owner's intended path. This promotes Garmin delivery from deferred scope,
beginning with swimming while retaining the wider generated-program goal.

The owner has no approved Training API access. Primary Garmin documentation
confirms calendar publishing/device sync and business-use application approval;
the watch manual confirms custom workouts and the training calendar. Detailed
API behavior and actual swim-step/device fidelity still require verification.
Updated existing plan/scope/wiki/index and distinguished outbound calendar
delivery from activity-file import. No connector, credentials, provider
application, user-data/RLS/schema changes or production operation was performed.
Frozen26 at0a3 and refreshed review atabbd remain accepted only in their original
scope; they do not prove this newly required Garmin workflow.

## [2026-09-11] implementation | Offline swim plan review before saving

The owner clarified that app/programming completion comes before any live
Garmin or production work. Missing API approval is not an offline blocker;
browser-assisted transfer is a possible later route requiring explicit
authorization, not a current live pilot.

Added a read-only setup preview using the same generation, input validation,
current limitations and strength-day confirmation as creation. It displays
all dated weeks and structured prescriptions using existing native-distance,
repeat, effort and pacing presentation. Input changes invalidate the preview,
and obsolete responses cannot overwrite newer setup state. Saving rechecks
conditions; existing direct creation remains available.

Synthetic regressions cover preview/save fidelity, no preview writes, optional
assessment, explicit empty weeks, current safety/overlap checks, editable setup,
stale responses and errors. DC-K4, DC-SW1/SW2/SW3/SW9. No generator rules, schema,
RLS, saved history, frozen26 cases or provider configuration changed. This is
local source, not a deployed change or completion of saved-plan editing or
Garmin delivery. Historical acceptance remains source- and scope-specific.

## [2026-09-11] implementation | Reviewed future swimming changes

Added explicit preview/apply for a selected future week's main repeats, even
before completed results exist. It reuses the existing generator/override rules,
warns and records the manual choice, and preserves other weeks and already
started work. Later progression uses the selected week's stored dose.

Added individual date previews within the assigned training week, with current
strength/other-swim warnings, explicit confirmation, stale-preview rejection,
and retained prescriptions. Reviewed resume anchors and partial weeks remain
intact. Both paths use the unchanged atomic update RPC, immutable setup rule,
revision checks and current safety path. Workout instructions now precede the
optional in-app start button. DC-K4, DC-SW1/SW3/SW4/SW5/SW7/SW9.

Fifteen focused offline web suites passed 483 tests; web typechecking and
changed-file lint passed. Real local Chromium rendered the actual components
with synthetic data and existing theme: no visible horizontal overflow at
320/375/768px with date controls collapsed or expanded. That is layout evidence,
not hydrated application, database, watch or release acceptance. Frozen26,
schema/RLS, provider configuration and live data remain unchanged; source is
local only. Independent scoped engine work and final integration remain pending.

## [2026-09-11] implementation | Swimming budget and event-horizon integration

Integrated the local programming agent's three reproduced repairs: event
feasibility is independent of week-array order; explicit slot budgets reject
non-finite and non-positive values; untimed prescriptions cannot consume their
entire stopping budget in known rests and turnarounds. Fully timed exact fits
remain valid.

A synthetic integration regression also reproduced saved-plan reconstruction
using the first actual swim as the week start. Reconstruction now retains the
stored program's declared weeks and original event horizon, including empty
weeks in a filtered resume cohort. Current resumed week/date presentation uses
the shared reviewed-week boundary. Invalid stored week indices fail visibly
rather than being omitted. No pace or event-prep opt-in is inferred.

DC-SW3/SW5/SW7 and existing safety/history rules remain intact. Engine and
affected web checks are local synthetic evidence, not hydrated app, database,
Garmin/watch or release acceptance. No schema/RLS, frozen26, remote source,
provider configuration or live data changed.

## [2026-09-11] implementation | Hydrated swimming review controls

Local React 19.2.4/Chromium execution reproduced duplicate React keys when a
reviewed week contained two swims on the same date. Read-only change rows now
have distinct keys; both entries and the explicit Apply payload are retained.
The existing unit suite includes the regression. DC-K4/DC-SW3/DC-SW5.

Thirteen local hydration scenarios passed with explicit synthetic action and
navigation stubs and no attempted network requests or client errors. They cover
stale responses, explicit preview/create/apply, input invalidation, native form
constraints, conflict warnings, mutation serialization, revision remounts and
failure recovery. Expanded component layouts fit 320/375/768px. The final
coordinator run uses the app's current sage palette, with local font fallbacks;
it is not full Next-shell, real-device or database evidence.

The full existing Next build also passed locally with telemetry disabled and
synthetic loopback-only Supabase configuration. Focused client tests, current
web typechecking and changed-file lint passed. The prior complete domain/engine
coverage run exceeded all 80-percent thresholds. Source remains local only:
current-source CI/reference, live Garmin/calendar/watch delivery and owner
acceptance remain separate and pending. No provider, owner-data, schema/RLS or
frozen26 changes were made.

## [2026-09-11] fix | Keep swim actions outside the retained prescription

Exact-head disposable reference34642668797 at `f09e7cc2` failed24/26, with no
flaky or skipped cases. Core/identity and all ten platform stages passed; both
cleanups verified. A5 failed the retained prescription text comparison after
result removal; A7 failed its final comparison after completion and pause.
Fifteen safe summaries were consumed once; the failure remains recorded.

The read-first layout had placed the conditional Start button inside the
prescription section, adding text that disappeared after completion. Two local
regressions reproduced that exact mismatch. The optional control now remains
after the instructions but outside their retained section. Frozen26, data,
issued work, safety and lifecycle logic are unchanged; no assertions were
weakened. DC-SW3/SW5/SW7. Corrected-head runtime acceptance is still required.

## [2026-09-12] decision | Accept standalone repair and prepare plan-review refresh

Reference34645293193 at `c1f25d2b` passed all26 scenarios once with no failed,
flaky or skipped cases, all11 stages, core/identity and both cleanups. A5 and A7
passed completely. Fifteen safe summaries were consumed once. Earlier
reference34642668797 remains failed; no logs were refetched or runs combined.
The existing nine standalone areas are revalidated, not Garmin delivery or
owner usability. The new editing controls additionally have focused action and
hydrated-client coverage, not dedicated database E2E coverage from frozen26.

The owner separately approved updating the existing isolated review while
preserving account, plans/history, isolation and sign-in protection. A new
default-false operation pins accepted application `c1f25d2b` and the existing
READY deployment/alias from34625326276. The shared bounded state machine retains
the old operation's original pins and guards. Its only new receipt window is
the prior authorized BUILD_SHA update; pool and other configuration windows
stay fixed. Existing workflow job bodies remain unchanged, including core,
identity, frozen26 and old provider jobs. New-mode exclusivity is checked in
core before credentials, then again in the dedicated protected job.

Only one branch-encrypted BUILD_SHA update, one exact-source Preview and the
fixed review alias assignment are allowed. The known alias UID is pinned
before writes. Ambiguous writes remain failed/partial and require manual
reconciliation, never retries or destructive rollback. The old spent refresh
is not rerun. Production, Garmin, schema/RLS, owner data and frozen26 are
unchanged; the review update remains pending guarded execution.

## [2026-09-12] decision | Remove in-app swim workout logging

The approved plan-review refresh34675114561 at `da91ab60` completed successfully.
Two safe records were consumed once; source and all eight operation stages,
same-workflow prerequisites, READY mapping, original alias UID, protection,
Auth, isolation and storage readiness passed. The fixed review now serves the
accepted plan-editing app. No production, Garmin or owner-data writes occurred.
That one-shot operation is spent.

The owner then explicitly requested removal of in-app swim logging. Removed
the workout logger, Start/Finish, per-repeat progress, result-entry/edit UI and
its local draft/queue creation. Old result-edit URLs now show the prescription
and saved historical result without editing. Keep scheduled-skip, future plan
adjustments, optional calibration, history and existing trash/restore. The hub
omits an empty logging-history prompt. Other sports' logging is unchanged.

DC-SW3/SW5/SW7/SW8 preserve prescriptions, stored results and legacy atomic
completion processing; no schema, RLS, data or browser-storage cleanup occurs.
The frozen26 source/evidence remains historical because it exercises removed
UI. New regression coverage asserts the requested absence of logging, intact
instructions/history and read-only old edit routes; this is not another
frozen26 pass or evidence of a new review deployment.

Focused local validation passed 410 tests across workout review, old routes,
history, planning/actions and legacy outbox handling. Fifteen actual
React/Chromium hydration scenarios passed using synthetic actions and blocked
networking, including absence of logging across all workout/plan states,
readable results, retained skip validation/failure handling and the existing
13 planning scenarios. Expanded layouts fit 320/375/768px. Web typechecking,
changed-file lint and offline knowledge-doc checks passed. These are not
real-database, physical-watch or new-deployment acceptance.

## [2026-09-12] decision | Refresh isolated review without swim logging

The owner approved updating the existing protected review to logging-removal
source `1c082ee854c5b3e595ebf198b01f878e4d9fe39d`, which passed automatic
CI34676255050. The owner also removed this session's scheduler: continue work
on completion rather than scheduled wakes. No new production or Garmin
permission was granted.

A new default-false read-only-review profile reuses the bounded refresh state
machine and pins current deployment da91/34675114561, its exact READY identity,
fixed alias UID and BUILD_SHA receipt window. Only seven tooling/doc paths may
differ from the accepted removal application. All twelve other operation flags
must be false in both the actual event and job context; core and identity
finish before the protected job. All twelve previous job bodies and spent
profile pins remain unchanged. The only permitted writes remain one exact
branch BUILD_SHA update, one exact-source Preview and the existing review alias;
no account, data, Auth, pool flag or production writes.

The summary explicitly identifies the accepted run as automatic CI, not
frozen26. The matching session reader checks that evidence kind and prior
receipt before accepting its single-use safe summary. Focused offline checks
passed 1,331 tests and strict source/test typechecking. Reader fixtures passed
the original four, plan-review six and read-only-review seven cases, including
partial failure, missing operation/source, wrong receipt/alias/evidence kind
and refusal to fetch logs twice. Provider execution and owner usability
acceptance remain separate from this source checkpoint.
