# ADR 0023 — Adaptive vs pre-generated block: posture & roadmap

**Status:** Accepted
**Date:** 2026-06-01
**Phase:** Production (strategic posture — sets the boundary for all future adaptivity work)
**Relates to:** ADR 0007 (autoregulated AMRAP top set — load-layer autoregulation), ADR 0008 (modality-aware taper — event-driven scaling), ADR 0010 (next-block nudge — between-block structure), ADR 0013 (within-block volume autoregulation — the volume-layer loop), ADR 0014 (mid-block limitation response), ADR 0018 (retire the inert daily wellness factor). This ADR is the **umbrella decision** those autoregulation ADRs sit under: it states *why* the engine keeps a planned spine and *where* adaptivity is allowed to grow.
**Touches:** Documentation only — this ADR. No code, no schema, no CP-2 constant. It is a decision record that gates future PRs.

## Context

The recurring product question: should the engine **pre-generate** a full multi-week block deterministically (what it does today), or move toward **progressive/adaptive generation** that (re)builds upcoming sessions from logged performance and readiness (as AitoFit, Fitbod, and TrainerRoad market themselves)?

Today the engine pre-generates. `createBlock` loops every week × day at block creation and writes a frozen `planned_sessions.prescription` for the whole block; weeks differ only by predefined wave/deload `weekProfiles`, **not** by logged performance. Adaptivity is layered on top as bounded, mostly-offered adjustments: AMRAP load autoregulation (0007), modality-aware taper (0008), within-block discretionary-volume trim (0013), mid-block limitation response (0014), between-block TM-bump nudge (0010). `updateBlockFocus` deliberately does **not** re-materialize — it only writes the `focus_muscles` column (the dialog copy claiming it changes "future sessions in this block" is therefore misleading; tracked separately as a copy fix).

The user requested a proper **market + literature scan** before committing to a direction. This ADR records the scan and the decision it supports.

## Market scan (verified mechanism vs marketing vs inference)

| App | Spine vs regen | Adaptation signal | Cadence | Auto / offered | Concurrent? |
|---|---|---|---|---|---|
| **AitoFit** (aitofit.io) | Pre-gen first program, then continuous regen | Reps-vs-target, load, **optional** RPE, time-since-muscle, weekly volume; RP-style MEV/MRV landmarks | **Set-by-set** | Automatic | No — gym hypertrophy only; **no endurance interference model** |
| **Fitbod** | Fresh-generated each session (no fixed block) | Logged history, est. 1RM, per-muscle "recovery %" heat-map | Per-session | Automatic | No |
| **TrainerRoad** | Plan skeleton; workouts swapped | "Progression Levels" 1–10 per power zone, moved by workout pass/struggle | Per-workout | **Offered** (accept adaptations) | Endurance only |
| **Juggernaut AI** | Periodized multi-week block | Per-session **RPE** on top sets + e1RM | Within block; week/block | Mostly automatic within block | No (strength) |
| **RP Hypertrophy** | Mesocycle pre-planned | Per-muscle **RIR + soreness/pump** → volume landmarks (MEV→MRV) | Per-session volume | **Offered** | No |

**Source confidence:** AitoFit mechanism is **[verified]** from their own methodology page (set-by-set rules, MEV/MRV, *optional* subjective input, **no HRV**). TrainerRoad Progression Levels **[verified]** from their engineering blog. Fitbod recovery heat-map **[partially verified]** (help-center + reviews; the per-exercise deduction figure is an unverified Reddit claim). Juggernaut/RP **[moderate]** from reviews + published methodology.

