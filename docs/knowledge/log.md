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
