# ADR 0076 — A recovery week's content belongs to the program

Status: Accepted (2026-08-24)
Supersedes: the loading half of [ADR 0049](0049-user-initiated-deload-week.md)
(its placement, insertion and off-program model stand)
Related: DC-K4 (override-and-warn), plan §6.9 (single home for derived state)

## Context

ADR 0049 shipped a user-initiated recovery week: an extra, lighter week inserted
after the lifter's current week rather than overwriting it, so no programmed week
is lost. That placement model is right and is unchanged here.

Its **content** was one recipe for every program. `deload-week.ts` mirrored the
lifter's next week and rewrote each main lift to `40/50/60 %TM × 5`. ADR 0049
states the reasoning plainly: "**5/3/1's loading principle** (light
active-recovery training, not GP's near-total rest)". The builder's signature —
`buildDeloadWeek(sources)` — took only the sessions, so it could not have done
otherwise: it never knew which program the block ran.

The owner, reading the Tactical Barbell 3 deload spec, found the consequence.
TB3:

> "an active recovery week. Volume and intensity are reduced… Approx 3 sets x 3-5
> 65-70%RM per session or do an easy calisthenics circuit 3x week."

These are opposite trades, not variations of one idea:

| | Weight | Volume |
| --- | --- | --- |
| 5/3/1 *Forever* deload | cut hard — 40–60 % of TM | kept — 3 × 5 |
| Tactical Barbell 3 | kept moderate — 65–70 % RM | cut — 3 × 3–5 |

A Tactical Barbell lifter pressing the button got Wendler's numbers. That also
sits badly with the repo's methodology-purity rule: engines are meant to be
faithful encodings of their own source.

Three further defects surfaced while checking, all from mirroring a week and
easing only the main-lift percentage:

1. **Warm-ups passed through untouched.** A plain TB block ends in a peak week,
   so the mirrored week's warm-ups could run *heavier* than the entire recovery
   session (80 % warm-up before 65 % work sets).
2. **Easy cardio was never shortened** — only hard cardio was converted. A
   90-minute Green Protocol long run survived a week meant to reduce volume.
3. **Bodyweight and fixed-load mains got no reduction at all**, only a cue.

And a fourth, from the loading basis: TB states percentages against the **true
1RM**, but a block may be run off a derived training max. The logger computes
`1RM × tm_percent × prescribed %`, so an unscaled `65` on a 90 % training max
lands at **58 %** of the lifter's actual max — below the range the book gives.

## Decision

**Each program states its own recovery week; the platform places it.**

1. **`RecoveryWeekPolicy` in `@hta/program-core`** — `topPercent`, `setOffsets`
   (so `[0,0,0]` is straight sets and `[-20,-10,0]` is a ramp), `reps`/`repsMax`,
   `recommendedPercent`, `basis`, `easyCardioMaxMin`, `restOnly`, `cue`. Engines
   export a policy; they never see a stored `Prescription` and never materialise
   a row, so purity holds. The platform keeps the mirroring, the insertion and
   the renumbering.
2. **Policies, from each source.** Tactical Barbell: 3 sets × 3–5 at 65 % of the
   true 1RM. 5/3/1: the 40/50/60 × 5 ramp off the training max. Green Protocol:
   rest, matching the near-total-rest deload weeks already in its own phase grid.
   HYROX: light straight sets, easy aerobic kept. A natively assembled block, or
   any program without a policy, gets an explicitly generic one — **not** any
   book's numbers relabelled as a default.
3. **The lifter sets the percentage.** The preview carries a control seeded from
   the policy, showing the program's recommended range. Choosing outside it
   **warns and proceeds** (DC-K4). Bounded 30–85 % and validated in the server
   action, which is the trust boundary — the value decides load.
4. **`basis: "one-rm"` is scaled through the training max**, so a policy stated
   against the true max means what its source says even on a block run off a
   derived one.
5. **The mirrored week is eased, not copied.** Warm-ups are regenerated against
   the recovery week's own top set; easy cardio is capped by the policy;
   a bodyweight main loses volume, since it has no percentage to lose.

## Options considered

- **A — Fix the numbers for Tactical Barbell only.** Rejected: it moves the
  problem. HYROX and native Hybrid already have their own deload behaviour
  elsewhere in the app and would still have been handed Wendler's ramp here.
- **B — Ask each engine for a full recovery `Prescription`.** Rejected: it would
  couple pure engines to materialised platform rows and user-customised
  sessions, which is exactly what the engine boundary exists to prevent.
- **C — Engine-owned policy, platform-owned transformation (chosen).**
- **D — Do nothing and document it.** Rejected by the owner.

## Consequences

- **A Tactical Barbell recovery week is a Tactical Barbell recovery week.** The
  same holds for 5/3/1, Green and HYROX.
- **The percentage is the lifter's**, with the book's advice stated rather than
  imposed — the same override-and-warn shape used elsewhere.
- **Recovery weeks already inserted are left alone.** They are accepted
  prescriptions and may be logged; silently rewriting one would itself be a
  silent overrule. An unlogged one can be removed and re-added.
- **`DELOAD_MAIN_RAMP` is gone** as an exported constant; its numbers now live in
  `WENDLER_RECOVERY_WEEK` where they belong.
- **Deferred:** the post-peak-week prompt. TB3 names "after Peak Week" as its
  rule of thumb, and a plain TB block *ends* in one, but surfacing it there needs
  a suggestion to survive a block being marked complete and needs recommendation
  identity to stop being one-per-block — a user-data migration, so it is its own
  decision. Recorded in the log as open.
- **Also deferred:** TB3's calisthenics-circuit alternative. It is a structurally
  different week (a bodyweight circuit three times a week, not a lightened
  version of your own week) and needs its own movement selection.
