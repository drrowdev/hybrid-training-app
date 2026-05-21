# Feature design: PRs + auto TM progression

**Status:** Planned. Build queued after the user gives the green light.
**Last updated:** 2026-05-21

---

## 1. Why

The planner currently freezes at whatever 1RM the user entered during onboarding. Training Maxes never move. Logged sets don't surface their own significance — a genuine PR scrolls past in the session log just like any other warmup.

This feature closes the loop: **logged sets feed back into the stored numbers** that drive future prescriptions. Two paired pieces:
- **PR detection** — every logged main-lift set is checked against history for three kinds of records (weight, reps-at-weight, estimated 1RM).
- **TM auto-suggestion** — when a 5/3/1 AMRAP set outperforms its wave target by enough signal, the engine proposes a TM bump. User accepts, declines, or modifies.

The model below is **ported from the user's existing implementation in another app** (more rigorous than my first-draft sketch) with two surgical additions that fit this codebase's research stack.

## 2. Scope contract

**In v1 (this build):**
- Three PR kinds: weight, reps-at-weight, e1RM
- 1RM estimation via Epley (default) + RPE-based (when RPE logged), taking the **conservative** of the two for PR detection
- AMRAP-driven TM bump proposal with confidence-gate scoring (hard gates + soft signals)
- 28-day cooldown per movement
- Per-session GRM as a soft signal in the gate (parallel to the chronic-fatigue signal)
- `tm_history` table for chronological log
- "Bump your TM?" card on the session page when a proposal fires
- Recent PRs tile on /app/stats
- Per-lift TM trend chart on /app/stats/movements/[slug]
- Auto-deload prompt after 2 real misses (GRM-gated)

**Out of v1:**
- TSB / chronic load aggregation (the app has no aggregated weekly load yet — see §8)
- A-priority race calendar gate (the app has no race calendar; defer)
- Bar speed / velocity inputs
- PR confetti / celebrations beyond a subtle badge (intentional choice — ages badly)
- User-tunable cooldowns or scoring weights (curated values only in v1)

## 3. Constraints already encoded

| Constraint | What it dictates |
|---|---|
| DC-P1 | Fatigue + soreness as readiness inputs; feed into the GRM signal in the gate. |
| DC-K4 | Every proposal cites *why* it fired (the contributing signals are passed forward and rendered on the proposal card). |
| DC-S1 / DC-S3 | TM bumps + deloads are soft proposals — user always accepts/declines. Never auto-applied. |
| DC-H1 / DC-H3 | Missed top sets feed the stall-diagnosis decision tree; auto-deload is the "fatigue suppression" branch action. |

No new constraints needed.

## 4. Data model

### Already present
- `set_logs(id, session_id, movement_id, set_kind, weight_kg, reps, rpe)` — input data
- `sessions(id, user_id, performed_at, fatigue, soreness)` — readiness signal
- `planned_sessions(id, prescription, completed_session_id)` — what the user was supposed to do (for AMRAP detection)
- `training_maxes(user_id, movement_id, one_rm_kg, tm_percent)` — current TM

### New (migration 0015_tm_history)

```sql
CREATE TYPE tm_change_reason AS ENUM (
  'manual',          -- user edited via Settings -> Training maxes
  'pr_detection',    -- a single-set PR triggered a recalibrate proposal accepted
  'amrap_bump',      -- AMRAP confidence-gate bump accepted
  'block_complete',  -- end-of-block default bump accepted
  'deload',          -- 2-miss safety net accepted
  'onboarding'       -- initial values seeded by the wizard
);

CREATE TABLE tm_history (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL,
  movement_id   uuid NOT NULL,
  old_tm_kg     numeric(6,2),       -- null on the very first onboarding row
  new_tm_kg     numeric(6,2) NOT NULL,
  reason        tm_change_reason NOT NULL,
  session_id    uuid REFERENCES sessions(id) ON DELETE SET NULL,
  -- Idempotency key for PR / AMRAP triggers. Format:
  --   pr_detection:    {session_id}:{movement_id}:pr
  --   amrap_bump:      {session_id}:{movement_id}:amrap
  -- A repeat insert with the same key is a no-op.
  trigger_key   text,
  changed_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX tm_history_user_movement_idx ON tm_history (user_id, movement_id, changed_at DESC);
CREATE UNIQUE INDEX tm_history_trigger_unique_idx
  ON tm_history (user_id, movement_id, trigger_key)
  WHERE trigger_key IS NOT NULL;

ALTER TABLE tm_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY tm_history_self ON tm_history FOR ALL USING (user_id = auth.uid());
```

The trigger_key partial unique index is the idempotency machinery — re-saving the same set never re-fires.

## 5. 1RM math (`lib/engine/one-rm.ts`)

