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

## [2026-09-01] fix | A substituted movement owns its loading maths

The whole-codebase review found a critical sibling of the weighted pull-up bug. Tactical Barbell lets a lifter replace a template slot with any catalog movement, but the saved customization chose the loading kind from the SLOT being replaced. Putting a normal Barbell Row into the Weighted Pull-up slot therefore kept `weighted-bw`: at 75% of a 120 kg max for an 82 kg lifter, the engine subtracted bodyweight and prescribed 7.5 kg instead of 90 kg. The reverse was dangerous: putting the new Weighted Dip into a Bench slot treated its bodyweight-inclusive max like a barbell max and prescribed +90 kg on the belt instead of +7.5 kg.

The first fix at the wizard boundary was not enough. Independent review found that deploy's `normalizeCustomMovement` unconditionally rewrote every catalog movement with a max to `barbell`, clobbering the corrected client value before it reached the engine. This also meant old customizations could never heal.

Loading kind is now derived from the selected catalog movement in one pure function: no saved max is `unanchored`; a bodyweight-loadable movement with a saved max is `weighted-bw`; any other movement with a max is `barbell`. The wizard uses it instead of inheriting the old slot, and deploy repeats the derivation from the trusted catalog row rather than trusting the client or stored blob. Existing customized plans therefore correct themselves the next time they are edited/deployed.

No migration. The catalog already owns `body_weight_loaded`, and the training-max and session-load paths already use that column to mean the saved max includes bodyweight.

## [2026-09-01] fix | Five engine-to-adapter contract breaks

A contract audit across every engine and the platform adapter found five places where what an engine prescribed and what the lifter was shown had drifted apart. All five are fixed together because they share one shape: the engine said something true, and the layer that reads it assumed a different meaning.

HYROX two-a-day emitted the afternoon session twice. The timeline already publishes a separate `-pm` ref for the second session, and `locateCell` already resolves it, so appending the same work onto the morning prescription put every evening station in both sessions. The morning ref now prescribes only its own session. Titles, tags and completion-station mapping are unchanged, and a materialization test asserts the morning row is byte-identical to the same ref built with two-a-day switched off.

Green ran every lift 11% heavy for anyone using the optional training max. Green has no top-level basis - it holds one nested strength engine per slot, each with its own `useTrainingMax`/`tmPercent` - but three call sites read a Green instance as if it were a Tactical Barbell one, found nothing, and concluded "true max", seeding 100%. A 125 kg engine target rendered as 140 kg. `greenStrengthBasis` is now the single home for that question and returns the basis the nested engines agree on, or `null` when they do not: a single `tm_percent` column cannot describe two divergent bases, and guessing is what caused this.

Writing the round-trip test for that exposed a second layer nobody had reported. Tactical Barbell and Zulu/HT both round the training max to the plate increment BEFORE applying the session percentage. Seeding the raw percentage made the renderer multiply in the other order, which lands a plate step away whenever the training max is not a round number - a 143 kg max at 90% and 75% is 95 kg from the engine and 97.5 kg from the naive product. The alignment now seeds the engine's ROUNDED ratio, which is what the 5/3/1 branch already did. A tidy 100 kg fixture hides this completely, which is why it survived.

`body_weight_loaded` was answering two different questions. It marks a movement that CAN be done with no external weight - lunges, step-ups, push-ups, inverted rows, eccentric chin-ups - and the training-max, session and catalog-substitution paths read it as "the saved max INCLUDES the lifter's bodyweight". Those are not the same claim, and the previous entry in this log records the moment the second reading was written down as if it were settled. A 70% forward-lunge off a 100 kg max for an 80 kg lifter resolved to 0 kg. Today only the explicitly weighted pull-up and weighted dip carry a bodyweight-inclusive max, so that fact now lives in `packages/domain/src/movement-load-identity.ts` as a catalog-slug and engine-key identity table rather than in a boolean whose name promises something broader. Ordinary bodyweight logging is untouched; the capability question keeps the column. No migration: nothing new is stored, and because catalog identity now WINS over the `systemLoad` marker on an already-materialised item, plans built under the old rule correct themselves on read. The marker is still honoured for movements the catalog cannot resolve.

Green's deload week materialised empty. The engine emitted the guidance as a standalone note, and the adapter folds a note into the item before it - with no item before it, the note was dropped and the session had nothing in it. The guidance is now a `cardio_external` item, which is the representation the schema documents for a session that carries no movement, duration or intensity. It is deliberately given no duration: four of the five phases already have three easy aerobic days in a deload week, and inventing a 30-minute session would add a fourth. It classifies as restorative and carries no stress load. The alternative - branching per phase - would leave those four phases with no deload session at all, which is the bug.

Green's public I/CAT phase delegates its pull-up assistance to Zulu/HT, whose source table quotes the sets as a share of the lifter's MAX CLEAN REPS. That share was carried as `percentOfTm`, which the adapter reads as a share of a LOAD, so a lifter with a pull-up entry saw a fabricated kilogram target on a bodyweight set. There is no max-rep anchor in the prescription to divide by and none is invented here: the share is already spent producing the source's prescribed 12/10/8, so the honest prescription is those reps plus the source's 3-5 set range, which the adapter already fans out as five slots with the last two optional. The note says what the reps are a share of.

Every fix has an end-to-end engine-to-adapter-to-materialize test citing DC-K4.

Two things were deliberately left alone. A pull-up rep max shares the `one_rm_kg` column with real one-rep maxes and is displayed with kilogram units in roughly eight places; that is a pre-existing product question about where a rep count should live, not an engine-contract break, and it needs a schema decision rather than a patch. And Green Outcome's combined session is intentional and test-locked, so it is unchanged.
