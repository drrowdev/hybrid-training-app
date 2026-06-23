# ADR 0058 — HYROX strength: two-main split, promoted pull, demand-matched reps

Status: Accepted
Date: 2026-06-23

## Context

ADR 0057 made HYROX strength HYROX-specific but kept **two identical full-body
days** (squat + deadlift + press, both days, each lift 2×). In use that raised
three problems:

1. **CNS + movement quality.** Three near-max compounds per session (squat *and*
   deadlift heavy together), twice a week, on top of 5 running/station days, is a
   lot of axial/CNS load — and the 3rd lift always gets the worst technique.
2. **No compound pull.** The sled pull is a whole station and pulling drives
   posture, yet pull was accessory-only.
3. **Accessory loading wasn't demand-derived.** Reps were reasonable but not tied
   to what each station actually demands.

The deciding insight came from profiling the race: **HYROX never demands maximal
force.** Every loaded element is sub-maximal force at high rep/duration under
fatigue across 60–90 min (sled push ~45 s, lunge station ~100 loaded reps, wall
balls 100 light explosive reps, farmers carry ~2 min, 8 km running). So strength
work has two jobs that want different rep ranges:

- **Strength reserve** (raise max so station loads are a lower % → fatigue slower)
  — genuine strength, but **4–6 reps, not 1–3RM**; the marginal endurance benefit
  of a true max over a strong 5RM is tiny once loads are sub-maximal, at high CNS
  cost.
- **The endurance qualities** the race tests — trained at **station-matched
  rep/duration** (SAID).

## Decision

Move to a **two-main split** when a week carries two strength days; keep a
full-body session for a single strength day.

### Two heavy mains per day (4–6 reps, the phase scheme = strength reserve)
- **Day A — Squat + Overhead Press**
- **Day B — Deadlift + a heavy compound Pull** (the pull is **promoted to a
  primary lift** — the sled-pull driver, programmed by effort 4×4–6 @ RPE 8 since
  there's no pull 1RM).

Two heavy efforts per session (not three) protects CNS + quality. Each pattern is
hit ~1× as a true max-effort main; muscle stimulus is backfilled to ~2×/week by
the accessories + the running/station volume.

### Demand-matched accessories
| Accessory | Maps to | Reps |
|---|---|---|
| Secondary pull (Day A) | sled pull, posture (2nd pull stimulus) | 3×6–10, RPE 7–8 |
| Power-endurance press (Day B) | 100 wall balls (light explosive) | 3×8–15 explosive |
| Single-leg (both days) | 100 m lunge station + running + sled drive | 3×12–15 / leg |
| Loaded carry (Day B) | farmers carry station (200 m) | 3 × ~40–60 m / time |
| Core (Day A) | trunk bracing across the race | 3×12–20 / holds |
| Calf / Achilles prehab (Day A) | running + jump durability (Achilles/soleus) | 2×12–15 |

Accessory-resolution refinements (follow-up): pulling ROTATES patterns across the
week — Day A horizontal (row), Day B heavy VERTICAL (weighted pull-up, the
promoted primary). The press slot resolves to OVERHEAD/explosive only
(push-press/thruster), never a horizontal bench (no race transfer). Calf
isolations route to a dedicated `prehab` slot, never single-leg. The resolver
gains `pull_vertical` / `pull_horizontal` / `push_overhead` sub-pools (each falls
back to the general pull/push pool when the variant is unavailable) and a `prehab`
slot; 5/3/1's `single_leg_or_core` union still includes prehab, so 5/3/1 is
unchanged.

### Single strength day
Low weekly frequency → `strength-full`: Squat + Deadlift + Press (4–6) + a pull,
single-leg and carry, so no pattern is missed.

## Calibration

- **CP-1:** the split structure, 4–6-rep mains, and the accessory rep ranges are
  `[DEF]` derived from station demand profiles + the muscular-endurance continuum
  + SAID — not generic convention. No HYROX RCT exists; flagged. Validation = the
  plan-composition tests + (later) adherence/feedback.
- **CP-2:** no shared engine coefficient moves; HYROX-package-local. The strength
  math (% of 1RM) is unchanged; only session composition + accessory reps changed.
- **CP-3/CP-5:** no new >1-sig-fig physiological coefficient.

## Scope / risk

HYROX strength composition only; other programs untouched. Reverses ADR 0056/0057's
"two identical full-body days, each lift 2×" in favour of the split (each pattern
1× heavy main + 2× muscle stimulus). Covered by updated dosing/placement tests +
a new split-content test. No migration — applies on plan (re)deploy.
