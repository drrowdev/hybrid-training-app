# Accessory schema — research-grounded redesign

**Status:** Design proposal. Supersedes the v1 design in `docs/design/hypertrophy-accessories.md` which is now too narrow.
**Date:** 2026-05-21
**Driver:** Owner asked for accessory scheduling to be backed by data across all archetypes (Strength / Hypertrophy / Endurance / Concurrent-Hybrid / Maintenance / Rebuild), including two-a-day variants.

---

## 1. What the research actually says

### 1.1 Volume targets per muscle per week (DC-M1, `new` §2.1 / §7.2)

Schoenfeld 2017 dose-response meta — **HIGH** — converges on **10–20 hard sets per muscle per week** as the MEV→MAV range for trained lifters in a non-concurrent context.

The Israetel MV/MEV/MAV/MRV framework (Renaissance Periodization — MODERATE-HIGH) names the four landmarks:

| Landmark | Meaning |
|---|---|
| **MV** | Maintenance — minimum to retain gains |
| **MEV** | Minimum effective — starts new growth |
| **MAV** | Maximum adaptive — best growth-to-fatigue ratio |
| **MRV** | Maximum recoverable — upper ceiling |

### 1.2 Concurrent stress modifier (DC-M2, `new` §2.1 / §2.4)

When **weekly endurance ≥ 4 h OR conditioning sessions ≥ 3/wk**, three adjustments apply (practitioner consensus — MODERATE; no RCT validation):

- **MAV drops ~20–30%** — systemic fatigue is higher
- **MV is roughly unchanged** — protein-synthesis ceiling unaltered
- **MRV is more easily breached** — conditioning adds global fatigue without muscle-specific signal

Practical formula: under concurrent stress, the safe operating range becomes **MEV → MEV+30%**, **not** MEV → MAV. Use `concurrent_modifier = 0.70` on MAV and MRV.

### 1.3 Per-muscle priority targets (DC-T1, `new` §7.2 — Schoenfeld HIGH)

These are the muscles main compounds under-train. Direct work is required for visible development:

| Muscle group | Sets/wk |
|---|---|
| Shoulders (medial + posterior delts) | 6–12 |
| Arms (biceps + triceps) | 8–14 |
| Calves | 8–16 |
| Abs | 6–10 |
| Upper chest | covered by incline emphasis |

### 1.4 Emphasis block templates (`new` §5.2)

| Block | Strength load | Hypertrophy slots | Z2 | VO2 | Tissue |
|---|---|---|---|---|---|
| **Strength emphasis** | 4 sessions/wk, MEV–MAV | **1–2 supplementary** | 2–3 h/wk | 1 short/wk | Background |
| **Hypertrophy emphasis** | 3 sessions/wk, sub-max | High volume, MAV | 2–3 h/wk | 1/wk | Background |
| **Aerobic base emphasis** | 2 sessions/wk maintenance | **1 slot** | 5–7 h/wk polarized | 1/wk | Maintain |
| **VO2 / conditioning emphasis** | 2 sessions/wk maintenance | **minimal** | 3–4 h/wk | 2–3 hard | Maintain |
| **Peak / test** | Testing volume | reduce | reduce | reduce | maintain |
| **Deload** | **50–60% volume** | **50%** | 50% | none | isometrics only |

Key heuristic (HIGH): **one quality leads at a time**, others receive **maintenance dosing (1/9th to 1/3rd of peak)** per Bickel 2011. Trying to lead two qualities simultaneously is the most common cause of slow long-term progress.

### 1.5 Maintenance phase (DC-M3, `new` §2.2 — Bickel 2011 HIGH)

Strength is maintained at as little as **1/9th peak volume for 32 weeks IF intensity stays ≥85%** on the main lift. Translation: a Maintenance archetype's accessory load should be **minimal** — heavy compound work carries it.

### 1.6 Exercise selection bias (`new` §2.3 — MODERATE-HIGH)

