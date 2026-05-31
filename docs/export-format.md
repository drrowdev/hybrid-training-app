# Data export format (`export-v1`)

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
| `schema`         | string  | Fixed format identifier: `"hybrid-training-app/export-v1"`.   |
| `format_version` | integer | Currently `1`. Bumped **only** on a breaking change.          |

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
  "schema": "hybrid-training-app/export-v1",
  "format_version": 1,
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
  "wellness": [],
  "limitations": [],
  "limitation_events": [],
  "priority_events": [],
  "memories": [],
  "chat_threads": [],
  "chat_messages": [],
  "bw_progress": [],
  "bw_progression_events": [],
  "prescription_modifications": [],
  "engine_override_events": [],
  "region_state": [],
  "custom_movements": [],

  "excluded": {
    "secrets": ["byoai_key_secrets", "strava_connections"],
    "derived": ["tm_suggestions", "region_state_history", "muscle_state_history",
                "bw_diagnostics_snapshots", "ai_call_logs"],
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
| `profile`                    | `profiles`                   | The user's profile/settings row (single object or `null`).                 |
| `training_maxes`             | `training_maxes`             | Current training max per main lift. Joined to `movement {slug, display_name}`. |
| `tm_history`                 | `tm_history`                 | Every training-max change over time. Joined to `movement`.                 |
| `training_blocks`            | `training_blocks`            | Program blocks (archetype, weeks, focus, status). Includes soft-deleted.   |
| `planned_sessions`           | `planned_sessions`           | The planned/prescribed sessions inside each block.                         |
| `sessions`                   | `sessions`                   | Logged training sessions (workouts).                                       |
| `session_movements`          | `session_movements`          | Off-plan / freestyle movements attached to a session. Joined to `movement`. |
| `set_logs`                   | `set_logs`                   | Individual logged sets (reps, weight, RPE, kind…). Joined to `movement`.   |
| `cardio_logs`                | `cardio_logs`                | Logged cardio sessions. Joined to `movement`.                              |
| `wellness`                   | `wellness`                   | Daily log rows — body weight (live), plus retained legacy wellness check-in fields (fatigue/soreness/motivation/notes) kept for history (see ADR 0018). |
| `limitations`                | `limitations`                | Active/historical injury or training limitations.                         |
| `limitation_events`          | `limitation_events`          | Event log of limitation changes.                                          |
| `priority_events`            | `priority_events`            | Races / priority events the user is training toward.                      |
| `memories`                   | `memories`                   | Long-term AI assistant memories the user authored or confirmed.           |
| `chat_threads`               | `chat_threads`               | In-app AI chat threads.                                                   |
| `chat_messages`              | `chat_messages`              | Messages within those threads.                                            |
| `bw_progress`                | `bw_progress`                | Bodyweight-movement progression state.                                    |
| `bw_progression_events`      | `bw_progression_events`      | Event log of bodyweight-progression changes.                              |
| `prescription_modifications` | `prescription_modifications` | User edits to engine-prescribed work.                                     |
| `engine_override_events`     | `engine_override_events`     | Logged overrides of engine decisions.                                     |
| `region_state`               | `region_state`               | Per-body-region load/recovery state.                                      |
| `custom_movements`           | `movements` (user-owned)     | The user's own custom movements (`user_id = <you>`). The global catalog is excluded. |

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

- `byoai_key_secrets` — encrypted BYOAI API-key ciphertext.
- `strava_connections` — Strava OAuth access/refresh tokens.

> `profile` does include an **opaque pointer** to the BYOAI secret store, which
> is not itself a secret and cannot be used to recover a key.

### Derived / recomputable (omitted for clarity)

These are regenerated by the engine from the included authored data, so they're
omitted to keep the export to first-class user data:

- `tm_suggestions`
- `region_state_history`
- `muscle_state_history`
- `bw_diagnostics_snapshots`
- `ai_call_logs`

### Not personal data

- The **global movement catalog** (`movements` where `user_id IS NULL`) is
  shared reference data, not personal data. Only the user's own custom
  movements are exported.

## Round-trip / import note

`export-v1` is designed to be re-importable: portable movement slugs, complete
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
