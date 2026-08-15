# ADR 0070 — Capture prescribed-vs-actual on `set_logs`

**Status:** Accepted — owner sign-off 2026-08-15 (user-data migration, per AGENTS.md)
**Date:** 2026-08-15
**Revision:** 3 — implemented. Rev 2 revised the design after independent review;
Rev 1 contained four factual errors and understated the snapshot-timing problem.
See *Review corrections*.
**Phase:** Production (engine data capture)
**Relates to:** DC-K4 (override-and-warn, never silent overrule), plan §6.8 (schema
discipline), plan §6.9 (single home for derived state), ADR 0013 (within-block volume
autoregulation), ADR 0018 (retired daily wellness check-in), migration 0003 (`set_logs`
+ `percent_of_tm`), migration 0037 (per-set skip + reason), migration 0097
(`client_log_id` idempotency)
**Touches:** `packages/db/src/schema/set-logs.ts`, `packages/db/drizzle/0128_*.sql`,
`packages/db/rollbacks/0128_*.down.sql`, `apps/web/src/lib/sessions/actions.ts`
(`addStrengthSet`, `fillSessionFromPlan`), `apps/web/src/components/session/SessionWorkArea.tsx`,
`apps/web/src/lib/sessions/fill-plan-sets.ts`, `docs/export-format.md`

## Context

The app records **what the user did**. It does not record **what it asked them to do**.

`set_logs` stores actuals only — `weight_kg`, `reps`, `duration_sec`, `distance_m`, `rpe`
— plus a `prescription_item_index` pointer into the plan. Deviations are captured
unevenly:

| Deviation | Recorded where | First-class? |
|---|---|---|
| Skip a set | `set_logs.skipped` + `skip_reason` (migration 0037) | Yes |
| Skip a session | `engine_override_events` type `skip` | Yes |
| Swap a movement | `engine_override_events` type `swap` | Yes |
| Accept / decline a banner | `prescription_modifications` | Yes (taper + recovery only) |
| **Lower the weight on a set you perform** | — | **No** |
| **Cut reps short on a set you perform** | — | **No** |

Dropping set 4 entirely is a fully audited DC-K4 override. Grinding set 4 at 10 kg under
programmed is indistinguishable from executing it as written.

### Motivating feature

Tactical Barbell prescribes cluster ranges ("3 sets minimum, up to 5, based on the day").
The engine already emits `setsMax`; `adapter.ts:195` materializes all 5 rows and flags
those beyond the minimum `optional: true`; the logger renders "Set 4 · optional" and the
skip menu carries a `fatigue` reason. **The mechanism exists.** What is missing is any
basis for the app to say whether *today* should be 3 or 5 — which requires knowing
whether the preceding sets landed as programmed. It cannot currently know that.

### Reconstruction from the linked prescription is unreliable — verified

1. **The index is nullable.** NULL for free-form and unlinked sessions
   (`set-logs.ts:52–56`). Narrow: those rows have no prescription by definition.
2. **The index is stored against a *transformed* array, not the stored one.** This is the
   severe one. `fillSessionFromPlan` builds `items` by piping the stored prescription
   through `applyAutoregVolumeScale` (ADR 0013) **and**
   `applyModificationsToPrescription` → `applyModificationsToItems`
   (`archetypes.ts:2144`), which **reorders** (main/tendon are bucketed and appended
   *after* accessories and cardio) and **drops** items (cardio on `cardioLoadScale <= 0`,
   strength on `strengthLoadScale <= 0`). `prescription_item_index` is the index into
   *that* array. Resolving it later against the stored prescription — or against the same
   pipeline under a *different* active modification — can silently address a different
   item.
3. **Main lifts store `percentTm`, not kg.** Replaying `percentTm × TM` after a TM bump,
   a −10% auto-deload, or a block retest re-seed yields a number that was never shown.

### The prescribed value is computed and then discarded

