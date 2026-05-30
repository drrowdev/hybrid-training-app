# ADR 0010 — Next-block suggestion nudge (lightweight macrocycle guidance)

**Status:** Accepted
**Date:** 2026-05-30
**Phase:** Production (engine methodology review)
**Relates to:** the methodology review's finding-3 (absence of macrocycle / block sequencing)

## Context

The engine is a **mesocycle generator**: it builds one well-formed 4-week block (3 load + 1
deload) at a time and stops. There is no automated block-to-block sequencing — no
phase-potentiation logic that would chain, say, an accumulation (hypertrophy) block into an
intensification (strength) block into a realization/peak. Today the **user is the macrocycle
planner**: at block end they manually pick the next archetype with no guidance.

A world-class coach sequences blocks deliberately. But the two ways to close that gap are very
different in cost:

- **Full annual/periodization planner** — a timeline UI where the user (or the engine) lays out
  a multi-block macrocycle in advance. High build cost, high cognitive load, and it directly
  conflicts with the product principle of *intuitive and simple*. It also locks in a long-range
  plan that real training rarely survives (life stress, illness, motivation, event changes).
- **Just-in-time suggestion nudge** — at the moment the user starts a new block, surface a
  single, dismissible recommendation for the *next* archetype, with a one-line rationale, that
  pre-selects but never forces. Low build cost, near-zero added cognitive load, fully
  overridable.

This ADR adopts the second. It captures the large majority of the periodization value
(steering users away from running the same block indefinitely, and toward sensible phase
sequences and event-appropriate emphasis) at a small fraction of the complexity — the explicit
"~80% of the value at ~10% of the complexity" trade the owner endorsed.

## Decisions

| # | Topic | Decision | Why |
|---|---|---|---|
| 1 | Form factor | At block-completion / new-block entry, show **one** suggested next archetype + a one-sentence reason + a single "use this" action. Dismissible; the full manual archetype choice is always present and unchanged. | A nudge, not a planner. One tap to accept, one glance to ignore. Keeps the surface trivially simple. |
| 2 | Just-in-time, not stored long-range | The suggestion is **computed at block end** from recent history; no multi-block plan is persisted or locked. | Long-range plans don't survive real life; storing one creates stale state and false precision. A fresh nudge each time is both simpler and more honest. |
| 3 | Suggestion heuristics | A pure function maps `(recentArchetypeHistory, upcomingAEvent, recentReactiveDeloads)` → `{ archetypeId, reason } \| null`. Core rules: (a) phase sequence — repeated hypertrophy (accumulation) → suggest strength (intensification/consolidation); (b) event-aware — an approaching A-event suggests the archetype matching its modality (ties to ADR 0008); (c) recovery-aware — repeated reactive deloads / cooked signals → suggest rebuild or maintenance; (d) anti-staleness — same archetype 3× in a row surfaces a "consider varying emphasis" note. | Encodes practitioner-consensus periodization without pretending to optimise an annual plan. Returns `null` (no nudge) when no rule fires confidently, so the user simply picks freely. |
| 4 | Never auto-apply | The nudge **pre-selects** the archetype in the new-block flow but never auto-creates a block or locks the choice. | Preserves user agency and the "manual control always available" property. |
| 5 | Honest confidence | The sequencing rules ship tagged `// heuristic — periodization sequencing (MODERATE), practitioner-consensus`. The reason strings are framed as suggestions ("a strength block would consolidate those gains"), not mandates. | The block-sequencing evidence base is framework-level, not RCT-grade (CP-1/CP-5). The copy and the code should both say so. |
| 6 | Realization-week nudge (absorbs ADR 0008 D5) | When the user has run **enough consecutive strength/build volume without an A-event or realization** (heuristic threshold, e.g. ≥2 consecutive STRENGTH_ANCHOR blocks), the nudge offers an **opt-in realization microcycle**: a terminal-week reshape (volume −40–50%, intensity held/raised to singles) to test/peak before backing off. Never auto-applied; one tap to accept, otherwise the normal block runs unchanged. | ADR 0008 deliberately rejected auto-peaking *every* 4-week block (methodologically backwards + violates non-participant parity). Gating the realization reshape on accumulated build, surfaced as a nudge, delivers the peak when it's earned without silently altering most users' prescriptions. |

## Rationale

