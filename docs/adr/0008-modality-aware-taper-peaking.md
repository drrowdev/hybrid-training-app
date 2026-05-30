# ADR 0008 — Branch taper/peaking by event modality (strength vs endurance)

**Status:** Accepted
**Date:** 2026-05-30
**Phase:** Production (engine methodology review)
**Relates to:** `apps/web/src/lib/planner/taper.ts`

## Context

`computeTaperRecommendation` (`taper.ts:46-117`) applies a **single** taper model to *every*
A/B-priority event, regardless of what the event is. The model is explicitly endurance-derived
(header citations Mujika & Padilla 2003, Bosquet 2007 — both endurance meta-analyses):

```
14–8 d out:  -20% volume, hold intensity      (approach)
 7–4 d out:  -40% volume, hold intensity      (deep)
 3–1 d out:  -60% volume, DROP max-effort work (polish, intensityAction:"minimal")
    day 0:   rest / activation
```

The event shape is `{ name; date; priority: "A"|"B"|"C" }` — there is **no modality field**, so
the engine cannot distinguish a marathon from a powerlifting meet or a max-strength test. Two
problems follow:

1. **Wrong peaking shape for strength events.** The strength-peaking literature (Pritchard
   2015 review; Travis 2020) differs from endurance tapering in three load-bearing ways:
   - The window is **shorter** (~7–10 days; the nervous system re-sensitises faster than the
     aerobic system super-compensates).
   - You **hold intensity high to within ~3–5 days** — heavy, low-volume singles/openers — and
     do **not** drop max-effort work at 3 days out. The current `polish` phase does exactly the
     wrong thing for a barbell peak: it zeroes the heavy neural exposure right when a lifter
     should be touching opener-range singles.
   - Volume is cut **~40–50%**, not 60% — strength detrains faster than endurance with deep
     volume cuts, and a 60% cut over a 14-day window risks a flat, "detuned" meet day.

2. **Event-less strength users get no peaking/realization at all.** A strength-archetype user
   with no race event never enters a taper (no event → `null`). The block simply ends at its
   terminal top-set % (e.g. 0.95×TM) and rolls into a calendar deload. There is no
   *realization* microcycle — the deliberate, brief, high-intensity/low-volume window that
   converts accumulated work into a tested peak. That's a missing best-practice for the
   archetype whose entire purpose is expressing maximal strength.

This ADR makes the taper **modality-aware** and defines an optional realization peak for
event-less strength blocks.

## Decisions

| # | Topic | Decision | Why |
|---|---|---|---|
| 1 | Add event modality | Extend the event input with `modality: "endurance" \| "strength" \| "mixed"` (default `"endurance"` for backward compatibility / existing rows). | The engine cannot peak correctly for something it can't classify. Default preserves current behaviour for all existing events. |
| 2 | Endurance taper unchanged | `modality:"endurance"` → today's exact curve (Mujika/Bosquet). | It is correct and well-cited for the case it was built for. No regression. |
| 3 | Strength taper branch | `modality:"strength"` → shorter window (10 d), **hold intensity to ~3 d out**, volume cut graded **−30% / −45% / −50%**, and the final phase keeps **heavy low-volume singles (openers)** rather than dropping max-effort work. Day 0 = activation + opener primer, not full rest. | Matches Pritchard 2015 / Travis 2020 strength-peaking; fixes the inverted `polish` behaviour. |
| 4 | Mixed-event taper | `modality:"mixed"` (e.g. hybrid race, "test day for both") → endurance volume curve for the cardio side but **hold one heavy strength primer** into the final 3–5 days. | Hybrid events need both systems sharp; neither pure model fits. |
| 5 | Realization peak for event-less strength blocks | When a STRENGTH_ANCHOR block has no upcoming A/B event, a **realization microcycle** (volume −40–50%, intensity held/raised to singles) reshapes the terminal build week before the deload. **Revised (2026-05-30): NOT default-ON every block.** The reshape mechanism is built opt-in and is *triggered by the ADR 0010 periodization nudge* after the user has accumulated enough consecutive build volume — not auto-applied to every 4-week block. Implemented under ADR 0010, not here. | Auto-peaking every mesocycle is methodologically backwards (realization belongs at end of a multi-block macrocycle, and it would silently alter week-3 prescriptions for the majority of event-less strength users — violating the non-participant-parity rule). Tying it to the 0010 nudge gates the peak on real accumulation. |
| 6 | Confidence labelling | Strength-taper constants ship tagged `// heuristic — strength taper, per Pritchard 2015 (MODERATE)`; realization-week ON-by-default flagged as a defensible default, not a high-confidence constant. | CP-1/CP-5: the strength-taper dosing evidence is MODERATE, thinner than the endurance HIGH evidence. Be honest in the code. |