### Epley (default)
```
e1RM = weight × (1 + reps / 30)   // for reps in [1, 12]; null above
```

### RPE-based (when RPE is logged)
Helms / Zourdos chart — lookup table indexed by (reps, rpe) → %1RM. Reps in [1, 12], RPE in [6.0, 10.0] in 0.5 steps. Out of range → null.

Examples (a few canonical rows):
```
reps 1 @ RPE 10 -> 100% 1RM    reps 5 @ RPE 8  -> 83.5% 1RM
reps 1 @ RPE 9  ->  95.5%      reps 5 @ RPE 9  -> 87.0%
reps 3 @ RPE 8  ->  88.0%      reps 8 @ RPE 9  -> 77.0%
```

### Conservative dispatcher
```ts
function bestEstimateOneRm({ weight, reps, rpe }): number | null {
  if (reps < 1 || reps > 12 || weight <= 0) return null;
  const epley = weight * (1 + reps / 30);
  if (rpe == null) return epley;
  const rpePct = lookupRpeChart(reps, rpe);   // 0.0-1.0, or null
  if (rpePct == null) return epley;
  const rpeBased = weight / rpePct;
  // Conservative pick so PRs are hard to fake.
  return Math.min(epley, rpeBased);
}
```

Returning `null` above 12 reps automatically excludes high-rep sets from PR detection.

## 6. PR detection (`lib/engine/pr.ts`)

Three kinds run on every logged main-lift set whose movement matches a tracked role:

| Kind | Trigger |
|---|---|
| **weight** | new weight > max weight ever lifted on this movement (any reps) |
| **reps-at-weight** | new reps > max reps ever performed at exactly this weight |
| **e1RM** | conservative-dispatcher e1RM > max e1RM across all prior sets for this movement |

Each kind has its own card on the session page: small accent badge + the value + "first PR in 6 weeks" streak context when the previous PR for this kind is older than 6 weeks.

Cap: **one PR card per kind per movement per session** (a session that includes both a weight-PR and an e1RM-PR shows both; a session with two weight-PRs only shows the highest). Idempotent on session re-saves.

## 7. AMRAP TM auto-suggestion (`lib/engine/tm-bump.ts`)

Fires only when:
- Set is logged
- Its movement matches the current block's main-lift role at the day's slot
- The planned prescription for that day has a top-set entry tagged AMRAP (`5+`, `3+`, `1+`)
- The set's reps >= the AMRAP target (else not an AMRAP attempt)

### Layer 1 — pure suggestion
```
newTm = bestEstimateOneRm(amrap_weight, amrap_reps, amrap_rpe) * 0.90
```
Wendler's "new TM = 90% of estimated 1RM."

### Layer 2 — confidence gate

**Hard gates** (any one fails → suppressed):
- TM for this movement was changed in the last **28 days**
- A TM-bump proposal has already been emitted for this movement in the last 28 days
  *(implemented via the partial unique index on tm_history.trigger_key)*
- An active limitation in `limitations` targets this movement's region

**Race-prep gate deferred to a future version** — the app has no race calendar yet.

**Soft signals** (≥ 3 points required):

| Points | Signal |
|---|---|
| +1 | reps over the wave's target ≥ 5 |
| +2 | Wk3 (1+ AMRAP) beaten by ≥ 5 reps — Wendler's canonical bump signal |
| +2 | Wk1/Wk2 AMRAP beaten by ≥ 7 reps — early-week outlier |
| +2 | e1RM-implied TM exceeds current TM by ≥ 7% |
| +1 | per prior AMRAP "smash" on same lift in last ~6 weeks (capped at +2) |
| +1 | ≥ 1 full cycle (21 days) since last TM change |
| −1 | last session's GRM < 0.93 (acute fatigue masking the signal) |

The contributing signals are passed forward as `reasons[]` on the proposal so the card can cite *why* it fired.

### Idempotency
`trigger_key = "{planned_session_id}:{movement_id}:amrap"`. Re-saving the same set never re-fires; the unique index on tm_history blocks duplicate rows.

## 8. Block-complete bump (secondary trigger)

When a block ends with no AMRAP outperformance (so the confidence gate never fired), still offer a **conservative default bump** so the user can keep moving forward at Wendler's small-jumps cadence:
- Squat / Deadlift: +5 kg
- Bench / OHP: +2.5 kg
- Other patterns: +2.5 kg

This shows up as a card at the start of the next block planning flow ("Last block ended clean — bump TMs by the Wendler default?"). The user can accept, decline, or override per-lift.

Idempotency key: `"{block_id}:{movement_id}:block_complete"`.

## 9. Auto-deload

Detect two consecutive missed top sets on the same movement. A miss is:
- AMRAP set logged with reps < AMRAP target, OR
- Top set logged with weight < prescribed weight × 0.95

