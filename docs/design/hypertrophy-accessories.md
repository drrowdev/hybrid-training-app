# Feature design: Hypertrophy accessories

**Status:** Planned. Build is queued after mobile polish.
**Last updated:** 2026-05-21

---

## 1. Why

Hypertrophy Focus currently prescribes only the main lift per session. The one-liner explicitly notes: *"Add accessory work — flies, lateral raises, biceps, calves — live during sessions; v1 prescribes the main lift only."*

That works for the very first version but it's a leak: hypertrophy results live and die on **per-muscle volume** (DC-B4 floor doses, DC-M1/M2 MV/MEV/MAV/MRV landmarks), and we can't track that without prescribing accessories. This pass closes the loop.

## 2. Scope contract

**In v1 (this build):**
- Per-strength-day curated accessory pool, keyed on the day's pattern (squat / horizontal-press / deadlift / vertical-press)
- Accessory items render as **optional** checkboxes on the session page — user picks which ones to do today
- Picked accessories get added to the session prescription with default sets × reps (3 × 10–15 for isolation, 3 × 8–12 for compound assistance)
- Per-muscle volume rollup on the stats page using the DC-T1 22-muscle taxonomy
- Custom builder gains an "include accessories" toggle per strength day (default on for Hypertrophy Focus, off for Strength Focus)

**Out of v1:**
- Auto-progression of accessory loads (Phase 2)
- User-customised accessory pools (currently curated only)
- Accessory-specific 1RM tracking (overkill — RPE-driven works)
- Conditioning-side accessories (calves on Z2 day, etc. — over-engineering for v1)

## 3. Constraints already encoded

| Constraint | What it dictates |
|---|---|
| DC-B4 | Per-quality floors include per-muscle MV / MEV. |
| DC-M1 / DC-M2 | Per-muscle weekly volume landmarks. MAV / MRV scaled by 0.70 under concurrent stress (DC-M2). |
| DC-T1 | 22-muscle taxonomy is the rollup target. |
| DC-L4 | Hypertrophy stimulus is most robust under concurrent load — accessories don't need GRM scaling. |

## 4. Data model

### Already present
- `Prescription.items[].kind` enum includes `"accessory"` (line 65 of `packages/db/src/schema/planner.ts`).
- `movements` catalog has `primary_muscle` + `secondary_muscles` jsonb (per DC-T1 taxonomy).

### New
**None.** Accessories slot into the existing `Prescription.items[]` array as `kind: "accessory"` entries. No new tables.

What might be added later (not in this build):
- `accessory_pools` table for user-customised pools
- `accessory_completion` log entries for set-by-set tracking (currently the existing `set_logs` table handles this fine)

## 5. Curated accessory pools (initial v1 set)

```ts
// lib/planner/accessories.ts
const ACCESSORY_POOLS: Record<StrengthRole, AccessoryTemplate[]> = {
  squat: [
    { slug: "leg-curl-lying", muscle: "hamstrings", sets: 3, reps: "10-15", rationale: "Quad-dominant day; hams under-loaded by squat." },
    { slug: "calf-raise-standing", muscle: "calves", sets: 3, reps: "12-15" },
    { slug: "ab-wheel", muscle: "abs", sets: 3, reps: "8-12" },
    { slug: "glute-bridge-bb", muscle: "glutes", sets: 3, reps: "10-12", rationale: "Extra glute volume on quad day." },
  ],
  horizontal_press: [
    { slug: "cable-fly", muscle: "chest", sets: 3, reps: "12-15" },
    { slug: "lateral-raise-db", muscle: "delts-lateral", sets: 3, reps: "12-15", rationale: "Side delts get nothing from horizontal press." },
    { slug: "tricep-pushdown", muscle: "triceps", sets: 3, reps: "10-15" },
    { slug: "face-pull", muscle: "delts-rear", sets: 3, reps: "12-15", rationale: "Posterior shoulder balance." },
  ],
  deadlift: [
    { slug: "leg-curl-lying", muscle: "hamstrings", sets: 3, reps: "10-15" },
    { slug: "back-extension", muscle: "lumbar-erectors", sets: 3, reps: "10-12" },
    { slug: "barbell-row", muscle: "lats", sets: 3, reps: "8-12", rationale: "Upper back assistance — different from a pull day pattern." },
    { slug: "biceps-curl-db", muscle: "biceps", sets: 3, reps: "10-12" },
  ],
  vertical_press: [
    { slug: "lateral-raise-db", muscle: "delts-lateral", sets: 3, reps: "12-15" },
    { slug: "face-pull", muscle: "delts-rear", sets: 3, reps: "12-15" },
    { slug: "tricep-pushdown", muscle: "triceps", sets: 3, reps: "10-15" },
    { slug: "biceps-curl-db", muscle: "biceps", sets: 3, reps: "10-12" },
  ],
};
```

These are **curated**, not user-customisable in v1. Quality over quantity: every entry has a stated muscle target tied to the DC-T1 taxonomy.

## 6. UX

### Session page (`/app/sessions/[id]`)
- Below the main lift's prescribed sets, show an **"Accessories"** section
- Each accessory rendered as a checkbox row: muscle target + name + default sets×reps + optional rationale tooltip
- Checkboxes default to **on** when Hypertrophy Focus is the active archetype
- Checkboxes default to **off** when Strength Focus is active (user opt-in only)
- A "Save accessories" button persists the user's pick onto the session prescription
- After save, accessories appear in the set-log list the same way main-lift sets do

### Plan card
- Accessory chips render as `+3 accessories` next to the main lift summary so the user knows there's optional volume on this day

### Stats page
- New **"Weekly per-muscle volume"** section: bar chart by muscle (22 from DC-T1), 7-day rolling window
- Color-code each bar against the MV/MEV/MAV/MRV landmarks: red = below MV, yellow = below MEV, green = MEV–MAV, orange = above MAV, red = above MRV
- Concurrent-stress modifier (DC-M2) applies automatically when the week has ≥3 cardio sessions or ≥4 endurance-hours

## 7. Build sequence

1. **Catalog audit**: ensure all accessory movement slugs exist in the `movements` table with correct `primary_muscle` per DC-T1. Add any missing rows via a seed migration.
2. `lib/planner/accessories.ts`: define `AccessoryTemplate` type + `ACCESSORY_POOLS` per role
3. `buildPrescription`: optionally append accessory items when `includeAccessories` flag is on per day (default true for Hypertrophy, false for Strength)
4. Custom builder UI: per-strength-day "include accessories" toggle (default reads from the focus picked)
5. Session page UI: render accessories section with checkboxes + Save action
6. `saveSessionAccessories` server action: writes the user's selection onto the session's prescription
7. Stats: weekly per-muscle volume chart with DC-T1 + DC-M2 wiring
8. Tests: per-pool curation lints (every slug exists), per-muscle aggregation correctness, DC-M2 modifier triggers correctly

## 8. Open questions for kickoff

- **Default-on/off per focus:** confirmed default-on for Hypertrophy, default-off for Strength. Endurance and Rebuild stay accessory-free unless user explicitly opts in via the custom builder.
- **Movement variants:** do we let users pick `leg-curl-seated` vs `leg-curl-lying`? Recommend single canonical default per pool entry in v1; variant picking is a polish pass.
- **Two-a-day interaction:** if Mon AM is Squat + Mon PM is Z2, the accessories belong to the AM session only. The PM session never gets accessory items. (Curtain rod ready — no real interaction problem here.)
- **Stats time-window:** rolling 7 days, calendar week, or last-block? Recommend rolling 7 days for the volume chart (matches the polarized aerobic distribution chart's convention).