## Rationale

The current single-model taper is a category error: it treats "being fresh for a marathon"
and "being peaked for a 1RM" as the same physiological problem. They are opposites in one key
respect — endurance peaking is about **dissipating fatigue while the slow aerobic
super-compensation completes** (hence the long window and aggressive late volume cut), whereas
strength peaking is about **keeping the nervous system potentiated** (hence the shorter window
and *holding* heavy neural exposure late). Dropping max-effort work at 3 days out — what
`polish` does now — is appropriate for a runner and counter-productive for a lifter.

Decision 5 closes the more glaring gap: the app's flagship STRENGTH_ANCHOR archetype has no
way to *express* the strength it builds unless the user happens to register a race event. A
brief realization week is the established way to do this. **However**, an automatic
terminal-week reshape on *every* block was rejected (see Decision 5 "Why"): peaking every
4-week mesocycle is too frequent and would change week-3 prescriptions for most event-less
strength users. Instead the realization reshape is an **opt-in mechanism triggered by the ADR
0010 next-block nudge** once the user has accumulated enough build volume — implemented under
ADR 0010.

**Why modality defaults to endurance:** every event row in production today was created without
a modality field; defaulting to `"endurance"` means zero behavioural change for existing data
and existing tests. Strength/mixed behaviour only activates when a user (or the archetype
inference) tags an event accordingly.

## Evidence base

- **Mujika & Padilla 2003** (endurance taper meta) — **HIGH**. Basis for the unchanged
  endurance branch.
- **Bosquet 2007** (non-linear taper) — **HIGH**. Basis for the steeper-late endurance curve.
- **Pritchard 2015** *Sports Med* — *Tapering practices of strength/power athletes* — **MODERATE**.
  Shorter window, maintain intensity, ~40–50% volume reduction.
- **Travis 2020** (peaking for powerlifting / openers and intensity maintenance) —
  **MODERATE/LOW**. Supports holding heavy singles late and an opener-primer day-0.
- General strength-detraining kinetics (faster strength loss with deep volume cuts) —
  **MODERATE**.

## Implementation contract (on acceptance)

- Add `modality` to the event type consumed by `computeTaperRecommendation`; thread it from the
  event source (race/event creation). Existing callers pass `modality` absent → defaults to
  `"endurance"`.
- `phaseFor` branches on modality. Endurance branch is the **current function verbatim**
  (pinned by an existing-behaviour test). Strength/mixed branches are new pure functions with
  their own phase tables.
- Realization microcycle (Decision 5) is **deferred to ADR 0010** (not implemented here). It is
  generated in the block planner, not in `taper.ts`: an opt-in terminal-week reshape (volume↓,
  intensity held to singles) suggested via the next-block nudge after sufficient accumulated
  build — never auto-applied to every block. Guard: only STRENGTH_ANCHOR, only when no taper is
  otherwise active, only on explicit user opt-in.
- **Regression guard.** All endurance-event tapers and all currently-passing taper tests are
  byte-identical. New tests cover: strength-event polish phase *retains* heavy singles;
  strength window caps at 10 d; every other archetype is unaffected. (Realization-week tests
  land with ADR 0010.)

## Out of scope

