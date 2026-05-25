# Import / Export — design plan

Status: planning · not yet implemented
Last updated: 2026-05-25

## TL;DR

Two distinct features that share infrastructure but solve different problems:

- **Export**: deterministic snapshot of the user's data in JSON + (optional) per-table CSV. GDPR-style "give me everything", plus a few targeted exports (session log only, bodyweight history only) for quick spreadsheet work.
- **Import**: tiered into three independent surfaces, each with its own UX and engineering shape:
  1. **Self re-import** — round-trip of our own export format. No AI.
  2. **Third-party app adapters** — Strava / Hevy / Strong / Garmin / etc. Deterministic ETL per source. No AI.
  3. **Unstructured import** — text notes, screenshots, free-form spreadsheets. **This is where an LLM earns its place** — extract → preview → human-edit → commit. Never silent.

Phasing: ship Export first, then self-import, then one third-party adapter (Strava deepening since we already have the OAuth wired), then ramp into AI-assisted import only after the structured paths are battle-tested.

---

## Export

### What's in scope

Everything the user owns. The list, by table:

| Table | What | Format consideration |
|---|---|---|
| `sessions` | Completed session metadata | core |
| `set_logs` | Every logged set | core, large for active users |
| `cardio_blocks` | Z2/VO2/interval sessions | core |
| `planned_sessions` | Block plans incl. unmet | nice-to-have for "what I planned vs did" |
| `training_blocks` | Block metadata | core |
| `training_maxes` + history | TM evolution | core |
| `bodyweight_history` | Daily bodyweight | core |
| `bw_progress` + `bw_progression_events` | Per-family node + advances | BW users only |
| `wellness_check_ins` | Fatigue/soreness | core |
| `limitations` | Injuries / blocked regions | core |
| `priority_events` | Races / comps | core |
| `profiles` | Preferences (units, format, timezone, equipment) | core |
| `bw_diagnostics_snapshots` | Phase 6 audit log | optional |

### Format

**Primary: JSON.** One file, single object keyed by table name, with a top-level header:

```json
{
  "schema_version": 1,
  "exported_at": "2026-05-25T13:37:00Z",
  "user": { "id": "uuid", "display_name": "drrowdev" },
  "tables": {
    "sessions": [ ... ],
    "set_logs": [ ... ],
    ...
  },
  "catalog_refs": {
    "movements": {
      "front-squat": { "slug": "front-squat", "display_name": "Front Squat", "pattern": "squat" },
      ...
    }
  }
}
```

`catalog_refs.movements` is keyed by every `movement_slug` that appears anywhere in the rows. Embedding the catalog snippet makes the export self-describing — third-party tooling doesn't need to ask us what `rdl-bb` means.

**Optional: CSV bundle.** Same data, per-table CSVs, zipped. Useful for users who just want to drop everything into Excel / Sheets. Not the source of truth — JSON wins on round-trip fidelity.

### UI

Single settings page: `/app/settings/data` (new). Three buttons:

- **Full export (JSON)** — everything. Generates and downloads in one shot for typical users. For power users with 1000+ sessions, kick to a background job + email/in-app notification when ready.
- **Session log (CSV)** — flat table of every set with date / movement / weight / reps / RPE / RIR / etc. Spreadsheet-friendly.
- **Bodyweight history (CSV)** — date + kg.

### Engineering shape

- New server action `exportUserData(format: 'json' | 'csv')` in `lib/data/export-actions.ts`.
- Query helper `gatherUserExport(userId)` returns the full object — pure-ish, easy to test.
- Synchronous path for typical exports (< 5MB JSON); async path with a `pending_exports` row + polling for large ones. Defer the async path until someone actually has the data volume to justify it.
- Streamed response so we don't double-buffer on the server.
- Stripping: never include service-role-only data; explicitly drop `auth.*` references; embed display name not email by default (user can opt-in to PII).

### Acceptance

- A user with 6 months of data can hit "Full export", get a JSON file in under 10s, and the file round-trips cleanly into self-import (Phase 2).
- A user can open the CSV in Excel/Sheets without fiddling with delimiters / encoding (UTF-8 BOM if needed for Excel).
- Schema version stamped so future format changes are migratable.

---

## Import

### Tier 1 — Self re-import

**The "I exported, now restore me" case.** GDPR data portability, account migration between environments, accidental data deletion recovery.

