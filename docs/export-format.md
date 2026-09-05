# Data export format (`export-v2`)

The app exposes a one-click data export at **Settings → Account → "Export my
data (JSON)"**, served by `GET /api/me/export`
(`apps/web/src/app/api/me/export/route.ts`). This document is the contract for
that file: what it contains, what it deliberately omits, and how it evolves.

It satisfies the GDPR Article 15 (right of access) and Article 20 (right to
data portability) obligations, and is the canonical schema any future **import**
feature must target.

## Identity & versioning

Every export carries two identifiers at the top level:

| Field            | Type    | Meaning                                                        |
| ---------------- | ------- | ------------------------------------------------------------- |
| `schema`         | string  | Fixed format identifier: `"hybrid-training-app/export-v2"`.   |
| `format_version` | integer | Currently `2`. Bumped **only** on a breaking change.          |

### Stability contract

Within a given `format_version`, changes are **additive only**:

- New top-level sections (tables) **may** appear over time.
- New fields **may** appear inside existing rows (the export uses `select("*")`,
  so new DB columns surface automatically).
- Existing sections and existing fields are **never renamed or removed**.

A breaking change — renaming/removing a section or field, or changing the
meaning or type of an existing field — requires incrementing `format_version`.
Consumers should therefore **ignore unknown keys** and tolerate new sections.

This contract is pinned by
`apps/web/src/app/api/me/export/__tests__/route.test.ts`, which fails CI if a
covered table is dropped or an excluded (secret/derived) table leaks in.

## Top-level shape

```jsonc
{
  "schema": "hybrid-training-app/export-v2",
  "format_version": 2,
  "exported_at": "2026-05-31T12:00:00.000Z",
  "user": { "id": "...", "email": "...", "created_at": "..." },

  "profile": { /* one row, or null */ },

  // ── arrays of rows, RLS-scoped to the requesting user ──
  "training_maxes": [],
  "tm_history": [],
  "training_blocks": [],
  "planned_sessions": [],
  "sessions": [],
  "session_movements": [],
  "set_logs": [],
  "cardio_logs": [],
  "swimming_schema_available": true,
  "swim_plans": [],
  "swim_workouts": [],
  "wellness": [],
  "limitations": [],
  "limitation_events": [],
  "priority_events": [],
  "bw_progress": [],
  "bw_progression_events": [],
  "prescription_modifications": [],
  "engine_override_events": [],
  "region_state": [],
  "custom_movements": [],

  "excluded": {
    "secrets": ["strava_connections"],
    "derived": ["tm_suggestions", "region_state_history", "muscle_state_history",
                "bw_diagnostics_snapshots"],
    "note": "…"
  },
  "notes": "…"
}
```

## Sections

Every array is **RLS-scoped**: the route uses the user-scoped Supabase client,
so each query returns only the requesting user's own rows — never another
user's, never the global catalog.

| Section                      | Source table                 | What it is                                                                 |
| ---------------------------- | ---------------------------- | -------------------------------------------------------------------------- |
| `profile`                    | `profiles`                   | The user's profile/settings row (single object or `null`). Its legacy notes column is exported as `training_notes`. |
| `training_maxes`             | `training_maxes`             | Current training max per main lift. Joined to `movement {slug, display_name}`. |
| `tm_history`                 | `tm_history`                 | Every training-max change over time. Joined to `movement`.                 |
| `training_blocks`            | `training_blocks`            | Program blocks (archetype, weeks, focus, status). Includes soft-deleted.   |
| `planned_sessions`           | `planned_sessions`           | The planned/prescribed sessions inside each block.                         |
| `sessions`                   | `sessions`                   | Logged training sessions (workouts).                                       |
| `session_movements`          | `session_movements`          | Off-plan / freestyle movements attached to a session. Joined to `movement`. |
| `set_logs`                   | `set_logs`                   | Individual logged sets (reps, weight, RPE, kind…). Joined to `movement`. Also carries the ADR 0070 prescribed snapshot — see below. |
| `cardio_logs`                | `cardio_logs`                | Logged cardio sessions. Joined to `movement`.                              |
| `swim_plans`                 | `swim_plans`                 | Standalone pool setup, lifecycle, accepted/rejected decisions and their input snapshots. |
| `swim_workouts`              | `swim_workouts`              | Dated pool workouts, original and issued targets, revisions and ordinary-session links. |
| `wellness`                   | `wellness`                   | Daily log rows — body weight (live), plus retained legacy wellness check-in fields (fatigue/soreness/motivation/notes) kept for history (see ADR 0018). |
| `limitations`                | `limitations`                | Active/historical injury or training limitations.                         |
| `limitation_events`          | `limitation_events`          | Event log of limitation changes.                                          |
| `priority_events`            | `priority_events`            | Races / priority events the user is training toward.                      |
| `bw_progress`                | `bw_progress`                | Bodyweight-movement progression state.                                    |
| `bw_progression_events`      | `bw_progression_events`      | Event log of bodyweight-progression changes.                              |
| `prescription_modifications` | `prescription_modifications` | User edits to engine-prescribed work.                                     |
| `engine_override_events`     | `engine_override_events`     | Logged overrides of engine decisions.                                     |
| `region_state`               | `region_state`               | Per-body-region load/recovery state.                                      |
| `custom_movements`           | `movements` (user-owned)     | The user's own custom movements (`user_id = <you>`). The global catalog is excluded. |