Under conditioning load:
- **Compound bias.** Single-joint isolation costs recovery without giving back movement quality. First to drop when fatigue rises.
- **Machine/supported variants** earn an outsized place. Comparable hypertrophic stimulus, lower systemic fatigue, less eccentric load than barbell variants (Schoenfeld + practitioner consensus).
- **Reserve free-weight high-fatigue variants for emphasis blocks** when conditioning is low.

### 1.7 Anchor-filler under compression (v1 §11 + DC-E1/E3/I1)

- Accessories ARE fillers — the first thing dropped under time / recovery / equipment pressure
- Schedule-compressed signal → drop fillers, keep anchors, **no catch-up sessions**
- High systemic fatigue → reduce accessory + hard conditioning
- Hypertrophy stalled + recovery OK → raise priority-muscle volume with **low-fatigue tools**

### 1.8 Variation within a block (v1 §6 + practitioner consensus)

> "Accessory variation distributes stress across tissues" — v1 §6

Wendler 5/3/1 explicitly endorses varying assistance week-to-week ("It is the work that matters"). The principle generalises: **rotate within a muscle target** rather than stacking identical exercises. Targets stay the same; movements rotate.

---

## 2. Per-archetype prescription

The numbers below combine all of the above into a single table. Each cell is **working sets per week** (warmup excluded), drawn from per-muscle compound contribution + accessory pool. Per-day caps respect the anchor-filler rule (anchor stays untouched, accessories fill remaining recovery budget).

### 2.1 Strength Focus

**Goal:** Drive main-lift strength. Compound work dominates. Accessories cover the priority-muscle gaps that squat + bench + deadlift + OHP can't reach.

| Muscle | Compound covers? | Target sets/wk | Source |
|---|---|---|---|
| Quads | yes (squat) | 8–12 (compound) | DC-M1 |
| Glutes | yes (squat, deadlift) | 6–10 (compound) | DC-M1 |
| Hamstrings | partially (deadlift) | **+4–6 accessory** | DC-M1 |
| Chest | yes (bench) | 8–10 (compound) | DC-M1 |
| Lats / mid-back | yes (deadlift) | **+4–6 accessory row** | DC-M1 |
| Front delts | yes (OHP) | adequate | — |
| **Side delts** | NO | **6–8 accessory** | DC-T1 |
| **Rear delts** | NO | **4–6 accessory** | DC-T1 |
| **Triceps** | partially (bench/OHP) | **+4–6 accessory** | DC-T1 |
| **Biceps** | NO | **4–6 accessory** | DC-T1 |
| **Calves** | NO | **6–8 accessory** | DC-T1 |
| **Abs** | NO | **6 accessory** | DC-T1 |

**Default per strength day:** 2–3 accessory items at **3 × 8–12** (compound assistance) or **3 × 10–15** (isolation). Total ~8–12 accessory sets per session, **~16–24 across the 4 strength days**.

**Selection bias:** Compound assistance (rows, dips, RDLs) preferred over isolation when both fit the gap.

### 2.2 Hypertrophy Focus

**Goal:** Drive per-muscle hypertrophy. Compounds remain the anchor (force production matters for stimulus quality) but **accessory share is larger** than in Strength.

| Muscle | Target sets/wk |
|---|---|
| Chest | **12–16** (compound + 2 isolation slots) |
| Upper chest | **8–12** (incline + flies) |
| Lats / upper back | **12–16** (compound + 2 isolation) |
| Quads | 10–14 |
| Glutes / hamstrings | 10–12 each |
| Side delts | **10–14** |
| Rear delts | **8–12** |
| Triceps | **10–14** |
| Biceps | **10–14** |
| Calves | **10–14** |
| Abs | **8–10** |

**Default per strength day:** **4 accessory items at 3 × 8–15**, total ~12 accessory sets per session, **~48 across 4 strength days**.

