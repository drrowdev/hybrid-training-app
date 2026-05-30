# ADR 0007 — Autoregulate main-lift progression via a true AMRAP top set

**Status:** Accepted
**Date:** 2026-05-30
**Phase:** Production (engine methodology review)
**Supersedes intent of:** `apps/web/src/lib/engine/amrap.ts` (the AMRAP apparatus exists but is never solicited)
**Related:** ADR 0011 (hypertrophy-compound effort anchor — applies this decision to the hypertrophy archetype)

## Context

The engine carries a full AMRAP / RIR apparatus — `amrap.ts` (detection), `deload.ts`
(reactive "two real misses → −10% TM"), `tm-bump.ts` (e1RM-driven progression) — whose
file headers cite the autoregulation literature (Helms 2018, Zourdos 2016, Schoenfeld 2017
RIR). The implication, on its face, is that the main lifts are autoregulated.

They are not. `buildPrescription` (`archetypes.ts:1457-1471`) emits every main-lift set as a
**fixed** rep count drawn from `weekProfiles[].setReps`, tagging only the last set
`notes: "top set"`:

```ts
const reps = Array.isArray(profile.setReps) ? profile.setReps[i] ?? 5 : profile.setReps;
return { kind: "main", sets: 1, reps, percentTm: Math.round(pct*100), … ,
         notes: i === profile.setIntensities.length - 1 ? "top set" : undefined };
```