### Native pool swimming (ADR 0079)

The swim sections include retained paused, finished and archived history,
regardless of whether new swimming setup is enabled. `swimming_schema_available`
is false on an app-first deployment before the additive migration, where both
new table sections are empty. A failed read of installed swim storage fails the
export instead of silently omitting history.

`cardio_logs.swim_result` retains exact native course, whole lengths,
millisecond timings and conditions. The generic kilometre/second summary is a
rounded projection, not the source for reconstructing pool distance or pace.

### Prescribed vs actual on `set_logs` (ADR 0070)

Each set row records **what you did** (`weight_kg`, `reps`, `duration_sec`,
`distance_m`, `rpe`) and, since migration 0128, **what the app asked for**:

| Field | Meaning |
|---|---|
| `target_weight_kg` | Prescribed load as displayed when the set was logged |
| `target_reps`      | Prescribed reps as displayed when the set was logged |
| `prescribed`       | Slot semantics — `optional`, `setRange`, `repRange`, `targetRir` / `targetRpe`, `isAmrap`, `percentTm`, `basis` |

`prescribed.percentTm` is a **0–100** percentage, and `prescribed.basis` says what
it is a percentage *of*: `"TM"` (a training max, e.g. 5/3/1) or `"1RM"` (e.g.
Tactical Barbell, Green Protocol, HYROX). Comparing a percentage across programs
without reading `basis` will misinterpret the load.

**`null` means "unknown", never "on target".** Targets are absent for free-form
logs, off-plan sets, HYROX race rows, sets whose submitted target could not be
corroborated against the plan, and every set logged before migration 0128 —
historical rows were not backfilled, because the prescriptions they referenced
have since been transformed and the training maxes have moved. Any analysis over
these fields must skip `null` rather than treat it as a match.

Skipped sets keep their snapshot: the deviation is the whole prescribed set.

### Movement references

Rows that reference a movement by internal UUID (`training_maxes`, `tm_history`,
`session_movements`, `set_logs`, `cardio_logs`) embed a
`movement: { slug, display_name }` object. The **slug** is the portable,
stable identifier — prefer it over the opaque `movement_id` when interpreting or
re-importing an export.

## What's intentionally excluded

The `excluded` section in the payload mirrors this list so the file is
self-describing.

### Secrets (never exported)

Exporting these would defeat at-rest encryption, so they never leave their
subsystem:

- `strava_connections` — dead Strava OAuth access/refresh tokens. The Strava
  integration was removed (Strava now charges for API access); the table is
  orphaned but still present pending an owner-approved drop migration, so it
  remains declared here until that lands.

### Derived / recomputable (omitted for clarity)

These are regenerated by the engine from the included authored data, so they're
omitted to keep the export to first-class user data:

- `tm_suggestions`
- `region_state_history`
- `muscle_state_history`
- `bw_diagnostics_snapshots`

### Not personal data

- The **global movement catalog** (`movements` where `user_id IS NULL`) is
  shared reference data, not personal data. Only the user's own custom
  movements are exported.

## Round-trip / import note

`export-v2` is designed to be re-importable: portable movement slugs, complete
authored history, and a stable additive contract. A concrete import feature is
**parked** (see the data-portability plan) until there's a real third-party
fixture to target, but any import path must treat this format as its canonical
schema.

## When you change the export

1. **Adding a table or field?** No version bump. Add it to the route, add it to
   `REQUIRED_TABLES` / `REQUIRED_SECTIONS` in the contract test, and add a row
   to the table above.
2. **Renaming/removing/retyping?** That's breaking — bump `format_version`,
   update this doc's contract section, and update the test.
3. **Adding a new user-owned table to the schema?** Decide whether it's authored
   (→ export it), derived (→ add to `excluded.derived`), or secret (→ add to
   `excluded.secrets`), and reflect the choice in both the route and this doc.
