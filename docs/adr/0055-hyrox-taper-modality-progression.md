# ADR 0055 — HYROX best-in-class refinements: taper, easy-modality, within-phase progression

**Status:** Accepted (evidence-led; user asked for best-in-class, not a v1).
**Date:** 2026-06-22
**Relates to:** ADR 0050 (HYROX program), ADR 0053 (week-builder quota model),
ADR 0054 (two-a-days), ADR 0008 (modality-aware taper). CP-1…CP-5 in
`docs/knowledge/hybrid-training-design-constraints.md`.

## Context

A full-matrix QA of HYROX generation (all levels × budgets 3–7 × two-a-day)
surfaced three quality gaps. None is the original "lone ski-erg" bug (that class
is eliminated and guarded), but the user wants best-in-class, so a focused
research pass (peer-reviewed taper science + named elite HYROX programs) drove the
fixes below.

## Decision 1 — A real taper (race week ≠ a hard week)

**Problem.** Every taper week generated the same demanding trio —
`strength-full + station-intervals + threshold-run`. Evidence says that is a
failure to taper.

**Evidence (HIGH).** Bosquet 2007 (MSSE meta-analysis) + Travis 2020 (Sports
8(9):125) + Mujika & Padilla: a taper is a ~41–60 % VOLUME cut with INTENSITY
maintained; reducing intensity is the classic mistake; heavy strength's last
session is 5–10 days out; for endurance-dominant events the last hard
threshold/VO2 is ≥7–10 days out. Elite datapoint: Hidde Weersma (Pro WR 52:42, ex
Olympic-centre S&C) drops 18–23 h → 13–14 h into taper (~35–40 % cut) and warns
that too many race-pace intervals leave you flat. Hunter McIntyre's cautionary
tale: arriving over-trained kills the result. RoxLyfe: "taper volume in the days
before so you go in fresh." No HYROX program puts heavy strength + a hard
threshold in race week.

**Change.** The taper now distinguishes two week kinds:
- **Sharpen week** (earlier taper week; only exists for the 2-week
  intermediate/advanced tapers): one LAST moderate strength + one LAST quality
  (threshold) + a station touch + easy. Cap 4. This is the final "normal-ish"
  week (~10–14 days out).
- **Race week** (the FINAL taper week, ≤7 days out): NO heavy strength, NO
  separate hard threshold/VO2. Content = ONE short race-pace **primer**
  (`compromised-run` — run+station at race effort, volume-cut by the taper engine),
  a light **station** technique touch, and **easy** aerobic; capped at **3**
  sessions to bias rest. Matches the synthesized elite race-week template
  (primer + technique + easy/rest).

Beginners (1-week taper) get only the race week — so their last heavy strength is
the end of the Specific block (~10 days out). Correct.

## Decision 2 — Bike is the default easy aerobic modality (not ski)

**Problem.** Easy off-feet volume (the base "cross" fill, the deload aerobic day,
and the two-a-day companions) defaulted to `easy-ski`. Long steady-state ski-erg
is a poor easy-volume choice and felt monotonous — correctly.

**Evidence (HIGH).** The bike is the universal easy-Z2 anchor: Pierre Spies
(HYROX365 sport scientist) singles out the indoor bike (no eccentric load,
controllable, develops aerobic/neuromuscular qualities); Weersma cycles 6–12 h/wk
almost all easy; Botterill's low-intensity volume is "majority bike, StairMaster,
elliptical." The **ski-erg is an intervals/technique tool**, not a long-easy tool —
grip/shoulder fatigue at Z2 impairs subsequent ski technique AND upper-body
strength; the HYROX365 off-feet piece doesn't list ski as an easy modality at all.
Ski/row keep their place in `station-intervals` (race-specific) where they belong.

**Change.** Easy off-feet sessions now default to **`easy-bike`**, varying with
`easy-row` (race-relevant, posterior) for variety; **ski is removed from the easy
pool** (it remains in station work). Specifically: the base "cross" fill →
`easy-bike`; the deload aerobic day ski → bike; the two-a-day companion rotation →
bike-dominant (`bike, row, bike`), never ski.

## Decision 3 — Within-phase quality undulation (MODERATE)

**Problem.** Every week within a phase was byte-identical in session types.

**Evidence (MODERATE).** Best practice is block periodization (Weersma, citing
Schumann & Rønnestad 2019) — fixed session TYPES per phase, but the protocol
PROGRESSES (volume → intensity → specificity) and elites show week-to-week
undulation. RoxLyfe flags "identical sessions + rising load" as a stagnation
mistake. Most progression lives in the prescription layer (volume/%); but the
session SELECTION can add light variety.

**Change (measured — the evidence here is MODERATE, so the touch is light).** In
the **Build** phase the weekly quality-running session now **undulates by week
parity** — threshold on odd weeks, VO2 on even weeks — instead of always
threshold. Base stays threshold (aerobic/tempo emphasis); Race-prep stays VO2 /
race-pace. This yields a real macro progression (base→build→specific) AND
within-build stimulus variety, without disturbing the per-week quota invariants.

## CP pressure-test

- **CP-1:** the taper week-kind thresholds, the easy-modality preference order, and
  the build undulation are `[DEF]` coach-consensus / practitioner heuristics →
  tagged in source; validation = the plan-composition QA guard (race week has no
  heavy strength; easy default is bike; build quality alternates) plus, once usage
  exists, adherence/freshness signal on race week.
- **CP-2:** no shared engine constant moves; HYROX-package-local. The taper VOLUME
  math is the existing ADR-0008 engine (unchanged) — this ADR changes session
  SELECTION only.
- **CP-3:** no new >1-sig-fig coefficient.
- **CP-5:** taper/modality claims cited (Bosquet 2007, Travis 2020, Spies, Weersma)
  at the stated confidence; the within-phase undulation is labeled MODERATE.

## Scope / risk

HYROX-only, package-local; other programs byte-identical. Output changes for HYROX
taper weeks, easy-fill modality, and build quality weeks — covered by updated +
new tests (no heavy strength in race week; bike is the easy default; build quality
undulates). The QA guard and quota invariants already exclude taper from the
strength/station floor, so the lighter taper does not violate them.
