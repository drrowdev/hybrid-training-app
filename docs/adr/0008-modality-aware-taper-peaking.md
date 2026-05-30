# ADR 0008 — Branch taper/peaking by event modality (strength vs endurance)

**Status:** Proposed
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
| 5 | Realization peak for event-less strength blocks | When a STRENGTH_ANCHOR block has no upcoming A/B event, the **final** week becomes an optional **realization microcycle** (volume −40–50%, intensity held/raised to singles) before the calendar deload — distinct from a deload. Default ON for STRENGTH_ANCHOR, opt-out. | Gives the strength archetype a tested peak instead of fading into a deload; this is the standard end-of-block practice the engine currently omits. |
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
brief realization week is the established way to do this and costs no new UI — it's an
automatic terminal-week reshape, opt-out.

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
- Realization microcycle (Decision 5) is generated in the block planner, not in `taper.ts`:
  when STRENGTH_ANCHOR + no A/B event, the terminal week's `weekProfile` is reshaped
  (volume↓, intensity held to singles) before the deload week. Guard: this only fires for
  STRENGTH_ANCHOR and only when no taper is otherwise active.
- **Regression guard.** All endurance-event tapers and all currently-passing taper tests are
  byte-identical. New tests cover: strength-event polish phase *retains* heavy singles;
  strength window caps at 10 d; event-less STRENGTH_ANCHOR gets a realization week; every other
  archetype is unaffected.

## Out of scope

- Auto-classifying event modality from the event name (manual tag / archetype inference only,
  for now).
- Multi-peak / double-periodization across two events in one window (future ADR).
- Endurance taper re-tuning — it is correct and stays as is.

## Implications

- Strength and hybrid athletes get a peak that matches their sport instead of a runner's taper.
- The STRENGTH_ANCHOR archetype gains a tested peak even without a registered event.
- On acceptance: add CP-2 rows for the strength-taper constants (tagged MODERATE), update
  `hybrid-training-engine-live.md` §17 (taper) and the canonical workspace mirror, and note the
  new `modality` field in the event-schema docs.
