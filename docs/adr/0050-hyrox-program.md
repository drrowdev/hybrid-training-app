# ADR 0050 — HYROX program (event-targeted concurrent endurance + strength-endurance)

**Status:** Proposed
**Date:** 2026-06-15
**Phase:** Production (platform-program era)
**Relates to:** ADR 0046 (programs platform), ADR 0008 (event taper), ADR 0025/0028
(concurrent interference), the Green Protocol engine (`@hta/green`, the closest analog), and
the calibration policy CP-1…CP-5 (`docs/knowledge/hybrid-training-design-constraints.md`).

## Context

HYROX is a standardized indoor fitness race: **8 × 1 km runs**, each followed by one functional
station, in fixed order — 1000 m SkiErg, 50 m sled push, 50 m sled pull, 80 m burpee broad jumps,
1000 m row, 200 m farmers carry, 100 m sandbag lunges, 100 wall balls — plus ~700 m of "roxzone"
transition running (≈8.7 km total running). Station weights/reps vary by **division** (Open / Pro /
Doubles). The format is identical worldwide (global leaderboards). *(en.wikipedia.org/wiki/Hyrox;
hyrox.com — confirmed.)*

It is currently a dimmed "coming soon" tile in the program picker
(`apps/web/src/components/program/ProgramPicker.tsx`). This ADR specifies the program so it can be
built and enabled.

HYROX is, in training terms, a **periodized, event-targeted, concurrent endurance + strength-
endurance program**. Running is ~50 % of race time and the single biggest performance lever, and the
distinctive stimulus is **compromised running** (running under post-station fatigue). The platform
already hosts comparable programs behind the `@hta/program-core` `ProgramEngine` contract; Green
Protocol is the closest analog (its own phase grid + conditioning vocabulary, fixed schedule).

## Decision

Add HYROX as a **foreign `ProgramEngine`** in a new package `@hta/hyrox`, modeled on Green Protocol:
its own periodized phase grid + a HYROX session/station vocabulary, **fixed schedule**, reusing the
existing materialize/adapter/registry/picker plumbing. It is **event-aware**: a standalone block with
a baked-in end-taper by default; supplying a race date upgrades it to an A-event with an ADR-0008
taper aligned to the race.

### Periodization model (`[DEF]` programming schedule — not a physiological claim)

A block runs **Base → Build → Specific/Race-prep → Taper**, with block length set by experience level
(see Setup), tapering into the race:

| Phase | Primary focus | Maintained |
|------|---------------|-----------|
| **Base** | Z2 aerobic volume (run + ergs), strength foundation, station technique | — |
| **Build** | Heavy strength + muscular endurance; threshold run volume ↑ | Z2 aerobic |
| **Specific / Race-prep** | Compromised running ↑, station circuits, VO2 intervals, 1–2 partial sims | Strength |
| **Taper** | Volume ↓ 10–50 %, intensity maintained (7–14 days) | — |

The exact week-splits, per-level session counts, and station progression increments are **`[DEF]`
coaching defaults** (cite the coach consensus below), conservative and **user-overridable** — the
same status as 5/3/1 wave length or TB block length. They are NOT presented as calibrated physiology.

### Session vocabulary

Mirrors `packages/green/src/conditioning.ts` — a typed catalog of session templates, each carrying a
zone + unit + movement keys:

- **Easy / Z2** run or erg (aerobic base; off-feet ski/row/bike option for injury-prone runners).
- **Threshold / tempo** run (≈half-marathon effort — HYROX race-pace zone).
- **VO2 intervals** (400 m–1 km reps).
- **Compromised running** — run → station → run combos under fatigue (the signature session).
- **Strength-endurance circuit** — station combos (isolation → compound → compromised over the block).
- **Station-specific intervals** — sled / wall ball / lunge / ski / row technique + interval work.
- **Strength** (HYROX-owned, see below).
- **Simulation** — half (4 stations + 4 runs) or rare full (8 + 8).

### HYROX owns its own strength sessions (no TB delegation)

Unlike Green Protocol (which delegates strength to an embedded Tactical Barbell instance), HYROX
defines its own **station-specific** compound-strength template — the lift selection is driven by the
stations, not a generic cluster:

