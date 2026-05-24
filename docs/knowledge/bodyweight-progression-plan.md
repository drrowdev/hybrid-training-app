# Bodyweight Progression — Implementation Plan

**Status:** plan only, not yet started
**Created:** 2026-05-24
**Owner:** project owner (decisions A–F outstanding, see end)

This document captures the 7-phase plan for incorporating bodyweight-only progression into the Hybrid Training App. It builds on:

- `docs/knowledge/hybrid-training-research-v1.md` — the foundational research synthesis
- `docs/knowledge/hybrid-training-bodyweight-addendum.md` *(to be added — currently in the Clawpilot working folder)* — bodyweight-specific corrections and additions

The addendum is **the source of truth** for what bodyweight programming differs from barbell programming. This plan operationalises it into shipped code, in phases.

---

## Foundational principles (from the addendum)

These principles change the engine for bodyweight users:

1. **Strength is relative, not absolute.** Bodyweight strength is a strength-to-mass ratio. Hypertrophy can directly hurt skill on the same movement. Volume landmarks (MEV / MAV / MRV) become fuzzy because a set of one-arm chin-ups ≠ a set of band-assisted pull-ups.
2. **Progression is discrete, not linear.** Replace +2.5 kg with a DAG of skill nodes per family. Jumps are large; **require over-completion** before unlocking the next node.
3. **Hinge is a structural gap.** You cannot load the posterior chain on bodyweight the way a deadlift does. The app must surface the gap and compensate via conditioning modality (hill sprint, ruck, sled).
4. **Tendon timeline is the binding constraint.** Tendons adapt 2–10× slower than muscle. Gate progressions on **accumulated time-under-tension at the previous level**, not just rep performance.
5. **Skill work is neurologically demanding even when "light".** Planche / lever / muscle-up belongs early in the day and early in the week, like heavy strength.
6. **Mixed-modal sessions are a third thing.** Burpee EMOMs, calisthenic circuits, AMRAPs are not Z2 and not strength. Tag them and budget them against both stimuli.
7. **Aesthetics signature:** lean midsection + developed upper, lagging legs. If aesthetics is a goal, lower-body conditioning becomes a hypertrophy input, not just a fitness input.

---

## Phase 1 — Schema + catalog (skill trees as DAGs)

**Goal:** the data exists.

### DB changes

- New table `movement_nodes`:
  - `id` uuid PK
  - `family` text (push_h / push_v / pull_h / pull_v / squat_unilateral / squat_bilateral / hinge / core_anti_flexion / core_anti_rotation / planche / lever_front / lever_back / muscle_up / handstand / human_flag)
  - `node_key` text (unique within family — e.g., `tuck_planche`, `archer_pull_up`)
  - `display_name` text
  - `prerequisites` uuid[] (other node ids that must be owned to access this node — DAG edges)
  - `external_load_capable` bool (true for pull-up / dip / squat — accepts weighted variants)
  - `isometric_capable` bool (true for lever / planche / flag — uses hold time not reps)
  - `unilateral` bool
  - `default_tempo_seconds` int (eccentric component, default for the prescription)
  - `tut_per_rep_seconds` int (helper for the effective-difficulty math)
  - `difficulty_anchor` int (1–100, rough subjective ranking used for cross-family normalisation)

- New table `bw_progress`:
  - `user_id` uuid FK
  - `family` text
  - `current_node_id` uuid FK movement_nodes
  - `accumulated_tut_seconds` int (across all sessions at this node)
  - `weeks_at_node` int
  - `clean_rep_history` jsonb (sliding window of last N sessions: `[{date, reps, tempo, rir}]`)
  - `updated_at` timestamptz
  - Composite PK (`user_id`, `family`)