`fillSessionFromPlan` (~`actions.ts:1420–1451`) resolves target weight
(`percentTm × TM`, plate-rounded) and work (`resolvePrescriptionSetWork`) and writes them
into `weight_kg` / `reps` as the prefill for the **"Same as planned"** bulk action. The
user's first edit overwrites them. On the normal per-set path the prescribed value is
never persisted at all.

### Dead column

`set_logs.percent_of_tm numeric(5,2)` has existed since migration 0003 and has **never
been written** — verified: zero write sites across `apps/web`, `packages/`, and all of
`packages/db/drizzle`.

## Decision

Two typed columns for the numeric comparison, plus one JSONB blob for prescription
semantics, written at materialization and protected by a trigger.

| Column | Type | Meaning |
|---|---|---|
| `target_weight_kg` | `numeric(6,2)` | Prescribed load as displayed |
| `target_reps` | `smallint` | Prescribed reps as displayed |
| `prescribed` | `jsonb` | Slot semantics — see below |

`prescribed` carries what a scalar cannot express:

```jsonc
{
  "optional": true,           // required minimum vs discretionary set
  "setRange":  { "min": 3, "max": 5 },
  "repRange":  { "min": 8, "max": 10 },
  "targetRir": 2,             // or targetRpe
  "isAmrap": false,
  "percentTm": 75,            // 0–100, matching PrescriptionItem.percentTm
  "basis": "1RM",             // TB/GP/HYROX load off 1RM; 5/3/1 off TM
  "movementSlug": "back-squat",
  "setKind": "main"
}
```

**`duration_sec` / `distance_m` targets are deferred.** They are speculative for the
motivating feature and can be added by a later migration if a consumer appears.