GRM gating: a miss on a session with `GRM < 0.93` is **discounted** (the user was cooked; not a TM problem). Only "real misses" count toward the streak.

After 2 real misses in a row, surface a proposal:
> "Two real misses on bench this cycle. Drop bench TM by 10%?"

User accepts, declines, or modifies. Idempotency key: `"{session_id}:{movement_id}:deload"`.

## 10. UX

### Session page — when a PR fires
Below the set list, a slim accent-bordered card per PR kind:
```
🏆 Bench Press PR · 132 kg × 1
   First weight PR in 8 weeks. Previous best: 130 kg × 1.
```
Three side-by-side cards possible (weight + reps-at-weight + e1RM); typically only 1-2 will fire at once.

### Session page — when a TM bump proposal fires
A larger card at the top of the session log:
```
   Bump bench TM?
   You hit 8 reps on the 1+ AMRAP at 110 kg, RPE 8.
   Estimated 1RM → 138 kg. Suggested new TM → 124 kg (was 120 kg).

   Why this fired:
     · Wk3 (1+) beaten by ≥ 5 reps  (+2)
     · e1RM exceeds current TM by 7%+  (+2)
     · ≥ 1 cycle since last TM change  (+1)

   [Accept 124 kg]  [Modify…]  [Not now]
```
Reasons are surfaced verbatim — DC-K4 compliance.

### Stats — Recent PRs tile
Top of /app/stats, between the existing tiles and the muscle volume chart:
```
   Recent PRs
   Bench Press · 132 kg × 1 · 2 days ago
   Back Squat  · 145 kg × 5 · 5 days ago
   See all →
```
Links to /app/stats/prs (new route — list of every PR ever, filterable by kind and movement).

### Per-lift trend chart on /app/stats/movements/[slug]
Existing movement drill-down gets a new section: **TM history**. Time-series chart of `tm_history` entries with color-coded reason markers (manual/AMRAP/block-complete/PR/deload) so the user can see how their TM curve actually evolved.

## 11. Build sequence (will become SQL todos)

1. **1RM math** — `lib/engine/one-rm.ts` with Epley + RPE chart + conservative dispatcher + tests
2. **Migration 0015** — `tm_history` table + `tm_change_reason` enum + indexes + RLS
3. **PR detection** — `lib/engine/pr.ts` with three-kind detector + idempotency
4. **AMRAP detection** — helper to identify which planned-session items are AMRAP (5+/3+/1+) entries
5. **Confidence gate** — `lib/engine/tm-bump.ts` with hard gates + soft signal scoring
6. **`proposeTmBump` server action** — runs gate, returns proposal payload (newTm, reasons[])
7. **`acceptTmBump` / `declineTmBump` / `modifyTmBump` server actions** — write to tm_history + training_maxes
8. **PR cards on session page**
9. **TM bump proposal card on session page** (when proposal exists)
10. **Block-complete secondary bump card** on /app/plan when a block ends
11. **Auto-deload detector** — top-set miss tracking + GRM gating + proposal
12. **Recent PRs tile on /app/stats** + **`/app/stats/prs` list route**
13. **TM history chart on /app/stats/movements/[slug]**
14. **Tests** — math (bounds, RPE chart, conservative dispatcher); PR detection (three kinds, idempotency); confidence gate (every signal + hard gates); auto-deload GRM gating

## 12. Open questions for kickoff

- **TSB equivalent.** The original model used Training Stress Balance as a chronic-fatigue mask in the confidence gate. This app has no aggregated weekly load yet. For v1 I'll skip the chronic signal and rely on the per-session GRM only. A future engine pass can add a TSB-like aggregate and re-introduce the signal.
- **Race-prep window.** Original model suppressed bumps within 21 days of an A-priority race. This app has no race calendar. Defer to a future feature; in the meantime the cooldown + injury gates carry most of the safety.
- **AMRAP detection on custom blocks.** The 5/3/1 archetype clearly marks Wk3 top sets as `1+`, but a custom block built from `WAVE_TEMPLATES` may or may not have explicit AMRAP semantics. Proposal: only fire AMRAP-driven bumps on curated archetypes that mark their AMRAP set with `reps: "5+"` / `"3+"` / `"1+"` in the prescription. Custom blocks fall back to the block-complete trigger.
- **Variant interaction with PRs.** TMs are per `movement_id`. If a user switches squat variant mid-block (back → front), the PR detection should not flag the first front-squat session as a "PR" by default since the variant changed. Proposal: PR kinds compare against history of *this exact movement_id* — natural side-effect, no special-casing needed.
- **PR streak history.** "First PR in 6 weeks" is the streak context. Computing it requires scanning history. Cheap enough at query time; no caching needed for v1.
