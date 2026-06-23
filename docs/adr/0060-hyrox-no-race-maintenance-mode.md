# ADR 0060 — HYROX without a race: a no-taper concurrent-maintenance mode

Status: Accepted
Date: 2026-06-23

## Context

A HYROX block's race date is **optional** in the wizard. But when it's left blank the
engine still defaults the block length by experience (`WEEKS_BY_EXPERIENCE`: 10/12/16)
and `buildHyroxGrid` lays down the full **Base → Build → Specific → Taper** sequence —
so a raceless block **tapers toward an implied race on the block's end date**. The
wizard copy even admits this ("Leave blank for a standard build with a fixed
end-taper"). The final week is a 0-strength race-pace primer for a race that does not
exist.

That is the wrong shape. From periodization theory (TrainingPeaks / Matt Fitzgerald,
*Linear vs. Non-Linear Periodization in Running*): periodization exists to "produce a
**single peak** at the end of the cycle", and the taper sheds fatigue to express that
peak. A peak is **transient** (~2–3 weeks). Tapering toward a non-existent race spends
a peak the athlete won't use, then forces a rebuild. The opposite extreme — endless
pure base — is also inferior: Martin & Coe's multi-pace argument is for "harmonious
interdevelopment of strength, speed, stamina and endurance all year, never eliminating
any". The best-practice middle is a **non-linear / concurrent maintenance** state that
keeps every quality well-rounded, so the athlete can "peak fairly quickly" once a race
appears. HYROX off-season coaching consensus agrees: the off-season is for holding the
aerobic-base + strength foundations and staying "race-ready for what's next".

## Decision

Make HYROX a **binary** race / no-race program (deliberately no third "peak by date"
intent — keep it simple).

### Race mode (race date set) — unchanged
Base → Build → Specific → Taper, weeks-to-race derived from the date, peaking on race
week. Exactly today's behaviour (incl. ADR 0059 Build alternation).

### No-race mode (race date blank) — new
A **no-taper concurrent-maintenance** block:

- **No Taper and no Specific (race-prep) phase.** There is nothing to sharpen for or
  to peak on, so the engine never emits a taper week, a "race" week, or race
  simulations.
- **Short Base intro → Build steady state.** A *short, capped* Base intro (≈ a
  transition/prep length, not a proportional fraction — see below), then the **Build**
  phase for the remainder: the ADR 0059 two-strength alternation, functional station,
  quality run, and compromised run every week. This *is* the "well-rounded,
  race-ready" state the literature prescribes.
- **Steady, non-ramping load.** The Build load is held **steady and undulating** — it
  must NOT progressively intensify toward a (non-existent) peak. In practice this falls
  out of staying in Build: the Build strength scheme is fixed and the quality stimulus
  *alternates* (threshold/VO2) rather than escalating, and no Specific/Taper is ever
  reached. Joe Friel's caution applies directly — with no near-term start line *"there
  is no reason to start pushing your limits now… a sure way to end up burned-out or
  injured."*
- **Periodic deloads** (the existing every-4th-week cadence) carry the undulation that
  keeps a never-tapering block from overreaching.
- **Fixed block length** (the experience default, user-overridable). When the block
  ends the user starts another; an auto-rolling/indefinite block is a possible future
  enhancement, out of scope here.

### Base intro: a short fixed cap, NOT proportional
Reusing the race-mode `BASE_FRACTION` (40% of the block) is **wrong** for an ongoing
no-race block: it would re-do a long base every time the block is re-created, when a
maintained athlete does not need to re-base. Established practice (Friel's Annual
Training Plan: a long 12+ wk base is for building a *peak from a reduced state*; the
between-plans Transition is only ~3–4 weeks, and complete rest "is likely to prolong
next year's Base Period") says: hold fitness, don't rebuild it. So no-race mode uses a
**short fixed Base cap** (`NO_RACE_BASE_WEEKS`, `[DEF]` ≈ 3–4 wk, clamped to leave Build
room), then settles into the Build steady state.

### Converting no-race → race later
Attaching a race date to a live no-race block (the edit / "add race" flow) recomputes
weeks-to-race and lays **Specific + Taper** onto the tail — i.e. build the peak *from*
the maintained well-rounded base, exactly the "peak quickly" model.

## Mechanism (implementation sketch)

- Thread a boolean (`hasRace`, or equivalently `raceless`) into `HyroxInstance` and
  `HyroxGridInput`. The deploy path already knows it: `raceDate` present ⇒ race mode.
  (`actions.ts` computes `hyroxWeeksToRace` from `raceDate`; absent ⇒ no-race.)
- `phaseForWeek` / `buildHyroxGrid` branch on it: race mode keeps the four-phase
  sequence; no-race mode emits only Base (capped intro) + Build, no Specific, no
  Taper, with the existing `isDeload` cadence.
- Update the wizard copy: the blank-race note should describe an **ongoing build that
  holds fitness with no taper** (today it advertises a "fixed end-taper").
- **Season planner interaction:** a raceless HYROX block is an *accumulation /
  maintenance* arc, not a *peak* arc. Today HYROX's descriptor is `arcRoles:
  ["accumulation","peak"]` (`seasons/descriptors.ts`) on the assumption it always
  self-sequences to a race. The planner should not treat a raceless HYROX block as a
  peak; reconcile the descriptor (or make the arc role mode-dependent) so Season
  sequencing stays correct.

## Calibration

`[DEF]` scheduling defaults — the Base-intro cap (`NO_RACE_BASE_WEEKS` ≈ 3–4 wk) and
the existing deload cadence for the no-race block. No new CP-2 physiological constant.
The *direction* is high-confidence and triangulated across periodization theory
(Fitzgerald), the annual-plan / transition literature (Friel), and HYROX off-season
consensus: (a) don't taper toward a phantom race, (b) hold a concurrent well-rounded
state rather than pure base, (c) a short base intro not a repeated long base, and
(d) a steady, non-ramping load to avoid burnout. The only genuinely low-confidence
residue is the *exact* Base-cap number — trivially tunable later.

## Consequences

- A raceless block never tapers and never emits a 0-strength race week — it stays in
  the productive Build steady state, so the athlete holds fitness and can launch a
  proper peak whenever a race is booked.
- Invariants preserved: every week keeps a strength day, a station, and run work; no
  lower-only week; deload cadence unchanged.
- Race-mode behaviour is byte-identical (the branch only changes the no-race path).
- Existing live raceless blocks already in the DB are not retroactively changed;
  the new shape applies to newly generated/redeployed HYROX plans.

## Resolved (was "open questions")

1. **Base intro:** a **short fixed cap** (`NO_RACE_BASE_WEEKS` ≈ 3–4 wk), NOT
   proportional — the proportional option is removed (it would repeatedly re-base a
   maintained athlete).
2. **Steady state:** **pure Build**, held at a **steady, non-ramping** load (no
   Specific/sims, no progressive intensification toward a peak).
3. **Block length:** **fixed for v1** (re-create to continue). Auto-rolling/indefinite
   is a deferred future enhancement — consistent with how an Annual Training Plan
   itself chains finite periods.