**Selection bias:** Mix of compound assistance + machine/cable isolation. Machine work earns its place here — comparable stimulus, lower fatigue (`new` §2.3).

### 2.3 Concurrent-Hybrid Focus (the intended default)

**Goal:** Balance strength + cardio without starving either. **`concurrent_modifier = 0.70` automatically applies** because the archetype prescribes ≥3 cardio sessions / ≥4 h endurance.

Volume math: take Strength Focus accessory counts × 0.85 (mild concurrent pull-back, since the archetype is balanced not strength-emphasis).

| Muscle | Target sets/wk |
|---|---|
| Side delts | 5–7 |
| Rear delts | 4–5 |
| Triceps | 4–6 |
| Biceps | 4–6 |
| Calves | 5–7 |
| Abs | 6 |
| Hamstrings extra | 3–4 |
| Lats / mid-back extra | 3–5 |

**Default per strength day:** **2 accessory items at 3 × 10–15**, total ~6 accessory sets per session, **~24 across 4 strength days**.

**Selection bias:** Heavily skew supported / machine / cable isolation. Eccentric-heavy barbell variants (Romanian deadlifts, bent-over rows) deprioritised — they tax recovery shared with conditioning.

### 2.4 Endurance Focus

**Goal:** Cardio leads. Strength is at maintenance dose. Accessories are a **floor**, not a driver — protect from atrophy of underused muscles.

| Muscle | Target sets/wk |
|---|---|
| Side delts | 4 (MV floor) |
| Rear delts | 4 (MV floor) |
| Calves | 4 (functional for running) |
| Abs | 4 |
| Hamstrings extra | 4 (hip-hinge balance for running mechanics) |

**Default per strength day:** **1–2 accessory items at 2 × 12–15**, total ~3–4 accessory sets per session. Strength Focus has 2 strength days here → **~6–8 total accessory sets/wk**.

**Selection bias:** Low-fatigue tools only. Machine / cable / band work. No high-eccentric variants. No CNS-heavy isolations (preacher curl OK, weighted dips no).

### 2.5 Maintenance archetype

**Goal:** Keep the lights on. **Per DC-M3 (Bickel 2011 HIGH): heavy compound work at ≥85% TM is enough.** Accessories explicitly minimised.

**Default:** **0–1 accessory items per session**, ~2 sets max. Total ~4 accessory sets / 2-week block.

**Rationale:** During a 2-week busy / travel block, recovery budget is the constraint. The compound stimulus is what holds the line. Accessories cost recovery without adding meaningful retention signal.

### 2.6 Rebuild archetype

**Goal:** Return-to-training, tendon focus, capped intensity. Tendon work has scheduled slots already; accessories should NOT compete with them.

**Default:** **1–2 isolation items per session at 2 × 12** — bodyweight or light DB variants only. Total ~4–6 accessory sets/wk.

**Selection bias:** Strict supported / fixed-path. No high-eccentric, no high-strain-tendon overlap with the scheduled tendon days.

---

## 3. Two-a-day modifier

Per DC-D1 (Robineau 2016 HIGH) + `new` §1.1, ≥6h between AM lift and PM cardio largely abolishes molecular interference. But the **total weekly recovery budget shrinks** — same 7 days, more sessions packed in.

