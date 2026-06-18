# ADR 0051 — Season / macrocycle roadmap (multi-block sequencing for hybrid athletes)

**Status:** Proposed
**Date:** 2026-06-18
**Phase:** Design (pre-implementation — written for review before any code)
**Relates to:** ADR 0010 (next-block suggestion nudge — this ADR graduates its
"2–3 block look-ahead on demand" open follow-up), ADR 0008 (modality-aware
taper / event peaking), ADR 0038 (cardio mesocycle progression), ADR 0037
(strength "hold" during a cardio build), ADR 0046 (programs, not archetypes),
ADR 0050 (HYROX `weeks-to-race` back-calculation), ADR 0013/0014 (mid-block
auto-regulation). Calibration policy CP-1…CP-5 in
`docs/knowledge/hybrid-training-design-constraints.md`.

## Context

SxC is a **platform of programs** that already periodizes well at two of the
three classic tiers (macro / meso / micro — Cleveland Clinic framing):

- **Microcycle (the week):** built — loading-week waves, deload cadence (ADR
  0030/0037), AMRAP-driven progression (ADR 0007).
- **Mesocycle (a block):** built — **each program instance _is_ a mesocycle.**
  A 5/3/1 cycle, a Tactical Barbell phase, Green Protocol's phased blocks, a
  Hybrid block. Internal progression + taper/deload lifecycle + event peaking
  (ADR 0008) + cardio meso-progression (ADR 0038).
- **Macrocycle (sequencing blocks over months):** **not built.** ADR 0010 ships
  only a *just-in-time nudge* for the next block and deliberately rejected a
  Gantt-style annual planner. The user is the macrocycle planner.

The four periodization *types* from the article already exist implicitly:
linear (5/3/1's monthly TM bump), undulating (Hybrid's concurrent week), block
(switching programs is block periodization), and event-peaking (HYROX
`weeks-to-race` + the A-event taper).