**Pattern [inference, high confidence]:**
1. "AI/adaptive" in this market overwhelmingly means **rule-based reaction to last-session performance** (reps-vs-target, RPE/RIR, pass/fail) — not ML controllers, not HRV. AitoFit's "set-by-set AI" is if/else on rep success — a signal our AMRAP loop already captures.
2. Strength-first apps (Juggernaut, RP) **keep a periodized spine** and autoregulate *within* it; pure regenerators (Fitbod, AitoFit) are single-modality hypertrophy apps with no competition peak to protect.
3. The best-regarded engines (TrainerRoad, RP) **offer** adaptations rather than silently rewriting the plan.
4. **No scanned competitor models concurrent endurance↔strength fatigue.** That is a market gap, not a solved feature — and it is exactly the axis this app is built around.

## Literature scan (with confidence)

- **Moesgaard et al. 2022, *Sports Med* (PMID 35044672)** — volume-equated meta, 35 studies. Periodized > non-periodized for **1RM (ES 0.31, 95% CI 0.04–0.57)**; **no difference for hypertrophy** (ES 0.13, ns). Undulating > linear for 1RM **only in trained** (ES 0.61, p=0.05). *HIGH confidence.* → Having *a* periodized structure matters modestly for strength; the specific model is a near-wash, especially for hypertrophy.
- **Ralston et al. 2017, *Sports Med* (PMID 28755103)** — weekly **volume** is the graded dose-response lever for strength. *HIGH confidence.* Volume, not scheduler cleverness, is the dominant knob.
- **Helms et al. 2020, *J Hum Kinet* (PMID 33312294)** — autoregulation review (90 studies): RIR-RPE and velocity have **"preliminary utility."** *MODERATE confidence* — note the *preliminary* hedge; objective methods are largely lab-only.
- **Zhang et al. 2022, *IJERPH* (PMID 35954603)** — VBT meta, 9 studies, 253 trained men: max strength **SMD 0.76**. *MODERATE.* But VBT-only comparisons, small n, and the mechanism is velocity-loss-capped volume — needs a sensor we don't have.
- **Wilson et al. 2012, *JSCR* (PMID 22002517)** — concurrent interference meta (21 studies, 422 ES): interference for hypertrophy **and** strength occurred with concurrent **running but not cycling**, and correlated negatively with endurance **frequency (−0.26 to −0.35)** and **duration (−0.29 to −0.75)**. *HIGH confidence.* → Interference is driven by endurance modality, frequency, and volume — a variable, session-to-session residual-fatigue signal a fixed strength plan cannot see.
- **Javaloyes et al. 2019, *IJSPP* (PMID 29809080)** — HRV-guided vs traditional periodization, 17 trained cyclists: HRV group improved within-group (40-min TT +7.3%) while traditional did not — **but no statistically significant between-group difference**; the edge rests on contested magnitude-based inference. *MODERATE-LOW confidence.* "HRV-guided beats fixed" is **suggestive, not proven.**
- **ACWR (Gabbett 2016) and its critics (Impellizzeri et al. 2020)** — **not re-verified from primary source this pass.** Prior knowledge: the ACWR injury "sweet spot" is heavily methodologically criticized. Treat ACWR-style ratios as a **soft heuristic, never a hard controller.** *LOW confidence — flagged, not asserted.*

## Decisions

