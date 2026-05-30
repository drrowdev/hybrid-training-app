# ADR 0012 — Accessory variation across blocks, weighted by movement value

**Status:** Accepted
**Date:** 2026-05-30
**Phase:** Production (engine methodology review — accessory selection)
**Relates to:** ADR 0010 (next-block nudge — the macrocycle-advice counterpart to this within-block-selection change), ADR 0006 (archetype balance), the methodology review's accessory-selection thread
**Touches:** `apps/web/src/lib/planner/accessory-picker.ts` (`candidateScore`, `findPowerCandidate`, `CatalogMovement`), `apps/web/src/lib/planner/power-emphasis-transform.ts` (inline recency score), `apps/web/src/lib/planner/actions.ts` (`toCatalogMovement` + the two `recentlyUsedMovementIds` call sites), a new read-only previous-block accessory-history query, `buildPrescription` threading

## Context

The accessory picker ranks every candidate by one function, `candidateScore`
(`accessory-picker.ts:588`, lower = better):

```
score = 100·(recentlyUsed) + 30·(unsupported & preferSupported) + 20·(concurrent & high-eccentric) − stimToFatigueScore
```

`findPowerCandidate` (`:569`) and the power-emphasis primer (`power-emphasis-transform.ts:223`)
carry the same inline `+100 recentlyUsed − SFR` shape. Two findings from the code/literature
review make the current behaviour wrong on both ends:

1. **Rotation never fires.** All three call sites pass `recentlyUsedMovementIds: new Set()`
   (`actions.ts:646,732` + the power path). The picker is otherwise deterministic, so a user
   gets the **same accessories every block, forever** — no systematic cross-mesocycle variation,
   risking regional-hypertrophy gaps, monotony, and repetitive single-tendon loading.

2. **If we naively wired it, it would rotate the wrong things.** The rotation penalty (`+100`)
   dwarfs the value signal (`−stimToFatigueScore`, max `−5`) by 20:1 — so a freshly wired flat
   penalty would rotate *away* from high-value staples (chin-ups, dips, rows) every block, the
   opposite of what a good coach does.

Two data facts shape the fix:

- `stimToFatigueScore`/`eccentricLoadScore` typed columns are **seeded 0/281 times** — the `−SFR`
  bias and the concurrent-eccentric `+20` term are effectively dead. SFR is also, per the
  literature, a **LOW-confidence practitioner heuristic** (Israetel; no validated peer-reviewed
  construct). We deliberately do **not** revive it here.
- `isCompound` is **populated** (per-family seed defaults) but **never read** by the picker;
  `bodyWeightLoaded` (flags weighted-loadable pull-ups/chin-ups/dips) is **populated but dropped**
  by `toCatalogMovement` before the picker sees it. The signal the user wants already exists in
  the catalog — it just isn't plumbed through.

## Decisions

