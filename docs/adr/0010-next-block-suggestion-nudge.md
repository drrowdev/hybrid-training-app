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

## Implementation notes (as built — 2026-05-30)

**Commits:** `8682844` *feat(planner): next-block suggestion core (ADR 0010)* and `e93de1f`
*feat(plan): surface next-block suggestion nudge (ADR 0010)*. Test count: 2698 → 2726 (+28;
the ADR-0010 suite at
`apps/web/src/lib/planner/__tests__/adr-0010-next-block-suggestion.test.ts` covers every
rule + priority + the realization gate).

Files touched:
- `apps/web/src/lib/planner/next-block-suggestion.ts` (new) — pure `suggestNextArchetype` +
  `suggestRealizationWeek`, fully unit-testable, zero I/O.
- `apps/web/src/lib/planner/next-block-suggestion-server.ts` (new) — server glue
  `getNextBlockNudge(supabase, userId, recentArchetypes, todayYmd, windowStartYmd)` that
  gathers the pure function's inputs from a user-scoped (RLS-enforced) Supabase client,
  including the recent reactive-deload episode count (see scope-down 3, now resolved).
- `apps/web/src/app/app/plan/page.tsx` — adds the read-only nudge fetch and renders a
  `NextBlockSuggestionCard` on the **no-active-block** surface above `PlanNewSwitch`.

### Scope-downs from the ADR text (deliberate; document so the lead can diff-review)

1. **Recommend, not pre-select.** Decision 4 of the ADR says the nudge "pre-selects the
   archetype in the new-block flow but never forces". The shipped surface **recommends** the
   archetype (renders a `NextBlockSuggestionCard` with the suggested archetype name + reason)
   but does **not** pre-select it inside `PlanNewSwitch` / the wizard. Pre-selecting would
   require an `archetypeId → {goal, secondary}` reverse-map the wizard does not currently
   expose; rather than ship a half-mapped pre-select that silently picks the wrong wizard
   path for half the archetypes, the surface stops at "recommend". **Follow-up:** add the
   reverse-map and wire pre-select on the next wizard pass.

2. **Realization week is surfaced, not auto-applied.** Decision 6 of the ADR talks about a
   terminal-week reshape (volume −40–50%, intensity held/raised to singles) when the
   accumulation gate fires. The shipped surface delivers the **nudge** via
   `suggestRealizationWeek`, but does **not** wire the actual block-shape transform —
   `taper.ts` carries no realization-week branch and `buildPrescription` is untouched. The
   copy now routes the user to the **manual custom-block path** rather than implying an
   auto-feature: "consider a lighter week of heavy singles to peak and re-test your maxes —
   you can set that up as a short custom block." The gate is correctly tied to the consensus
   accumulation threshold — fires after **≥ 2 consecutive event-less STRENGTH_ANCHOR blocks**
   (`REALIZATION_MIN_STRENGTH_RUN = 2`) and is suppressed when an A-event modality already
   drives a real taper/peak. **Follow-up (still deferred):** the automatic reshape transform
   itself is deferred to a subsequent ADR / PR; only the dead-end copy was fixed.

3. **Recovery-aware rule (rule 1) — RESOLVED, now LIVE.** The pure function honours
   `recentReactiveDeloads >= REACTIVE_DELOAD_BACKOFF (=2)`, and `getNextBlockNudge` now
   passes the **real** count. The signal already exists with no new migration: an accepted
   reactive deload persists a `tm_history` row with `reason = "deload"` and a `session_id`
   (`engine/tm-bump-actions.ts` + `engine/deload.ts`). The server glue queries those rows
   since the oldest recent block's start (`windowStartYmd`) and counts **distinct sessions**
   (deload *episodes*, not rows — one cooked period can deload several lifts). The query is
   read-only and user-scoped (explicit `.eq("user_id", userId)` on the request-scoped
   client; RLS preserved). So all four rules can now fire in production. Tested via six
   server-glue tests in `adr-0010-next-block-suggestion.test.ts` (episode counting,
   null-window skip, null-`session_id` fallback to row id, event mapping, and
   recovery-outranks-event priority).

### Heuristic constants (all CP-1, practitioner-consensus — NOT RCT-calibrated)

In `next-block-suggestion.ts`, tagged `// heuristic — periodization sequencing thresholds
(CP-1), practitioner-consensus`:

- `REACTIVE_DELOAD_BACKOFF = 2` — ≥ this many recent reactive deloads → rebuild.
- `ACCUMULATION_RUN_FOR_CONSOLIDATION = 2` — ≥ this many consecutive `hypertrophy_anchor`
  blocks → consolidate with `strength_anchor`.
- `STALENESS_RUN = 3` — same archetype this many times in a row → suggest the complementary
  emphasis.
- `REALIZATION_MIN_STRENGTH_RUN = 2` — ≥ this many consecutive `strength_anchor` blocks
  (event-less) → suggest the opt-in realization week.

### Rule priority (first match wins, encoded in `suggestNextArchetype`)

1. **Recovery-aware** (`recentReactiveDeloads >= REACTIVE_DELOAD_BACKOFF`) → `rebuild`.
   *Live in production — `getNextBlockNudge` counts distinct `tm_history` deload episodes.*
2. **Event-aware** (`upcomingEventModality != null`) → matching archetype per
   `archetypeForEventModality` (`strength` → `strength_anchor`, `endurance` →
   `endurance_anchor`, `mixed` → `concurrent_hybrid`).
3. **Phase sequence — accumulation → intensification** (`run.id === "hypertrophy_anchor" &&
   run.length >= ACCUMULATION_RUN_FOR_CONSOLIDATION`) → `strength_anchor`.
4. **Anti-staleness — complementary emphasis** (`run.length >= STALENESS_RUN` for any non-
   `custom`, non-maintenance/rebuild archetype) → complement per `complementaryArchetype`.
5. **Otherwise null** — silence beats a low-confidence nudge; the user picks freely.

`suggestRealizationWeek` is independent of `suggestNextArchetype`; both are merged into
`{suggestion, realization}` by `getNextBlockNudge` and rendered side-by-side when present.

### What is **not** shipped

- No persistence of dismissed nudges (Decision 2: the nudge recomputes each time).
- No auto-creation of blocks, no archetype lock, no multi-block look-ahead (Decision 4).
- No realization-week reshape in the planner (see scope-down 2 — the *automatic* reshape
  stays deferred; the opt-in nudge now points at the manual custom-block path).
- No archetype pre-select in the wizard surface (see scope-down 1).
