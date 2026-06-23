# ADR 0060 — HYROX without a race: a no-taper concurrent-maintenance mode

Status: Proposed
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
- **Base intro → Build steady state.** A short Base intro, then the **Build** phase
  for the remainder — the well-rounded concurrent state: the ADR 0059 two-strength
  alternation, functional station, quality run, and compromised run every week. This
  *is* the "well-rounded, race-ready" state the literature prescribes.
- **Periodic deloads** (the existing every-4th-week cadence) carry the undulation that
  keeps a never-tapering block from overreaching.
- **Fixed block length** (the experience default, user-overridable). When the block
  ends the user starts another; an auto-rolling/indefinite block is a possible future
  enhancement, out of scope here.

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

`[DEF]` scheduling defaults — the Base-intro length/cap and deload cadence for the
no-race block. No new CP-2 physiological constant. The *direction* (don't taper toward
a phantom race; hold a concurrent well-rounded state) is high-confidence — backed by
both periodization theory and HYROX off-season consensus. The *exact* Base cap and how
hard the maintenance steady state runs are medium-confidence `[DEF]`.

## Consequences

- A raceless block never tapers and never emits a 0-strength race week — it stays in
  the productive Build steady state, so the athlete holds fitness and can launch a
  proper peak whenever a race is booked.
- Invariants preserved: every week keeps a strength day, a station, and run work; no
  lower-only week; deload cadence unchanged.
- Race-mode behaviour is byte-identical (the branch only changes the no-race path).
- Existing live raceless blocks already in the DB are not retroactively changed;
  the new shape applies to newly generated/redeployed HYROX plans.

## Open questions (for implementation review)

1. Base-intro length in no-race mode — proportional (reuse `BASE_FRACTION`) vs a small
   fixed cap (e.g. ≤3–4 weeks) so a re-created block doesn't repeat a long base each
   time. Leaning fixed cap.
2. Whether the no-race steady state is pure Build, or a Build/“Specific-lite” blend
   that keeps the compromised-run *lead* without sims. Leaning pure Build (compromised
   is already a weekly Build essential — simplest, and avoids implying a peak).
3. Auto-roll / indefinite block vs fixed-length-then-recreate. Fixed for v1.
