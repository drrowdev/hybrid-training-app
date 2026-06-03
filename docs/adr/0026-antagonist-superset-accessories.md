# ADR 0026 — Antagonist-superset accessories

Status: Accepted (2026-06-03)
Supersedes: none
Related: ADR 0013 (autoreg volume end-slice), ADR 0020 (duration-governor volume tilt),
ADR 0024 (accessory volume level)

## Context

The app is built for the time-pressed hybrid athlete. It already has a set-aware
duration estimator (`estimate-duration.ts`) and a duration governor (ADR 0020) that
trims accessory volume to a 60-min target / 75-min hard ceiling, plus a Low/Med/High
accessory-volume lever (ADR 0024). The single most evidence-backed way to do MORE
useful work inside a fixed time budget is the **antagonist superset**: pairing two
opposing isolation movements (e.g. biceps curl + triceps pushdown) so the lifter
rests once per round instead of twice.

Antagonist (reciprocal) paired-sets cut session time ~30-50% at preserved total
volume, and — unlike same-muscle ("agonist") supersets — antagonist pairing
preserves or even slightly enhances agonist force output via reciprocal
facilitation. Evidence: Robbins et al. 2010 (JSCR systematic review of antagonist
paired sets); Weakley et al. 2017, 2020 (superset configurations roughly halve
session duration at similar volume, higher density/efficiency); Maia et al. 2014;
Paz et al. 2017; Krzysztofik et al. 2019 review. Honest caveat: supersets raise
acute RPE / blood lactate modestly — surfaced in the UI, not hidden.

## The hard constraint

The engine-regression invariant is absolute: **users not using a new feature must
see byte-identical prescriptions.** Pairing lowers the estimated session time, and
the governor trims accessories to a time budget. If pairing fed the governor,
enabling supersets would let the governor keep MORE accessories — every prescription
would change. That is unacceptable as a default and a muddy promise ("I enabled
supersets and got *more* exercises?").

## Decision

**Pairing is a post-selection annotation layer; it never selects volume.**

1. The duration governor always picks accessory volume on the UNPAIRED
   (conservative) estimate — unchanged.
2. AFTER the winning candidate is chosen, a pure pass groups opposing accessories
   into pairs by writing `meta.supersetGroup` + `meta.supersetSlot` (the `meta`
   blob is engine-invisible, UI-only — schema-discipline §6.8), pulling each A2
   partner up to sit immediately after its A1.
3. The DISPLAYED session time is recomputed with overlapped rest (the estimator
   gains a superset-aware branch, gated on `meta.supersetGroup`).

Net effect:
- **OFF (default):** the pass is never invoked and no item carries superset meta, so
  the estimator reduces to its exact legacy per-item computation → byte-identical.
- **ON:** the item SET is identical to OFF — only `meta`, the within-accessory-block
  order, and the displayed time differ. The same exercises, grouped A1/A2, with a
  shorter, honest session length.

Chosen "ON" behavior = **shorter session, same volume** (user decision 2026-06-03).
Rejected: (b) more volume / same time (governor feedback → regression surface,
confusing); (c) display-only with no time change (dishonest — hides the benefit).

No `buildPrescription` touch, no ceiling-chain factor (CP-4 clean), no cross-archetype
invariant risk.

## Antagonist classification (anatomical, not tuned)

Reciprocal groups keyed by joint action, derived from the 22-muscle `primaryMuscles`
enum. A movement classifies into a group ONLY when every mapped primary muscle
resolves to the same group (clean isolation); a movement whose primaries straddle two
groups (e.g. a row = lats + biceps) is ambiguous and stays solo. This conservatively
restricts pairing to isolation accessories.

| Group A (flexor/push) | Group B (extensor/pull) |
| --- | --- |
| elbow_flexors (biceps) | elbow_extensors (triceps) |
| knee_extensors (quads) | knee_flexors (hamstrings) |
| horizontal_push (chest, upper_chest, front_delts) | horizontal_pull (lats, mid_back, rear_delts) |
| ankle_plantarflexors (calves) | ankle_dorsiflexors (tibialis) |

Deliberately UNMAPPED in v1: side_delts (no true antagonist); abs / lower_back
(loaded trunk-flexion + lumbar-extension superset is contentious — safety); forearms
(the enum cannot separate wrist flexion from extension); glutes / traps / adductors /
abductors / obliques / neck (no clean isolation antagonist).

## Duration model

For a valid pair (both members present, both accessory, equal sets) of `s` rounds:

```
paired   = s × (work_A1 + work_A2 + TRANSITION_SEC + max(rest_A1, rest_A2))
unpaired = s × (work_A1 + rest_A1) + s × (work_A2 + rest_A2)
```

You rest once per round (the longer of the two requirements) after doing both
movements; the only added cost over the overlapped rest is the brief station switch.
For two accessories (work 40, rest 90): saving = `s × (90 − TRANSITION_SEC)` =
75 s/round (~29%).

A "widowed" member — whose partner was trimmed off by the ADR-0013 autoreg end-slice —
is priced solo (you cannot superset with a missing partner), and the UI renders it as a
normal solo item.

## Constants (calibration policy)

- `SUPERSET_TRANSITION_SEC = 15` — CP-1 Stage-A heuristic (station-switch time), with a
  source comment and a calibration plan: refine against logged set timestamps once
  available. This is the only new magnitude.
- `rest_pair = max(rest_A1, rest_A2)` — structural rule, not a tuned magnitude.

No CP-2 engine constants are introduced (the feature is meta/display-only). The
classification table is anatomy, not calibration.

## Control

Profile-level preference `superset_accessories boolean NOT NULL DEFAULT false`
(execution style — applies to all blocks; simpler than per-block). Default false keeps
existing prescriptions byte-identical. The new write path follows the RLS posture:
explicit user-ownership check, Zod `.strict()`, user-scoped Supabase client.

## Consequences

- Strong, honest time promise without touching prescribed work.
- The largest implementation surface is the UI (focus card A1/A2, set logger,
  rest-timer behavior, preview time) — phased after the engine machinery.
- Acute RPE/lactate caveat must be surfaced where the toggle is explained.

## Phasing

1. **P1 — `antagonist-pairs.ts` pure module + tests.** (this PR) classification,
   `arePairable`, `pairAntagonistAccessories` (meta tag + minimal A2-adjacency).
2. **P2 — superset-aware `estimateSessionSeconds`.** (this PR) meta-gated overlapped
   rest; unpaired path proven byte-identical.
3. **P3 — `superset_accessories` preference** (migration + schema + Zod + wizard
   toggle + RLS) and thread to assemble.
4. **P4 — assemble post-pass:** apply pairing after governor selection when pref ON;
   golden test OFF byte-identical / ON same item set.
5. **P5 — UI render** (A1/A2 grouping, superset-aware rest timer, widowed fallback).
6. **P6 — preview/plan paired time.**
7. **P7 — docs:** add `SUPERSET_TRANSITION_SEC` to the CP-2 table in both the workspace
   canonical doc and the `docs/knowledge` mirror.

P1 + P2 land first as pure, fully-tested engine machinery with no behavior change
(unwired until P4 + the P3 preference gate).
