# ADR 0040 — Interference-aware strength accessory headroom

Status: Accepted (2026-06-08)
Supersedes: none
Related: ADR 0039 (modality plan — supplies the planned modality mix), ADR 0025
/`engine/concurrent-scalar.ts` (`MODALITY_INTERFERENCE` + `computeConcurrentScalar`,
Wilson 2012), ADR 0024 (accessory-volume tilt — the lever this rides on). Phase B
of the modality-specificity design (`files/modality-specificity-design.md`).

## Context

The modality-interference model (`computeConcurrentScalar`: run 1.0, bike 0.4 …)
existed but only ever reached the Stats chart + the reactive early-deload offer —
never the generator. So a block that does its cardio on the bike (which barely
interferes with strength — Wilson 2012) did not earn any of the strength-recovery
headroom that cycling actually frees up, the way a run-heavy block would forfeit.

## Decision

Feed the block's **planned** cardio modality mix (post-ADR-0039) into the
generator as a small, capped **accessory-volume bonus** — the freed recovery buys
a little more strength accessory work.

1. **Signal** — compare the planned weekly cardio mix to the archetype's DEFAULT
   mix (no event, no preference, no diversification) via `computeConcurrentScalar`:
   `saving = scalar(planned) − scalar(default)`. Higher scalar = less
   interference, so a lower-interference plan scores `saving > 0`.
2. **Anchor = the archetype default** (not all-running). Every existing,
   non-diversified block has `planned == default` → `saving = 0` → no bonus →
   **byte-identical**. Only a plan the athlete diversifies BELOW the template
   baseline (e.g. an event-runner whose easy runs move to the bike on a hybrid
   block) earns it. This also keeps `strength_anchor` (whose default cardio is
   already the bike) unchanged.
3. **Effect** — `+1` aesthetic item via the existing ADR 0024 tilt machinery
   (`accessoryVolumeCandidates.extraItemBonus`), so it is bounded by the duration
   governor and only seats when there is a real muscle gap. Capped at
   `INTERFERENCE_BONUS_MAX_ITEMS = 1`.
4. **Gate** — only `strength_anchor` + `concurrent_hybrid`. On cardio-led /
   rebuild / maintenance blocks strength is deliberately floored — no headroom to
   spend, so a no-op.
5. **Threshold** — `INTERFERENCE_BONUS_THRESHOLD = 0.04`: a token diversification
   (e.g. one 45-min easy run → bike, ≈ 0.027 scalar) earns nothing; the bonus
   fires only when the interference saving is real (enough low-interference
   volume).

## Consequences

- **Byte-identical for every existing block**: the bonus is computed only when the
  cardio catalog is loaded (an event goal or preference exists, so diversification
  is possible); with no catalog, `planned == default` → 0. The assembler param
  (`interferenceItemBonus`) defaults to 0, so all golden / unit tests are
  unchanged (full suite green, 3615).
- **When it fires**: a strength-emphasis athlete whose planned cardio is
  meaningfully lower-interference than the template default (in practice, a
  concurrent-hybrid athlete who diversifies easy running to the bike via ADR 0039)
  gains one extra accessory item — bounded by the duration governor.
- **Naturally modest**: ADR 0039 keeps quality + the long session in the goal
  modality, so a run-goal block stays close to its run-heavy baseline and the
  saving rarely clears the threshold unless real cycling volume is present.
- **No schema change**. Reuses `computeConcurrentScalar`, the ADR 0039 plan, the
  cardio catalog, and the ADR 0024 tilt.

## Science / rationale

Wilson 2012 (HIGH): running-based concurrent training impairs lower-body strength
/ hypertrophy; cycling-based does not. The freed recovery from lower-interference
cardio is therefore available for more strength volume. The interference scalar
reuses the existing calibrated `MODALITY_INTERFERENCE` coefficients (no new
magnitudes); the threshold + the +1 cap are deliberately conservative CP-1
heuristics. Confidence: **HIGH** for "lower-interference cardio frees strength
headroom"; **LOW / CP-1** for the exact threshold + the one-item dose (it is an
unproven nicety, bounded on purpose).

## Files
- `apps/web/src/lib/planner/interference-volume.ts` (NEW, pure):
  `scalarModalityKey`, `computeInterferenceVolumeBonus`, constants.
- `apps/web/src/lib/planner/accessory-volume.ts` — `accessoryVolumeCandidates`
  gains `extraItemBonus` (additive, floored; default 0 = unchanged ladder).
- `apps/web/src/lib/planner/assemble-prescription.ts` — `interferenceItemBonus`
  param (default 0), threaded to the tilt.
- `apps/web/src/lib/planner/actions.ts` — build default vs planned modality mixes
  (when the catalog is loaded), compute the bonus, pass it to the assembler.
- Tests: `adr-0040-interference-volume.test.ts`.
- `docs/knowledge/hybrid-training-design-constraints.md` (+ workspace mirror).
