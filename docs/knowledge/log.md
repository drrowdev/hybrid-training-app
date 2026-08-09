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
Removed all UI affordances + writers for wellness.sleep_hours. Owner decision: sleep will arrive later via Apple Health / Google Fit; no manual entry in the meantime. Surfaces: (a) pre-session check-in (DC-P1) sleep chip row deleted — DC-P1 now reads literally as written (No mood, no energy, no sleep); (b) /app/stats overview sleep card removed; (c) /app/stats/wellness section A2 (Sleep) removed, sibling sections A1/A3/A4/A5 retained — section ids deliberately non-contiguous to mark the gap; (d) /app/stats/blocks index `Avg sleep` KPI tile removed; (e) /app/stats/blocks/[id] `Avg sleep` wellness tile + sleep compare section removed. Writers removed: startCheckInSession no longer accepts sleepChip; ecordDailyCheckIn silently ignores any inbound sleepHours / sleepChip form fields. Helpers deleted (unused after writer removal): sleepHoursForChip, SLEEP_CHIP_VALUES, SleepChip, sleepBucket, sleepBucketColor, SleepBucket, ollingMean (was only consumed by A2), entire pps/web/src/lib/stats/sleep-trend.ts. Schema: wellness.sleep_hours column intentionally kept (reserved for health-integration auto-fill — see comment in packages/db/src/schema/wellness.ts); no migration. DC-P5 footnote added noting the deferral. Tests removed: the E2E `pre-session sleep chip persists` (session-log-desktop), sleepHoursForChip mapping suite, sleepBucket boundary suite, ollingMean suite, sleep card / section / KPI assertions across 3 e2e specs (replaced with 	oHaveCount(0) guards). Test count goes DOWN; that's the intended marker that the surfaces are gone.

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
The dynamic accessory picker now consults profiles.equipment and drops candidates the user cannot perform. Two pure helpers — inferRequiredEquipment(movement) (slug-pattern heuristic, first-match-wins, conservative) and isEquipmentAvailable(req, equipment) (per-implement availability check) — wired into pickAccessoriesForSession via an optional quipment parameter; createBlock and createCustomBlock load it via esolveEquipment(profile). Main lifts bypass the filter entirely because they are resolved upstream from the user's training maxes, not from the picker catalog. Heuristic stance: when a slug doesn't clearly imply a specific implement (e.g. pallof-press, lateral-raise-machine with no MachineType-disambiguating token) it falls through to odyweight_or_generic and is always allowed. Better to over-include than over-filter — a thin pool from over-filtering looks like a bug to the user, while an over-inclusive pick is just one swap away.

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