| Archetype on two-a-day | Accessory adjustment |
|---|---|
| Strength Focus | × 0.85 (pull back ~15%) |
| Hypertrophy Focus | × 0.85 |
| Concurrent/Hybrid | × 0.75 (already concurrent, double-up tightens further) |
| Endurance Focus | × 1.00 (already at floor — don't cut) |
| Maintenance | n/a — two-a-day intentionally omitted |
| Rebuild | n/a — two-a-day intentionally omitted |

**Scheduling rule:** When a strength day is doubled with PM cardio, **drop the lowest-priority accessory** for that day (rank order: compound assistance > priority-muscle isolation > non-priority isolation).

---

## 4. Week-by-week behaviour

### 4.1 Deload weeks

| Archetype | Deload accessory scale | Source |
|---|---|---|
| All | **× 0.50** | `new` §5.2 deload row |
| Rep range adjusted | 2 sets × 10 (instead of 3 × 12) | practitioner |

Deload is the only week where accessory volume drops by half **alongside** the main-lift volume scale. Currently the engine has `strengthVolumeScale: 0.5` on deload weeks but doesn't apply it to accessories — needs fixing.

### 4.2 Variation rotation

Within a 4-week block, **rotate accessory selection within the same muscle target**:

| Wk | Side delts | Triceps | Hams |
|---|---|---|---|
| 1 | DB lateral raise | Rope pushdown | Lying leg curl |
| 2 | Cable lateral raise | Overhead extension | Seated leg curl |
| 3 | DB lateral raise (slight pause) | Rope pushdown | Romanian DL (cap reps) |
| 4 (deload) | Lighter version of Wk1 | Lighter version of Wk1 | Lighter version of Wk1 |

This satisfies the v1 §6 "Accessory variation distributes stress" rule without adding cognitive load — the user sees a small list rotating predictably.

### 4.3 Branch overrides (DC-I1)

When the daily branch logic fires:

| Signal | Accessory action |
|---|---|
| High systemic fatigue + perf down | **Drop all but the highest-priority accessory** for the session |
| Hypertrophy stalled + recovery OK | **Raise priority-muscle volume** by 1 set per accessory targeting that muscle |
| Local pain in a region | Drop accessories that load that region; substitute machine variant if available |
| Schedule compressed | Drop accessories entirely; keep anchor lift only |

These are session-time overrides — not persisted to the block — and surface as suggestions, not auto-applied.

---

## 5. Selection rules (priority order)

When picking accessory items for a day, the engine should evaluate in this order:

1. **Cover the priority-muscle gap.** What's the largest gap between this user's weekly running total (rolling 7d) and the per-muscle target for the current archetype × week? Pick an accessory that targets that muscle.
2. **Compound bias.** If two candidates target the same gap, prefer the **compound assistance** (row > pulldown, RDL > leg curl) under Strength / Hybrid emphasis. Under Hypertrophy emphasis, prefer the **isolation** (more direct stimulus, less main-lift overlap).
3. **Concurrent stress filter.** If `concurrent_modifier` is active, exclude movements tagged with high `eccentric_load_score` or high `CNS_cost_score`.
4. **Rotation.** Avoid the same exact accessory used in the immediately previous session for the same muscle, when an alternative exists in the pool.
5. **Limitations.** Skip any accessory that loads a flagged limitation region.

This converts the current static pool into a **gap-driven dynamic picker** — the same architecture used for region freshness, just for muscle volume.

---

## 6. Data model deltas

### 6.1 New schema (small)

- `movements.fatigue_cost` — smallint 1-5. Drives selection rule #3. Already implied by `interferenceCost` enum but at session granularity not movement-fatigue granularity. **Add a column or derive from `interference_cost + eccentric metadata`.**
- `movements.is_supported` — boolean. True for machines and cables. Used by selection rule #2 under concurrent stress.

### 6.2 Already present (reuse)

- `movements.is_compound` ✅
- `movements.primary_muscles[]` + `secondary_muscles[]` ✅
- `movements.high_strain_tendon` ✅
- `Prescription.items[].kind = "accessory"` ✅
- Per-muscle volume aggregator (`lib/stats/muscle-volume.ts`) ✅ — newly fixed to actually populate

### 6.3 Archetype-level flags (existing — needs expansion)

Today: `accessoriesByDefault?: boolean`. Becomes:

```ts
type AccessoryProfile = {
  /** Sets multiplier vs the per-muscle target table */
  intensityScale: number;        // 0.0 = none, 1.0 = full
  /** Per strength session */
  itemsPerSession: number;       // 0..4
  /** Default working sets per item */
  setsPerItem: number;           // 2..3
  /** Rep range */
  reps: { min: number; max: number };
  /** Selection bias */
  bias: "compound_assistance" | "isolation_machine" | "low_fatigue_only" | "minimal";
};
```

Each archetype declares its own `accessoryProfile`. Two-a-day variants override with reduced `intensityScale`.

---

## 7. Putting it together — what changes from today

| Aspect | Today | Proposed |
|---|---|---|
| Pool | Static 4 movements per strength role | Dynamic pick from a wider pool keyed on muscle gaps |
| Volume | Always 3 × 10-15 | Per-archetype `setsPerItem` × archetype rep range |
| Per-archetype default | Hypertrophy only | All six archetypes, each with `accessoryProfile` |
| Concurrent stress | Ignored | Pulls accessory scale by 0.70 when active |
| Two-a-day | Ignored | Per-archetype × 0.75–0.85 |
| Deload | Same as wave week | × 0.50 + lighter reps |
| Variation | Same movement every week | Rotate within muscle target across weeks |
| Limitations | Ignored | Filter accessories loading flagged region |
| Gap-fill | None | Top of selection-rule order |

---

## 8. Implementation phases (if we build this)

| Phase | What | Effort |
|---|---|---|
| **A** | Per-archetype `accessoryProfile` config + apply concurrent modifier + apply deload scalar | small |
| **B** | Two-a-day reduction + limitation filter | small |
| **C** | Dynamic gap-fill picker reading per-muscle volume | medium |
| **D** | Week-by-week variation rotation | medium |
| **E** | Daily branch overrides (high-fatigue / hypertrophy-stalled / schedule-compressed) | small-medium |

A + B alone closes the worst of today's gaps (Strength has no accessories, deload doesn't deload, etc.). C and D bring the engine to research-level.

