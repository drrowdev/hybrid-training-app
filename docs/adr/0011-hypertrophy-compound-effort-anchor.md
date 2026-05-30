# ADR 0011 — Effort-anchor the hypertrophy compound (RIR-targeted last set)

**Status:** Accepted
**Date:** 2026-05-30
**Phase:** Production (engine methodology review)
**Relates to:** ADR 0007 (autoregulated main-lift AMRAP — this ADR is its hypertrophy-archetype counterpart), the methodology review's finding-5
**Touches:** `apps/web/src/lib/planner/archetypes.ts` (`HYPERTROPHY_ANCHOR.weekProfiles`), `buildPrescription`

## Context

The methodology review's finding-5 was re-examined against the live `HYPERTROPHY_ANCHOR` week
profiles (`archetypes.ts:994-1021`) and **upgraded to HIGH confidence**. The compound main-lift
waves are:

| Week | Reps | %TM | %1RM (TM ≈ 90%) |
|---|---|---|---|
| 0 | 10,10,8,8 | 0.60–0.70 | **54–63%** |
| 1 | 10,10,8,8 | 0.60–0.75 | 54–67% |
| 2 | 10,8,8,6 | 0.65–0.75 | 58–67% |
| 3 (deload) | 8 | 0.50–0.65 | 45–59% |

Because the engine prescribes **stop-at-the-printed-reps**, the *effort* these sets deliver is
far below a hypertrophy stimulus. Using conservative (non-Epley) load–rep estimates:

- 54% 1RM is roughly an 18–20-rep max → **10 prescribed reps ≈ 8–10 RIR.**
- The hardest set of the block (67.5% 1RM ≈ 12–14RM) at 6 reps → **≈ 6–8 RIR.**

The hypertrophy stimulus threshold — the effective-reps / proximity-to-failure model
(Schoenfeld 2021; Helms) — sits at roughly **≤ 4–5 RIR**. So the compound main lifts in the
archetype *named for hypertrophy* are **above the stimulus threshold for the entire loading
block.** They function as technique/volume-grease, not muscle-building work. The real
hypertrophy stimulus is carried entirely by the accessory matrix (correctly cued at 0–1 RIR).

This contradicts the archetype's own copy — the oneLiner advertises "Muscle-building block …
at hypertrophy intensity (60–75% TM, 6–10 reps)" — and a code comment overstates the case:
*"the rep range is what drives the stimulus, not %TM."* Rep *range* at 8–10 RIR drives almost
nothing; proximity to failure is the governing variable.

With ADR 0007 now adopting autoregulation for the main lifts, the consistent fix for hypertrophy
is the **same philosophy in the form appropriate to a hypertrophy block**: anchor effort by a
fixed RIR target on the working set rather than leaving it at an arbitrary low RIR.

## Decisions

| # | Topic | Decision | Why |
|---|---|---|---|
| 1 | Anchor the last compound set by RIR | In `HYPERTROPHY_ANCHOR`, the **final working set** of each compound pattern is cued to a fixed RIR target — **RIR 2** on weeks 0–1, **RIR 1** on the week-2 peak — instead of a fixed printed rep count. Earlier sets keep their fixed reps as volume. | Puts the working set inside the effective-rep window (≤ 4–5 RIR) so the compound actually contributes a hypertrophy stimulus, while RIR 1–2 (not failure) protects the shared recovery budget. |
| 2 | RIR, not open AMRAP, for hypertrophy | Use an RIR *target* (stop at ~2 reps in reserve), not the open-ended "N+" AMRAP that ADR 0007 uses for strength/power patterns. | Open AMRAP on a light, high-rep compound is a metabolic-fatigue tax with little 1RM signal and high interference cost. An RIR target gets the stimulus without the junk fatigue. |
| 3 | Load floor so RIR-2 is reachable in the printed rep range | Where needed, nudge the working-set load up so that "RIR 2" lands near the printed rep count rather than 8–10 reps short of it (i.e. the prescribed reps and the RIR target should roughly agree for an average trainee). Keep loads within the 60–75% TM identity band where possible; document any adjustment as heuristic. | Today's 54–67% 1RM loads make RIR-2 unreachable at the printed reps for most lifters. The fix is incomplete if the load stays so light that a RIR-2 stop is impossible without doubling the reps. |
| 4 | Deload week stays fixed | Week 3 (deload) keeps fixed reps at reduced load/volume — no RIR push. | A deload must remain a deload (mirrors ADR 0007 Decision 4). |
| 5 | Accessories unchanged | The aesthetic/isolation accessory matrix (already 0–1 RIR) is untouched. | It is already correct; finding-5 is exclusively about the compound. |
| 6 | Copy alignment | Update the archetype oneLiner and the misleading code comment to describe the compound as "effort-anchored (RIR 1–2 on the working set)," not "intensity = rep range." | Methodology and stated intent must match (same principle as ADR 0007). |