| # | Topic | Decision | Why |
|---|---|---|---|
| 1 | Rotation cadence = **per block**, not per session | Populate `recentlyUsedMovementIds` from the **previous block's** prescribed accessories for the **same day-role**, fixed for the whole new block — not from the previous session. Within a block, picks stay constant. | Kassiano 2022: systematic per-mesocycle variation helps; excessive (per-session/random) rotation *hinders* gains. Baz-Valle 2019: per-session random rotation gives no hypertrophy benefit and may impair deep-muscle regions. Holding a movement for the whole block preserves progressive overload + the RIR wave + motor learning. |
| 2 | **Value-weight** the rotation penalty | Replace the flat `+100` with `ROTATION_BASE · (1 − valueNorm)`, `valueNorm ∈ [0,1]`. High-value staples get ≈0 penalty → **persist across blocks**; low-value/redundant movements get the full penalty → churn each block. | Encodes "some movements are higher value and worth repeating more often" numerically. Variation concentrates on the cheap-to-substitute slots, never the staples. |
| 3 | Value model = **compound + loadable** (SFR deferred) | `valueRaw = 2·isCompound + 1·isLoadable`, normalised `/3` → `valueNorm`. `isLoadable` = external/added-load capacity (surfaced from `bodyWeightLoaded` for the weighted-BW staples; the picker already only sees movements that can be loaded). **No SFR term.** | Gentil 2015: multi-joint = equivalent hypertrophy + lets you load more across multiple muscles (Schoenfeld 2010 mechanical tension). Both are MODERATE-evidence. SFR is LOW and over-values isolations (lateral raises) — exactly the movements that *should* be free to rotate. |
| 4 | Small **value bonus** in selection | Add `− VALUE_BONUS · valueNorm` so, all else equal, the picker prefers the higher-value movement for a given muscle gap (chin-up over straight-arm pulldown). `VALUE_BONUS < ROTATION_BASE`. | Makes compounds the *baseline* accessory (Gentil 2015) and, combined with Decision 2, makes staples recur. Kept small so it never disturbs the structural phase order or the limitation/region filters. |
| 5 | **Never rotate for its own sake** | The penalty only *demotes*; `findCandidate` still returns the best available, so if no anatomically-distinct alternative exists for that muscle/role the **same movement is kept**. Target coverage is never sacrificed to force a swap. | Kassiano 2022: variation must be anatomically justified — a swap to a redundant variant is worthless. The user's explicit constraint: "variation is ok but not for the sake of variation." |
| 6 | Main lifts unchanged | This ADR is accessory-only. Main/secondary lifts remain archetype-fixed. | Rutherford 1986 / SAID: max-strength adaptation is movement-specific and neural; the mains must stay the consistent progressive core. Already true in the app. |
| 7 | Overuse framing = **heuristic, not claim** | Tendon-distribution benefit of rotation is documented as a *secondary, plausible* rationale only — never surfaced as proven injury prevention. | Cook & Purdam 2009 / Baar 2017 give biological plausibility (tendons go refractory to identical loading) but there is **no RCT** on rotation → tendinopathy prevention. |

## Rationale

A world-class coach varies accessories **across mesocycles** — not within them and not every
session — and varies the *low-value, easily-substituted* work while keeping the high-value
compound staples (weighted pull-ups, dips, rows) as fixtures the athlete progresses on for years.
That is exactly the shape of Decisions 1–5: a per-block recency signal whose penalty is inversely
scaled by a compound+loadable value score. The math makes staples sticky and isolations fluid,
with an explicit fallback (Decision 5) that refuses to swap when no genuinely distinct
alternative exists.

We reject an SFR-led value model (Decision 3) on evidence grounds: SFR is unvalidated and, more
practically, it over-rewards isolations — the opposite of the user's intent and of the
mechanical-tension logic that makes loadable compounds high-ROI. `isCompound + isLoadable` is the
honest, better-grounded encoding, and both signals are *already in the catalog*.

## Evidence base

- **Kassiano W, Schoenfeld BJ et al. 2022** — *J Strength Cond Res* 36(6):1753, **PMID 35438660** — **MODERATE–HIGH**: systematic anatomically-justified variation helps; excessive/random rotation may hinder gains. Grounds Decisions 1 & 5.
- **Baz-Valle E et al. 2019** — *PLoS ONE* 14:e0226989 (DOI 10.1371/journal.pone.0226989; PMID not independently confirmed — cite by author/year) — **MODERATE**: per-session random rotation = equivalent global hypertrophy but possible regional deficit + motivation gain. Upper bound on rotation frequency → Decision 1 (per block, not per session).
- **Gentil P, Soares S, Bottaro M 2015** — *Asian J Sports Med* 6(2):e24057, **PMID 26446291** — **MODERATE**: multi-joint = equivalent hypertrophy to isolation for shared muscles. Grounds the compound term in Decision 3.
- **Schoenfeld BJ 2010** — *J Strength Cond Res* 24(10):2857, **PMID 20847704** — **MODERATE**: mechanical tension is the primary hypertrophy driver; loadable compounds deliver more of it. Grounds the loadable term in Decision 3.
- **Rutherford OM, Jones DA 1986** — *Eur J Appl Physiol* 55(1):100, **PMID 3698983** — **MODERATE**: strength is substantially task-specific (motor learning). Grounds Decision 6 (mains fixed).
- **Cook JL, Purdam CR 2009** — *Br J Sports Med* 43(6):409, **PMID 18812414** — **MODERATE** (continuum model) / **LOW** (rotation-as-prevention inference). Decision 7.
- **Baar K 2017** — *Sports Med* 47(S1):5, **PMID 28332110** — **MODERATE** (in-vitro tendon refractoriness) / **LOW** (rotation inference). Decision 7.
- **SFR as a ranking score** — **LOW** (practitioner heuristic; unvalidated). Basis for *deferring* it (Decision 3).