`detectAmrap` (`amrap.ts:64-68`) then re-interprets that fixed top set as an "AMRAP target"
equal to the prescribed reps. The user, however, is shown a fixed number ("top set: 5 reps
@ 85% TM") and a "+"/AMRAP cue is **never** surfaced. The consequences:

1. **The single richest signal in percentage-based barbell training is discarded.** A true
   AMRAP top-set rep count estimates *today's* e1RM and is the natural driver of an
   intelligent TM bump. By telling the user to stop at the prescribed reps, the engine keeps
   only a **binary** hit/miss.
2. **Progression is effectively completion-driven**, not performance-driven: TM moves via the
   block-complete bump (≥75% completion → +2.5/5 kg) and incidental e1RM PRs, plus the
   reactive deload on outright failed sets. Safe, but it under-progresses lifters who could
   be earning rep-PR-driven bumps, and it is **not** the autoregulated model the code's own
   citations claim.
3. **A latent contradiction:** if a user spontaneously grinds extra reps on the top set,
   `tm-bump.ts` *does* reward it via e1RM excess — so the machinery to consume an AMRAP
   already exists end-to-end. The engine simply never *asks* for the AMRAP.

This ADR resolves the contradiction in the scientifically-grounded direction: solicit the
AMRAP, feed it into progression, and keep the UX a single, intuitive "+" set.

### Philosophy decision (resolved)

There were two internally-consistent ways to close the contradiction. **The owner chose (A),
autoregulate, on 2026-05-30.** Both are recorded so the rejected path stays explicit:

- **(A) Autoregulate — ADOPTED.** Make the final top set a true AMRAP on non-deload
  weeks; the achieved reps drive e1RM → TM. Aligns prescription with the cited intent.
- **(B) Deliberate stop-short — rejected.** Keep fixed top sets (a legitimate RTS/"leave reps
  in the tank" philosophy, gentler on a hybrid athlete's shared recovery budget) and instead
  strip the overselling — remove the autoregulation citations from `amrap.ts`/`deload.ts` and
  re-scope `detectAmrap` to "prescribed-top-set completion." Rejected because it forfeits the
  richest progression signal; the recovery-budget concern is addressed instead by cueing RIR-1
  (not failure), per Decision 2.

Either way the rule was: **prescription behaviour and stated methodology must match.** (A)
satisfies it by making the solicited AMRAP real.

## Decisions

| # | Topic | Decision | Why |
|---|---|---|---|
| 1 | True AMRAP top set | On **non-deload** weeks, the final `kind:"main"` top set of each *main pattern* (squat / deadlift / horizontal_press / vertical_press) is emitted as an open-rep AMRAP: `reps: "N+"` where N is the current wave's prescribed top-set reps (5+, 3+, 1+). | This is the one change that aligns prescription with the cited Helms/Zourdos intent and re-activates the e1RM→TM signal the rest of the engine is already built to consume. |
| 2 | Stop-cue, not grind-to-failure | The AMRAP is cued as "as many **clean** reps as possible — stop at ~RIR 1 / when bar speed drops." Not true muscular failure. | Failure on heavy compounds is high-fatigue, low-extra-signal, and elevates injury + interferes with the endurance side. RIR-1 captures ~95% of the e1RM signal at a fraction of the fatigue (Helms 2018; Zourdos 2016 velocity-at-RIR). |
| 3 | One "+" set only | Exactly the **last** top set is an AMRAP. Earlier wave sets stay fixed. | Keeps the cognitive surface tiny and intuitive: the user sees one "+" at the bottom of the ladder. Matches the universal strength-template convention. |
| 4 | Deload weeks excluded | Deload weeks (and `disableFolding` / MAINTENANCE / REBUILD sub-strength weeks) keep fixed reps — never AMRAP. | A deload must remain a deload. AMRAP defeats the recovery intent. |
| 5 | Folded / secondary main lifts excluded | ADR 0004/0005 secondary (folded) main lifts stay fixed at their maintenance dose; no AMRAP on the secondary slot. | The secondary slot is a 1RM-*maintenance* dose (Androulakis-Korakakis 2020). An AMRAP there competes for the recovery budget the cap exists to protect. |
| 6 | Hypertrophy archetype handled separately | `HYPERTROPHY_ANCHOR` does not adopt this ADR's open-ended main-lift AMRAP. Its compound effort anchor is governed by **ADR 0011** (RIR-anchored last set), which applies the same autoregulation philosophy in the form appropriate to a hypertrophy block. | Open-ended AMRAP on a high-rep hypertrophy compound at light load is mostly a metabolic-fatigue tax with little 1RM signal. Hypertrophy effort is better governed by a fixed RIR target on the last set — see ADR 0011. |
| 7 | e1RM → TM wiring | The achieved AMRAP reps feed the existing `one-rm.ts` conservative e1RM (`min(Epley, RPE-chart)`, reps 1..12) → `tm-bump.ts` score. The reactive deload's "real miss" definition is unchanged but now keys off a genuine AMRAP rather than a fixed target. | Re-uses the path that already exists; no new progression primitive. The deload net becomes meaningful (a real miss on a real AMRAP), not a fixed-rep technicality. |
| 8 | Display + logging | UI renders the top set as "N+ (AMRAP)" with the stop-cue; the logger already captures reps, so no schema change. | No new surface, no migration. The "+" convention is self-explanatory and motivating. |

## Rationale

**Why autoregulate (A) is the right default for a science-grounded app.** The whole point of
a percentage-based wave is that the prescribed % is an *estimate* of today's capacity. An
AMRAP top set is the cheapest, most reliable in-vivo measurement of how that estimate landed
on the day — it is the mechanism by which the cited literature (Helms, Zourdos) actually
autoregulates. Keeping a fixed top set throws away the measurement and then *simulates*
autoregulation downstream with completion heuristics. That's strictly less information for the
same training cost.

**Why RIR-1, not failure.** For a hybrid athlete the shared recovery budget is the binding
constraint. Stopping at RIR-1 preserves nearly all the e1RM signal (the last rep before
failure barely moves a conservative Epley/RPE-chart estimate) while cutting the neuromuscular
and connective-tissue cost that would otherwise bleed into the endurance side. This is the
same logic ADR 0004/0005 used to cap secondary lifts.

**Why this stays simple.** The user-visible change is one character — a "+" on the last set —
plus a one-line cue. There is no new screen, no new setting, no new mental model. If anything
it is *more* intuitive and more motivating than "do exactly 5 and stop," which lifters
routinely find arbitrary. Simplicity and scientific grounding align here rather than trade off.

**Why exclude deloads, secondaries, and (optionally) hypertrophy compounds.** Each exclusion
protects a recovery-budget invariant the rest of the engine already enforces. The AMRAP is a
*measurement on the heaviest single primary effort* — precisely where the signal is richest
and the marginal fatigue is best justified.

## Evidence base

- **Helms 2018** *Muscle & Strength Pyramids* / RPE-RIR autoregulation — **HIGH**: RIR-based
  load adjustment outperforms fixed %1RM for trained lifters because intraday capacity varies.
- **Zourdos 2016** *J Strength Cond Res* 30(1) — **HIGH**: RPE/velocity at a given RIR is
  reliable; the last reps before failure carry the e1RM information.
- **Schoenfeld 2017** RIR / proximity-to-failure — **HIGH**: effort proximity governs the
  adaptive stimulus; near-failure on the top set is sufficient without going to failure.
- **Epley / RPE-chart e1RM** — **MODERATE**: conservative `min(Epley, RPE-chart)` is reliable
  in the 1–8 rep band; the engine already bounds reps to 1..12 and excludes RPE-10 grinders
  (`pr.ts: GRINDER_RPE`).
- Risk literature (failure training fatigue cost): **MODERATE** support for RIR-1 over failure
  on heavy compounds to manage systemic fatigue in concurrent contexts.

## Implementation contract (on acceptance)

- **Single source.** Change is localised to `buildPrescription`'s strength branch
  (`archetypes.ts:1457-1471`): when the week is non-deload, the archetype is not
  `disableFolding`/MAINTENANCE/REBUILD, and the item is the primary top set, emit
  `reps: "${N}+"` instead of `reps: N`. Secondary-slot emission (1490-1503) is untouched
  (stays fixed).
- **No change** to `detectAmrap`, `deload.ts`, `tm-bump.ts`, `one-rm.ts` — they already
  consume the `"N+"` shape (`amrap.ts:46-53` Strategy 1). This ADR *feeds* them the signal
  they were built for.
- **Regression guard (CRITICAL).** Deload weeks, secondary lifts, REBUILD, MAINTENANCE, and
  every cardio path emit byte-identical prescriptions. A pinned test asserts: for a non-AMRAP
  week the prescription is unchanged; for an AMRAP week only the final primary top set's
  `reps` field changes from `N` to `"N+"`.
- **Hypertrophy decision (Decision 6)** is owned by ADR 0011 (RIR-anchored compound last set).
  `HYPERTROPHY_ANCHOR` is therefore excluded from this ADR's open-rep AMRAP path; its effort
  anchor ships via 0011 so the two changes stay independently reviewable.

## Implementation notes (as built — 2026-05-30)

Two facts discovered during implementation deviate from the contract above. They do not
change the *decision*, only the mechanism; recorded here so the ADR matches the code.

1. **`isAmrap: boolean` flag, not a `reps: "N+"` string.** The contract proposed emitting
   `reps: "${N}+"`. But `PrescriptionItem.reps` is typed `number` (`packages/db/src/schema/planner.ts`),
   and the runtime "N+" string path was a latent, untyped escape hatch only `amrap.ts` Strategy 1
   parsed. Emitting the string for real would either be a type error or force a `reps: number | string`
   widening that ripples through every renderer, the logger, e1RM, and the picker. Instead we added a
   **typed, explicit `isAmrap?: boolean`** to `PrescriptionItem`. `true` = solicited AMRAP, `false` =
   deliberately fixed top set (the new opt-out signal), `undefined` = legacy stored prescription
   (renderers fall back to the positional last-main heuristic). `detectAmrap` gained a single
   `if (item.isAmrap === false) continue;` guard in both strategies plus an `isAmrap === true` numeric
   short-circuit; `deload.ts` / `tm-bump.ts` / `one-rm.ts` are untouched as promised. This is strictly
   less blast radius than the string and is backward-compatible with the **persisted** prescription
   JSON (prescriptions are stored at block creation, not rebuilt at view time — so in-flight blocks
   keep working with no flag).

2. **The "+" and the bump were already partially live (Context corrections).** `MovementFocusView.tsx`
   already rendered the last main set's rep line as "reps+" via a *positional* heuristic, and
   `detectAmrap` Strategy 2 already treated fixed {5,3,1} top sets as AMRAP targets for the bump.
   So the user-visible "+" and the e1RM→TM bump were *already happening on a positional guess* — the
   real gap this ADR closes is making that solicitation **explicit, archetype-scoped, and honest**:
   only strength-goal archetypes (STRENGTH_ANCHOR, CONCURRENT_HYBRID, custom strength waves) now carry
   `isAmrap: true` + the stop-cue; endurance / rebuild / maintenance / hypertrophy carry `isAmrap: false`
   so they are *not* silently bumped off a positional fixed top set. Per the owner's archetype-scope
   decision (2026-05-30): AMRAP is solicited on **strength + hybrid** only.

3. **Display dependency on ADR 0011.** Main-lift `%TM` sets render their RIR chip + cue only when
   `percentTm != null` — previously those branches were gated `percentTm == null` (accessory-only), so
   0011's hypertrophy RIR target was invisible. This change adds a main-lift RIR chip
   (`data-testid="main-intensity-chip"`) and a main-lift cue block (`data-testid="main-intensity-cue"`)
   so both the AMRAP cue (0007) and the hypertrophy RIR target (0011) actually surface.



- Velocity-based training / bar-speed autoregulation (separate, advanced-tier ADR).
- Changing the wave intensities or rep targets themselves.
- The hypertrophy-effort redesign (finding 5) — decided in ADR 0011, not here.

## Implications

- Re-activates performance-driven TM progression; the reactive deload net becomes a genuine
  safety mechanism rather than a fixed-rep technicality.
- Engine-regression risk is concentrated in `buildPrescription`; the regression guard above is
  mandatory per the repo's "identical prescriptions for non-participants" rule.
- On acceptance: add a CP-2 row referencing this ADR, update `hybrid-training-engine-live.md`
  §15 (PR detection / progression) and §18 (spec deltas), and the canonical workspace mirror.
