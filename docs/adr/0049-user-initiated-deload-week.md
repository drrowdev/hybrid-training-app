# ADR 0049 — User-initiated deload week (insert a standalone recovery week)

**Status:** Accepted
**Date:** 2026-06-14
**Phase:** Production (platform-program era)
**Relates to:** ADR 0046 (programs platform), ADR 0010 (deload nudges), the deload-skip
feature, and the Tactical Barbell engine (which has no scheduled deload week).

## Context

Three of the four live programs bake a deload into their plan calendar:

- **5/3/1** — the 7th-week protocol after two 3-week waves (`waves.ts` deload wave =
  `[0.4×5, 0.5×5, 0.6×5]`, assistance volume `none`). It is a *modulation of a fixed
  wave week* — part of the program's own 7-week structure.
- **Green Protocol** — a **standalone deload week** in the phase grid
  (`phases.ts`: `deloadWeek = { days: [deload, rest×6] }`), slotted *between* training
  phases (e.g. "Wk 1–6 Operator → **Wk 7 deload** → Wk 8–13 Fighter → **Wk 14 deload**").
  The block length already includes it; the surrounding training weeks are untouched.
- **Hybrid** — a Deload week profile in its concurrent engine.

**Tactical Barbell has none.** Operator/Fighter are *continuous* templates — TB1's
guidance is to take a CNS-recovery / dephasing week **as the lifter judges necessary**,
not on a fixed calendar slot. Today the only TB deload signal is an advisory banner at
~24-week boundaries (`program.ts` `onSessionLogged` → `program_recommendations`). There
is no way for a user — on **any** program — to say "I'm cooked, give me a recovery week
*now*."

A natural first instinct is to **convert** the current week in place (swap its
prescriptions to deload loading, like the deload-skip feature does). This is **wrong for
a user-initiated deload**: converting week *k* overwrites that week's programmed work, so
the user loses a training week and effectively skips forward to week *k+1*. What a fatigued
lifter actually wants is to **pause, recover, then resume the exact week they were about
to do**. That is an *insert*, not an overwrite — and it is exactly how Green Protocol
already models a deload: a discrete recovery week that sits between training weeks without
consuming one.

## Decision

Add a **user-initiated "Take a recovery week" action**, available on any active block,
that **inserts a standalone deload week** immediately after the user's current week. It
follows **GP's placement model** (a discrete inserted week, training weeks preserved) and
**5/3/1's loading principle** (light active-recovery training, not GP's near-total rest).

### Why insert is cheap here: dates are derived, not stored

Session calendar dates are **never persisted**. Every surface (`queries.ts:137`, all of
`lib/stats/**`, the heatmap, AI tools) derives a session's date from
`block.started_on + week_index*7 + day_index`. Therefore inserting a week requires **no
date rewriting**:

1. Renumber: `UPDATE planned_sessions SET week_index = week_index + 1 WHERE block_id = ?
   AND week_index > k` (where *k* = the current week index).
2. Insert the deload week's sessions at the freed `week_index = k + 1`, `role = 'deload'`.
3. `UPDATE training_blocks SET weeks = weeks + 1`.

The calendar of every later week shifts +1 week automatically because it is computed from
`week_index`. Stats, the heatmap, deload detection (role-derived), and the Plan calendar
all stay correct with zero extra work.

> Implementation note: `planned_sessions` has a unique index on
> `(block_id, week_index, day_index, slot)`. A bulk `+1` on a non-deferrable unique
> constraint can transiently collide mid-statement. The write must either renumber inside
> a transaction with a temporary high offset (shift to `week_index + 1000`, insert, shift
> down) or use a deferred constraint. The action MUST be transactional and idempotent.

### The deload week's content — "your next week, lighter"

The inserted week **mirrors the structure of the user's next programmed week** (same
training days, same main movements) at **deload loading**:

- **Main / cluster lifts kept**, dropped to a fixed light ramp — **40 % / 50 % / 60 % of
  the working weight (TM or cluster top), 5 reps, no AMRAP / no max-rep set.** This is the
  5/3/1 *Forever* deload wave applied program-agnostically.
- **Accessories / assistance stripped** to none (mirrors 5/3/1's `volume === "none"` on
  deload sessions).
- **Conditioning reduced to easy / Z2 only** (for concurrent programs); long/VO2/threshold
  work dropped.
- `role = 'deload'` on every session so the existing role-derived deload reads
  (Plan marker, session-detail phase label, offers) recognise it.

This is *active recovery*, deliberately not GP's full-rest week — a user-initiated
mid-block deload is a dephasing week, not a taper. (Where a program already defines its own
deload loading we MAY reuse it, but the unified 40/50/60 light week is the default and the
only new spec TB needs.)

### Off-program: the stateful engines are untouched

5/3/1 and TB are **stateful** engines whose `program_instances.instance` tracks
block/week position; progression advances via the `programRef` on each planned session
(`progression.ts`). The inserted deload sessions are **off-program**: they carry **no
advancing `programRef`** (they are recovery work, not a counted program week). Logging them
is a no-op for the instance cursor. The user's subsequent *real* weeks keep their original
`programRef`s and advance exactly as before — so the recovery week genuinely sits "outside
the program," matching TB's "step out for a recovery week" intent. No engine change.