The product tension is real: the app wants to be *scientifically grounded* **and** *intuitive
and simple*. A full periodization planner optimises the first at the expense of the second; the
status quo (no guidance at all) does the reverse. The nudge resolves the tension because the
single highest-value piece of macrocycle wisdom — *don't run the same block forever; rotate
emphasis and peak for events* — fits in one sentence and one tap. The diminishing-returns part
of periodization (precise multi-month sequencing) is exactly the part that (a) costs the most to
build, (b) burdens the user most, and (c) is least robust to how training actually unfolds.

Computing the nudge just-in-time rather than persisting a plan is deliberate: it keeps the
feature stateless and self-correcting. If the user's last two blocks were hypertrophy, the
nudge reflects that *now*; it doesn't depend on a plan they made six weeks ago that no longer
matches their life.

The heuristics are intentionally modest and labelled as such. The goal is gentle steering, not
prescriptive periodization. Returning `null` when no rule fires confidently is a feature: silence
is better than a low-confidence nudge that erodes trust.

## Evidence base

- **Block periodization** (Issurin 2010; Bompa) — **MODERATE**: sequencing concentrated blocks
  (accumulation → transmutation/intensification → realization) is a well-established framework
  for organising training emphasis over time.
- **Phase potentiation** (practitioner literature; e.g. hypertrophy base raising the ceiling for
  a subsequent strength block) — **MODERATE**: directional support, not strong causal RCT
  evidence.
- **Variation of training emphasis drives continued adaptation** — **MODERATE**: running an
  identical stimulus indefinitely stalls; rotating emphasis is standard practice. (Consistent
  with the app's own constraint that no archetype should be run to staleness.)
- Event-specific peaking — covered by ADR 0008 (modality-aware taper); the nudge simply routes
  the user toward the right archetype ahead of an event.

## Implementation contract (on acceptance)

- **Pure suggestion function** `suggestNextArchetype(input) → { archetypeId, reason } | null`,
  fully unit-testable, no I/O. Inputs are derived from existing block history + the upcoming
  A-event + recent reactive-deload count. No new engine math; does **not** touch
  `buildPrescription` or any prescription path (purely additive advice layer).
- **Surfaces:** block-completion screen and the new-block entry flow. The suggestion pre-selects
  the archetype control; the user can change it freely or dismiss the nudge.
- **RLS / write posture:** the suggestion itself is **read-only** (reads the user's own blocks
  under the existing user-scoped client). *If* we persist a "dismissed this suggestion" flag, it
  is a user-scoped write with the standard explicit ownership check + Zod `.strict()` +
  user-scoped Supabase client (never service-role). Default ships **without** persistence (the
  nudge recomputes each time), keeping the new-write surface at zero.
- **Regression guard:** no existing prescription, archetype config, or completion-guard behaviour
  changes. Tests pin: each heuristic rule fires on its trigger; `null` is returned when no rule
  fires; the nudge never mutates block creation on its own.

## Out of scope

- A full multi-block / annual planner or any timeline UI.
- Auto-applying, scheduling, or locking a sequence of future blocks.
- Long-range periodization optimisation or load forecasting across blocks.
- Changing archetype definitions or the deload cadence (finding-4 is parked as defensible — see
  the review; block-length variety remains a separate future enhancement, not part of this ADR).

## Implications

- Delivers the core of macrocycle guidance — phase rotation, event-aware emphasis,
  recovery-aware backing-off — without a planner's complexity or a stored long-range plan.
- Composes with ADR 0008: when an A-event approaches, the nudge points at the matching archetype
  and 0008 supplies the matching taper.
- Owns ADR 0008's Decision 5 (realization microcycle): the event-less strength peak is delivered
  here as an opt-in, accumulation-gated nudge rather than an automatic every-block reshape.
- On acceptance: add an advisory-only "block sequencing guidance" note to
  `hybrid-training-engine-live.md` (explicitly: suggestion-only, never auto-applied), and the
  canonical workspace mirror. No CP-2 numeric constants (heuristic rules, tagged MODERATE).

## Open follow-ups

- Validate the sequencing heuristics against real usage once user data exists (parallels the
  wellness-scale revalidation follow-up).
- If users want more, this can later graduate to a 2–3 block look-ahead — but only on demand,
  and never at the cost of the one-tap simplicity.
