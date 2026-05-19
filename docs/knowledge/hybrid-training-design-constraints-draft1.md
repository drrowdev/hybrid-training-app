# Design Constraints — Hybrid Training Engine

> **STATUS (added 2026-05-19): DRAFT 1.** This file was produced by an earlier AI session using ONLY `hybrid-training-research-v1.md` + `hybrid-training-research-v2.md` + `hybrid-training-app-plan.md` as sources. **`hybrid-training-research-new.md` (with literature citations + HIGH/MODERATE/LOW confidence labels + the modality interference table + the MV/MEV/MAV/MRV framework + the polarized 80/20 data + the "Translation to app logic" code blocks) did not exist when this was written.**
>
> **What the next AI should do in Phase C:**
>
> 1. Read this draft as a starting point. It has 65 testable constraints across 6 categories already vetted against v1+v2.
> 2. Re-read every constraint against `hybrid-training-research-new.md`. For each constraint:
>    - **If `new` agrees** — append the `new` citation + confidence label to the existing source list, e.g. `(v1 §2 Rule 3 + v2 §3.8 + new §1.3, Wilson 2012 HIGH)`.
>    - **If `new` adds nuance** — modify the constraint text to reflect it, citing all three.
>    - **If `new` contradicts** — flag in the new `## Open conflicts` section at the bottom; do NOT silently change.
> 3. Add **new constraints** for principles `new` covers that v1+v2 didn't surface:
>    - The modality-by-modality interference cost table (cycling low, running moderate, rowing low-moderate, etc.) — should become a `DC-?` table-backed constraint.
>    - MV/MEV/MAV/MRV per-bucket landmarks under concurrent stress, especially the "MAV drops 20–30% under concurrent" heuristic.
>    - The 6-hour AMPK/mTORC1 refractory window (vs v2's coefficient-based interference modifier — these may need reconciliation in Open Conflicts).
>    - The Baar tendon framework (6h refractory, isometric protocols at 70–80% MVIC × 30–45s × 4–5 sets) — most detailed in `new`.
>    - The monitoring-stack priority (subjective wellness > RPE > 7-day HRV trend > anything else).
>    - The polarized 80/20 distribution heuristic for endurance days.
>    - Pre-mortem-derived constraints — e.g. "the engine MUST have an explicit override path with consent" (from `new` §10 failure mode 1).
> 4. Apply confidence labels at the END of every constraint based on cross-document support:
>    - **3-source agreement (v1+v2+new) → HIGH**, encode as a strict default
>    - **2-source agreement → HIGH-MODERATE**, encode as a default
>    - **1-source only → MODERATE-LOW**, flag for review
>    - **In `new` cited as `HIGH` from peer-reviewed meta** → upgrade one tier
> 5. Save the result as `hybrid-training-design-constraints.md` (drop the `-draft1` suffix) in `docs/` of the new repo when it exists.
>
> Target: 60–100 constraints. The three files together have enough density to support that without padding.

**Status:** Phase C draft for the project owner's Phase D review. Pre-repo location; will move to `docs/knowledge/design-constraints.md` when the new repo exists.
**Sources:** `hybrid-training-research-v1.md` (v1) + `hybrid-training-research-v2.md` (v2) + `hybrid-training-app-plan.md` (plan). **NOT YET cross-validated against `hybrid-training-research-new.md` — see status banner above.**
**Convention:** Each bullet is one testable engine invariant. Citations point to the load-bearing source section(s). Authority labels:
 - **[EV]** Evidence-informed principle — load-bearing; flag any deviation.
 - **[DEF]** Implementation default / engineering assumption — overridable.
 - **[DEF→cal]** Default that the v2 spec explicitly marks as needing calibration from real outcomes (v2 §9).

---

## A. Canonical units & primitives

- **DC-A1 — Two-layer units (v2 §2)** [EV] — Engine stores stress in canonical internal units (bucket points, region points) but renders prescription in user-facing units (kg×reps, sets/muscle, minutes by modality, hard minutes). *Test:* round-tripping a session through internal storage and back to prescription preserves the user-facing unit type and quantity to within rounding.

- **DC-A2 — Session load primitive (v2 §3.1)** [DEF→cal] — `session_load = duration_min × session_RPE`. *Test:* a 60-min sRPE-7 session yields load 420; missing sRPE blocks load computation (or marks it estimated, never silently substitutes a default).

- **DC-A3 — Six global stress buckets (v1 §8 layer 2, v2 §3.1)** [EV] — The engine maintains exactly six bucket ledgers: `neural, mechanical, metabolic, impact, axial, tissue`. *Test:* schema enforces enum; adding a seventh requires migration + ADR.

- **DC-A4 — Bucket coefficients sum to 1.0 per session (v2 §3.1)** [DEF] — Each session's six `bucket_coeff` values sum to 1.00 ± ε. *Test:* tagger rejects (or normalises) any session whose coefficients sum outside [0.99, 1.01].

- **DC-A5 — Region coefficients are not normalised (v2 §3.1)** [EV] — Region coefficients are independent (one session can load multiple regions); they do NOT sum to 1.0. *Test:* a heavy back squat session can produce region_points > 0 for knee, hip, lumbar, and ankle simultaneously without triggering a normalisation warning.

- **DC-A6 — Tracked regions (v1 §4, v2 §10)** [DEF] — Region ledger covers at minimum: foot/ankle/calf, knee, hamstring/posterior chain, adductor/groin, lumbar/trunk, shoulder/scapular, elbow/forearm. *Test:* default seed creates rows for each; deletion is forbidden (only disabling).

## B. Floor / target / ceiling allocation

- **DC-B1 — Allocation order: floors → targets → ceiling clamp (v1 §8 layer 3, v2 §11)** [EV] — Allocator fills floor doses for every quality first, then distributes remaining budget toward targets weighted by archetype priority, then clamps each quality at its ceiling. *Test:* given a recovery-crisis week, floors are still allocated before any target work; if ceiling < floor, the allocator emits a `recovery_crisis` event rather than silently dropping the floor.

- **DC-B2 — Ceiling ≥ floor invariant (v2 §7.2 step 15)** [EV] — For every quality every week, `ceiling_q ≥ floor_q`. *Test:* the planner asserts this after ceiling computation; violation triggers deload recommendation or block transition.

- **DC-B3 — No quality drops to zero (v1 §2 Rule 4)** [EV] — Floor doses are never zero for an active quality; "maintenance" and "protected" tiers carry positive minima. *Test:* given any archetype, every quality in the active set has `floor_q > 0`.

- **DC-B4 — Default per-quality floors (v1 §2 Rule 4)** [DEF] — Strength: 1–2 quality exposures per main pattern/week. Hypertrophy: per-muscle floor below growth volume. Aerobic base: ≥ 2 easy sessions/week. Anaerobic: 1 brief exposure / 7–10 days. Durability: short frequent microdoses (daily, 5–12 min). *Test:* seeded floor values produce these defaults for the balanced archetype on a 4–5 session/week user.

## C. Ceiling computation

- **DC-C1 — EWMA load state (v2 §3.2)** [DEF] — ATL = EWMA_7, CTL = EWMA_28, α = 2/(n+1), per bucket and per region. *Test:* given a synthetic 60-day load series, the computed ATL/CTL match the EWMA formula within 1e-6.

- **DC-C2 — Bucket pressure formula (v2 §3.4)** [DEF→cal] — `pressure_b = 0.35·N_acute_pct + 0.25·N_ratio + 0.20·N_monotony + 0.20·N_strain`. Weights overridable per ADR. *Test:* unit test pins the formula; changing a weight without updating the test fails CI.

- **DC-C3 — Normalisation in [0,1] (v2 §3.3)** [EV] — All recovery/stress metrics normalised to [0,1] penalty space (`norm_high` for "more is worse", `norm_low` for "less is worse"). Default bands per v2 §3.3 table. *Test:* fuzzing inputs across raw range never produces a normalised value outside [0,1].

- **DC-C4 — Systemic penalty formula (v2 §3.5)** [DEF→cal] — `systemic_penalty = 0.30·N_sleep + 0.22·N_HRV + 0.16·N_RHR + 0.16·N_compliance_instability + 0.16·N_global_soreness`. If HRV missing, redistribute 0.22 → sleep+0.08, RHR+0.07, soreness+0.07. *Test:* with HRV=null the redistributed weights sum to 1.00 and the test fixture matches.

- **DC-C5 — Global recovery multiplier (v2 §3.6)** [DEF→cal] — `GRM = clamp(1.07 - 0.18·global_pressure - 0.12·systemic_penalty, 0.70, 1.08)`. *Test:* given pressures from v2 §3.13 worked example, GRM = 0.917.

- **DC-C6 — Quality sensitivity matrix (v2 §3.7)** [DEF→cal] — Per-quality sensitivity to the six buckets follows the v2 §3.7 table; rows sum to 1.0; `quality_modifier_q = clamp(1.04 - 0.18·quality_pressure_q, 0.78, 1.04)`. *Test:* matrix-row-sum invariant + worked-example modifier values.

- **DC-C7 — Interference modifier (v2 §3.8)** [DEF→cal] — `interference_modifier_q = clamp(1.00 - 0.25·Σ(conflict_q,c · overload_c), 0.80, 1.00)`, where `overload_c = max(0, delivered_c/target_c - 1)`. Conflict coefficients seeded from v1 §13 + v2 §3.8 high/moderate/low matrix. *Test:* lower-body strength quality with hard-running delivered at 1.5× target produces interference_modifier < 1.0; same with delivered at target produces exactly 1.0.

- **DC-C8 — Region cap (v2 §3.9)** [DEF→cal] — `region_cap_r = clamp(1.00 - 0.25·region_risk_r, 0.70, 1.00)` with `region_risk_r = 0.45·N_symptom + 0.25·N_ratio + 0.15·N_novelty + 0.15·N_stiffness`. *Test:* irritated Achilles (symptom 6/10) compresses running ceiling but leaves bike ceiling intact.

- **DC-C9 — Base ceiling from recovered weeks (v2 §3.10)** [DEF→cal] — `base_ceiling_q = max(floor_q, median(last_3_recovered_weeks_dose_q) × headroom_q)`. Recovered-week criteria: anchor compliance ≥ 85%, global soreness ≤ 5/10 avg, no local symptom +>2pts, no perf crash on two anchor exposures, no severe sleep/readiness deterioration. *Test:* a 3-week window with one disqualifying week produces a 2-week median (or triggers the cold-start fallback — see Open Conflicts).

- **DC-C10 — Headroom cap (v2 §3.10)** [DEF] — `headroom_q = clamp(1.00 + 0.02·positive_streak - 0.03·local_flags, 0.95, 1.06)`; `positive_response_streak_q` capped at 2. *Test:* a 5-streak yields headroom ≤ 1.04 (cap on streak), not 1.10.

- **DC-C11 — Final ceiling equation (v2 §3.11)** [EV] — `ceiling_q = base_ceiling_q × GRM × quality_modifier_q × interference_modifier_q × region_cap_factor_q × confidence_bias`. *Test:* worked example produces lower-body strength ceiling ≈ 1.37 heavy-exposure-equivalents (v2 §3.13).

- **DC-C12 — Region cap aggregation policy (v2 §3.11)** [DEF] — Weighted mean of relevant region caps for broad qualities; **minimum** critical-region cap for high-risk exposures (running, plyo, deep knee-dominant lifts). *Test:* hard-running ceiling uses min(knee, ankle, calf) region caps; bike aerobic uses weighted mean.

- **DC-C13 — Confidence bias (v2 §3.11)** [DEF] — Data completeness ≥ 0.80 → 1.00; 0.60–0.79 → 0.95; < 0.60 → 0.90. *Test:* sparse-data new user (completeness 0.3) gets confidence_bias = 0.90.

## D. Interference / scheduling / conflict matrix

- **DC-D1 — DCI 24h spacing (v1 §3 Rule 3 + v2 §3.8)** [EV] — Scheduler defaults to ≥ 24h between max-effort lower-body lifts and threshold/VO2 runs. Override-settable with warning. *Test:* placing both on the same calendar day with no override emits a `scheduling_conflict_high` warning.

- **DC-D2 — Same-day ordering rule (v1 §3 Strategy A)** [EV] — When qualities must share a day, default priority order is: power/speed/skill → heavy strength → hypertrophy → conditioning → mobility. Reversible only as an explicit "endurance-priority" mode. *Test:* a same-day strength+conditioning session generated with no explicit mode places strength block before conditioning block.

- **DC-D3 — Conflict matrix categories (v1 §13 + v2 §3.8)** [EV] — High conflict: heavy lower-body strength ↔ hard running intervals; leg hypertrophy ↔ sprint/plyo density; repeated glycolytic ↔ strength progression. Moderate: threshold erg ↔ lower-body hypertrophy; high-axial lifting ↔ rowing volume. Low: upper-body hypertrophy ↔ easy lower-body aerobic; mobility microdoses ↔ ~anything. *Test:* conflict matrix seed contains exactly these pairings at their stated severities; missing or extra entries fail.

- **DC-D4 — No back-to-back glycolytic sessions (v1 §3)** [EV] — Two high-glycolytic sessions on consecutive calendar days require explicit override. *Test:* scheduler emits warning when proposing this.

- **DC-D5 — No sprint/plyo on unresolved tendon irritation (v1 §3)** [EV] — Sprint/plyo dose is blocked (not warned) when the relevant region's symptom score ≥ 4/10. *Test:* attempting to schedule plyometrics with an active knee tendon flag returns a hard rejection with a substitution suggestion.

- **DC-D6 — Conditioning modality default (v1 §3 Strategy C, v2 §4 archetype B/E)** [EV] — Default conditioning modality is low-impact (bike, erg) unless running is an explicit user goal or aerobic emphasis archetype with established tissue tolerance. *Test:* in strength-biased and aesthetic archetypes, generated conditioning sessions default to bike/erg modality.

- **DC-D7 — Easy:hard conditioning bias (v1 §3 Strategy C)** [EV] — Default conditioning backbone is predominantly easy aerobic with small allocation to threshold/VO2 and even smaller to glycolytic. *Test:* in a balanced 4-week microcycle generation, easy-aerobic minutes ≥ 3 × hard-conditioning minutes by default.

## E. Anchor-filler model

- **DC-E1 — Anchors are preserved before fillers (v1 §11)** [EV] — When time/recovery/equipment tighten, the allocator drops fillers first and preserves anchor exposures. *Test:* a session generated under a 30-min time budget keeps the anchor lift and drops accessories before splitting the anchor.

- **DC-E2 — Anchor classification (v1 §11)** [DEF] — Anchors per block must cover: 1 lower-body strength exposure, 1 upper-body strength exposure, priority hypertrophy allocation, ≥ 1 long/easy aerobic exposure, hard-conditioning touch (when scheduled), region-targeted resilience for any flagged weak link. *Test:* generated balanced block contains all six anchor categories within a 7-day window.

- **DC-E3 — Filler-first reduction on schedule compression (v1 §9)** [EV] — When schedule_compressed signal fires, engine reduces fillers and never proposes catch-up sessions. *Test:* given a missed mid-week session, the engine does NOT add the missed work to the weekend.

## F. Mesocycle archetypes

- **DC-F1 — Five archetypes only (v1 §5, v2 §4)** [EV] — Supported archetypes are exactly: `balanced_hybrid_build, strength_biased_hybrid, aesthetic_hybrid, engine_biased_hybrid, rebuild_return`. *Test:* schema enum is closed; adding requires migration.

- **DC-F2 — Archetype bucket weights (v2 §4.1)** [DEF→cal] — Each archetype seeds the six-bucket weight vector per v2 §4.1 table; rows sum to 1.00. *Test:* sum-to-one + numeric pins for each archetype.

- **DC-F3 — Block length defaults (v2 §4.2)** [DEF] — Balanced 5–6w, strength-biased 4–6w, aesthetic 6–8w, engine-biased 4–6w, rebuild 3–5w. *Test:* default-length helper returns these ranges; out-of-range custom values raise warning.

- **DC-F4 — Deload protocol embedded per archetype (v2 §4.2)** [EV] — Deload definitions (volume cut %, intensity preservation, anchor preservation) live in the archetype definition row, not in user/program code. *Test:* selecting an archetype loads its deload block-definition without additional configuration.

- **DC-F5 — Rebuild has no formal deload (v2 §4.2 E)** [EV] — Rebuild blocks run entirely below ceiling; no deload week. *Test:* attempting to schedule a deload in a rebuild block is a no-op with informational log.

- **DC-F6 — Max 2 consecutive specialty blocks (v2 §4.3)** [EV] — Strength-biased and engine-biased archetypes cannot run > 2 consecutively; the state machine forces a balanced interlude. *Test:* requesting a 3rd consecutive strength-biased block returns a forced-balanced transition.

- **DC-F7 — All specialty transitions route through balanced (v2 §4.3)** [EV] — State machine never transitions specialty → specialty directly; intervening balanced block is mandatory. *Test:* transition aesthetic → engine-biased emits a balanced block insertion.

- **DC-F8 — Rebuild max duration 5 weeks (v2 §4.2 E + 4.3)** [EV] — Rebuild auto-transitions to balanced after 5 weeks. *Test:* week 6 of rebuild triggers forced transition.

- **DC-F9 — Aesthetic ceiling in deficit (v2 §4.2 C)** [DEF] — Body-comp phase "lean_out" carries a 15–20% lower hypertrophy ceiling than "gain". *Test:* same user/state in deficit yields a per-muscle target ≤ 0.85× of the surplus target.

## G. User-tier inference

- **DC-G1 — Tier is behavioural, not declared (v2 §5.1, §5.6)** [EV] — Effective tier is inferred from BTS; self-report can downgrade but cannot upgrade beyond what behaviour supports (with one anchor-compliance bypass). *Test:* user self-reports "high_performance" with 60% anchor compliance → effective tier remains intermediate (or below).

- **DC-G2 — BTS formula (v2 §5.3)** [DEF→cal] — `BTS = 0.25·anchor_compl + 0.15·session_compl + 0.15·completion_quality + 0.15·schedule_regularity + 0.10·recovery_input_consistency + 0.10·performance_trend + 0.05·frequency + 0.05·feature_engagement`. *Test:* pinned weight vector + computed BTS for a fixture user.

- **DC-G3 — Tier thresholds (v2 §5.4)** [DEF] — Consumer 0–49, Intermediate 50–74, High-performance 75–100. *Test:* boundary values yield expected tier.

- **DC-G4 — Hysteresis (v2 §5.4)** [EV] — Promotion requires 3 consecutive 28-day windows above threshold; demotion requires 2. *Test:* a single high BTS window does not promote; two low windows demote.

- **DC-G5 — Cold-start tier (v2 §5.6)** [DEF] — First 28 days default to intermediate unless onboarding indicates very low experience → consumer. *Test:* new user with no data is intermediate by default; onboarding flag "training_age < 1y" defaults to consumer.

- **DC-G6 — Tier-gated planning parameters (v2 §5.5)** [DEF] — Volume-ceiling headroom multiplier per tier (0.85/0.95/1.00), hard-conditioning sessions/week cap (0–1/0–1/0–2), autoregulation depth, session complexity cap (≤5/≤7/≤9 exercises), deload trigger mode. *Test:* a high-perf user can schedule 2 hard-conditioning/week; a consumer cannot.

## H. Stall diagnosis

- **DC-H1 — Five-category diagnosis (v2 §6.1)** [EV] — Stall outcomes are exactly one of: `underdosing, fatigue_suppression, cross_quality_interference, local_tissue_limitation, true_plateau`, plus `monitor` for inconclusive. *Test:* enum closed; diagnosis engine never returns an unmodeled label.

- **DC-H2 — Signal evaluation order (v2 §6.2 + §6.4)** [EV] — Diagnostic order is fixed: local tissue → systemic fatigue (GRM) → interference → dose adequacy → true plateau. *Test:* with both region_risk > 0.60 AND GRM < 0.90, diagnosis returns LOCAL_TISSUE_LIMITATION (tissue beats fatigue).

- **DC-H3 — Diagnostic thresholds (v2 §6.4)** [DEF→cal] — region_risk > 0.60 → local tissue; GRM < 0.90 → fatigue suppression; interference_modifier_q < 0.90 → interference; delivered < 0.85·target → underdosing; stall_duration > 2 mesocycles after all ruled out → true plateau. *Test:* fixture inputs map deterministically to expected diagnosis.

- **DC-H4 — Voluntary vs involuntary shortfall (v2 §6.7)** [EV] — If a quality's delivered dose is below target because the ceiling compressed it (not because of missed sessions), the engine does NOT diagnose underdosing — it flags ceiling-suppression. *Test:* a quality with delivered=floor due to GRM 0.85 returns `ceiling_suppressed`, not `underdosing`.

- **DC-H5 — Ceiling-suppression triggers transition (v2 §6.7)** [EV] — A quality ceiling-suppressed for 2+ consecutive mesocycles triggers a block-archetype transition recommendation elevating that quality to primary. *Test:* simulated 8 weeks of strength-quality ceiling-suppression in a balanced block produces a strength_biased transition candidate.

- **DC-H6 — Per-quality stall KPIs (v2 §6.6)** [DEF] — Strength: e1RM trend on anchor lifts. Hypertrophy: set-perf trend + circumference/photo. Aerobic: pace/power at easy HR + HR recovery. Threshold/VO2: interval pace/power + repeatability. Durability: symptom & ROM trends. *Test:* the engine reads the documented KPI for each quality; no quality uses an undocumented metric.

## I. Daily adaptation

- **DC-I1 — Branch logic (v1 §13, v2 §7.2 phase 4)** [EV] — Pre-session adaptation follows the documented branch order: local pain + low systemic → modify region load only; high systemic fatigue + perf down → preserve anchors, reduce accessory + hard conditioning; aerobic down + lifting stable → add easy aerobic frequency; hypertrophy stalled + recovery ok → raise priority-muscle volume with low-fatigue tools; schedule compressed → keep anchors, drop fillers. *Test:* the five fixture inputs produce the five documented branches in order.

- **DC-I2 — Daily GRM recompute (v2 §7.2 phase 4)** [DEF] — GRM recomputed pre-session using today's readiness; if it falls below the session's minimum threshold, scope is reduced. *Test:* a session with required_GRM 0.95 and today's GRM 0.88 reduces fillers and preserves the anchor.

- **DC-I3 — Region cap override at session time (v2 §7.2 phase 4)** [EV] — If a region cap falls below a session's requirement, swap exercise/modality rather than dropping the session. *Test:* knee region cap 0.72 with a planned heavy back squat triggers a swap (front squat / leg press) per substitution rules, not a session removal.

## J. Durability / tissue

- **DC-J1 — Durability is a programmed quality (v1 §4)** [EV] — Tissue-capacity work is allocated within the main plan, not as optional prehab. Every archetype assigns durability ≥ "secondary" or "maintenance" with daily microdoses. *Test:* every generated week contains ≥ 4 days with at least one resilience microdose.

- **DC-J2 — Graded reintroduction (v1 §4 + v2 §3.9)** [EV] — When a tissue has been underexposed (novelty_r > 0.50), the engine does NOT abruptly reintroduce high-stress versions; it ramps. *Test:* novelty_r > 0.50 caps region exposure increase at +30% week-over-week.

- **DC-J3 — Local cap, not global collapse (v1 §4, v2 §3.9)** [EV] — Local pain + normal systemic fatigue → modify the local load profile only; do not deload the whole plan. *Test:* shoulder symptom 5/10 with normal GRM reduces overhead/pressing ceiling but leaves lower-body and pulling ceilings unchanged.

## K. Engineering / data hygiene

- **DC-K1 — Recovered-week qualification is explicit (v2 §3.10)** [DEF] — A week is "recovered" iff all five criteria pass; the qualification flag is stored alongside the week record. *Test:* querying recovered-weeks for a user always returns weeks with the boolean flag set.

- **DC-K2 — Confidence-aware projection (v2 §3.11)** [EV] — When data completeness is low, the engine projects more conservative ceilings via `confidence_bias`, rather than pretending the user is fresh. *Test:* a sparse-data fixture produces a ceiling ≤ 0.90× of the full-data equivalent, all else equal.

- **DC-K3 — Engineering defaults are tunable (v2 §0 + §9)** [EV] — Every coefficient labelled `[DEF→cal]` is read from a config/seed row, not a TS literal, so calibration is data-driven not code-driven. *Test:* swapping a coefficient via the config table changes engine output without code changes.

- **DC-K4 — Override-and-warn, never silent overrule (v1 §2 Rule 5, plan §3)** [EV] — When the user overrides a principle-derived default, the engine records the override and shows a warning; it does not silently follow the user. *Test:* scheduling a high-conflict pairing with override returns the schedule AND a logged override record + warning surface.

- **DC-K5 — Continuity bias in planning (v1 §2 Rule 5)** [EV] — Week-to-week change in total load (sum of bucket ATL deltas) is bounded by default. *Test:* a generated week never increases total bucket-ATL by more than +20% over the prior week without an explicit "push" flag.

---

## Open conflicts (for Phase D resolution)

1. **OC-1 — Continuity vs aggressive compression.** v1 §2 Rule 5 ("bias toward continuity, small week-to-week changes") tensions with v2 §3.6 GRM, which can drop to 0.70 in one week. *Decision needed:* should GRM compression be rate-limited (e.g., GRM cannot fall by > 0.10 in one week unless a "recovery crisis" event fires)? Recommended default: yes, rate-limit at -0.10/wk except for explicit crisis flag.

2. **OC-2 — Conflict-matrix coefficients are not numerically specified.** v2 §3.8 names high/moderate/low conflict pairings but never publishes the actual `conflict_q,c` numeric coefficients used inside `interference_q = Σ(conflict_q,c · overload_c)`. The plan's example bullet ("0.85 per v2 §3.8 default") cites a number that v2 does not actually publish. *Decision needed:* seed values. Suggested defaults: high=0.85, moderate=0.50, low=0.15, none=0.00. Mark all as `[DEF→cal]`.

3. **OC-3 — Cold-start base ceiling.** v2 §3.10 requires median of last 3 recovered weeks. A new user has zero. v2 mentions only confidence_bias as the cold-start mitigation. *Decision needed:* what is `base_ceiling_q` for week 1? Suggested defaults: derive from onboarding-declared training inputs (recent typical week from the intake form) × 0.85, AND set confidence_bias = 0.90, until ≥ 3 recovered weeks accumulate. Cap "trust" of onboarding-declared values at 4 weeks.

4. **OC-4 — Consumer tier archetype gating.** v2 §5.5 restricts consumer tier to `balanced + rebuild` archetypes only. v1 §6 says aesthetics-priority users should be able to enter an aesthetic block. *Decision needed:* hard gate (consumer cannot pick aesthetic/strength/engine-biased) vs soft gate (warning + reduced ceiling headroom). Recommended default: soft gate — allow with explicit "I understand" + apply consumer's 0.85 headroom and 0–1 hard-conditioning cap.

5. **OC-5 — Deload cadence by tier vs by archetype.** v2 §5.5 says consumer = time-based every 4w, intermediate = hybrid, high-perf = signal-driven. v2 §4.2 fixes deload week per archetype (e.g., balanced wk 5–6). *Decision needed:* which wins when they conflict? Recommended default: archetype defines candidate deload week, tier mode decides whether to force it (consumer) or allow signal-driven shift (high-perf, can move ±1 week based on GRM trajectory).

6. **OC-6 — Same-day ordering enforcement.** v1 §3 mandates lift-then-condition default ordering for same-day sessions. v2 §3.8's interference math doesn't model intra-day order — only daily/weekly overload. *Decision needed:* should same-day ordering be enforced by the scheduler as a hard rule, or just emit a warning? Recommended default: scheduler emits same-day session pairs in the canonical order automatically; manual reordering requires explicit user action.

7. **OC-7 — Plan §5.3 data model vs v2 §10 data model.** Plan §5.3 lists `programs/methodologies/blocks/block_days` (methodology-flavored) as Drizzle tables. v2 §10 lists `user_profile/state_model/ceiling_model/block_state` (engine-state-flavored). Plan says "v2 wins" but they're orthogonal — methodology metadata vs engine runtime state. *Decision needed:* confirm the two are kept as separate concerns (methodology rows = program definitions; engine state = block_state + ceiling_model + stress_buckets), with `Block.kind` (plan) mapping to `block_state.current_archetype` (v2). I expect this is right but want confirmation before laying down schema.

8. **OC-8 — Floor-dose units are inconsistent across qualities.** v1 §2 Rule 4 floors are in mixed units (exposures, sessions, minutes). v2 §2 says "store internal stress ledger by bucket and region, but keep native user-facing units per quality." *Decision needed:* confirm the floors live in user-facing units (per-quality), with the engine NOT trying to express floors in canonical bucket-points. Recommended default: yes — floors are per-quality, in native unit; only ceilings/pressures use internal bucket math.

9. **OC-9 — Aesthetic deficit hypertrophy ceiling cut (15–20%).** v2 §4.2 C states it; v1 §6 says "reduce total volume slightly." Numeric value (15–20%) is v2-only. *Decision needed:* pick a fixed default. Recommended: 17.5% (midpoint), label `[DEF→cal]`.

10. **OC-10 — Anchor compliance bypass for tier override.** v2 §5.6 grants `requested_tier` access if `anchor_compliance_28d ≥ 0.85`, but only for *features*, while keeping the ceiling modifier at current tier. *Decision needed:* is this the right split? Recommended default: keep as written; flag to user that ceiling headroom remains tied to BTS.

11. **OC-11 — Region-cap minimum-vs-mean policy boundary.** v2 §3.11 says "weighted mean for broad qualities; minimum for high-risk." The list of "high-risk" qualities isn't enumerated. *Decision needed:* publish the explicit list. Recommended default high-risk set: hard running, sprinting, plyometrics, deep knee-dominant lower-body (high-bar back squat below parallel, ATG split squat, deep front squat). Everything else uses weighted mean.

12. **OC-12 — "Performance trend" component of BTS (v2 §5.3).** Listed in the BTS formula at weight 0.10 but its normalisation ("declining → 0, stable/improving → 100") is binary. *Decision needed:* refine to continuous (e.g., slope of e1RM trend mapped through `norm_low(slope_pct_per_4w; +1%, -2%)`)? Recommended default: continuous mapping, defined per quality KPI; binary is too coarse.

---

## Phase D resolution checklist

For each item above, the deliverable is one of:
- ✅ **Accept default as written** (suggested values become engine config).
- 🔧 **Modify** (state the change).
- ❌ **Reject** (state the alternative).

Plus the plan §8 open questions (DB, auth, region, pricing, domain, IP/naming, day-one platform, public-launch criteria) — those are resolved in the same Phase D session.
