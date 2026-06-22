# ADR 0057 — HYROX strength: make it HYROX-specific, not generic barbell strength

Status: Accepted
Date: 2026-06-22

## Context

An audit of the strength the engine produced for a 5×/week intermediate HYROX
plan found it was sound but **generic**: squat / deadlift / overhead press at a
fixed wave, plus exactly two accessories — a pull and a single *shared*
"single-leg OR core" slot. Against established HYROX strength methodology
(RoxLyfe, HYROX coach consensus, the SSAC 2025 framing of strength as
*supportive* of running) several gaps stood out:

1. **Single-leg under-weighted.** HYROX is ~8×1 km running + a 100 m sandbag-lunge
   station + single-leg sled drive. Unilateral work should be guaranteed, not
   competing with core for one slot.
2. **Loaded carries absent.** Farmers carry is a literal station (200 m); carries
   were not even selectable — they classified into the shared slot or were dropped.
3. **Accessory pool too thin.** Two slots can't cover unilateral + carry + pull +
   trunk.
4. **Build phase over-indexed on max strength** (4×4 @ 83% ≈ a 4–5RM). For a
   power-endurance sport where strength supports rather than dominates, mains
   should stay moderate-heavy and repeatable.

Per the owner's standing preference, sport methodology + coach consensus are
weighted ABOVE generic exercise-science RCT literature for HYROX programming.

## Decision

### Mains — moderate-heavy, never a max-strength peak
Soften the per-phase wave (squat / deadlift / overhead press, off the shared 1RM):

| Phase | Was | Now |
|---|---|---|
| Base | 4×5 @ 75% | **4×6 @ 72%** (accumulate, work capacity) |
| Build | 4×4 @ 83% | **5×5 @ 78%** (intensify via volume, sub-max) |
| Specific | 3×3 @ 80% | **3×4 @ 78%** (maintain, shed volume) |
| Taper | 2×3 @ 68% | **2×3 @ 65%** (stay sharp) |

Intensity now caps at ~78%; reps live in the 4–6 band — strength-endurance lean,
not powerlifting.

### Accessories — HYROX-specific, granular slots
`strength-full` now programs four targeted accessories every strength day:
**single-leg · loaded carry · pull · core**, with per-slot prescriptions:
- single-leg 3×10–15 per leg
- carry 3 × ~30–40 m / ~30–40 s (distance/time, no rep target)
- pull 3×8–12
- core 3×12–20

(Taper trims to 2 sets.) Both strength days remain full-body (each main 2×/week),
per the owner's earlier choice.

### Assistance resolver — split the shared slot, add carry
The platform assistance resolver (ADR 0047) gains granular slots
`single_leg` / `core` / `carry` alongside `push` / `pull`. The coarse
`single_leg_or_core` REQUEST that 5/3/1 emits is mapped onto the UNION of
single-leg + core + carry pools, so **5/3/1 selection is byte-unchanged**. Loaded
carries (`pattern: "carry"`) now classify into their own slot instead of being
dropped or mis-bucketed. The adapter surfaces the engine's accessory cue (e.g.
the carry's distance, single-leg's "per leg") on the resolved item.

## Calibration

- **CP-1:** the wave % / rep bands and accessory dosing are `[DEF]` coach-consensus
  (RoxLyfe + HYROX practitioner standards), user-gated by phase. No HYROX-specific
  RCT exists — flagged. Validation = the plan-composition tests + (later) adherence.
- **CP-2:** no shared engine coefficient moves; HYROX-package-local. The strength
  math (% of 1RM) is unchanged in form — only the constants and slot set changed.
- **CP-3/CP-5:** no new >1-sig-fig physiological coefficient.

## Scope / risk

HYROX strength composition changes (Base/Build/Specific/Taper loads + the
accessory set). 5/3/1 and other programs are unaffected — the resolver change is
backward-compatible via the union mapping, verified by the wendler suite (142
tests) and the assistance-resolver / catalog-classification suites. No migration.