- **Single-leg** (split squat, reverse lunge, step-up) → sled push (single-leg drive pattern).
- **Posterior chain / pull** (deadlift, RDL, bent row, pull-up, rope grip) → sled pull, farmers carry, row.
- **Press** (overhead / push press) → wall balls.
- **Loaded carries** (farmers, front-rack, zercher) → carry + lunge postural endurance.

1–2×/week, lower reps (3–6), higher load. These are logged per-movement (see below).

### Logging model — by SESSION TYPE, completion-driven

Because HYROX is standardized (movements + amounts are fixed by level/division), the prescription IS
the ground truth of what was done — so per-station logging is unnecessary:

- **Strength sessions** → full **per-movement logging** (existing strength logger; progressive
  overload + e1RM tracking matter here).
- **All HYROX-specific sessions** (runs/ergs, station intervals, circuits, compromised runs, sims) →
  show the **full structured workout**, then log at the **session level**: complete + **total time +
  session RPE + confirm/adjust prescribed weights**. No per-set entry.

**Freshness/recovery is impacted ONLY after completion.** A planned HYROX session contributes nothing
to muscle/region freshness, load balance, or interference (those read logged ACTUALS, never
`planned_sessions` — already true app-wide). At completion the app **materializes the prescription's
known movements into actual log rows** (station movements at prescribed reps/distance × confirmed
weight; runs/ergs as cardio with duration), scaled by **session-RPE load** (sRPE × duration —
Foster 2001, a validated metric). Freshness moves only post-completion, exactly like any logged
session, and no per-rep entry is needed because the standardized prescription supplies the movements.

**Whole-session import.** Many users run a HYROX activity profile (Garmin/COROS/Apple Watch) capturing
the entire session. The Strava mapping must be able to **complete a planned HYROX session from one
imported activity** (total duration + HR-zone distribution — a better intensity signal than manual
RPE); station/muscle load is still derived from the prescription. Manual time+RPE is the fallback.

### Setup (`describeSetup`)

- **Experience level** (beginner / intermediate / advanced) → sets the DEFAULT block length
  (**10 / 12 / 16 weeks**) and scales sessions/week (**3→4 / 5 / 8**), running volume, simulation
  frequency, and station overload.
- **Sessions per week** (defaulted by level).
- **Division** (Open / Pro / Doubles) → station weights/standards (all three seeded).
- **Target race date** (optional) → creates an A-event; taper aligns to it (ADR 0008). Absent →
  standalone block with a fixed end-taper; length = the level default.
- **Benchmarks** (platform Benchmarks step): 1 km (or 5 km) run time → run-pace targets; optional
  deadlift 1RM as a posterior-chain proxy.

### Movement catalog additions

Most stations already exist (sled push/pull, ski-erg, rowing erg, farmers carries, broad-jump).
**Seed (new migration + rows), with muscle/region tags for engine attribution and structured display:**
`wall-ball`, `sandbag-lunge` (the 100 m station; + likely `sandbag-clean`/`sandbag-shoulder` for
accessories), `burpee-broad-jump` (combined movement). These are NOT logged per-set; they exist for
DISPLAY + the completion-time load attribution.

## Calibration / confidence (CP-1…CP-5)

HYROX is a 2018 sport with **no RCT-grade periodization evidence**; its training methodology is
coach-practitioner consensus. Per the binding calibration policy we do **not** relabel that consensus
as HIGH. Instead the design ships **no new unvalidated physiological coefficient**:

1. **All engine math reuses the existing, CP-2-governed shared engine** — load model, concurrent
   interference (ADR 0025/0028), muscle/region freshness, deload triggers, and the event taper
   (ADR 0008). HYROX adds scheduling + standardized content, not new physiology.
2. **The only "science" HYROX leans on is established and citeable HIGH** (cite per CP-5):
   - Session-RPE load (sRPE × duration) — **Foster 2001, Med Sci Sports Exerc** (validated).
   - 80/20 polarized intensity distribution — **Seiler** (endurance evidence base).
   - Taper = volume ↓, intensity maintained — **Bosquet 2007, Med Sci Sports Exerc** (meta-analysis).