---

## 9. Confidence summary

| Claim | Confidence | Source |
|---|---|---|
| 10–20 sets/muscle/wk is MEV→MAV | HIGH | Schoenfeld 2017 meta |
| Concurrent modifier 0.70 | MODERATE | Israetel / Nuckols practitioner |
| Priority-muscle direct work required for visible development | HIGH | Schoenfeld + others |
| Maintenance ≥85% main lift retains strength at 1/9 volume | HIGH | Bickel 2011 |
| Compound bias under concurrent load | MODERATE-HIGH | Coffey & Hawley, practitioner |
| Machine variants stimulate hypertrophy with lower fatigue | MODERATE-HIGH | Schoenfeld + practitioner |
| Accessory rotation distributes stress | MODERATE | v1 §6 + practitioner |
| Anchor-filler under compression | HIGH-MODERATE | v1 §11 + multi-source |
| Two-a-day recovery budget shrinks | implied | DC-D1 + recovery basics |

The numeric targets (sets/week per muscle, archetype scalars) are **`[DEF→cal]`** — defaults to ship, calibrate as real logged data accumulates.

---

# Revision — three-pillar accessory model

The original draft above (sections 1–9) covered only the **aesthetic / hypertrophy** pillar. The research mandates two more pillars that are not optional and not archetype-dependent. This revision integrates them.

## 10. The three pillars

Accessories serve three distinct purposes. A complete schema treats each as a first-class slot type, not as a tag on the same pool.

| Pillar | What it produces | Research basis | Confidence |
|---|---|---|---|
| **Aesthetic** | Visible muscle development at the muscles compounds under-train (side/rear delts, arms, calves, abs, upper chest) | DC-T1, `new` §7.2 (Schoenfeld 2017 + others) | HIGH |
| **Functional** | Movement-quality carryover to the main lift / sport — asymmetry control, trunk-under-load, hinge mechanics, single-leg capacity, anti-rotation | `new` §2.3 (compound bias), §9 (skeleton), v1 §11 (anchor-filler); Tactical Barbell / Westside heritage | MODERATE-HIGH |
| **Durability** | Tissue resilience — tendons, connective tissue, joint health. The rate limiter of long-term hybrid careers | `new` §4 *entire section*, DC-J1, DC-O3, DC-O4 (Baar 2017 HIGH, Magnusson & Kjaer 2019 HIGH, Kongsgaard 2009 HIGH, Alfredson 1998 HIGH) | HIGH |

