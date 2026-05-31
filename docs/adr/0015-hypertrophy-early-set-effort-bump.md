# ADR 0015 — Effort-bump the hypertrophy compound's early sets (bounded, no false RIR)

**Status:** Accepted
**Date:** 2026-05-31
**Phase:** Production (engine conservativeness review — Part-1 finding A)
**Relates to:** ADR 0011 (final-set RIR anchor — this ADR extends it to the earlier sets), ADR 0016 (effort/volume dial — where literal RIR 3–4 / higher volume becomes opt-in)
**Touches:** `apps/web/src/lib/planner/archetypes.ts` (`HYPERTROPHY_EARLY_SET` + `applyHypertrophyEffortAnchor`)

## Context

ADR 0011 effort-anchored only the **last** working set of the `HYPERTROPHY_ANCHOR`
compound by an RIR target, deliberately leaving the **earlier** sets as fixed-rep
"accumulated volume." The conservativeness review re-examined those earlier sets and
confirmed they sit at **~RIR 6–10** at the prescribed loads — i.e. junk-volume
territory that contributes little hypertrophy stimulus (Schoenfeld 2021; the
effective-reps / proximity-to-failure model). The archetype *named for hypertrophy*
therefore delivers most of its early compound volume below the stimulus threshold.

The intuitive fix — "tighten the early sets to RIR 3–4" — was tested against the load
model before committing, and it **does not hold at these loads**:

| Early set | %TM | %1RM (TM ≈ 90%) | Reps to reach RIR 3 (RPE 7) via the Helms/Zourdos chart |
|---|---|---|---|
| W0 set 1 | 0.60 | 0.54 | **off the chart low** (12-rep cell ≈ 0.673) → ~14–16 reps |
| W0 set 2 | 0.65 | 0.585 | ~13–15 reps |
| W0 set 3 | 0.70 | 0.63 | ~12–13 reps |
| W2 set 3 | 0.75 | 0.675 | ~12 reps |

So **literal RIR 3–4 on the early sets forces ~12–15 rep sets across the board** — a
large, uniform volume jump whose systemic-fatigue and interference cost is exactly
what a concurrent (endurance + strength) athlete can least afford. The only way to
reach RIR 3–4 *without* the rep explosion is to raise early-set load to ~0.76 TM,
which breaks the archetype's "60–75% TM, light-volume" identity and overlaps strength
intensities.

The conservativeness review's own conclusion (high inter-individual variability on
volume/effort tolerance) was: **prefer a user-facing volume/effort dial over
hardcoding aggressive defaults.** This ADR therefore ships a *modest, honest* default;
the aggressive option lives in ADR 0016 (the dial).

## Decisions

| # | Topic | Decision | Why |
|---|---|---|---|
| 1 | Bounded rep bump on early sets | On `HYPERTROPHY_ANCHOR` **non-deload** weeks, each early (non-final) compound set's printed reps rise by a fixed `+2`, **capped at 12**. Load (%TM) is unchanged. | Moves the early sets from ~RIR 8 toward ~RIR 6 — a real but conservative tightening — without the ~12–15 rep explosion that a literal RIR-3-4 target would force. The 12-rep cap is the validity ceiling of the e1RM model (`one-rm.ts`). |
| 2 | No `targetRir` on early sets | The early sets carry an honest submaximal **cue** but **no** `targetRir` number. | At 54–67% 1RM a precise "RIR 3–4" label would overstate the effort the printed reps deliver. We do not print effort precision the load model can't honour. The final set keeps its `targetRir` (ADR 0011) because the load nudge there makes it reachable. |
| 3 | Deload untouched | Week 3 (deload) early sets keep their fixed reps and no cue. | A deload must remain a deload (mirrors ADR 0011 Decision 4). |
| 4 | Final set unchanged | The ADR 0011 final-set RIR anchor is preserved exactly. | This ADR only extends coverage to the earlier sets. |
| 5 | Aggressive effort is opt-in | True RIR 3–4 / higher volume is **not** hardcoded; it is exposed through the effort/volume dial (ADR 0016) for users who want it. | High inter-individual variability — the default must stay concurrent-safe; the user opts in to more. |

## Rationale