3. **Published FACT, not calibration:** race format, station order/distances, and Open/Pro/Doubles
   weights/reps are HYROX rulebook standards.
4. **Periodization phase-splits / session-counts / progression increments are `[DEF]` programming
   schedule** — conservative, citing the coach consensus, **user-overridable** (the user controls
   sessions/week + block length). Tagged `[DEF]`, never presented as calibrated physiology.

**External framing** stays "science-informed… heuristic adaptive load management" — no "calibrated"
claim (calibration policy external-facing rule).

Coach-consensus sources (cited in the engine `[DEF]` comments): RoxLyfe (Paul Gillingham / Greg
Williams; guest articles by Hidde Weersma — 2026 European Elite champ — on interference + training
zones; Dr Adam Storey, HYROX Sports Science Advisory Council, on the farmers carry), HYROX365 Academy
(official; faculty Chris Hinshaw / Ralf Iwan / Sean Light), Louis Osselaer (Elite 15). Where sources
diverge (e.g. sled-pull at race-weight vs. above-race-weight) the conservative option is the default.

## Consequences

- HYROX becomes a first-class, event-targeted program reusing the entire existing platform
  (materialize, adapter, registry, picker, stats, deload, freshness, taper) — minimal new surface.
- **New build surfaces** that don't exist today: (a) a session-level "complete structured session →
  time + RPE + confirm weights" logging flow; (b) completion-time materialization of
  prescription → actual log rows; (c) Strava whole-session-activity → HYROX-session mapping (today the
  Strava import maps activities to runs/cardio only).
- A prod migration seeds the missing station movements (sign-off gated, like ADR 0049's RPC migration).
- The Hybrid program already covers "build-your-own concurrent"; HYROX is the **race-specific** option
  with fixed standardized content + event taper — a distinct, non-overlapping product slot.

## Alternatives rejected

- **Native block-level engine (like Hybrid)** — unnecessary; HYROX has no cross-day optimization that
  the per-session `ProgramEngine` + phase grid can't express. Green Protocol's per-session model fits.
- **Delegate strength to embedded TB (like GP)** — TB's cluster is the wrong lift selection; HYROX
  strength is station-specific. HYROX owns its strength template.
- **Per-station structured logging on every session** — pointless given HYROX standardization; adds
  logging friction with no signal the prescription doesn't already provide.
- **Labeling the periodization "HIGH confidence"** — would fabricate calibration the evidence can't
  back, violating CP-2/CP-3/CP-5. Handled by the `[DEF]`-schedule + reuse-existing-engine strategy above.

## Migration / build order (each step shippable + green CI)

1. This ADR (Accepted on sign-off).
2. **Catalog seed + migration** — wall ball / sandbag lunge / burpee-broad-jump (+ sled aliases if
   needed), with muscle/region tags. Prod migration — explicit sign-off gate before `db:migrate`.
3. **`@hta/hyrox` engine skeleton** — meta + `describeSetup` + `setup` + types; registry wiring behind
   a flag (NOT yet in `ENABLED_PROGRAM_IDS`). Pure, unit-tested.
4. **Phase grid + session/station vocabulary** — Base/Build/Specific/Taper scaled by level; golden
   timeline tests (counts, tags, weekdays, deload/test kinds), mirroring GP's tests.
5. **`prescribe()`** — render each ref to a `SessionPrescription` (runs, stations, circuits,
   compromised, sims, strength) with pace/load targets from benchmarks. Unit-tested.
6. **Adapter/materialize wiring** + materialize tests.
7. **Completion-logging surface + completion-time prescription→actuals materialization** (freshness
   updates only post-completion).
8. **Strava whole-session mapping** (one HYROX-profile activity completes a planned HYROX session).
9. **Enable in picker** — add `"hyrox"` to `ENABLED_PROGRAM_IDS` + `FIXED_SCHEDULE_PROGRAM_IDS`,
   remove the coming-soon teaser; live-verify the wizard.
10. **Event/taper integration** — race date → A-event → ADR-0008 taper + next-block nudge alignment.
11. **Stats/plumbing pass** — confirm HYROX feeds stats, deload, freshness (post-completion only),
    limitations; live end-to-end deploy.
