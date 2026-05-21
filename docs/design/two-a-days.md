# Feature design: Two-a-day sessions

**Status:** Pre-build — design captured, build scoped, scheduled as next major feature.
**Owner trigger:** User preference (`profiles.allows_two_a_days`) collected during onboarding since `fba1f38`.
**Last updated:** 2026-05-21

---

## 1. Why

Two-a-day sessions (AM strength + PM cardio, or the reverse) are a defining hybrid-training pattern. The research stack already encodes the science:

- **DC-D1** (research-new §1.3, Robineau 2016 HIGH) — modality separation thresholds: `<3h apart = same-session interference`; `6h+ = substantial mTORC1 recovery`; `24h+ ≈ separate-day gold standard`.
- **DC-D2** (research-new §1.3, Coffey & Hawley 2017 HIGH) — same-day ordering: strength first when strength is the day's emphasis; endurance first only if the endurance is short Z2 ≤30 min or endurance is the emphasis with strength at maintenance.
- **DC-L1–L3** — modality interference hierarchy and duration penalties.

The single-session-per-day model fights this science: it forces a hybrid user to either skip cardio in a strength block, or do cardio back-to-back with the lift (worst-case AMPK / mTORC1 interference). Two-a-day support lets the engine honour the 6h gap by construction.

## 2. Scope of this prep

**This document captures design only.** No engine code changes ship in this prep step. The build will be scheduled as the next major feature after the next sync.

**Already shipped (prep step):**
- `profiles.allows_two_a_days boolean` (migration 0013) — persistent user preference.
- Onboarding Schedule-step checkbox captures the signal during first-run setup; default `false`.
- UI copy renamed `archetype` → `focus` so the surface area is stable before the planner changes land.

## 3. Constraints already encoded (no new doc work needed)

The design-constraints wiki already covers every behavioural rule the planner needs:

| Constraint | What it dictates for two-a-days |
|---|---|
| DC-D1 | Default to ≥6h gap; warn at 3–6h; treat <3h as same-session for interference math. |
| DC-D2 | AM lift / PM cardio for Strength + Hypertrophy + Rebuild focuses; reversible only when Endurance focus is active and explicitly user-flagged. |
| DC-D3 | High-conflict pairings get the larger gap (heavy lower-body lift ↔ hard running intervals). |
| DC-L1 | Same-day cardio defaults to lower-interference modality when the lift quality is heavy. |
| DC-L3 | Endurance >45 min within 6h before heavy strength → warn even with the gap honoured. |
| DC-K4 | All warnings cite the source (e.g., "Robineau 2016 HIGH"). |
| DC-S3 | Interference is a soft constraint at the scheduler layer — warn, don't block, except for tendon gates. |

No new constraints are needed. The prep is in the engine and UI, not the wiki.

## 4. Data model changes (planned, not yet built)

```
sessions
  + slot enum('am','pm','single') NOT NULL DEFAULT 'single'
  + planned_at timestamptz                  -- optional explicit local time
  + (existing) day_date date
  + index (user_id, day_date, slot)         -- enforces <=1 AM + <=1 PM + <=1 single per day

blocks.day_plan jsonb
  + per-day shape evolves from { kind: "..." } to:
    { am?: { kind, ... }, pm?: { kind, ... }, gap_hours?: number }
    backward-compatible: existing single-session days continue to parse via "single" slot
```

Migration plan:
1. Add columns + index.
2. Backfill: all existing rows get `slot = 'single'`.
3. Two new compiled day-kinds in `lib/planner/custom.ts`: `am_pm_lift_then_cardio`, `am_pm_cardio_then_lift` (latter only valid in Endurance focus).
4. Curated focus archetypes opt-in: only emit two-a-day days when `profile.allows_two_a_days = true`. Otherwise, fall back to existing single-session shape.

## 5. UX changes (planned)

- **Today / Log:** session card splits into AM / PM columns when the day has both slots. Each card shows its own start time, status (`planned / in_progress / done`), and edit affordances.
- **Plan / focus picker:** when `allows_two_a_days` is on, each focus card shows an extra line: "two-a-day option available". Custom block builder gets an AM/PM toggle per day.
- **Conflict warnings:** if user manually schedules both slots <6h apart, surface the DC-D1 warning with the cited source (DC-K4) and a one-click "shift PM to +6h" action.
- **Settings:** the toggle becomes editable in profile settings (currently only writable from onboarding).
- **Analytics:** stats page splits daily volume by slot so the user can see the AM-lift / PM-cardio rhythm.

## 6. Engine changes (planned)

- `buildPrescription` extended to compile a `Day` with optional `am` and `pm` entries.
- Stress-bucket accounting: same-day AM+PM sessions accumulate into the day's totals but separately tagged for the interference math — DC-C7 `interference_modifier_q` reads the per-slot dose, not the day total.
- `dayPreviewByFocus` (the picker preview generator in `plan/new/page.tsx`) emits dual-slot day previews.

## 7. Out of scope for the first build

- Per-session timezone overrides (assume profile timezone).
- Skipping AM and rescheduling PM to next day (treat as two separate session cancel + reschedule operations).
- AI-driven slot recommendation (deferred to Phase 4 AI layer per Phase D decision).
- Wearable-driven readiness shifting of slots (deferred with the broader HRV / wearable backlog).

## 8. Build sequence (will become SQL todos)

1. DB migration: `sessions.slot`, `sessions.planned_at`, composite index.
2. Drizzle schema + types + zod payloads.
3. `lib/planner/types.ts`: `DayPlan` shape extension (`am | pm | single`).
4. `lib/planner/custom.ts`: new dual-slot day-kinds + builder wiring.
5. `lib/planner/archetypes.ts`: per-archetype two-a-day variant when `allows_two_a_days = true`.
6. `buildPrescription` two-slot compilation.
7. Today / Log UI: dual-card layout.
8. Plan / focus picker: dual-slot preview + custom-builder AM/PM toggle.
9. Conflict-warning surface + cited explanation (DC-K4 wiring).
10. Settings page: edit toggle post-onboarding.
11. Stats page: per-slot volume.
12. Engine tests: DC-D1, DC-D2 fixtures (the 6h gap, the AM-lift default).

## 9. Risks & open questions

- **Time-of-day input:** does the user pick exact times, or do we ship with profile-level "AM window" and "PM window" defaults (e.g., 07:00-09:00, 17:00-19:00)? Recommendation: defaults first, exact-time as polish later.
- **Existing blocks:** when a user turns the toggle on mid-block, do we re-compile remaining weeks or only apply at next-block? Recommendation: next-block only - re-compiling a live block is a sharp edge that's hard to undo.
- **Custom block compatibility:** custom-built blocks created before two-a-day shipping keep `slot = single`. Editing a day to AM/PM should be allowed; round-tripping is straightforward because both shapes coexist.
- **Cardio-first override:** how visible should the Endurance-focus "cardio first" option be? Recommendation: tucked under "advanced" per-day options, not on the main builder, to avoid encouraging it inadvertently for strength users.

These are decisions for the kickoff sync, not the prep step.