## 11. Durability is a programmed quality, not optional prehab

**DC-J1 (HIGH):** Tissue-capacity work is allocated within the main plan, not as optional prehab. **Every archetype assigns durability as ≥ secondary or maintenance** with daily microdoses.

**DC-O4 — Weekly bulletproofing stack (HIGH-MODERATE) — every week template MUST include:**

| Slot | Dose | Source |
|---|---|---|
| ≥1 heavy isometric session (patellar / Achilles / posterior-chain stack) | 3 × 30s holds at ≥70% MVC, high-strain joint position | Baar 2017 HIGH |
| ≥1 HSR or eccentric-emphasis movement | 3 × 6–10 @ 70–85% 1RM, 3s eccentric / 3s concentric | Kongsgaard 2009 HIGH |
| ≥1 plyometric exposure (low-amplitude OK) | 30–80 ground contacts | `new` §4.3 + practitioner |
| ≥2 carry exposures (farmer / suitcase / overhead) | 3–4 sets of 30–60s | `new` §4.3 + practitioner |

When a tendinopathy flag is active for the affected region, the plyometric line is **omitted** (per DC-D5 hard-block) and the symptomatic-protocol switches to **Alfredson eccentric** (DC-O3, Alfredson 1998 HIGH) until cleared.

**DC-O2 (HIGH):** Tendon refractory is ~6 hours within a day, ~48 hours across days for the same tendon. Bulletproofing items targeting the same tendon must respect both windows. This is enforceable via the existing region ledger + `highStrainTendon` flag.

**DC-S4 — Prep gate (MODERATE-LOW, soft by default):** If the bulletproofing dose for the session's loaded regions hasn't been completed in the prior 24–48h, the session start surfaces a "prep first" prompt. Skip-with-reason allowed; escalates to hard after 3 skips in 14d per OC-15.

## 12. Functional carryover

Less codified in the research (no single dedicated section) but consistent across the docs:

**`new` §2.3 + §9 + v1 §11:**
- Compound assistance (rows, single-leg presses, RDLs) produces a hypertrophic stimulus AND a movement-quality stimulus simultaneously — earns its place even when the muscle target is otherwise covered.
- Velocity-cued execution / compensatory acceleration is a free upgrade — costs nothing extra in the recovery budget but offsets the power-suppressing tendency of concurrent training (Wilson 2012 HIGH).
- Single-leg work is the highest-value functional accessory for hybrid athletes specifically — corrects asymmetry, builds the unilateral force production running demands, and loads the hip stabilizers compound work misses.

**Anti-rotation core (Pallof press, suitcase carries):** Mentioned implicitly in v1 §4 "trunk under load" framing and codified via the carry requirement in DC-O4. The literature is consistent (McGill 2014 et al. — generally MODERATE-HIGH in the back-pain prevention space): anti-rotation core capacity protects the lumbar trunk during heavy compound work.

## 13. Revised per-archetype mix

Each archetype now declares **per-pillar items per week**, not just total accessory volume. The three pillars run in parallel — the aesthetic table from §2 stays as-is for the aesthetic column; this revision adds functional + durability columns.