The honest read of the load model is that the hypertrophy compound's **light loads and
low RIR are physically incompatible** — you cannot have both at the prescribed
intensities. Given that, the right default is the *bounded* one: nudge the early sets a
little closer to the stimulus window (a few reps, a truthful cue) while keeping the
archetype's volume identity and concurrent-safety intact, and route anyone who wants the
full RIR-3-4 / high-volume version through an explicit, reversible preference.

The expected benefit is **modest** by design. Refalo 2023 puts the per-set sub-failure
penalty at a small effect size (ES ≈ 0.12–0.19), so a `+2` bump captures a fraction of
the available stimulus — but it is a fraction at near-zero fatigue cost, and it stops
the early sets from being pure junk volume. The dial carries the rest.

## Evidence base

- **Schoenfeld 2021** (proximity-to-failure / effective reps) — **HIGH**: stimulus scales
  with proximity to failure; sets many reps shy of failure are largely sub-threshold.
- **Refalo 2023** (proximity-to-failure dose-response meta) — **MODERATE**: the marginal
  hypertrophy return of taking sub-failure sets a little closer to failure is real but
  small per set — supports a *modest* bump, not an aggressive one.
- **Load–rep relationship (Helms/Zourdos RPE chart, `one-rm.ts`)** — **MODERATE/practical**:
  inverting the chart shows RIR 3–4 at 54–67% 1RM lands at ~12–15 reps — the basis for
  rejecting a literal RIR-3-4 default and for the 12-rep cap.
- **Concurrent-training interference / fatigue cost** (Wilson 2012; ADR 0008 lineage) —
  **MODERATE**: a uniform volume jump on the strength side raises the interference and
  recovery cost — the reason the aggressive option is opt-in, not default.

## Implementation contract (on acceptance)

- Change is localised to `archetypes.ts`: a new `HYPERTROPHY_EARLY_SET` constant (heuristic,
  CP-1) and an extension of `applyHypertrophyEffortAnchor` to transform the early sets. No
  other file's prescription output changes.
- **Regression guard (CRITICAL).** Every non-hypertrophy archetype, the hypertrophy deload
  week, folded secondary slots, and all accessory prescriptions are byte-identical. A pinned
  test asserts only the `HYPERTROPHY_ANCHOR` non-deload compound *early* sets change
  (reps `+2` capped at 12, plus an `intensityCue`); the final set, weeks, loads, and
  everything else are unchanged.
- New constants ship tagged
  `// heuristic — hypertrophy compound EARLY-set effort bump (CP-1), per Schoenfeld 2021 / Refalo 2023`.
- CP-2 table gains a row (repo `docs/knowledge/` + the canonical workspace mirror).

## Out of scope

- Changing the hypertrophy %TM band, set counts, or wave structure.
- Any `targetRir` on the early sets (explicitly rejected — Decision 2).
- The effort/volume dial itself (ADR 0016).
- Accessory-matrix changes (already correct).

## Implications

- The hypertrophy compound's early sets stop being pure junk volume while the archetype
  stays concurrent-safe by default.
- The dial (ADR 0016) is the principled home for users who want true RIR 3–4 / more volume.
- On acceptance: add a CP-2 row for `HYPERTROPHY_EARLY_SET` (tagged heuristic), update
  `hybrid-training-engine-live.md` §10 (archetypes) and the canonical workspace mirror.

## Implementation notes (as built — 2026-05-31)

**Commit:** _(filled on merge)_.

1. **Files touched.** `apps/web/src/lib/planner/archetypes.ts` only:
   `HYPERTROPHY_EARLY_SET = { repBonus: 2, repCap: 12, cue: "Build set — make it
   challenging; stop several reps short of failure." }` and `applyHypertrophyEffortAnchor`
   now maps the early sets (non-deload) to `reps = min(12, reps + 2)` + the cue, with no
   `targetRir`. The function still returns a new array and never mutates inputs.
2. **Per-week effect.** W0 early `[10,10,8]` → `[12,12,10]`; W1 `[10,10,8]` → `[12,12,10]`;
   W2 `[10,8,8]` → `[12,10,10]`. Loads unchanged. Deload (W3) unchanged.
3. **Regression guard.** The ADR-0011 test's "NON-final sets" assertion was updated to the
   new early-set shape; a dedicated ADR-0015 test pins the bump + cap + cue, the deload
   no-op, and non-hypertrophy archetypes being byte-identical.