| # | Topic | Decision | Why |
|---|---|---|---|
| 1 | **Spine** | **Keep the pre-generated, deterministic periodized block as the backbone.** Do not move to AitoFit/Fitbod-style full regeneration of strength sessions. | When volume + relative intensity are equated, daily strength regeneration is **not** shown to beat a well-designed periodized block (Moesgaard 2022: small 1RM edge for *any* periodization, **zero** hypertrophy edge; model choice a wash). Determinism also protects the golden-snapshot/regression contract (ADR 0013 dec. 6 invariant). |
| 2 | **Strength autoregulation = within-plan, not regen** | Strength adaptivity stays **load-layer (AMRAP/TM, ADR 0007) + bounded volume-layer (ADR 0013)** flexes applied to a stable plan. No per-session strength **structure** regeneration. | The literature's autoregulation value is fatigue management / individualization (Helms 2020 "preliminary"; Zhang 2022 modest, sensor-gated), concentrated in trained lifters — which our submaximal-TM + AMRAP loop already serves on the right cadence. AitoFit's "feedback" is reps-vs-target, which we already have. |
| 3 | **Where adaptivity is allowed to grow = concurrent / endurance fatigue** | The next adaptivity investment targets **endurance↔strength interference**, not daily strength load-chasing. | Wilson 2012 (HIGH): interference scales with endurance modality/frequency/duration — a *variable* load the fixed block is blind to, and the one place the science clearly favors adaptivity. It is also an unserved market gap (no competitor models it). |
| 4 | **Posture = bounded + offered, never silent** | Any new readiness/concurrent controller must be **bounded** (capped magnitude, discretionary kinds only) and **offered** (confirm-first), not a silent regenerator. | Matches the best apps (TrainerRoad, RP both *offer*) and every existing engine offer (deload, TM-bump, taper, ADR 0013 volume trim). Silent plan rewrites erode predictability/trust. |
| 5 | **Readiness evidence is softer than marketing — gate it** | Treat HRV/readiness adaptivity as **moderate-low confidence**. Do not ship threshold logic until there is **real logged signal** to calibrate against (CP-1…CP-5); ACWR-style ratios remain soft heuristics only. | Javaloyes 2019 is within-group only (no between-group significance); ADR 0018 already retired an inert daily-wellness factor for lack of data. Instrument before thresholding. |
| 6 | **Sequencing = instrument first** | Step 1 of any concurrent-adaptivity work is to **log the signals** (endurance modality/frequency/duration residual-fatigue inputs) before building any controller or thresholds. | CP-1…CP-5 calibration policy: constants need data provenance. We currently have zero rows; thresholds built on zero data repeat the PR #166 wellness mistake. |

## Rationale

The honest synthesis the user asked for: the strength literature does **not** justify rebuilding the engine into a daily regenerator — periodization's strength edge over non-periodized is small and is **zero for hypertrophy**, and model choice is a wash. Our TM%-block + AMRAP + between-block TM-bump is already squarely evidence-consistent. The defensible case for *more* adaptivity is **concurrent fatigue** (Wilson 2012), where the load is genuinely variable and a fixed plan is blind — and which no competitor addresses. But the readiness evidence (Javaloyes 2019) is weaker than its marketing, so the correct posture is **bounded, offered, data-gated** growth on the endurance axis, not silent strength regeneration. This ADR draws that boundary so future feature work doesn't drift into low-evidence daily load-chasing.

This is a **correction of confidence** from the assessment turn that preceded it: the HRV→performance claim was dialed down from "moderate-high" to **moderate-low** after reading Javaloyes' no-between-group-difference result directly.

## Consequences

- **Positive:** a recorded boundary — reviewers can reject "let's regenerate strength sessions daily" by citing this ADR; the parked wellness/readiness work (PR #166 revalidation) now hangs off a rationale; the concurrent-fatigue axis is named as the sanctioned growth direction.
- **Negative / risk:** the engine remains blind to *within-block* endurance-fatigue accumulation until the concurrent controller is built — accepted, because building it on zero data would be worse (decision 6).
- **Out of scope:** building the concurrent controller itself (future ADR, after instrumentation); any HRV/wearable ingestion; the `updateBlockFocus` mid-block re-materialization (separate copy-fix + possible future ADR).

## Follow-ups (not blocking)

- **Copy fix:** `PlanBlockFocusCard` claims focus changes apply to "future sessions in this block" — false (only the column is written). Correct the copy to reflect that focus edits take effect at the **next** block, or wire re-materialization behind a future ADR.
- **Instrumentation ADR:** specify the endurance residual-fatigue signals to log (modality, frequency, duration, recency) as the precondition for any concurrent-adaptivity controller.
- **Revalidation gate:** revisit decisions 5–6 once real logged data exists (parked alongside PR #166 wellness-threshold revalidation).

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>
