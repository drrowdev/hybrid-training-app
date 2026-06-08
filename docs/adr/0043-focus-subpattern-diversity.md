# ADR 0043 — focus-muscle sub-pattern diversity

Status: Accepted (2026-06-08)
Supersedes: none
Related: ADR 0027/0028 (focus-muscle floor + goal-weighted aesthetic), the
within-week movement-id variety, ADR 0037 (pull-plane diversity — same
"span both vectors" principle).
Driven by the same deep-research block review (B−) as ADR 0041/0042 — its
"do all follow-ups" tail.

## Context

The review's `forearms` focus block dosed enough volume (8 direct/near-direct
sets/week) but spent it on a single functional pattern: **wrist flexion** (Wrist
Curl BB on day 1, Wrist Curl DB on day 3) plus grip isometrics from carries. It
never touched wrist **extension** or **rotation**. A focus muscle should span its
distinct functional patterns, not duplicate one.

Two gaps enabled this:

1. **No catalog rotation movement.** The forearm/grip family had flexion
   (`wrist-curl-db`, `wrist-curl-bb`), extension (`reverse-wrist-curl`) and grip
   isometrics (`plate-pinch`, `captains-of-crush`, `dead-hang`) — but **no
   pronation/supination**, so the engine *couldn't* prescribe rotation even if it
   wanted to.

2. **Variety was movement-id-only.** The within-week variety penalty
   (`weekUsedMovementIds`) stops the *same movement* twice, but two distinct
   wrist-flexion curls have different ids, so a multi-day focus could still seat
   flexion → flexion.

## Decision

### #1 — seed a forearm rotation movement
Add `db-pronation-supination` ("Pronation / Supination (DB)") to the grip family
(seed + migration 0095, applied to prod). It's a normal forearm isolation
(`elbow_forearm`, `forearms`, no special role), so it only ever competes when
forearms are targeted.

### #2 — focus sub-pattern diversity penalty
Add a `focusSubPattern(slug)` classifier (forearm: flexion / extension / rotation
/ grip; every other slug → `null` = no taxonomy) and a soft
`FOCUS_SUBPATTERN_VARIETY_PENALTY = 30` in `candidateScore`. The focus top-up pass
computes the sub-patterns a focus muscle already covered this week (prior days +
earlier passes this session, resolved through the catalog so it classifies by slug
regardless of whether the history id is a slug or a DB id) and passes them as
`avoidFocusSubPatterns`. A candidate whose sub-pattern is already covered is
demoted, so a multi-day focus spans flexion → extension → rotation rather than
stacking one. Soft — a repeat sub-pattern still seats when it's the only feasible
option.

## Consequences

- **Byte-identical for every non-focus user** (`focusMuscles` empty → the pass
  never runs) and for any focus muscle without a sub-pattern taxonomy
  (`focusSubPattern` → `null` → no penalty → only the existing movement-id variety
  applies). Currently the taxonomy is meaningful only for `forearms`.
- **Forearm-focus blocks** now diversify across days. The new rotation movement
  only surfaces when forearms are targeted, so no other prescription changes.
- Full `@hta/web` suite stayed **3624 green** with no snapshot/realism drift —
  the seed addition + penalty are inert outside a forearm focus.
- Migration 0095 applied to prod (`db-pronation-supination` verified present).

## Science / rationale
- A focus muscle should be trained across its functional range, not via one
  duplicated pattern — basic specificity / balanced-development practice (forearm
  resilience spans flexion + extension + rotation + grip, not flexion alone). The
  DIRECTION is well-supported; the exact penalty size and the forearm taxonomy are
  **CP-1 / Stage-A heuristics**. **HIGH** direction; **MEDIUM/CP-1** magnitude.

## Files
- `apps/web/src/lib/planner/accessory-picker.ts` — `focusSubPattern`,
  `FOCUS_SUBPATTERN_VARIETY_PENALTY`, `CandidateQuery.avoidFocusSubPatterns`,
  `candidateScore` penalty, focus-pass avoid-set wiring.
- `packages/db/seeds/movements-part2.ts` — `db-pronation-supination` in the grip
  family.
- `packages/db/drizzle/0095_seed_forearm_rotation.sql` (+ `_journal.json`),
  applied to prod.
- Test: `adr-0043-focus-subpattern.test.ts`.
- `docs/knowledge/hybrid-training-design-constraints.md` (+ workspace mirror).