| Archetype | Aesthetic sets/wk | Functional items/wk | Durability items/wk |
|---|---|---|---|
| **Strength Focus** | 16–24 | **2–3** (carries + single-leg) | **DC-O4 floor** (4 items min) |
| **Hypertrophy Focus** | 40–48 | 1–2 (carries) | **DC-O4 floor** (4 items min) |
| **Concurrent/Hybrid** | 18–24 | **3** (carries + single-leg + anti-rotation) | **DC-O4 floor** (4 items min) |
| **Endurance Focus** | 6–8 (MV floor only) | **2–3** (hip stabilizer + ankle/foot for running) | **DC-O4 floor + Achilles HSR 2x/wk** |
| **Maintenance** | 0–2 | 1 (carry only) | **DC-O4 minimum subset (isometrics + 1 carry)** |
| **Rebuild** | 4–6 | 1 (tempo/loaded mobility) | **Tendon days carry this** — existing TendonDay primitive |

### 13.1 The durability floor is the same shape across all archetypes

DC-O4 is **not negotiable per archetype**. Every week from every archetype has to satisfy:
- ≥1 heavy isometric
- ≥1 HSR or eccentric
- ≥1 plyometric (unless flagged)
- ≥2 carries

What varies is **how it gets placed**:

| Archetype | Where bulletproofing lives |
|---|---|
| Strength / Hypertrophy / Hybrid | Integrated into existing strength days (HSR substitutes for one accessory; isometric as warm-up extension; carries as session finisher) |
| Endurance | Integrated into the 2 maintenance strength days |
| Maintenance | Compressed into the 2 short strength days — the isometric is the warmup, the HSR is the main work |
| Rebuild | The dedicated TendonDay primitive (already in the codebase) carries all four items |

### 13.2 Endurance Focus needs the Achilles add-on

Per `new` §4.4 (HIGH pattern): "Achilles / patellar: too many running miles ramped too fast, without HSR or isometric calf/quad work." The single highest-ROI durability add for runners is **Achilles HSR 2×/wk** beyond the DC-O4 floor (which already mandates ≥1).

So Endurance Focus carries the bulletproofing floor + a second Achilles HSR exposure. This is the only archetype with a region-specific durability add — earned by the cardio modality.

## 14. Functional accessories — per-archetype defaults

Reading `new` §2.3 + §9, the functional toolkit per archetype:

| Archetype | Primary functional accessories | Why |
|---|---|---|
| Strength | Farmer carry, suitcase carry, single-leg press | Carry-over to deadlift / squat; trunk under load |
| Hypertrophy | Suitcase carry (× 2 per week) | Minimum trunk + grip dose without taxing hypertrophy budget |
| Hybrid | Farmer + Pallof press + Bulgarian split squat | All three pillars hit per item — multi-purpose under tight recovery budget |
| Endurance | Bulgarian split squat, hip airplane, ankle dorsiflexion holds | Running-specific stabilizers; mechanics carryover |
| Maintenance | One carry per session | Cheapest functional dose; protects grip + trunk |
| Rebuild | Loaded carries at light weight (suitcase only) | Builds tolerance without the eccentric/CNS cost of farmers |

## 15. Selection-rule order (revised)

The §5 selection rules now have a clear priority among pillars:

1. **Durability floor first.** Has the week satisfied DC-O4? If not, the next accessory slot is filled from the bulletproofing pool that closes the gap (isometric / HSR / plyo / carry). This is the only **hard** rule.
2. **Functional second.** Has the archetype's functional minimum been met? (Carries × 2 for most, single-leg × 1 for Strength/Hybrid, etc.) If not, fill from the functional pool.
3. **Aesthetic gap-fill third.** Pick from the per-muscle gap-fill picker (§5 original logic).
4. **Variation rotation fourth.** Within an equal-priority gap, prefer a movement not used in the immediately previous session.
5. **Concurrent stress filter applied throughout.** If `concurrent_modifier` active, exclude high-eccentric / high-CNS variants.
6. **Limitations filter applied last.** Skip any movement loading a flagged region; substitute from same-pillar pool.

The order matters: an Endurance Focus user has a tight recovery budget, but DC-O4 is **HIGH evidence-base** and DC-J1 is explicit ("durability is a programmed quality, not prehab"). It comes first.

## 16. Data-model deltas (revised)