- Make `training_maxes.weight_kg` nullable (already nullable per PR #88 backfill). Add:
  - `bw_node_id` uuid FK movement_nodes nullable
  - Constraint: row must have either `weight_kg` OR `bw_node_id`.

### Catalog seeding

Six core families + skill families:

| Family | Nodes (~) | Notes |
|---|---|---|
| push_h | 8 | wall / counter / knee / standard / decline / diamond / archer / one-arm |
| push_v | 6 | pike / wall HSPU / freestanding HSPU progression |
| pull_v | 8 | dead hang / scapular pull / band-assist / negative / strict / wide / archer / one-arm |
| pull_h | 5 | inverted row / feet-elevated / archer row / one-arm row variants |
| squat_unilateral | 6 | split squat / Bulgarian / shrimp / pistol assisted / strict pistol / shrimp pistol |
| squat_bilateral | 4 | BW squat / jump squat / sissy / deficit |
| hinge | 5 | hip hinge / single-leg RDL / glute-ham raise / Nordic eccentric / Nordic concentric |
| planche | 6 | lean / tuck / advanced tuck / straddle / full / one-arm |
| lever_front | 5 | tuck / advanced tuck / straddle / half / full |
| lever_back | 4 | tuck / straddle / full / one-arm |
| muscle_up | 3 | jumping / explosive / strict |
| handstand | 4 | wall walk / wall hold / freestanding hold / press |
| human_flag | 3 | clutch / vertical / horizontal |
| core_anti_flexion | 4 | dead bug / plank / hollow body / dragon flag |
| core_anti_rotation | 3 | side plank / pallof / windmill |

**~75 nodes total.** Each tagged with prerequisites (DAG edges), tempo defaults, and difficulty anchor.

### Helpers

`apps/web/src/lib/planner/bw-difficulty.ts`:

```ts
export function effectiveDifficulty(input: {
  node: MovementNode;
  reps: number;
  tempoSec: number;
  rir: number;
  externalLoadKg: number;
  userBodyweightKg: number;
}): number;
```

Returns a normalised score that lets the engine compare a set of one-arm chins to a set of weighted pull-ups to a set of muscle-ups. Calibration is iterative (Phase 4 will likely tweak).

### Tests

Catalog snapshot tests (every node has a sensible prerequisite chain, no cycles in the DAG, every family has at least 1 entry node with empty prerequisites). Difficulty helper unit tests covering range of inputs.

### Effort
~ 1 PR. Catalog seeding is the bottleneck — ~ 3–4 hours of focused taxonomy work either by hand or by a dedicated agent run.

### No UI changes in this phase.

---

## Phase 2 — Multi-page onboarding assessment

**Goal:** new BW users start at the right node.

For users whose equipment lacks loadable main lifts (post-PR #88 detection), the TM step is replaced with a three-page assessment.

### Page 1 — Rep tests

- "How many strict push-ups can you do in one set?" (numeric)
- "How many strict pull-ups can you do in one set?" (numeric, including assisted)
- "How many bodyweight squats can you do in one minute?" (numeric)

Maps rep counts to a starting node per family via a calibration table. Defaults if skipped: node-level 3 (kneeling push-up / band-assisted pull-up / BW squat).

### Page 2 — Skill chips

Chip grid; tap any skill the user can perform with strict form for **at least 3 clean reps** (or hold for 5+ seconds for static skills).

The list **excludes** entry-level exercises already covered by rep tests (no push-up, no BW squat, no band-assisted pull-up).

Layout: four columns by family. ~25 chips total.

**UPPER PULL**
- Strict pull-up × 5+
- Weighted pull-up
- Archer pull-up
- Front lever (tuck)
- Front lever (advanced tuck)
- Front lever (straddle)
- Front lever (full)
- One-arm chin-up
- Strict muscle-up

**UPPER PUSH**
- Strict dip × 5+
- Ring dip
- Pseudo planche push-up
- Pike push-up
- Wall handstand push-up
- Freestanding handstand push-up
- Tuck planche (5s hold)
- Advanced tuck planche
- Straddle planche
- Full planche

**LOWER**
- Pistol squat × 5+
- Shrimp squat
- Nordic curl (eccentric)
- Nordic curl (concentric)

**CORE**
- Hollow body hold (30s+)
- Dragon flag
- L-sit (10s+)
- V-sit
- Human flag

### Selection behaviour

Tapping a skill **auto-selects its prerequisites** (e.g., selecting "Front lever advanced tuck" silently checks "Front lever tuck"). Surfaced visually as "auto-included" so the user understands what happened.

### Page 3 — Hinge-gap acknowledgement

A single screen:

```
Bodyweight has a known posterior-chain limitation.

Loaded hinge movements (deadlift, RDL) build the back, hamstrings, and
glutes in ways that bodyweight cannot fully replicate. We can compensate
via conditioning:

(·) Include posterior-chain conditioning compensators
    Hill sprints, weighted ruck (if vest), sled drag, sprint mechanics

( ) I'll handle this myself
( ) Skip — accept the gap as a known weakness
```

Default: include. The choice writes to a user preference field consulted later by the conditioning picker.

### Output

Writes `bw_progress` rows per family with the starting node + flagged skills. Default rep-test fallback for unselected families.

### "Skip the quiz" path

Top-right "skip — start with defaults" link. Sets every family to node-level 3, no skill chips set.

### Tests

E2E spec walks the three pages, asserts `bw_progress` rows are written correctly. Unit tests for the rep-count → starting-node calibration table.

### Effort
~ 1 PR.

---

## Phase 3 — Engine prescription with skill trees

**Goal:** bodyweight users get a real main-lift workout.

### Detection

Planner detects bodyweight users via:
1. `resolveEquipment(profile)` → `hasLoadableMainLift === false`
2. AND `bw_progress` rows exist for at least one family

If both true: BW prescription path. Otherwise: existing barbell path.

### Per-archetype matrix

Each archetype's main-lift slot gets a BW-specific shape:

| Archetype | Wk 1 | Wk 2 | Wk 3 (push) | Wk 4 (deload) |
|---|---|---|---|---|
| **Strength** | current node · 5–6 reps · RIR 2 · 2-1-2 tempo | current node · 4–6 reps · RIR 1 · 2-1-2 | current node + 1 · 3–5 reps · RIR 0–1 · 2-1-2 | current node · 4 reps · RIR 3 |
| **Hypertrophy** | current node · 10–15 reps · RIR 1–2 | current node · 12–18 reps · RIR 0–1 (some sets to failure) | current node · 15–20 reps · RIR 0–1 | current node · 8 reps · RIR 3 |
| **Endurance** | current node − 1 · 20–30 reps · RIR 2 · density bias | current node − 1 · 25–35 · RIR 2 · density bias | current node − 1 · 30–40 · RIR 2 | current node − 1 · 15 reps · RIR 3 |
| **Concurrent Hybrid** | current node · 8–10 reps · RIR 1–2 | current node · 10–12 · RIR 1 | current node · 10–15 · RIR 0–1 OR current node + 1 · 5–6 · RIR 0–1 | current node · 6 reps · RIR 3 |
| **Rebuild** | current node − 1 · 8 reps · 3-1-2 tempo · RIR 2 | current node · 8 reps · 3-1-2 · RIR 2 | current node · 10 reps · 2-1-2 · RIR 1 | current node − 1 · 5 reps · RIR 3 |
| **Maintenance** | current node · 6–8 reps · RIR 2 | current node · 6–8 · RIR 2 | — | — |

Each main session picks one node per family, biased by archetype (Strength → push V + pull V + squat unilateral; Hypertrophy → balanced family rotation; Endurance → push H + pull H + squat bilateral for higher rep ranges; etc.).

### Static skills (planche / lever / human flag)

When the user has a skill node selected and `isometric_capable === true`, the prescription uses **hold time** instead of reps. Format:

```
PLANCHE · SET 1 OF 4
[ Advanced tuck · 8-12s hold chip ]
"Hold steady, neutral spine, slight protraction."
```

Skill sessions get a CNS-priority flag — scheduler places them early in the day and early in the week.

### Focus view rendering

For BW main-lift items, the focus card shows:
- Current node name (e.g., "Archer Pull-Up")
- Target reps OR hold time (depending on isometric_capable)
- Tempo cue
- Vest / belt weight stepper IF the user owns one (PR 7 territory; placeholder for now)
- "Next:" preview showing the next node in the DAG

Plate calculator stays hidden (PR #82 already gates it to barbell movements with TMs).

### Skill-CNS scheduling

The scheduler (existing) is extended: sessions with one or more **skill nodes** (planche / lever / flag / muscle-up / one-arm) flagged with `skillCns: true` get prioritised:
- Place on Day 1 or Day 2 of the week
- Place AM, not PM
- Don't pair with hard cardio earlier in the day

If a user opts into 2 skill families, both can't be Day-1-AM — the scheduler distributes them across the week.

### Tests

Unit tests for the prescription generator covering each archetype × week × family combo. E2E spec creating a BW block and verifying the planned session has BW main-lift items in the right shape.

### Effort
~ 1–2 PRs (could split: matrix + render in PR A, skill-CNS scheduling in PR B). Biggest piece overall.

---

## Phase 4 — TUT-gated progression engine

**Goal:** the app suggests variant bumps after consistent clean sessions, gated by tendon adaptation time.

### Bump trigger

After session completion, helper inspects each BW main-lift family the user logged:

A node bump is suggested only when **all three** are true:
1. **Clean completion**: user hit the **top of the prescribed rep range** at **RIR ≤ 1** on every working set this session.
2. **TUT accumulation**: user has accumulated ≥ `nodeTutTargetSeconds` total time-under-tension at this node across the **last 2 weeks**. Per-node target stored in `movement_nodes`. Default: 240s for entry nodes, 480s for intermediate, 720s for advanced.
3. **Sustained clean weeks**: user has hit clean completion for **2 consecutive weeks** of sessions, not just one.

When all three fire, write a `tm_suggestions` row with `kind: 'bw_variant_bump'`, suggested next node from the DAG.

### Bump-down trigger

Inverse path. After 2 consecutive sessions where the user:
- Failed to hit the **bottom of the rep range** with RIR ≥ 2
- OR skipped 50%+ of prescribed sets

Suggest the previous node in the DAG. Same accept/dismiss banner.

### Banner

On Today page, when a pending `bw_variant_bump` suggestion exists:

```
Ready to level up your pull-up?
You've hit 12 clean reps for 2 weeks. Archer pull-up is next.
[ Accept · update training max ]   [ Not yet ]
```

Same accept/dismiss flow as PR #52's existing AMRAP TM-bump. Accept writes the new `current_node_id` to `bw_progress`.

### Tests

Unit tests for the trigger logic across the three gates. Snapshot tests for the suggestion-content shape.

### Effort
~ 1 PR.

---

## Phase 5 — Mixed-modal classifier + hinge compensator

**Goal:** the engine knows when a circuit is a third thing, and BW users get conditioning that fills the posterior-chain gap.

### Session classifier

After every logged session, classify it into one of:
- `strength_pure` — heavy main lifts, low rep, long rest
- `strength_endurance` — moderate load, 8–15 reps, short rest
- `z2_steady` — long aerobic, conversational pace
- `threshold` — sustained tempo, RPE 7–8
- `vo2` — short hard intervals
- `mixed_modal` — circuits / AMRAPs / EMOMs mixing strength + cardio

Heuristic v1 (no HR data needed):
- Duration > 40 min + average RPE > 7 + ≥ 3 different muscle groups → `mixed_modal`
- Single-modality cardio_log present → use modality field
- Strength-only with ≥ 3 working sets per movement → `strength_pure` or `strength_endurance` based on rep range
- Otherwise → ask the user at session completion ("How would you call this session?")

`mixed_modal` sessions count against **both** strength and cardio budgets in the planner's interference math (Wilson 2012 already cited in the existing engine — same model applies).

### Hinge compensator

When the user's equipment is BW-only AND the active archetype has hinge-light prescription:
- Conditioning picker biases toward **posterior-chain modalities**: hill sprints, weighted ruck (if vest), sled drag, sprint mechanics work, glute-ham raise circuits.
- Banner on `/app/plan` if weekly hinge volume falls below a threshold:

```
Posterior-chain volume looks light this week.
Bodyweight programming can't load the hinge like a deadlift. Consider
adding a hill-sprint or ruck session to compensate. We'll suggest one
in your next block.
[ Add now ]   [ Dismiss for this block ]
```

### Tests

Classifier unit tests across the 6 categories. Hinge-compensator unit test with a fake BW user's weekly hinge volume.

### Effort
~ 1 PR.

---

## Phase 6 — Strength-mass drift detection

**Goal:** flag when bodyweight change is fighting the user's skill goal.

### Detection

Weekly job (or session-completion hook) checks:
- User's bodyweight trend over the last 4 weeks (from `wellness.bodyweight_kg`)
- User's active archetype (Strength / Hypertrophy / etc.)
- User's selected skill goals (Phase 2 chip selections, or optional skill-goal field added in Phase 3+)

Triggers:

| Condition | Banner |
|---|---|
| User is in a skill phase (one-arm pull-up / front lever / planche selected) AND has gained ≥ 2 kg over 4 weeks | "You're working toward [skill]. Skill movements get harder as bodyweight goes up — want to hold weight steady?" |
| User is in a hypertrophy phase AND lost ≥ 2 kg over 4 weeks | "Hypertrophy needs a small surplus. Want to check your eating window?" |
| User flagged 'aesthetics' as a goal AND has lost > 0.5 kg per week for 3 weeks | "You're losing weight fast — muscle goes too at that rate. Slow to 0.3–0.5 kg/wk." |

Surface in the Today header as a soft signal — small chip + tap to expand. Not a modal.

### Tests

Unit tests for each trigger condition. Edge cases: user with no bodyweight log, user who toggled off skill goals, conflicting goals.

### Effort
~ 1 PR.

---

## Phase 7 — Loaded bodyweight (deferred)

**Goal:** weighted vest, dip belt, ankle weights unlock weighted variants. Bridges BW to existing TM model.

When user adds weighted vest or dip belt to equipment:

- Picker considers `external_load_capable === true` variants
- Prescription gets an additional `externalLoadKg` field
- Effective-difficulty score factors in the added load
- "Training max" for weighted pull-up: `bodyweight_kg × bw_multiplier(node) + vest_kg`. The multiplier is a per-node lookup: pull-up = 1.0, archer = 1.4, one-arm = 2.0 (rough leverage equivalents).

Suggestion engine: once a user's weighted pull-up is consistent at +20 kg with RIR 1, suggest variant bump OR added load increase. Bidirectional choice surfaced as a small selector in the banner.

### Effort
~ 1 PR. Defer until 1–6 ship and are stable.

---

## Decision matrix (recap from chat thread)

| ID | Question | Recommendation |
|---|---|---|
| **A** | Catalog scope | **Big 6 + skill trees** (planche, lever, flag, muscle-up, handstand). Addendum makes clear advanced BW IS skill work. |
| **B** | Calibration | **3-page assessment quiz** (rep tests + skill chips + hinge ack) with "skip — start with defaults" path. |
| **C** | Loaded BW timing | **Phase 7, deferred.** Ship base BW first. |
| **D** | Variant swap UI | **"Next:" hint always visible** in the focus view AND existing swap modal stays available. |
| **E** | Existing BW user migration | **Manual upgrade on next block.** Existing blocks run as-is; new shape kicks in for new blocks. |
| **F** | Catalog tagging effort | **Agent-driven DAG seeding with project-owner review.** Validated against calisthenics practitioner consensus literature (Beast Skills, Steven Low's Overcoming Gravity treated as practitioner references — no brand citations in code). |

---

## Risks

1. **Skill-tree DAG correctness.** Wrong prerequisites = nonsensical prescriptions. Validate against established calisthenics practitioner literature. Cite as "calisthenics practitioner consensus," not the brand name.
2. **Effective-difficulty score calibration.** Composite formula needs intuition checks. Iterate as Phase 4 ships.
3. **Mixed-modal classifier reliability without HR data.** May need user confirmation at session completion until HR streams are wired (Phase 8+ territory).
4. **Catalog tagging hours.** ~75 nodes × prerequisites + tempo defaults + difficulty anchors is meaningful taxonomy work. Easy to under-estimate.

---

## Total effort estimate

- Phases 1–4: ~ 4–5 PRs · ~ 20–25 agent-hours
- Phase 5: ~ 1 PR · ~ 4–5 hours
- Phase 6: ~ 1 PR · ~ 3 hours
- Phase 7: ~ 1 PR · ~ 4 hours (deferred)

**Total: ~ 7 PRs.** Each phase is independently shippable and visible — no big-bang merges.

---

## Cross-references

- Existing onboarding equipment step: PR #87
- Bodyweight-only fallback (current behaviour, to be replaced): PR #88
- Existing accessory RIR matrix (precedent for archetype × week matrices): PR #83
- Existing carry distance prescription: PR #84
- AMRAP-driven TM bump (precedent for variant-bump flow): PR #52
- Tendon work + HSR citations: PR #83 (Baar 2017, Kongsgaard 2009)

---

## Open follow-ups before Phase 1 starts

1. Save the bodyweight addendum into `docs/knowledge/hybrid-training-bodyweight-addendum.md` so it lives alongside this plan and the existing research documents.
2. Confirm decision matrix above (A–F).
3. Decide on catalog seeding approach: agent-driven OR project-owner-curated. Either works; agent is faster, owner-curated is more confident.

Then Phase 1 dispatches.
