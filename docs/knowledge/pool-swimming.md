# Native pool swimming

Authority: [ADR 0079](../adr/0079-pool-swim-track-and-calendar.md) and
[DC-SW1 through DC-SW9](./hybrid-training-design-constraints.md#sw-native-pool-swimming-adr-0079-2026-09-05).
The standalone track is separate from primary programs. Filling an existing
program's cardio slots is the next slice, not part of this implementation.

## Evidence and its limits

The workouts are original compositions. The following sources support the
direction of the rules, not a copied workout catalogue or validated dosing model.

| Source | Supported interpretation | What it does not establish |
| --- | --- | --- |
| [Nikitakis et al., 2019](https://pmc.ncbi.nlm.nih.gov/articles/PMC6359490/) | A 200/400 m critical-speed field estimate can inform repeat-swim pacing in trained swimmers. | Universal maximal lactate steady state, adult-novice suitability, native-yard validation, or pace inferred from session elapsed time. The study involved trained boys and adolescents; some could not sustain continuous swimming at the estimate. |
| [Feijen et al., 2020](https://pmc.ncbi.nlm.nih.gov/articles/PMC6961642/) | Monitor individual swimming exposure and shoulder symptoms; volume associations differ across age groups. | A universally safe distance, ramp percentage, or individual injury probability. |
| [Tovin, 2006](https://pmc.ncbi.nlm.nih.gov/articles/PMC2953356/) | Shoulder mechanics and equipment such as paddles/kickboards matter when modifying training. | Quantitative equipment risk multipliers or an automatic injury diagnosis. |
| [Arsoniadis et al., 2022](https://pmc.ncbi.nlm.nih.gov/articles/PMC8953612/) | Recovery between resistance and swim sessions matters; both orders can improve performance. | One universally optimal order or separation interval for all swimmers. Existing platform constraints still apply. |
| [Swim England adult learning framework](https://www.swimming.org/learntoswim/swim-england-adult-learn-to-swim-awards/) | Water confidence and independent swimming precede stamina work. | A reason to require a maximal assessment from someone unable to swim a length. |
| [USMS beginner guidance](https://www.usms.org/fitness-and-training/articles-and-videos/articles/best-swimming-workouts-for-beginners) | Rest-based work and easy preparation/finish are useful organizing principles. | Exact beginner doses or progression coefficients for this app. No workout content is reproduced. |
| [USMS elbow guidance](https://www.usms.org/fitness-and-training/articles-and-videos/articles/what-to-know-about-swimmers-elbow) | Elbow exposure should not be omitted from structured swimming. | A numeric elbow risk ratio. |
| [USMS course measurement procedures](https://www.usms.org/volunteer-central/guide-to-local-operations/event-management/top-10-and-records-and-tabulation/pool-length-form-and-measurement-procedures) | Course identity matters for comparable pool performances. | A requirement that an app use rational storage; that is our engineering choice. |

## Measurement rules

The swimming modules in `packages/domain/src/` own native data, validation,
totals, formatting and compatibility projection. `packages/engine/src/swimming.ts`
owns deterministic prescriptions and next-week recommendations. Neither performs
I/O or depends on React or the database.

A course is a reduced positive rational `{ numerator, denominator, unit }`.
Lengths are integers and observations retain integer milliseconds. Converting
yards to metres for a generic summary does not change the native course. A
100/3 m pool is not a 33.33 m pool. The database's kilometre and second fields
are rounded compatibility summaries, never a source for swimming benchmarks.
Custom pool entry accepts decimal or fractional lengths, including `33 1/3`,
through `swim-pool-input.ts`; the stored rational is not exposed as separate
numerator/denominator controls.

The optional paired assessment requires exact 200 and 400 native units under
matching conditions. Its estimate in milliseconds per 100 native units is
`(t400 - t200) / 2`. Original observations and calculation version remain
available. A yard estimate is mathematically valid but lacks equivalent
physiological evidence. Unverified swimming uses effort and rest. Total elapsed
time, which includes rest, is never automatically converted into a pace update.

## Prescription and adaptation rules

The generator consumes explicit dated slot intents. Empty or lower-frequency
weeks produce less work, not overdue work. The standalone calendar supplies
those intents; a later primary-cardio adapter can supply different slots without
changing the swim model.

Whole-length workouts preserve easy preparation, key main work and an easy
finish. Time without verified pace is a stopping budget. It does not claim the
distance can be completed at an invented speed. A budget that cannot support a
valid session returns a conflict.
Each slot retains its own time budget when future work is reissued, including
slots that could not fit a workout. A plan-wide default must not replace that
slot's accepted limit.

Future weeks are provisional. Recommendations use settled issued targets and
actual work, with explicit effort missingness and compatible course data.
Accept/reject/override decisions retain consulted inputs and rule versions.
Started targets are frozen; accepting a new benchmark cannot rewrite them.
Missed work never increases a later session.

## Poolside controls

`swim-workout-progress.ts` groups sets from their structural identities while
retaining the existing per-repeat progress IDs. The workout shows each set once,
with mark-next, undo and optional individual-repeat controls. Split times use
optional length/time rows; partial drafts keep what the swimmer typed. Completed
results show native distance alongside lengths and elapsed time. Failed form
submissions retain the entered values.

## Heuristics and revision policy

Exact starting doses, rest durations, completion cutoffs and progression caps are
**versioned engineering heuristics**, not research-derived safe limits. Their
authoritative values live with the generator version, rather than being repeated
in the UI. Changing them requires a new version and updated deterministic
fixtures, not rewriting issued workout history.

For an opt-in non-production evaluation, compare matched-course completion,
reported effort, next-week skipped sessions and accepted-versus-rejected changes
over successive weeks. Revisit a dose or progression rule if more than 20% of
accepted increases are followed by under-80% completion or effort at least 8/10
over 20 evaluable decisions. Revisit the starting-dose/rest rule if more than 20%
of first weeks fall below 80% completion over 20 evaluable first weeks. Missing
effort is missing data, not a favorable outcome. These thresholds are themselves
engineering review triggers, not injury prediction or clinical validation.
Any reported pain or new limitation is handled by the existing limitations
workflow independently of these aggregate review thresholds.

Regional exposure uses existing primary/secondary workload weights. Stroke and
equipment decide which regions participate; no additional equipment multiplier
is introduced. Review attribution if repeated same-condition logs and the user's
reported restrictions disagree. Generic historical swim rows keep the old
attribution because their native conditions are unknown.

## Persistence, rollout and privacy

Swim plans/workouts do not create a primary program, block or season. Starting
links an ordinary session; actual work has one structured cardio summary.
Completion and its receipt share a transaction. Native results cannot coexist
with a contradictory generic cardio addition. The existing durable offline
outbox owns replay.

Pausing removes unstarted future exposure. Resuming requires reviewed new dates,
not catch-up. Started work can finish after pause/archive and still counts as
actual load. Session trash retains its target link; account deletion cascades.
Export includes both swim tables and structured cardio results. No swim or
limitation payload belongs in telemetry.

New setup is disabled until explicitly enabled and the additive schema is
available. Disabling setup must not strand existing history or queued finishes.
The migration is not authorization to alter production. Rollback must refuse to
remove populated swim storage.

Release proof requires genuine two-user database and mobile/offline runs on a
confirmed dedicated non-production environment. Pure and mocked tests do not
substitute for those acceptance runs.

`pnpm test:coverage` uses the existing Vitest runner for the complete domain and
engine packages, enforcing the repository's 80% minimum for lines, statements,
functions and branches. Coverage does not substitute for database acceptance.

### Dedicated acceptance environment

Keep credentials outside the repository and load them only into the test
process. The migration runner uses `DATABASE_URL`; the test web app uses
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` and
`POOL_SWIMMING_ENABLED=true`.

RPC acceptance requires `SWIM_RPC_TEST_NONPRODUCTION=true`,
`SWIM_TEST_PROJECT_REF`, `SMOKE_SUPABASE_URL`, `SMOKE_SUPABASE_ANON_KEY` and
`SMOKE_SUPABASE_SERVICE_ROLE_KEY`. Mobile acceptance requires
`E2E_SWIM_NONPROD=1`, the same `SWIM_TEST_PROJECT_REF`, explicit
`E2E_SUPABASE_URL`, `E2E_SUPABASE_ANON_KEY`,
`E2E_SUPABASE_SERVICE_ROLE_KEY`, `E2E_REQUIRE_SEED=1` and
`PLAYWRIGHT_BASE_URL`. The owner can supply one public client key and one admin key;
map those into the runner-specific variables in memory, not duplicate files.
The preflight checks reject missing/template values and URLs that do not match
the acknowledged project. Do not use the generic E2E fixture's app-credential
fallback for swimming.

A separate, narrower mode exists for a disposable, synthetic, **loopback-only**
Postgres/Auth/REST stack (for example a local Supabase-compatible stack run on
a CI/sandbox runner, never a hosted project): set `SWIM_RPC_TEST_LOCAL=true`
(RPC) or `E2E_SWIM_LOCAL=1` (Playwright) alongside
`SWIM_TEST_PROJECT_REF=local` as an explicit acknowledgement. In this mode the
target URL must use `http:` and a loopback host (`127.0.0.1`, `localhost` or
`[::1]`) with no path, query, fragment or embedded credentials; the existing
hosted-ref/URL guard is otherwise unchanged and still applies whenever this
local flag is absent. This never accepts arbitrary URLs and never silently
falls back — both the local flag and `SWIM_TEST_PROJECT_REF=local` must be
set together, or the existing hosted guard runs as before.

Before applying any migration, independently pin `DATABASE_URL` to the same
acknowledged project: the direct database hostname, or the project-qualified
username on an official pooler hostname, must identify that project. A valid
test API URL alone does not make a database connection safe. Never print the
connection string or keys.

The dedicated database needs the existing migrations and official movement
catalog, including `swim-easy` and `swim-intervals`, before migration 0145's
acceptance run. Applying 0145 requires the privileges to create its restricted
writer role. The private session-source trigger keeps table-owner execution
solely to invalidate revisions during service-role purges; it is not callable
by app or service roles. Since purge has already cleared the session links,
that trigger conservatively invalidates swim plans belonging to affected
session owners, including their archived plans.

Drizzle cannot describe a column-specific composite `SET NULL` action.
Migration 0145's `ON DELETE SET NULL (session_id)` is authoritative: review any
future generated migration that touches this foreign key rather than replacing
it with a whole-key null or `NO ACTION`.
