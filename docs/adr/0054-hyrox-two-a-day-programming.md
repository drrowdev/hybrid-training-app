# ADR 0054 — HYROX two-a-day (AM/PM) programming model

**Status:** Proposed (design + evidence review — written for sign-off BEFORE any
engine code, per the "propose engine changes first" rule).
**Date:** 2026-06-22
**Relates to:** ADR 0050 (HYROX program), ADR 0053 (HYROX week-builder quota
model), ADR 0025 (intensity-aware interference), the modality interference scalar
(`concurrent-scalar.ts`), migration 0110 (`allows_two_a_days`, Hybrid). Calibration
policy CP-1…CP-5 in `docs/knowledge/hybrid-training-design-constraints.md`.

## Context

HYROX scheduling was just unified (the user picks 3–7 training weekdays). The user
asked to re-offer **two-a-days** (same-day AM/PM double sessions) — as **real,
separately-logged sessions**, with programming logic that is *"world-class and not
based on assumptions or guesses."* This ADR sets the evidence-grounded rules; a
follow-up PR implements them.

The engine's old two-a-day mechanism (a `plus: easy-ski` folded into the Monday
label when `sessionsPerWeek === 8`) is crude, display-only, and not phase- or
experience-aware. It is replaced by the model below.

## Evidence base

Two research passes: (1) the app's own already-cited corpus
(`hybrid-training-research-new.md`, `concurrent-scalar.ts`), (2) a fresh
peer-reviewed literature review (24 sources, verified PMIDs). Confidence tiers:
HIGH = RCT/meta-analysis, MODERATE = consistent observational/expert consensus,
LOW = single study/practitioner-only.

Load-bearing findings:

- **Recovery interval (HIGH).** Robineau 2016 (JSCR 30(3):672–683, PMID 25546450):
  same-day concurrent adaptation `24h > 6h > 3h > 0h`; **<6h impairs strength and
  high-velocity neuromuscular gains**. Direct quote: *"avoid scheduling 2
  contradictory qualities with less than 6-hour recovery."* Sale 1990 / Schumann
  2015 (MODERATE): different-day (48h) beats same-day for strength/VO₂ — so
  doubles are a deliberate trade, not free volume.
- **Session order (HIGH).** Three meta-analyses — Eddens 2018 (PMID 28917030),
  Murlasits 2018 (28783467), Gao 2023 (36776981) — agree **strength-before-
  endurance (SE)** yields greater lower-body dynamic strength (+~4 kg 1RM / +~7%;
  HYROX-relevant: sleds, lunges, wall balls), and order is **VO₂-neutral**.
- **Pairing policy (HIGH molecular / MODERATE practice).** Wilson 2012 (22002517,
  meta-analysis): endurance **frequency & duration** correlate negatively with
  strength/power (r −0.26…−0.75); **running interferes more than cycling**.
  Methenitis 2018: high-volume steady endurance drives the largest AMPK → mTOR
  suppression; HIIT/easy-Z2 far less. Seiler 2006 / Casado 2022: elite practice is
  **hard-day/easy-day**, ~75–80% easy. ⇒ **exactly one hard + one easy per
  double-day; never two hard.**
- **Modality of the easy session (MODERATE; app-cited HIGH for magnitudes).** The
  app's own `concurrent-scalar.ts` (Wilson 2012): interference per modality —
  run 1.0 (baseline), row 0.5, ski/bike 0.4, walk 0.3. Doma 2019 (30847824):
  strength impairs subsequent endurance mainly via **muscle damage**, so an easy
  **low-impact erg** (ski/row/bike) after lower-body strength beats an easy *run*
  (no added ground-reaction load on damaged fibres). Yeo 2008 (18772325): a
  glycogen-lowered easy session adds a mitochondrial "train-low" signal — a modest
  upside, **not overclaimed** (no TT-performance gain shown).
- **Intensity is duration/energy-cost driven (HIGH).** Coffey & Hawley 2017
  (27506998): interference worsens with training history and endurance energy cost;
  a short easy Z2 bout is a small AMPK spike. ⇒ cap the easy session's duration.
- **Circadian (HIGH) vs pragmatics (MODERATE).** Knaier 2022 (34431827): strength/
  power peak 13:00–20:00h; Hayes 2010: morning cortisol-awakening response is
  catabolic. But Küüsmaa 2016: time-of-day effects need ~12 weeks of *consistent*
  timing — irrelevant for athletes who can't fix a daily clock. ⇒ model AM/PM as
  **first/second (protected/secondary)**, not wall-clock, and surface a "≥6 h,
  ideally 8" guidance note rather than enforcing times.
- **Frequency caps (LOW–MODERATE; explicitly heuristic).** No HYROX-specific RCT
  exists (PubMed: zero). Robineau's 2 double-days/wk already impaired adaptation
  even at 6 h; Bellinger 2020 (32064575): doubles raise overreaching risk, needing
  planned deloads. RoxLyfe (practitioner, HYROX-specific): strength "away from
  endurance… combine only as the race nears"; sims are standalone, not doubled.

Honest gaps (stated, not papered over): no HYROX two-a-day RCT; the per-week
double caps and the phase windows are **CP-1 heuristics** extrapolated from
adjacent literature; "Eklund et al" and a standalone "Fyfe & Hawley" review could
not be verified and are **not** cited.

## Decision — the programming rules