## Implementation contract (on acceptance)

- **Value helper.** A pure `movementValueNorm(m)` in `accessory-picker.ts`:
  `(2·(isCompound?1:0) + 1·(isLoadable?1:0)) / 3`. Surface `isLoadable` onto `CatalogMovement` and
  set it in `toCatalogMovement` from the DB `body_weight_loaded` column (∪ any inherently loadable
  pattern). No new DB column, no migration.
- **Score rebalance.** In `candidateScore`, replace `+= 100` with
  `+= ROTATION_BASE · (1 − valueNorm)` and add `−= VALUE_BONUS · valueNorm`. Apply the **same**
  rebalance to `findPowerCandidate` and the inline score in `power-emphasis-transform.ts` so all
  three selection paths agree. The dead `−stimToFatigueScore` / `+20 eccentric` terms may stay as
  harmless no-ops (out of scope to remove).
- **History query.** A new read-only, **user-scoped** loader returning the set of accessory
  `movement_id`s prescribed in the user's **previous block**, grouped by **day-role** (mirror the
  `bw-diagnostics-loader` `recentSessionsLast30Days` pattern: user-scoped Supabase client, **never**
  service-role; `.strict()` on any input). Source: `planned_sessions.role` + `prescription` JSONB
  (accessory items) for the prior block, or `set_logs` (`set_kind='accessory'`) joined to the
  block's sessions.
- **Wiring.** Thread a per-day-role `recentlyUsedAccessoryIds` map from the block-generation server
  action into `buildPrescription`, replacing the two `new Set()` literals (`actions.ts:646,732`).
  When there is no prior block (first block ever), the map is empty → behaviour is exactly today's.
- **Constants** ship tagged, e.g.
  `// heuristic — accessory value-weighted rotation (CP-1), per Kassiano 2022 / Gentil 2015`:
  `ROTATION_BASE = 40`, `VALUE_BONUS = 8`, value weights `{compound: 2, loadable: 1}`, cadence
  `per-block`, lookback = 1 prior block. Magnitudes are CP-1 proposals (see "Magnitudes" below).
- **Regression guard (CRITICAL).** For any user with **no prior block**, every prescription is
  byte-identical to today (empty recency map + value bonus must not reorder existing picks against
  the current fixtures — pin with a parity test on the seeded catalog). A separate test asserts a
  high-value staple in last block's set is **still chosen** this block while a low-value isolation
  is **rotated out**, and that with only one viable candidate the movement is **kept** (Decision 5).
- **Guards inherited:** new query gets explicit user-ownership check + `.strict()` Zod +
  user-scoped client; no change to `sessionPrescribesStrength` (accessory selection doesn't touch
  the hybrid-completion guard).

### Magnitudes (CP-1 — proposals to validate)

Scoring is penalty-based (lower = better); existing terms are `+30` supported, `+20` eccentric.

- `ROTATION_BASE = 40` — the largest single term, so a recently-used **low**-value movement
  (`valueNorm≈0` → penalty `40`) reliably rotates; but small enough that value can modulate it,
  unlike the old `+100` which swamped everything.