### Reversibility

The action is reversible while the deload week is unlogged: delete the deload sessions,
`week_index = week_index - 1` for the rows after it, `weeks = weeks - 1`. Once any deload
session is logged, the week is retained (we never delete logged history) and the user ends
the block one week longer — the honest outcome.

### Preview before commit (confirmed)

The action is **two-step, like the autoreg / deload-skip offers**: a read-only
`getDeloadWeekPreview(blockId)` computes the deload week (off the user's next programmed
week) and returns it for display; the user sees **exactly what the recovery week will look
like** — each session, each main lift at its deload weight, accessories removed, conditioning
eased — and only on **Accept** does the transactional `insertDeloadWeek(blockId)` run. The
action **recomputes server-side** (never trusts client-sent prescriptions) and is
idempotent. Default content is locked to the 5/3/1-style light week below — no rest-vs-light
user choice (keep it simple).

### Surfaces

- Primary: a **"Take a recovery week"** action on the Plan page for any active block.
- TB also wires it into the existing ~24-week **CNS-deload advisory banner** as its CTA, so
  the advisory becomes actionable instead of purely informational.

## Calibration / citations (CP-1 … CP-5)

New constants introduced — the deload loading ramp — must carry citations per the
calibration policy:

- **`DELOAD_MAIN_RAMP = [0.40, 0.50, 0.60] × 5 reps, no AMRAP`** — *5/3/1 Forever*
  (Wendler, 2017), the Deload / 7th-Week Protocol deload wave; already encoded in
  `packages/wendler/src/waves.ts` (`deload` wave). HIGH confidence as a deload floor
  (it is the same number the app already ships for 5/3/1).
- **TB recovery-week applicability** — *Tactical Barbell* (K. Black), CNS-recovery /
  dephasing week guidance: a lighter week taken as fatigue accumulates. MODERATE confidence
  on transferring the 5/3/1 ramp to TB's cluster (practitioner-consensus that a deload =
  ~40–60 % for fixed light reps); the *decision to deload* stays the user's.
- **Accessory volume → none on deload** — mirrors the shipped 5/3/1 behaviour
  (`assistance-spec.ts` returns `[]` for deload). No new number.
- **Conditioning → easy/Z2 only** — consistent with the existing modality/taper model
  (ADR 0008/0009); no new constant.

## Consequences

- TB (and every program) gains an authentic, methodology-faithful, user-controlled deload
  that preserves all programmed training. The block grows by one week; nothing is skipped.
- The deload week reuses the **role-derived** read seam (ADR 0046 Phase 3), so the Plan
  marker, session-phase label, and stats light up with no per-feature work.
- A new **write path** (the only schema-mutating action of its kind): must be transactional,
  idempotent, RLS-scoped (user-scoped client, explicit ownership check, Zod `.strict()`),
  and reversible. The `week_index` renumber under a unique constraint is the main
  implementation risk and needs the temp-offset / deferred-constraint handling above.
- **Open interaction — events/taper:** inserting a week pushes later training one week back,
  which could shift a block past a scheduled A-event taper window (ADR 0008). v1 SHOULD warn
  (not block) when an A-event falls inside the remaining block and would be affected; the
  full re-taper is deferred.
- Block auto-completion (`maybeCompleteBlock`) now needs the extra week's sessions done —
  consistent and correct (the block really is one week longer).

## Alternatives rejected

- **Convert-in-place** (overwrite the current/next week to deload loading) — overwrites
  programmed work and skips the user forward a week. Rejected: it is the deload-*skip*
  semantics, not a deload-*insert*; it costs a training week, which is precisely what the
  user does not want.
- **TB-specific button only** — a user-initiated recovery week is valuable for every
  program; special-casing TB would duplicate the mechanism. Build it program-agnostic with
  TB as the primary beneficiary.
- **Full-rest week (GP style) as default content** — too passive for a mid-block "I'm
  fatigued" deload; the 5/3/1 light-training ramp is the better active-recovery default.

## Migration / build order (each step shippable)

1. **Pure deload-week builder** — given the user's next week's planned sessions + program
   context, produce the deload week's session specs (each distinct main lift at
   `DELOAD_MAIN_RAMP`, accessories/supplemental stripped, conditioning eased to easy/Z2,
   `role='deload'`). Pure + unit-tested; no DB. **Doubles as the preview source.**
2. **Read-only preview** — `getDeloadWeekPreview(blockId)`: load the next programmed week,
   run the builder, return the deload week for the confirm dialog. No writes.
3. **Transactional insert/remove actions** — `insertDeloadWeek(blockId)` (renumber + insert
   + bump `weeks`, unique-constraint-safe ordering; recomputes server-side; RLS-scoped,
   idempotent) and `removeDeloadWeek` (reverse, while unlogged).
4. **Plan-page CTA** with the preview→Accept dialog; wire the TB advisory banner CTA.
5. **Tests** — builder unit tests; an action-level test for renumber correctness +
   off-program (no `programRef`) + reversibility; an invariant test that the engine instance
   cursor is unchanged after insert.