ADR 0010's rejection of an annual planner was correct **for the median user** —
false precision, the engine already auto-regulates, and long plans don't survive
real life. But 0010 explicitly carved out *"if users want more, this can later
graduate to a 2–3 block look-ahead — but only on demand, and never at the cost
of the one-tap simplicity."* This ADR is that graduation, scoped to the
**advanced user** who explicitly wants to see and shape a multi-month arc, and
built on machinery that did not exist when 0010 was written: just-in-time block
materialization, `programSegments`, `priority_events`, `program_recommendations`,
and the forward-only **edit-active-plan** flow (this session's PR #585).

The genuinely novel, on-brand part is **balance periodization**: almost every
periodization tool sequences *one* attribute (a lifter's strength peak, a
runner's mileage). A hybrid athlete's macrocycle problem is different — *how to
shift the strength↔endurance emphasis block-to-block without detraining either*.
SxC already models the concurrent interference scalar and modality balance, so
it is unusually well-placed to express this.

## Decisions

| # | Topic | Decision | Why |
|---|---|---|---|
| 1 | A roadmap, not a Gantt | A **Season** is an ordered list of block *intentions*, each a `(program, emphasis)` pair, optionally anchored to a goal event/date. No timeline UI, no day-level plan. | Keeps the surface simple; respects ADR 0010's rejection of a planner while delivering the long view. |
| 2 | Just-in-time materialization | **Only the active block is materialized** into `planned_sessions`. Future Season blocks are intentions only — no sessions exist for them until activated. | Sidesteps regeneration-drift + stale-prescription entirely (the same reason the edit-plan flow is forward-only, PR #585). A plan months out is an intention, not a contract. |
| 3 | Reuse the deploy path | Activating a Season block calls the **existing** `createProgramInstance` with the emphasis translated into existing knobs (program setup + `secondaryFocus`/focus + effort bias). The new `training_blocks` row links back via `season_blocks.block_id`. | No new prescription math. The Season is an orchestration layer **above** `program_instances`; `buildPrescription` is untouched. |
| 4 | Auto-regulation always wins | The Season is **advisory and living**. Readiness / reactive-deload signals (ADR 0013/0014) can insert a recovery block or slide the peak; if the user runs a different program, the Season re-plans forward or marks itself off-track. It **shows, never blocks**. | Matches the app's "display only, never overrule" philosophy. A map you can see, not a rail you're locked to. |
| 5 | Event anchor reuses ADR 0008/0050 | If goal is an event, back-calculate so the peak block's final week lands on event week (reuse `wholeWeeksBetween`). The event is a `priority_events` A-event; **the taper is ADR 0008's**, not new. | Event peaking is the one place the science is strong; lean entirely on the existing, validated taper. |
| 6 | The nudge becomes Season-aware | When a Season is active, ADR 0010's next-block nudge changes from *recompute-from-history* to *"advance to your next planned block"* (pre-filled). With no Season, 0010 behaves exactly as today. | One coherent "what next?" surface; 0010's stateless nudge remains the default for users who never make a Season. |
| 7 | Balance periodization (the differentiator) | Emphasis tags for a hybrid Season express the **strength↔endurance bias**, not a single quality. The de-emphasized quality is **held at a maintenance floor**, validated against the concurrent interference model. | Concentrated-load block periodization (Issurin) applied to a *concurrent* athlete — the move no competitor really makes. |
| 8 | Honest confidence | Sequencing + bias constants ship tagged `// heuristic (CP-1)`; copy frames the Season as *agency / visibility / adherence*, with a guaranteed-benefit claim made **only** for the event-peaking case. | The evidence that structured periodization beats good auto-regulation in non-elites is weak-to-moderate; overclaiming would violate CP-1/CP-5 discipline. |

## Rationale

The product tension ADR 0010 named is real: *scientifically grounded* **and**
*intuitive and simple*. 0010 resolved it for the median user by refusing to
build a planner. This ADR does **not** reopen that — it adds an *opt-in* layer
for the advanced user, built so it can't regress the simple path (no Season =
today's behaviour, byte-identical).

The two design choices that keep it honest are **(2)** just-in-time
materialization and **(4)** advisory-only. Together they mean a Season is a
*living intention*, not a stored multi-month prescription. If the user's life
changes, the Season bends; it never holds the user to a plan made six weeks ago.
This is the same stance as the just-in-time nudge in 0010 — extended from
"one block ahead" to "a named arc" — and the same forward-only discipline as the
edit-plan flow.

Balance periodization (7) is the reason to build this at all. The literature on
periodizing a *single* quality is mature; the literature on periodizing the
*balance* for a concurrent athlete is thin precisely because few tools can model
interference. SxC can. The defensible, on-brand claim is narrow and true:
*concentrate load on one quality for a block while holding the other at a
maintenance floor, then rotate* — and the app can verify the floor is respected.

## Evidence base

- **Block periodization** (Issurin 2010; Bompa) — **MODERATE**: sequencing
  concentrated blocks is a well-established framework for organising emphasis;
  not RCT-grade for recreational athletes.
- **Maintenance volume preserves adaptation** (Bickel 2011, *Med Sci Sports
  Exerc* 43(7)) — **HIGH** for the principle: trained adaptations are maintained
  on roughly a third of accumulation volume **when frequency is preserved**.
  This is the science anchor for the "hold the de-emphasized quality" floor; the
  exact percentage SxC uses is a CP-1 heuristic, not Bickel's number applied
  literally.
- **Concurrent interference is dose/intensity dependent** (Wilson 2012 meta;
  Coffey & Hawley 2017) — **MODERATE**: supports concentrating one quality while
  *reducing but not removing* the other to limit interference.
- **Aerobic build = add easy volume first, then quality** — already implemented
  as ADR 0038 (`hybrid-training-research-v2.md` §4); the endurance-bias emphasis
  reuses it directly.
- **Periodized ≈ non-periodized for hypertrophy in non-elites; modest
  undulating edge for strength; individual response dominates** (Grgic 2017 meta
  and related) — **MODERATE**: the reason copy must frame the Season as agency /
  adherence, not a guaranteed performance optimizer.
- **Event taper science** (Bosquet 2007 meta; Mujika) — **HIGH**: the one place
  a guaranteed-benefit claim is warranted — and it is delivered by ADR 0008, not
  by this ADR.

## Data model

Two tables, both one-active-per-user and RLS-scoped exactly like
`program_instances` (explicit `user_id` ownership, never service-role).

```
training_seasons
  id            uuid pk
  user_id       uuid not null  -> auth.users
  name          text           -- user label ("Spring HYROX build")
  goal_type     text           -- 'event' | 'theme'
  target_event_id uuid null     -> priority_events(id)   -- when goal_type='event'
  target_date   date null      -- denormalised event/peak date for back-calc
  status        text           -- 'active' | 'completed' | 'abandoned'
  created_at / updated_at / deleted_at

season_blocks
  id            uuid pk
  season_id     uuid not null  -> training_seasons(id) on delete cascade
  user_id       uuid not null  -- denormalised for RLS + cheap filtering
  position      int  not null  -- 0-based order within the season
  program_id    text not null  -- which program runs this block (registry id)
  emphasis      text not null  -- 'base'|'strength_bias'|'endurance_bias'
                               --  |'build'|'peak'|'realize'|'recovery'
  intent_note   text null      -- optional user/coach note
  planned_weeks int  null      -- estimate only (display); real weeks come from
                               --  the engine when materialised
  status        text not null  -- 'planned' | 'active' | 'done' | 'skipped'
  block_id      uuid null      -> training_blocks(id)  -- set ONLY when activated
  created_at
  unique (season_id, position)
```

Invariants:
- At most **one** `training_seasons` row per user with `status='active'` (mirrors
  `program_instances`; activating a new Season archives the old one).
- At most **one** `season_blocks` row per Season with `status='active'`, and it
  is the only one whose `block_id` is non-null (the only materialized block).
- `season_blocks.block_id` is a nullable FK with `ON DELETE SET NULL` — ending a
  block must not cascade-delete Season history.

No change to `training_blocks` / `planned_sessions` / `program_instances`
schemas; the Season layer only *references* them.

## Just-in-time materialization contract

1. **Future blocks are intentions.** Creating/editing a Season writes only
   `training_seasons` + `season_blocks` rows. **No `planned_sessions` are
   generated for `status='planned'` blocks.** This is the load-bearing rule: it
   makes the Season immune to the regeneration-drift and stale-prescription
   problems that forced the edit-plan flow to be forward-only.

2. **Activation = the existing deploy path.** "Start this block" calls
   `createProgramInstance({ programId, ...emphasisKnobs })` unchanged, then sets
   the activated `season_blocks.block_id` and `status='active'`, and archives the
   prior active block exactly as `createProgramInstance` already does. The
   emphasis is translated to **existing** setup knobs (see the balance spec
   below) — no new materialization code path.

3. **Advancement.** When the active block completes (or the user taps "start next
   block"), the next `status='planned'` Season block is offered via the wizard,
   deep-linked `/app/program?seasonBlockId=<id>` (mirrors the existing
   `?program=` / `?phase=` / `?edit=` deep links), pre-filled with its program +
   emphasis. The user can edit or skip it; **never auto-activated** (Decision 4,
   and ADR 0010 Decision 4 parity).

4. **Event back-calculation.** For `goal_type='event'`, the peak/realize block's
   final week is pinned to the event week using `wholeWeeksBetween(start, event)`
   (the exact HYROX mechanism, ADR 0050). Earlier blocks fill the runway; if the
   runway is too short for the planned sequence, the Season **flags** the
   conflict (show, don't silently truncate). The taper itself is ADR 0008's
   A-event taper — the Season only orders blocks up to it.

5. **Auto-regulation bends the roadmap (advisory).** The Season never overrides
   the engine. Concretely:
   - A reactive deload / cooked-readiness signal (ADR 0013/0014) can surface a
     suggestion to **insert a `recovery` Season block** before the next planned
     one. Opt-in, one tap, like every other nudge.
   - If the user activates a program that doesn't match the next planned block,
     the Season marks itself **off-track** and offers to re-plan forward from the
     current reality (or to keep the original arc as a target). It does not block
     the deviation.
   - The event date moving updates `target_date`; the back-calc re-runs and the
     roadmap re-annotates. No materialized future sessions means re-planning is
     a cheap metadata update.

6. **Regression guard.** With **no active Season**, every existing surface
   behaves byte-identically: the ADR 0010 nudge recomputes from history, the
   program picker is unchanged, `createProgramInstance` is unchanged. The Season
   layer is purely additive.

## Hybrid balance-periodization spec

This is the part that distinguishes a SxC Season from a generic block planner.
For a hybrid athlete the emphasis tag schedules the **strength↔endurance bias**,
and the de-emphasized quality is **held at a maintenance floor** rather than
dropped. Emphasis → existing-knob mapping (all heuristic, CP-1):

| Emphasis | Strength | Endurance | Implemented via (existing knobs) |
|---|---|---|---|
| `base` | balanced | balanced | Hybrid default `concurrent_hybrid` (~50/50) |
| `strength_bias` | concentrate | **hold at floor** | Hybrid with `secondaryFocus` toward strength + higher `effort_preference`; aerobic frequency preserved, volume held near the maintenance floor |
| `endurance_bias` | **hold (already the default)** | concentrate | ADR 0038 cardio easy-volume creep ON; strength stays the ADR 0037 "hold" wave |
| `build` | progress primary | progress primary | program's normal within-block progression |
| `peak` | taper | taper | ADR 0008 event taper (requires an A-event) |
| `realize` | test/peak singles | reduce | ADR 0010 Decision 6 realization microcycle (opt-in) |
| `recovery` | dialed down | dialed down | Hybrid dialed-back (the 0010 recovery target) |

**The maintenance-floor invariant (the science-bearing rule).** When a block
concentrates one quality, the other must not drop below a maintenance threshold,
defined on two axes and **validated against the existing concurrent interference
scalar**:
- **Frequency floor:** the de-emphasized quality keeps ≥ a minimum sessions/week
  (frequency is the strongest maintenance lever — Bickel 2011, HIGH).
- **Volume floor:** its weekly volume stays ≥ a fraction of the athlete's
  rolling baseline (the "roughly a third" maintenance region — anchored to
  Bickel 2011 for the *principle*; the exact fraction is CP-1 heuristic).

The Season's bias is therefore **bounded**: `strength_bias` shifts allocation
toward strength but the generator must still seat the endurance frequency/volume
floor, and the interference scalar is checked so the concentrated load doesn't
push the held quality into a deficit. This is the concrete, falsifiable form of
"concentrate one quality, hold the other" — and it's exactly the check SxC can
make that a single-quality planner cannot.

**Constants introduced (all NEW, all heuristic-pending-data):**
- `SEASON_BIAS_SHIFT` — how far `strength_bias` / `endurance_bias` move the
  concurrent allocation from 50/50 (e.g. toward ~60/40). **CP-1 heuristic**,
  practitioner-consensus; no RCT value.
- `MAINTENANCE_FREQUENCY_FLOOR` — minimum sessions/week of the de-emphasized
  quality. **CP-1 heuristic**; principle per Bickel 2011 (HIGH), magnitude not.
- `MAINTENANCE_VOLUME_FLOOR_FRAC` — minimum fraction of rolling baseline weekly
  volume the held quality must retain. **CP-1 heuristic**; "~1/3" *direction* per
  Bickel 2011 (HIGH), exact fraction a placeholder.
- Phase-sequence + planned-weeks defaults for the auto-suggested Season
  templates — **CP-1 heuristic**, practitioner-consensus (same tier as ADR
  0010's sequencing thresholds).

## CP-2 / calibration-policy pressure-test

Run before any code, per the user's request.

**CP-1 — no unvalidated constant ships without a labeled validation plan.** The
four constants above each get (a) a `// heuristic … (CP-1)` source tag, and (b) a
validation plan in this ADR:
- `SEASON_BIAS_SHIFT` → signal: **interference-deload trigger rate inside biased
  blocks vs base blocks** (if `strength_bias` blocks raise reactive deloads
  materially, the shift is too aggressive); rollback if biased-block deload rate
  exceeds base-block rate by a pre-registered margin.
- `MAINTENANCE_FREQUENCY_FLOOR` / `MAINTENANCE_VOLUME_FLOOR_FRAC` → signal:
  **measured retention of the held quality** across a biased block (strength: top
  AMRAP e1RM drift; endurance: Z2 pace/HR drift). Rollback/raise the floor if the
  held quality regresses beyond a noise band.
- Season-template defaults → signal: **adherence-to-Season rate and off-track
  frequency**; revise templates whose blocks are skipped/deviated most.

**CP-2 — existing engine constants stay untouched.** The Season layer adds **no
new coefficients to `buildPrescription`, the ceiling chain, the load model, the
modality multipliers, or the interference scalar.** It *reads* the interference
scalar to check the floor; it does not change it. Every CP-2 table row is
unaffected — a Season with zero blocks produces byte-identical prescriptions.

**CP-3 — precision requires a tag.** The bias/floor constants are expressed at
one significant figure where possible (e.g. a frequency *count*, a coarse
fraction) and carry the `// heuristic, no calibration data` tag. No two-decimal
precision ships without a CP-3 marker.

**CP-4 — the ceiling chain stays at 2 factors.** The Season **must not** add a
third ceiling factor. Emphasis biases volume *allocation* via existing setup
knobs **before** the ceiling math, not via a new `season_modifier × baseCeiling`
term. This is an explicit non-goal and a review tripwire: any PR that routes
Season emphasis through `getCeilingExplain` fails review.

**CP-5 — peer-reviewed constants must cite.** The maintenance-floor *principle*
cites `// maintenance via frequency per Bickel 2011, Med Sci Sports Exerc 43(7),
HIGH`; the *magnitudes* use the CP-3 heuristic tag (they are consistent-with, not
equal-to, the literature). Block-periodization framing cites Issurin 2010
(MODERATE). No fabricated precision citations.

**Net:** the Season is a CP-clean *orchestration* layer. All new constants are
CP-1 heuristics with validation plans; no CP-2 row moves; CP-4 is explicitly
protected. The only science claim made at HIGH confidence is the event taper,
which is ADR 0008's, not this ADR's.

## Phasing (cheap → rich)

- **Phase 0 (near-free, validates demand):** make the ADR 0010 nudge
  multi-step-aware — let a user pin a 2–3 block sequence with emphasis tags. Adds
  `training_seasons` + `season_blocks` and the Season-aware nudge (Decision 6);
  no event anchor, no balance floors yet. Reuses everything.
- **Phase 1:** event anchor + back-calculation (Decision 5), a read-only roadmap
  strip on `/app/plan`, and emphasis → existing-knob mapping for the simple tags
  (`base`/`build`/`recovery`).
- **Phase 2 (the differentiator):** balance periodization — `strength_bias` /
  `endurance_bias` with the maintenance-floor invariant validated against the
  interference scalar.

## Out of scope

- A Gantt/timeline UI, day-level plans months out, or pre-materializing future
  blocks (Decision 2 forbids it).
- Auto-activating, scheduling, or locking future blocks (Decision 4).
- Any change to `buildPrescription`, the ceiling chain, the interference scalar,
  the deload cadence, or program definitions.
- A guaranteed-performance claim for anything other than event peaking
  (Decision 8).

## Implications

- Delivers the macrocycle tier as an **opt-in, advisory** layer that can't
  regress the simple path (no Season = today, byte-identical).
- Composes with ADR 0008 (taper), ADR 0038 (cardio build), ADR 0010 (nudge
  becomes "advance the Season"), ADR 0013/0014 (auto-regulation bends the
  roadmap), and the edit-plan flow (forward-only discipline reused).
- The balance-periodization invariant is the first feature that *consumes* the
  concurrent interference model as a planning constraint rather than a stats
  display — a genuinely differentiated, hybrid-native capability.
- On acceptance: add an advisory-only "Season / macrocycle roadmap" note to
  `hybrid-training-engine-live.md` (explicitly: orchestration-only, never
  auto-applied, never touches the ceiling chain) and the canonical workspace
  mirror. No CP-2 numeric rows added until Phase 2 ships, at which point CP-1
  governs the four new heuristics.

## Open follow-ups

- Validate the four CP-1 heuristics against real usage once Season data exists
  (parallels the ADR 0010 sequencing-heuristic and wellness-scale follow-ups).
- Decide whether a "coach mode" (shareable read-only Season) is worth it — out of
  scope here, but the data model supports it without change.
- Revisit whether `endurance_bias` should also creep *quality* (VO₂ density) per
  ADR 0038's "then add quality" clause, or hold quality and only build easy
  volume in a bias block — a Phase-2 calibration question.
