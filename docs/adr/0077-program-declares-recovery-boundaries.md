# ADR 0077 — The program says *when* a recovery week is due

Status: Accepted (2026-08-25)
Supersedes: the placement half of [ADR 0049](0049-user-initiated-deload-week.md)
(its insertion and off-program model stand)
Complements: [ADR 0076](0076-recovery-week-belongs-to-the-program.md), which moved
the recovery week's *content* into the program
Related: DC-K4 (override-and-warn), plan §6.9 (single home for derived state)

## Context

ADR 0076 gave each program its own recovery-week loading. It left the other half
of the question open: **when** is one due, and **where** does it go?

Both answers were platform guesses.

*When* was a 24-week counter in the TB engine, chosen as a heuristic stand-in for
TB1's "dephase every few months", plus a fatigue proxy on the Plan page. Neither
knows what TB3 actually says:

> "A good rule of thumb is to deload after Peak Week and Work Capacity blocks."

Operator, Fighter and Zulu each end their block with a peak week. Gladiator, Mass,
Grey Man and Zulu/HT do not. The 24-week counter fired on none of those facts —
it fired on arithmetic, so a lifter finishing a 6-week Operator block with three
maximal singles behind them got no advice at all until week 24.

*Where* was worse. `getDeloadWeekPreview` derived the insertion point from
`Date.now()`:

```ts
const cur = currentWeekIndex(block.started_on, weeks);
const afterWeek = cur;
```

For the user-initiated control that is exactly right — "I am tired now" means
"after this week". For program-advised placement it is a bug with a plausible
disguise. A lifter logs their last peak session on Sunday, sees the prompt on
Thursday, and taps it: the week lands after whatever week Thursday falls in. If
they had already begun the next block, a light week drops into the middle of it.
The prompt would have been *right* and the placement *wrong*, which is the worst
combination — the lifter has no reason to doubt it.

## Decision

**1. A program declares its own recovery boundaries.**

`ProgramEngine` gains an optional `recoveryBoundaries(instance): RecoveryBoundary[]`.
A boundary is a key, the session refs that must be settled to reach it, and the
copy to show:

```ts
interface RecoveryBoundary {
  key: string;      // stable within an instance, e.g. "peak-b2"
  refs: string[];   // every session that must be settled
  title: string;
  detail: string;
}
```

TB returns one boundary per engine block **that has a peak week** — derived from
the template's own `kind: "test"` sessions in its final week, not from a list of
template names. A template with no peak week declares no boundary and therefore
raises no post-peak deload. Activation is excluded: it carries its own week-15
deload.

The 24-week counter survives only as the fallback for templates that declare no
boundary, which is where TB1's dephasing guidance actually applies.

**2. Placement is anchored to the boundary, resolved from live rows.**

The recovery-week preview takes an optional `boundaryKey` **and the id of the
recommendation that raised it**. It resolves the boundary through the engine,
then finds those sessions in `planned_sessions` and inserts after the **last week
they occupy**.

Resolving from rows rather than from the engine's own week numbers matters: an
earlier inserted recovery week has already shifted everything after it, so
`block × blockWeeks + finalWeek` is wrong the moment a lifter deloads twice.

The recommendation id is not decoration. Session refs are instance-independent —
a fresh deploy of the same template contains byte-identical refs — so advice
raised by a *finished* block would otherwise resolve happily against the block
that replaced it and schedule the light week six weeks out. The preview therefore
refuses unless the recommendation is still pending, belongs to the **active**
block, and carries that exact boundary key. Pending advice is also retired when
its block is archived, so it never sits on Today pointing at a plan the lifter
has left.

If the named sessions are no longer in the plan, the preview returns **null**. A
boundary we cannot see is one we must not guess at — the advice has been
overtaken by a replanned block, and the quiet always-available control is still
there if the lifter wants a recovery week anyway.

**3. The client never sends a week number.**

The action takes a boundary *key*; the server re-resolves it. A stale page cannot
put a light week into a hard one.

**4. One nudge per occurrence, not per kind.**

`blocks: N` materialises into ONE `training_blocks` row, and the recommendation
table was unique on `(user_id, block_id, kind)` with a matching pending-by-kind
filter. Block 2's "retest your maxes" was therefore swallowed by block 1's — a
pre-existing bug this work would have multiplied, since a per-block deload prompt
is by definition recurring.

`ProgramRecommendation` gains an optional `occurrenceKey`; migration 0135 adds the
column as `NOT NULL DEFAULT ''` and swaps the unique index to
`(user_id, block_id, kind, occurrence_key)`. `''` keeps meaning "this plan raises
this kind once", which is every row written before 0135.

The column is NOT NULL rather than nullable-plus-`COALESCE` for a specific
reason. Two NULLs are distinct in a Postgres unique index, so a nullable column
indexed directly would quietly reintroduce the duplicate race 0105 closed.
`COALESCE(occurrence_key,'')` fixes that but makes the index an **expression**
index, and Postgres cannot infer an expression index from the bare column list
PostgREST sends for `on_conflict` — every recommendation upsert would fail with
42P10. Since the write result was not being checked, the symptom would have been
*silence*: no retest nudge, no deload prompt, no error, and a green test suite.
The upsert now checks and logs its error too.

**5. The prompt clears when the week lands, not when the link is clicked.**

Previously the CTA dismissed the recommendation on click. A failed insert left the
lifter with no week and no advice. The recommendation id now travels to the Plan
page and is resolved only after the insert returns ok.

**6. `insert_deload_week` is genuinely idempotent** (migration 0136). It takes a
row lock on the block, and returns the existing week index when a recovery week
**this function inserted** already sits, unlogged, at the target position. A
double-tap gets one week.

`role = 'deload'` is not that marker: every program tags its *own* programmed
deload week with it — 5/3/1's 7th week, Green's phase-grid deloads, Hybrid's
deload week. Guarding on role alone would have made the always-available "take a
recovery week" control a silent success-with-no-effect for anyone standing the
week before their programmed deload. Inserted weeks are therefore stamped
`prescription.insertedRecoveryWeek`, and the guard reads that.

**7. Recovery at the end of a plan leads the next block.**

When the peak week is the last week of the plan there is nothing to insert
*before*. The wizard offers "Start with a recovery week", which prepends
(`p_after_week = -1`, newly allowed by 0136). This matches TB3's "a deload can be
taken between blocks" more honestly than stretching the finished block by a week.
It runs on the native deploy path as well as the foreign one — an option that
silently does nothing for some programs is worse than no option — and marks the
advice accepted once the week lands, so the lifter is not then asked for a
second.

## Consequences

- TB lifters on Operator / Fighter / Zulu are advised to deload after every peak
  week, cited to TB3, instead of at an arbitrary 24-week mark.
- Templates without a peak week are unaffected — they keep the dephasing
  fallback, which is the guidance that applies to them.
- Every recurring program nudge can now be raised once per block instead of once
  per plan. The `tm-test` retest bug is fixed as a side effect.
- The user-initiated control is unchanged: no boundary key, no anchor, still
  "after the week I'm in".
- **Not supported:** TB3's "and Work Capacity blocks". This app has no work
  capacity block as a domain concept, and inventing one to satisfy a sentence
  would be worse than omitting it.
- A program that declares no `recoveryBoundaries` behaves exactly as before.