- Upload the JSON file from Export.
- Server action validates `schema_version`, runs migration if needed, then upserts row-by-row keyed on UUIDs.
- **Idempotent**: importing the same file twice is a no-op (UUIDs match, content matches).
- **Conflict policy**: when a UUID exists but the row content differs, surface a 3-way diff and let the user pick "keep mine / use imported / merge". For the MVP, default to "keep mine" (safer).
- Preview screen before commit: "Will add 247 sessions, 31 planned blocks, 1,809 set logs. Existing data untouched."

No AI needed. The format is ours, the schema is known.

**Engineering**: `importNativeJson(file)` server action with a `dry_run: true` flag for the preview step.

### Tier 2 — Third-party app adapters

Each adapter is a dedicated ETL: parse → normalise → match to our schema → commit.

Proposed adapters, ranked by likely user demand:

| Source | Format | Notes |
|---|---|---|
| **Strava** | API (OAuth already wired) | Cardio sessions: GPX/TCX → `cardio_blocks`. We have the connection; deepen the import. |
| **Hevy** | CSV export | Set logs. Reasonable export quality. |
| **Strong** | CSV export | Set logs. Quirky column headers, well-documented. |
| **Garmin Connect** | TCX / FIT | Cardio + HR. Overlap with Strava for most users. |
| **MyFitnessPal** | — | NOT scoped here — body comp / nutrition is a separate concern. |
| **Polar Flow / Suunto** | TCX | Niche. |

Each adapter lives in `lib/import/adapters/<source>.ts`. Shape:

```ts
type AdapterResult = {
  sessions: NormalizedSession[];
  unmappedMovements: { sourceName: string; suggestedSlug: string | null; reason: string }[];
  parseWarnings: { row: number; message: string }[];
};
```

**Movement matching is the hard part.** Hevy says `"Bench Press (Barbell)"`, we have `"bench-press-bb"`. The adapter's job is:

1. **Exact-slug normalization** — lowercase, strip parens, kebab-case → first-pass lookup against our catalog.
2. **Fuzzy match** (Levenshtein, threshold 0.85) against catalog `display_name` and `slug`. Top match if confident.
3. **Equipment-aware tiebreak** — `"Bench Press (Barbell)"` should prefer `bench-press-bb` over `bench-press-db`.
4. **Unmapped surface** — anything left over goes to a "review unmapped movements" screen where the user picks the catalog slug manually. Decisions persist as `user_movement_aliases` so subsequent imports auto-resolve.

No AI in this tier. Deterministic + fast + auditable.

**Engineering**: `lib/import/adapters/<source>.ts` exports `parse(file: File): Promise<AdapterResult>`. A shared `commitNormalized(result, options)` writes the rows + invokes the alias-resolution loop.

### Tier 3 — Unstructured import (this is where AI lives)

Triggers:

- User pastes free text: `"Mon 5/19: squat 5x5@100, bench 3x8@60, OHP 5x5@40"`
- User uploads a photo of a notebook page
- User pastes a coach's idiosyncratic spreadsheet
- PDF of a periodisation block from a strength coach

**Why AI here, not in Tier 2?** Tier 2 inputs are structured — column headers, known shapes, well-defined types. A regex or schema-driven parser is faster, cheaper, and more auditable. Tier 3 inputs are open-set text/image where pattern variance is unbounded — there's no fixed schema to write a parser against. LLMs are good at *interpretation under uncertainty*, which is exactly what Tier 3 is.

**Workflow**:

1. User uploads or pastes.
2. Backend sends the content to an LLM with a structured-output schema: array of `{date, movement_text, sets, reps, weight, weight_unit, rpe?, rir?, notes?}`.
3. LLM returns rows + a `confidence` (0–1) per row + a `reasoning` string per row.
4. Each row gets a second pass for movement resolution: fuzzy-match against catalog (same as Tier 2). The LLM proposes a slug; we verify against the catalog and present the choice.
5. **Preview screen**: every extracted row is rendered as an editable form. Low-confidence rows are highlighted. User edits / accepts / discards.
6. Commit on confirmation. **Never silent commit.**

**Failure modes to design against**:

- Hallucinated movements ("Cuban press" when the input said "curl" — LLMs sometimes fill in vibes). Mitigated by catalog-anchored verification.
- Date ambiguity (5/19 = May 19 in US, 5 Sep in EU). Surface in UI, ask user.
- Weight unit guessing (200 = lbs or kg?). User profile gives the prior, but flag anything inconsistent (e.g. squat suddenly 4× higher than user's TM).
- Multi-set notation variants: `5x5@100`, `5 sets x 5 reps @ 100kg`, `5/5/5/5/5 @100`, `5@100, 5@100, 5@100, 5@100, 5@100`. Schema-prompt covers common shapes.
- Image OCR errors. Use a vision-capable model; surface raw OCR text in the preview so user can spot wrong digits.

**Engineering**:

- New table `import_drafts` (id, user_id, kind, raw_input, ai_extracted_rows jsonb, status enum, created_at). Drafts persist so user can come back and finish later.
- LLM call lives in `lib/import/ai/extract.ts` with a strict output schema (Zod-validated).
- Catalog-resolution loop reuses Tier 2's `resolveMovement(text)`.
- Confidence threshold for auto-suggest vs "needs review": 0.8.

**Cost / latency awareness**: a 100-row block is ~30–60s of LLM time at current models. Show progress, let user navigate away and come back via the draft.

---

## Phasing

| Phase | Ships | Effort | Notes |
|---|---|---|---|
| **P1** | Export (JSON + 2 CSV) | small | Foundation for everything else; testable in isolation. |
| **P2** | Self re-import (JSON) | small | Round-trip validates the export format. |
| **P3** | Strava deepening | medium | Already have OAuth; pull historic GPX/TCX into `cardio_blocks`. |
| **P4** | Hevy + Strong CSV adapters | medium | Two of the most common requests. Establishes the adapter pattern. |
| **P5** | Garmin TCX/FIT | medium-large | Defer if Strava is good enough for most users. |
| **P6** | AI unstructured import — text | large | Behind a feature flag for early users. |
| **P7** | AI unstructured import — image / PDF | large | Vision model. Higher cost; gated behind text first. |

Each phase is independently shippable and visible.

---

## Cross-cutting concerns

- **Brand purity (DC-Q6)**: adapter source names (Strava, Hevy, etc.) are NOT external strength program names — they're integrations. Fine to use literally. The grep-guard is for methodology names (`wendler`, `5/3/1`, etc.).
- **Privacy / PII**: exports should default to NOT including email; user can opt-in to "include account email" if they're transferring to a new env.
- **Schema versioning**: every export carries `schema_version: 1`. Self-import migrates older versions forward.
- **Idempotency**: every importable item should have a stable client-supplied UUID. Re-running the same import = no-op.
- **Movement aliases as a learning system**: every manual mapping in Tier 2/3 trains future imports for that user (and potentially across users with anonymized aggregation, opt-in).
- **Audit trail**: every successful import writes a row in `import_runs` (id, user_id, source, summary, committed_at) so users can find what came from where.

---

## Open questions before P1 starts

1. **Async export threshold**: at what data size do we kick to a background job? Suggest: sync for < 5MB raw JSON, async beyond. Most users will never hit async.
2. **CSV scope**: just sessions + bodyweight in P1, or include cardio? Suggest: include cardio. It's a single table query.
3. **Bulk delete after export**: should "Full export" offer a "delete my account" button on success (GDPR right-to-erasure)? Suggest: separate flow, not bundled with export. Less risky.
4. **Tier 3 AI provider**: OpenAI / Anthropic / local? Initial: whichever is already wired in the cloud-agent path. If none, OpenAI for structured outputs.
5. **Movement-alias scope**: per-user, or shared globally? Suggest: per-user, with a separate proposal flow to promote to global.

---

## Cross-references

- Bodyweight export shape: `packages/db/src/schema/bw-progress.ts`, `bw-progression-events.ts`, `bw-diagnostics-snapshots.ts`
- Session log shape: `packages/db/src/schema/sessions.ts`, `set-logs.ts`
- Strava existing integration: `apps/web/src/lib/strava/*`
- Movement catalog: `packages/db/seeds/movements-part{1,2}.ts`
- Equipment-aware accessory filter (similar fuzzy-match pattern reusable for Tier 2): `apps/web/src/lib/planner/equipment-requirements.ts`

---

## Next step

Confirm the scope + answer the open questions. Then P1 starts (export, ~1 PR).