**R1 — Opt-in, off by default.** A per-block toggle (reuse the existing
`allows_two_a_days` column from migration 0110). OFF ⇒ byte-identical to today.

**R2 — Real second sessions.** A double-day emits a genuine second
`planned_session` (slot `pm`), independently logged / completed / Strava-matched —
reusing the multi-slot `(week, day, slot)` machinery Hybrid already uses. Not a
display-only label.

**R3 — One hard + one easy.** The double-day's existing PRIMARY (the hard/quality
session the quota model already placed) is the protected session; the ADDED second
session is **easy Z2 aerobic only**. The engine never pairs two hard sessions.
[HIGH molecular / MODERATE practice — Wilson 2012, Methenitis 2018, Seiler 2006.]

**R4 — Protected session is first (SE order).** AM = the primary/hard session,
PM = the easy aerobic. When the primary is strength this realises strength-before-
endurance. [HIGH — Eddens 2018, Murlasits 2018, Gao 2023.]

**R5 — Easy-session selection (modality-aware).**
- Default: a **low-impact erg** — ski / row / bike — `easy-ski`/`easy-row`/
  `easy-bike`, Z2. Lowest interference (scalar 0.4–0.5) and no added impact on
  fibres damaged by the AM lift. [Wilson 2012 HIGH; Doma 2019 MODERATE.]
- If the primary that day is **upper-body strength or a run** (lower-body fibres
  not the limiter), an `easy-run` is permitted.
- Duration kept modest (Z2, the engine's existing easy-aerobic dose) so energy
  cost / AMPK stays low. [Coffey & Hawley 2017 HIGH.]

**R6 — ≥6 h spacing (guidance, not enforced).** Surface copy on the PM session:
*"Leave 6+ hours after your main session (ideally 8) — training the two too close
together blunts both."* The app can't see wall-clock time; it advises. [HIGH —
Robineau 2016.]

**R7 — Phase + experience dosing (CP-1 heuristic).**
- **Phases:** doubles only in **Build** and **Race-prep**. **Never** in Base
  (build the base first), deload, or taper, and **never** add a second session to
  a **simulation** week's sim (sims are standalone hard days). [RoxLyfe; Bellinger
  2020.]
- **Per-week cap by experience:** beginner **0** (insufficient base — no doubles at
  all), intermediate **≤1**, advanced **≤2**. [Robineau 2016; Wilson 2012;
  Bellinger 2020 — all extrapolated, LOW–MODERATE.]
- **Spacing:** never two double-days back-to-back; place them on non-adjacent
  training days.
- The deload cadence (ADR 0050) already inserts recovery every 4th work week,
  satisfying Bellinger's "planned deload after a doubles block."

**R8 — Selection of WHICH days double.** Among a phase's eligible training days,
pick the day(s) whose primary is a **hard strength or quality session** (the
sessions whose adaptation an easy aerobic companion protects/complements), highest-
priority first, up to the experience cap, spaced apart.

## Worked example

Advanced, Race-prep week, 5 training days, two-a-day ON (cap 2):
- Mon `compromised-run` (hard) **+ PM easy-row**
- Tue `station-intervals` (hard)
- Wed `strength-full` (hard) **+ PM easy-ski**  ← low-impact erg after squat/DL
- Fri `vo2-intervals` (hard)
- Sat `long-run`
→ 2 doubles, each hard+easy, on non-adjacent days, easy modality low-impact after
the lower-body lift. Beginner same week ⇒ 0 doubles (toggle no-ops).

## CP pressure-test

- **CP-1:** R7's per-week caps + the phase windows are heuristics → tagged
  `// heuristic — HYROX two-a-day dose (CP-1)` with a validation plan: a
  plan-composition audit (no week exceeds the cap; none in base/deload/taper; every
  double is hard+easy) plus, once usage exists, adherence + perceived-recovery
  signal on double-days; rollback if double-day completion < single-day baseline by
  a set margin.
- **CP-2/CP-3:** the easy-session duration reuses the existing Z2 dose; no new
  numeric coefficient with >1 sig fig is introduced (caps are small integers).
- **CP-4:** the 2-factor ceiling chain is untouched — this is HYROX week assembly,
  not the ceiling computation.
- **CP-5:** every physiological claim above carries an `Author Year, PMID,
  ConfidenceTier` citation; heuristic doses are tagged as such, not given fake
  citations.

## Scope / risk

- HYROX-only for the programming rules. The **materialize** change (emit a second
  `pm` slot for a foreign program) is generic plumbing but reuses Hybrid's proven
  schema/read path; it must stay byte-identical for every program when no second
  session is present.
- Output changes only when the toggle is ON; covered by new invariant tests
  (one-hard-one-easy; caps; phase windows; SE order; low-impact-after-lower-body).

## Open questions for sign-off

1. **Caps:** beginner 0 / intermediate ≤1 / advanced ≤2 per week — good, or do you
   want advanced up to 3 (the upper end of the practitioner range, higher overreach
   risk)?
2. **Easy-run allowance:** permit an easy *run* as the PM session after upper-body/
   run primaries (my proposal), or keep PM **always** a low-impact erg for maximum
   safety/simplicity?
3. **Spacing copy:** surface the "≥6 h, ideally 8" guidance on the PM card (my
   proposal) — agree?

## Decision

Pending sign-off. On approval: implement R1–R8 in `packages/hyrox` (second-session
selection in the week builder) + the materialize `pm`-slot seam + the wizard toggle
+ invariant tests, and move this ADR to Accepted.