The §6 deltas grow modestly:

### Movement-level tags (additive)

```ts
type MovementBulletproofRole =
  | "heavy_isometric"        // DC-O3 protocol (i)
  | "hsr"                    // DC-O3 protocol (ii) — Kongsgaard
  | "alfredson_eccentric"    // DC-O3 protocol (iii) — symptomatic only
  | "plyometric_low"         // low-amplitude
  | "plyometric_high"        // high-amplitude
  | "carry";

type MovementFunctionalRole =
  | "single_leg"
  | "anti_rotation"
  | "loaded_mobility"
  | "compound_assistance"
  | "velocity_cued";

// Movements may have 0..N bulletproof_roles + 0..N functional_roles.
// E.g. a Bulgarian split squat is { functional: ["single_leg"], bulletproof: [] }
// E.g. a Spanish squat hold is { bulletproof: ["heavy_isometric"], functional: [] }
// E.g. a farmer carry is { bulletproof: ["carry"], functional: [] }
```

These are jsonb tag arrays on `movements`, not enums — multiple movements can serve the same role.

### Archetype-level `accessoryProfile` (replaces §6.3 single-pillar version)

```ts
type AccessoryProfile = {
  // Aesthetic pillar (existing)
  aestheticItemsPerSession: number;
  aestheticSetsPerItem: number;
  aestheticReps: { min: number; max: number };
  aestheticBias: "compound_assistance" | "isolation_machine" | "low_fatigue_only" | "minimal";

  // Functional pillar (new)
  functionalItemsPerWeek: number;
  functionalPriorityRoles: MovementFunctionalRole[];

  // Durability pillar — always satisfies DC-O4 floor; archetype may add extras
  durabilityExtras: MovementBulletproofRole[]; // e.g. Endurance gets ["hsr"] for Achilles
};
```

DC-O4 is enforced by the **engine**, not by per-archetype config — the floor is global. The archetype only declares **extras above the floor**.

## 17. Implementation phases (revised)

| Phase | What | Effort |
|---|---|---|
| **A** | Aesthetic pillar — per-archetype config + concurrent + deload | small |
| **B** | Two-a-day + limitation filter | small |
| **B'** | **Durability floor enforcement (DC-O4)** — engine emits "tissue-stack-deficient" warning when week missing any of the 4 items | small-medium |
| **B''** | **Movement tags + tagging the existing catalog** — add `bulletproof_role[]` + `functional_role[]` columns; populate ~30-40 movements | small |
| **C** | Dynamic gap-fill picker (now reads per-pillar gap, not just per-muscle) | medium |
| **C'** | **Functional pillar fill** — picker selects functional items when archetype hasn't satisfied its functional minimum | small-medium |
| **D** | Week-by-week variation rotation | medium |
| **E** | Daily branch overrides (DC-I1) | small-medium |
| **E'** | **DC-S4 prep gate** — soft prompt when current session's loaded region hasn't seen bulletproofing in 24–48h | small |

**Recommended sequence:** A → B'' → B' → C → C' → B → D → E' → E. The durability work (B' + B'' + E') gates before the dynamic picker (C) because the picker needs the tags to do gap-driven selection across all three pillars.

## 18. Confidence delta vs the original draft

The original draft had one HIGH source (Schoenfeld 2017) carrying the whole prescription. The revised three-pillar model is meaningfully better-evidenced:

| Pillar | Top sources | Confidence |
|---|---|---|
| Aesthetic | Schoenfeld 2017 | HIGH |
| Functional | `new` §2.3 + practitioner + v1 §11 | MODERATE-HIGH |
| Durability | Baar 2017 + Magnusson & Kjaer 2019 + Kongsgaard 2009 + Alfredson 1998 + DC-O3/O4 | **HIGH** (four peer-reviewed sources) |

The pillar I missed in the first pass turned out to be the **best-evidenced** of the three. That's the honest answer to your question.