## Rationale

Hypertrophy is governed by mechanical tension delivered through reps taken reasonably close to
failure. The current archetype delivers the *reps* but not the *proximity*: at 8–10 RIR the
compound sets are sub-threshold no matter how the %TM is labelled. The least-invasive correction
that respects the archetype's structure is to anchor only the **last** working set by RIR —
preserving the earlier fixed sets as accumulated volume, capping effort at RIR 1–2 to stay off
true failure (critical for a concurrent athlete), and lifting the load just enough that the RIR
target is actually reachable.

Choosing an **RIR target over an open AMRAP** is deliberate and is the key place this ADR
diverges from 0007. For a heavy low-rep strength top set, an AMRAP yields a clean e1RM estimate
that's worth the fatigue. For a light high-rep hypertrophy compound, an AMRAP mostly buys
metabolite accumulation and systemic fatigue with little usable 1RM signal — exactly the cost a
hybrid athlete can least afford. RIR-2 captures the stimulus at a fraction of that cost.

This keeps the app simple and intuitive: the user sees "last set: ~8 reps, leave 2 in the tank"
instead of a bare rep count — arguably *clearer* about intent than the current arbitrary number.

## Evidence base

- **Schoenfeld 2021** (hypertrophy / proximity-to-failure, effective-reps) — **HIGH**: stimulus
  scales with proximity to failure; sets many reps shy of failure are largely sub-threshold.
- **Helms 2018** (RIR-based autoregulation) — **HIGH**: RIR targets are a reliable, teachable
  way to place effort in the productive window without going to failure.
- **Failure-vs-RIR fatigue cost** — **MODERATE**: stopping a rep or two short retains nearly all
  hypertrophy stimulus while sharply cutting fatigue — the right trade for concurrent training.
- Load–rep relationship / RIR reachability (Decision 3) — **MODERATE/practical**: at 54–67% 1RM
  the printed reps sit far from failure; the load must rise for an RIR-2 stop to be meaningful.

## Implementation contract (on acceptance)

- Change is localised to `HYPERTROPHY_ANCHOR.weekProfiles` + the hypertrophy branch of
  `buildPrescription`: the final working set emits an **RIR target** (and a matching cue)
  instead of a fixed rep, with the load adjusted per Decision 3. Earlier sets and all other
  archetypes are untouched.
- The achieved reps on the RIR-anchored set may feed e1RM opportunistically (reusing the
  `one-rm.ts` path), but progression for the hypertrophy block remains primarily
  completion/volume-driven — this ADR does **not** turn the hypertrophy compound into a TM-test.
- **Regression guard (CRITICAL).** Every non-hypertrophy archetype, the hypertrophy deload week,
  and all accessory prescriptions are byte-identical. A pinned test asserts only the
  `HYPERTROPHY_ANCHOR` non-deload compound *final* set changes (rep field → RIR-anchored shape +
  load nudge); weeks/sets/loads elsewhere are unchanged.
- New constants (RIR targets per week, any load-nudge factor) ship tagged
  `// heuristic — hypertrophy compound effort anchor (CP-1), per Schoenfeld 2021 / Helms 2018`.

## Out of scope

- Restructuring the hypertrophy rep scheme or set counts beyond the final-set anchor.
- Turning the hypertrophy compound into an e1RM/TM driver (it stays volume/completion-led).
- Accessory-matrix changes (already correct).
- Adding an open AMRAP to any hypertrophy set (explicitly rejected — Decision 2).

## Implications

- The hypertrophy archetype finally delivers a hypertrophy stimulus on its compounds, matching
  its name and copy.
- Consistent autoregulation story across archetypes: strength/power → AMRAP (ADR 0007),
  hypertrophy → RIR target (this ADR), accessories → existing RIR matrix.
- On acceptance: add CP-2 rows for the RIR targets / load-nudge (tagged heuristic), update the
  `HYPERTROPHY_ANCHOR` oneLiner + the misleading comment, update `hybrid-training-engine-live.md`
  §10 (archetypes) and the canonical workspace mirror.