**`percent_of_tm` stays unwritten.** Rev 1 proposed reviving it. Rejected: its unit is
ambiguous (app `percentTm` is 0–100; the engine's `percentOfTm` is 0–1) and its *name*
asserts a TM basis that is wrong for TB, Green Protocol and HYROX, which load off the
1RM (`adapter.ts:213` labels this via `mainLiftBasisLabel`). Recording percent and basis
inside `prescribed` avoids inheriting a misleading name. The column is left alone.

### Snapshot timing — the value must be the one displayed

Rev 1 proposed resolving targets server-side at insert. **That is not a snapshot.** The
server resolves against *current* TM / modification / prescription state, which can
differ from render time via offline outbox replay, a TM change, a taper apply-or-undo, a
mid-session movement swap, or delete-and-re-log. It would persist numbers that were never
on screen — worse than NULL, because it looks authoritative.

Therefore:

- **The client submits the displayed targets.** The UI already computes them
  (`MovementFocusView.tsx`); the outbox payload must carry them alongside actuals.
- **The server validates, never invents.** `addStrengthSet` bounds-checks the submitted
  targets against the linked prescription item it can see and rejects absurd values. On
  mismatch or absence it writes **NULL** and logs the set normally.
- **Target resolution never blocks logging.** A failure to resolve a target must never
  prevent the actual from being recorded.

### Immutability — enforced in the database, not by convention

Rev 1 claimed a "write-once contract". It is unenforceable by convention: RLS grants
`UPDATE` on `set_logs` table-wide (migration 0003), so any client can patch the snapshot
directly. `ON CONFLICT DO NOTHING` guards only repeated-`client_log_id` inserts, not
update or delete-then-reinsert.

A trigger rejects post-insert changes:

```sql
CREATE OR REPLACE FUNCTION public.set_logs_freeze_prescribed()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.target_weight_kg IS DISTINCT FROM OLD.target_weight_kg
     OR NEW.target_reps    IS DISTINCT FROM OLD.target_reps
     OR NEW.prescribed     IS DISTINCT FROM OLD.prescribed THEN
    RAISE EXCEPTION 'set_logs prescribed snapshot is immutable';
  END IF;
  RETURN NEW;
END $$;
```

Delete-and-re-log intentionally yields a **fresh** snapshot: it is a new set, logged
against whatever was prescribed then.

**Skipped sets keep their snapshot.** A skip is a deviation whose magnitude is exactly
"the whole prescribed set" — the most valuable row for Option A, not the least.

### Three write paths, one resolver (plan §6.9)

Rev 1 claimed two. There are three:

| Path | Behaviour |
|---|---|
| `fillSessionFromPlan` (`actions.ts:1323`) | Has prescription + TM in scope. Snapshots directly. |
| `addStrengthSet` (`actions.ts:145`) | Per-set action. Persists client-submitted, server-validated targets. |
| `hyrox/complete-action.ts` (:108/:201/:236) | Deletes and re-inserts all rows. **Explicitly writes NULL** — a HYROX race is not a prescribed-set comparison. |

All target derivation goes through one canonical resolver beside
`resolvePrescriptionSetWork`, consumed by the UI and both persisting paths, so display
and storage cannot drift.

### Schema discipline (plan §6.8)

> (a) What removes it?

Nothing. A prescribed value is an immutable historical fact.

> (b) Is it observable from outside the engine?

For `target_weight_kg` / `target_reps`: yes — they are the numbers printed on screen, and
belong in export and per-set history. For range/optionality/effort metadata: no, that is
engine-internal — hence JSONB.

Rev 1 argued for four top-level columns on performance grounds. That argument was
motivated and is withdrawn: no indexes were proposed, JSONB supports expression indexes,
and per-session rendering does not need indexed targets. The honest split is
**observable scalars top-level, engine semantics in JSONB** — which is what §6.8 asks for.

## Migration

`0128_set_logs_prescribed_snapshot.sql` — additive, nullable, idempotent, no backfill.
The existing `set_logs_has_some_work` CHECK constrains actuals only and is unaffected.
RLS policies are `EXISTS`-based via the parent session and are unaffected by added
columns (verified, migration 0003).

```sql
ALTER TABLE public.set_logs
  ADD COLUMN IF NOT EXISTS target_weight_kg numeric(6,2),
  ADD COLUMN IF NOT EXISTS target_reps      smallint,
  ADD COLUMN IF NOT EXISTS prescribed       jsonb;

ALTER TABLE public.set_logs
  ADD CONSTRAINT set_logs_target_nonneg
  CHECK ((target_weight_kg IS NULL OR target_weight_kg >= 0)
     AND (target_reps      IS NULL OR target_reps      >= 0));
```

Plus the `set_logs_freeze_prescribed` function and its `BEFORE UPDATE` trigger.

Rollback (`packages/db/rollbacks/0128_*.down.sql`) drops the trigger, function,
constraint and three columns. **It must not touch `percent_of_tm`** (migration 0003, not
ours to remove).

Rollback is **not** "safe" in the unqualified sense Rev 1 claimed: it discards snapshots
captured while live, and during a rolling deploy a still-running reader would break.
**The app rollback must precede the schema rollback.**

### No backfill

Historical rows cannot be reconstructed — the transform pipeline reorders and drops
items, and TMs have moved. A guessed backfill would manufacture false deviations and
poison the exact heuristic this feeds. Every consumer must degrade cleanly on NULL, and
Option A starts with zero history.

## Consequences

- **Option A gains its missing input** — "did the required sets land as programmed?" and
  "was this set required or discretionary?" become local column reads.
- **DC-K4 narrows, it does not close.** This ADR records the *data*. Surfacing the
  warning and defining the recommendation heuristic are follow-on work.
- **Export:** `/api/me/export` selects `MOVEMENT_JOIN = "*, movement:movements(...)"`, so
  the columns export automatically. That is additive and allowed under the v2 contract,
  but `docs/export-format.md` and a field-level contract test must be updated in the same
  PR. If exclusion is wanted it must be decided **before** the migration, since the
  wildcard exposes fields immediately.
- **Cost:** one resolver call per logged set; a slightly larger outbox payload.

## Tests

Covered by this change: resolver semantics and the "never record the UI fallback
as a prescription" rule; submitted-target validation including boundary and
fabricated values; DC-K4 deviation detection for reduced load and cut reps;
skip-as-whole-set-deviation; NULL degrading to "unknown" rather than "on target";
TB cluster required-vs-discretionary; and the `set_logs` column contract.

Deferred to integration/e2e (need a live Postgres or browser): the immutability
trigger rejecting an UPDATE, offline replay after a TM change end-to-end,
delete-and-re-log, mid-session movement swap, and the export payload shape.

## Review corrections (Rev 1 → Rev 2)

| Rev 1 claim | Verified reality |
|---|---|
| Server action is `logSet` at `actions.ts:184` | It is **`addStrengthSet`** at `actions.ts:145`; `logSet` is the client wrapper in `SessionWorkArea.tsx` |
| Two write sites | **Three** — `hyrox/complete-action.ts` also deletes/inserts `set_logs` |
| Index unstable because `autoregVolumeScale` mutates the array and `custom_accessory_order` reorders | Both wrong: `applyAutoregVolumeScale` returns a copy, and `custom_accessory_order` is **display-only** (`reorder-actions.ts:9–10`). The real cause is `applyModificationsToItems` reordering and dropping items |
| Export uses `select("*")` | Uses `MOVEMENT_JOIN`; conclusion unchanged |
| "Write-once contract" | Unenforceable — RLS grants table-wide UPDATE; needs a trigger |
| Four scalar columns suffice | Insufficient for Option A (optionality, ranges, RIR/RPE, AMRAP) and over-broad (duration/distance speculative) |
| Revive `percent_of_tm` | Rejected — ambiguous unit, misleading TM basis |
| Rollback "genuinely safe" | Requires app-before-schema ordering |

## Owner decisions (2026-08-15)

1. **Client-submitted targets:** accepted, with server validation
   (`validateSubmittedTarget`, ±15% tolerance) plus a movement/set-kind identity
   guard against stale indices. The server corroborates but never substitutes its
   own figure — a mismatch stores NULL.
2. **Export:** included immediately. `docs/export-format.md` documents the fields,
   the `basis` caveat, and that NULL means "unknown", never "on target".
3. **Deviation threshold:** quietly recorded for now. No `engine_override_events`
   row is emitted; revisit once real data exists.

## Implementation notes

- Migration `0128_set_logs_prescribed_snapshot.sql` + rollback. The immutability
  trigger allows `NULL → value` exactly once (so a later backfill of an
  unresolvable row can still land) but rejects `value → different` and
  `value → NULL`.
- Canonical resolver: `packages/domain/src/prescribed-snapshot.ts`
  (`resolvePrescribedSnapshot`, `validateSubmittedTarget`). Pure; consumed by the
  live logger, the bulk fill, and the per-set server action.
- `PrescribedSnapshot` is owned by `@hta/domain` and re-exported from `@hta/db`,
  so storage and derivation cannot drift.
- `SET_KIND_TO_LOG` moved to `apps/web/src/lib/sessions/set-kind.ts` and is shared
  by client and server; `power_potentiation` → `main` is many-to-one, so the
  identity guard would otherwise reject every potentiation set.
- The resolver deliberately does NOT record the logger's "last logged weight"
  fallback as a prescribed load — that is a UI convenience, and storing it would
  manufacture a false "on target" for every unanchored movement.
- `targetRir` / `targetRpe` are `{min,max}` ranges in the app schema, not scalars.
- The offline outbox serialises all FormData keys generically, so the displayed
  targets round-trip through an offline replay with no outbox change.
- HYROX (`hyrox/complete-action.ts`) leaves the columns NULL by omission — a race
  is not a prescribed-set comparison.

## Verification

- `pnpm -r typecheck` clean; `pnpm -r test` 4017 passing (+31 new).
- New: 20 resolver/validation cases (`packages/domain`), 11 DC-K4 deviation and
  TB-cluster cases (`apps/web`), and the `set_logs` materialisation column
  contract extended to the three new columns.
- `pnpm --filter @hta/db db:check` resolves 129 journal entries cleanly.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>
