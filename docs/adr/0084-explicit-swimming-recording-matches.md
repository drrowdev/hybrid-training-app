# ADR 0084: Explicit swimming recording matches

**Status:** Approved for isolated development and synthetic testing, 2026-09-12.
No existing-account migration, live data access, provider operation or deployment.

## Decision

The owner explicitly approved choosing which planned workout an existing
recording belongs to. The earlier account-owned import/link storage approval
covers this reversible development implementation. This is not manual result
entry, automatic matching or evidence that every planned set was completed.

From an imported recording, choose a workout date, then explicitly choose a
workout. Date is a user-supplied search filter, never a matching heuristic.
No candidate is preselected. The selection carries the displayed workout
revision and current match identity; changed recordings, workouts or matches
require a fresh review. Only pool recordings can attach to pool workouts.

A recording may have one current workout association; several distinct
recordings may attach to a workout without being combined into one result.
Changing or removing an association appends an event. Removal remains available
when new matching is disabled. Corrected activity evidence does not silently
replace the version previously matched. Its new version requires explicit
matching; the prior recording and all prior match events remain available.

Matching does not start, skip or complete a workout, alter its prescription,
write a native result, calibrate pace, add shared load or change progression.
Each match snapshots the selected issued prescription, title, date and revision.
Later legitimate workout edits cannot rewrite what was matched. A match is
an association, not the existing session link that establishes started work.

## Relational fields and ownership

Migration0153 adds `swim_import_matches`:

| Field | Why observable / relational | Removal |
| --- | --- | --- |
| id | Client request identity and durable retry receipt. | Account deletion. |
| user_id | Ownership, RLS and account deletion. | Account deletion. |
| activity_id, import_id | Stable activity group and exact immutable evidence version; composite owned FK. | Account deletion. |
| workout_id | Explicit optional association; composite owned FK. Null records removal. | Account deletion. |
| revision | Serializes current association and retained changes per owned activity. | Account deletion. |
| created_at | Visible/exported association history. | Account deletion. |
| metadata JSONB | Previous match identity and immutable selected-workout snapshot. | Account deletion. |

Supporting unique constraints on imports and workouts make both FKs enforce the
same owner. Neither FK cascades ordinary parent deletion; both are deferred so
deleting the Auth account can cascade all its owned rows atomically. No backfill.

Owner RLS protects the new table. Authenticated clients may read but cannot
write it directly. The existing non-login, non-bypass `swim_writer` receives
only the additional import SELECT and match SELECT/INSERT needed by the
authenticated, identity-checked RPC. No new role or service-key authority.
Inherited public/anonymous/authenticated/service grants are narrowed explicitly.

The RPC shares the import receiver's owner lock, validates both ownership links
and optimistic guards, and snapshots the workout under a row lock. An identical
retry reuses its receipt only while it is still current; a later event makes
that old retry stale. A reused request ID with different input is rejected.
The invoker-security `swim_current_import_matches` view is the sole current
projection, including removal events so earlier matches cannot reappear.

## Rollout, export and down

New matching requires default-off `SWIM_IMPORT_MATCHING_ENABLED=true` and the
authenticated readiness probe. Existing match history and removal do not depend
on that flag. Export includes every audit page and immutable snapshot, not just
current matches. Import browsing is paged; matched recording links are visible
on the workout without changing its completion state.

The down locks the new table with bounded waits and refuses any retained event,
including a removal. Empty down drops only this view/RPC/probe/table, supporting
constraints and the newly granted import SELECT. It never erases data to make
rollback possible. Disable matching and retain the schema if history exists.
The source has154 migrations; historical150-only runtime profiles still refuse
it. Existing-review and production migration/deployment require separate approval.

## Acceptance

DC-SW1/SW4/SW5/SW8: focused action/storage/export tests and the existing
network-blocked React browser runner exercise deliberate selection, invalidated
choices, failed-save retention, duplicate-submit guards, retry identity and
removal while disabled at375/1280. The existing disposable Postgres runner
covers both ownership links, real RLS/grants, correction/replay/concurrency,
immutable snapshots, unchanged training rows, removal history, used-down refusal
and account cleanup. Native Auth/server-action/multi-browser and actual owner
or watch acceptance remain separate release gates.