- `valueNorm` from `{compound:2, loadable:1}/3`: compound+loadable → `1.0` (penalty `≈0`,
  persists); compound-only → `0.67`; loadable-only → `0.33`; neither → `0` (full penalty).
- `VALUE_BONUS = 8` — staples get `−8`, enough to prefer the compound for a shared muscle gap, but
  `< ROTATION_BASE` so it never overrides region/limitation filters or the structural phase order.
- Worked check: a recently-used **staple** scores `40·(1−1) − 8·1 = −8` vs a fresh low-value
  alternative `0` → **staple kept** (recurs, as intended). A recently-used **isolation** scores
  `40·1 − 0 = +40` vs fresh alternative `0` → **rotated** (as intended).

## Out of scope

- Reviving / backfilling `stimToFatigueScore` (deferred; LOW evidence).
- Any new DB column or migration (value is derived from existing `is_compound` + `body_weight_loaded`).
- Cross-session accessory **load/progression** memory — accessories still carry no %TM (unchanged;
  the per-block RIR wave in `accessory-intensity.ts` is the truth-of-record).
- "Anatomically-distinct-from-main-lifts" complement scoring (a plausible v2 value refinement).
- Main-lift / secondary-lift selection (Decision 6 — fixed).
- Any claim of injury prevention from rotation (Decision 7 — heuristic only).

## Implications

- Accessories finally vary *systematically across blocks* while the high-value compound staples
  recur — matching both the literature and a world-class coach's behaviour.
- One coherent selection story: mains fixed (SAID), accessories rotate per mesocycle weighted by
  value, macrocycle advice via the ADR 0010 nudge.
- On acceptance: add CP-2 row 40 (rotation/value constants, tagged heuristic + citations), update
  `hybrid-training-engine-live.md` (accessory selection section) and the canonical workspace mirror.

## As-built (implemented)

Implemented as specified; no design changes from the accepted decision. Notes:

- **Three scoring sites unified.** candidateScore, the inline sort in `findPowerCandidate` (both `accessory-picker.ts`), and `score()` in `power-emphasis-transform.ts` all use the same gated `ROTATION_BASE·(1−value) − ACCESSORY_VALUE_BONUS·value` formula. Constants `ROTATION_BASE = 40` / `ACCESSORY_VALUE_BONUS = 8` exported from `accessory-picker.ts` and reused by the power-emphasis transform.
- **Value model** = `movementValueNorm = (2·isCompound + 1·isLoadable)/3` (compound + loadable only). SFR column left dead per the accepted decision.
- **Parity guard.** The whole computation is gated on `recentlyUsedMovementIds.size > 0` → first-ever blocks and any empty-recency path are byte-identical to the pre-ADR picker. Verified by a dedicated parity test.
- **History source** = new `accessory-history-queries.ts` → `getPreviousBlockAccessoryIdsByRole(supabase, userId)` returning `Map<role, Set<movementId>>` (accessory + power_potentiation kinds). Read-only, user-scoped, graceful-empty.
- **Plumbing.** `body_weight_loaded` → `DbMovement` → `toCatalogMovement.isLoadable` → `createBlock` catalog SELECT. Recency computed in `createBlock` **before** the prior-block archive and only when `archetype.accessoryProfile` is set; threaded per day-role into `assemblePrescriptionItems` and both picker filters. `createCustomBlock` (`catalog: undefined`) skips the picker → recency inert for custom blocks.
- **Tests** (+10): `movementValueNorm` levels; staple-persists / isolation-rotates / single-candidate-fallback; empty-recency parity; and three for the history query (grouping, role/prescription skips, no-prior-block empty). Full suite 2732 → 2742, `pnpm --filter @hta/web build` green.
- **Docs.** CP-2 row 40 + engine-live "Accessory variation across blocks" section, in-repo and workspace mirror.