- Auto-classifying event modality from the event name (manual tag / archetype inference only,
  for now).
- Multi-peak / double-periodization across two events in one window (future ADR).
- Endurance taper re-tuning — it is correct and stays as is.

## Implications

- Strength and hybrid athletes get a peak that matches their sport instead of a runner's taper.
- The STRENGTH_ANCHOR archetype gains a tested peak even without a registered event — delivered
  via the ADR 0010 nudge (opt-in), not an automatic every-block reshape.
- On acceptance: add CP-2 rows for the strength-taper constants (tagged MODERATE), update
  `hybrid-training-engine-live.md` §17 (taper) and the canonical workspace mirror, and note the
  new `modality` field in the event-schema docs.

## Implementation notes (as built — 2026-05-30)

**Commits:** `67066ee` *feat(engine): modality-aware taper/peaking (ADR 0008, decisions 1-4 + 6)*
and `233143a` *docs(adr): redirect ADR 0008 D5 realization microcycle to ADR 0010 nudge*.
Test count: 2670 → 2698 after the combined 0008 + 0009 batch (the taper suite alone added
~17 cases in `apps/web/src/lib/planner/__tests__/taper.test.ts`).

Files touched: `apps/web/src/lib/planner/taper.ts`,
`apps/web/src/lib/planner/taper-recovery-actions.ts`, `apps/web/src/app/app/page.tsx`,
`apps/web/src/lib/planner/__tests__/taper.test.ts`.

Shipped exactly as scoped — the strength branch matches the contract numerically:

1. **`TaperModality` exported as `"endurance" | "strength" | "mixed"`** alongside a
   `taperModalityForEvent(modality: string | null | undefined)` mapper. Only the literal
   `"strength"` event-UI string maps to `"strength"`; every other value (including `null`,
   `"run"`, `"bike"`, `"swim"`, `"row"`, `"ski"`, `"padel"`, `"other"`) maps to
   `"endurance"` — preserving the pre-ADR-0008 curve for every existing row.

2. **`computeTaperRecommendation`** now branches on `event.modality ?? "endurance"`. The
   strength A-event window is **10 days** (vs endurance/mixed 14, B-events 7 in all
   modalities). C-events still return null.

3. **Strength branch (`strengthPhase`)** — volume cuts graded **−30% / −45% / −50%** across
   approach (14–8d) / deep (7–4d) / polish (3–1d), `intensityAction: "hold"` at *every*
   phase including polish (the key fix vs endurance, which drops to `"minimal"` at polish).
   Day 0 returns `intensityAction: "hold"` with the "openers and activation only — the
   heavy work is banked" detail, **not** the endurance branch's "rest or 5–10 minutes of
   activation". Constants tagged `// heuristic — strength taper, per Pritchard 2015
   (MODERATE) / Travis 2020 (MODERATE-LOW)`.

4. **Mixed branch (`mixedPhase`)** — endurance volume curve verbatim
   (−20% / −40% / −60%) but `intensityAction: "hold"` at polish (so one heavy strength
   primer survives). Day 0 falls back to the endurance `"minimal"`.

5. **Endurance branch (`endurancePhase`)** — current function verbatim, pinned by the
   existing-behaviour tests; the only refactor was extracting it from
   `computeTaperRecommendation`'s body into a named helper.

6. **B-priority adjustment.** Volume cut is halved (`adjust = scale → 1 - (1 - scale) * 0.5`)
   in every modality, and the max-window is clamped to 7d — same as the prior behaviour.

7. **Decision 5 (realization microcycle) is redirected, not implemented here.** The taper
   module ships modalities 1–4 + 6 only; the realization peak is delivered as an opt-in
   *nudge* under ADR 0010 (`suggestRealizationWeek`) and does **not** auto-reshape the
   terminal week of a STRENGTH_ANCHOR block — see ADR 0010's as-built note for the deferred-
   reshape scope-down. The commit `233143a` updated this ADR's text to make the redirect
   explicit.
