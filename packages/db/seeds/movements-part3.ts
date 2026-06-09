/**
 * Movement catalog seed — part 3: cardio modalities, plyo/power, Olympic lifts,
 * tendon/resilience, rotator cuff, run drills.
 */
import type {
  AxialLoad,
  InterferenceCost,
  NewMovement,
  Stability,
} from "../src/schema/movements";

type Region =
  | "foot_ankle_calf"
  | "knee"
  | "hamstring_posterior"
  | "adductor_groin"
  | "lumbar_trunk"
  | "shoulder_scapular"
  | "elbow_forearm";

type MoveOpts = Partial<NewMovement>;

function m(slug: string, displayName: string, opts: MoveOpts = {}): NewMovement {
  return {
    userId: null,
    slug,
    displayName,
    pattern: "isolation",
    primaryRegion: "knee" as Region,
    secondaryRegions: [],
    primaryMuscles: [],
    secondaryMuscles: [],
    equipment: null,
    isCompound: false,
    interferenceCost: "low" as InterferenceCost,
    highStrainTendon: false,
    axialLoad: "low" as AxialLoad,
    stability: "free" as Stability,
    bilateral: true,
    bodyWeightLoaded: false,
    experienceMin: 0,
    experienceMax: 4,
    metadata: {},
    ...opts,
  };
}

// ─── cardio: cycling (8) — low interference per Wilson 2012 HIGH ───
const bike = (slug: string, name: string, opts: MoveOpts = {}): NewMovement =>
  m(slug, name, {
    pattern: "cardio",
    primaryRegion: "knee",
    secondaryRegions: ["hamstring_posterior", "foot_ankle_calf"],
    primaryMuscles: ["quads", "glutes", "hamstrings"],
    secondaryMuscles: ["calves"],
    interferenceCost: "low",
    metadata: { modality: "cycling", impact: "very_low", eccentric_cost: "very_low" },
    ...opts,
  });

const CYCLING: NewMovement[] = [
  bike("bike-indoor-z2", "Indoor Bike — Z2", { equipment: "stationary-bike", metadata: { modality: "cycling", zone: "Z2", duration_target_min: 45 } }),
  bike("bike-indoor-threshold", "Indoor Bike — Threshold", { equipment: "stationary-bike", interferenceCost: "low_moderate", metadata: { modality: "cycling", zone: "Z4", duration_target_min: 30 }, experienceMin: 1 }),
  bike("bike-indoor-vo2-4x4", "Indoor Bike — VO2 4×4", { equipment: "stationary-bike", interferenceCost: "moderate", metadata: { modality: "cycling", zone: "Z5", protocol: "4x4min-3min-recovery" }, experienceMin: 2 }),
  bike("bike-indoor-sprints", "Indoor Bike — Sprint Intervals", { equipment: "stationary-bike", interferenceCost: "low", metadata: { modality: "cycling", protocol: "alactic-30s-on-90s-off", emphasis: "alactic" }, experienceMin: 2 }),
  bike("bike-outdoor-easy", "Outdoor Bike — Easy", { equipment: "road-bike", metadata: { modality: "cycling", zone: "Z1-Z2" } }),
  bike("bike-outdoor-long", "Outdoor Bike — Long", { equipment: "road-bike", metadata: { modality: "cycling", zone: "Z2", duration_target_min: 120 } }),
  bike("bike-mtb", "Mountain Bike", { equipment: "mountain-bike", interferenceCost: "low_moderate", metadata: { modality: "cycling", terrain: "trail" } }),
  bike("bike-spin-class", "Spin Class", { equipment: "spin-bike", interferenceCost: "low_moderate", metadata: { modality: "cycling" } }),
];

// ─── cardio: running (10) — moderate-to-high interference per Wilson 2012 ───
const run = (slug: string, name: string, opts: MoveOpts = {}): NewMovement =>
  m(slug, name, {
    pattern: "cardio",
    primaryRegion: "foot_ankle_calf",
    secondaryRegions: ["knee", "hamstring_posterior"],
    primaryMuscles: ["calves", "quads", "hamstrings", "glutes"],
    secondaryMuscles: ["tibialis"],
    interferenceCost: "moderate",
    metadata: { modality: "running", impact: "moderate-to-high", eccentric_cost: "moderate" },
    ...opts,
  });

const RUNNING: NewMovement[] = [
  run("run-easy-z2", "Easy Run — Z2", { equipment: "shoes", metadata: { modality: "running", zone: "Z2", impact: "moderate" } }),
  run("run-long-z2", "Long Easy Run", { equipment: "shoes", metadata: { modality: "running", zone: "Z2", duration_target_min: 90 } }),
  run("run-recovery", "Recovery Run", { equipment: "shoes", interferenceCost: "low_moderate", metadata: { modality: "running", zone: "Z1" } }),
  run("run-tempo", "Tempo Run", { equipment: "shoes", interferenceCost: "moderate_high", metadata: { modality: "running", zone: "Z3" }, experienceMin: 1 }),
  run("run-threshold", "Threshold Run", { equipment: "shoes", interferenceCost: "moderate_high", metadata: { modality: "running", zone: "Z4" }, experienceMin: 1 }),
  run("run-vo2-4x4", "VO2 Intervals — 4×4", { equipment: "shoes", interferenceCost: "high", metadata: { modality: "running", zone: "Z5", protocol: "4x4min" }, experienceMin: 2 }),
  run("run-vo2-1k-repeats", "VO2 1k Repeats", { equipment: "shoes-track", interferenceCost: "high", metadata: { modality: "running", protocol: "5-8x1km" }, experienceMin: 2 }),
  run("run-hill-sprints", "Hill Sprints", { equipment: "outdoor-hill", interferenceCost: "variable", highStrainTendon: false, metadata: { modality: "running", emphasis: "alactic-power", impact: "high" }, experienceMin: 2 }),
  run("run-track-400", "Track 400s", { equipment: "track", interferenceCost: "high", metadata: { modality: "running", protocol: "8-12x400m" }, experienceMin: 2 }),
  run("run-treadmill-easy", "Treadmill — Easy", { equipment: "treadmill", interferenceCost: "low_moderate", metadata: { modality: "running", zone: "Z2" } }),
];

// ─── cardio: rowing (5) ───
const row = (slug: string, name: string, opts: MoveOpts = {}): NewMovement =>
  m(slug, name, {
    pattern: "cardio",
    primaryRegion: "lumbar_trunk",
    secondaryRegions: ["hamstring_posterior", "knee", "shoulder_scapular"],
    primaryMuscles: ["lats", "mid_back", "quads", "hamstrings", "glutes"],
    secondaryMuscles: ["lower_back", "rear_delts", "biceps"],
    interferenceCost: "low_moderate",
    metadata: { modality: "rowing", impact: "very_low" },
    ...opts,
  });

const ROWING: NewMovement[] = [
  row("erg-z2", "Erg Row — Z2", { equipment: "erg", metadata: { modality: "rowing", zone: "Z2" } }),
  row("erg-threshold", "Erg Row — Threshold", { equipment: "erg", interferenceCost: "moderate", metadata: { modality: "rowing", zone: "Z4" }, experienceMin: 1 }),
  row("erg-intervals-500", "Erg Row — 500m Intervals", { equipment: "erg", interferenceCost: "moderate", metadata: { modality: "rowing", protocol: "6-10x500m", kind: "cardio_vo2" }, experienceMin: 2 }),
  row("erg-sprints-30-30", "Erg Row — 30/30 Sprints", { equipment: "erg", interferenceCost: "moderate", metadata: { modality: "rowing", protocol: "tabata-style" }, experienceMin: 2 }),
  row("erg-2k-tt", "Erg Row — 2k Time Trial", { equipment: "erg", interferenceCost: "high", metadata: { modality: "rowing", emphasis: "max-effort-test", kind: "cardio_vo2" }, experienceMin: 2 }),
];

// ─── cardio: other modalities (15) ───
const sled = (slug: string, name: string, opts: MoveOpts = {}): NewMovement =>
  m(slug, name, {
    pattern: "cardio",
    primaryRegion: "knee",
    secondaryRegions: ["hamstring_posterior", "lumbar_trunk"],
    primaryMuscles: ["quads", "glutes", "calves"],
    secondaryMuscles: ["hamstrings", "lower_back"],
    interferenceCost: "very_low",
    metadata: { modality: "sled", impact: "very_low", eccentric_cost: "very_low" },
    ...opts,
  });

const ruck = (slug: string, name: string, opts: MoveOpts = {}): NewMovement =>
  m(slug, name, {
    pattern: "cardio",
    primaryRegion: "foot_ankle_calf",
    secondaryRegions: ["knee", "hamstring_posterior", "lumbar_trunk"],
    primaryMuscles: ["calves", "quads", "glutes"],
    secondaryMuscles: ["lower_back", "abs", "traps"],
    interferenceCost: "low_moderate",
    metadata: { modality: "rucking", impact: "low" },
    ...opts,
  });

const swim = (slug: string, name: string, opts: MoveOpts = {}): NewMovement =>
  m(slug, name, {
    pattern: "cardio",
    primaryRegion: "shoulder_scapular",
    secondaryRegions: ["lumbar_trunk"],
    primaryMuscles: ["lats", "front_delts", "mid_back"],
    secondaryMuscles: ["triceps", "abs"],
    interferenceCost: "very_low",
    metadata: { modality: "swimming", impact: "none" },
    ...opts,
  });

const OTHER_CARDIO: NewMovement[] = [
  sled("sled-push-light", "Sled Push — Light", { equipment: "sled", metadata: { modality: "sled", emphasis: "Z2-equivalent" } }),
  sled("sled-push-heavy", "Sled Push — Heavy", { equipment: "sled", metadata: { modality: "sled", emphasis: "strength-cardio-hybrid" }, experienceMin: 2 }),
  sled("sled-drag-light", "Sled Drag — Light", { equipment: "sled" }),
  sled("sled-drag-heavy", "Sled Drag — Heavy", { equipment: "sled" }),
  sled("sled-drag-backwards", "Backwards Sled Drag", { equipment: "sled", primaryMuscles: ["quads", "calves"], metadata: { modality: "sled", emphasis: "VMO-knee-rehab" } }),
  ruck("ruck-light", "Rucking — Light Load", { equipment: "rucksack", metadata: { modality: "rucking", load_kg: 10, zone: "Z2" } }),
  ruck("ruck-heavy", "Rucking — Heavy Load", { equipment: "rucksack", metadata: { modality: "rucking", load_kg: 20 } }),
  ruck("ruck-hill", "Hill Rucking", { equipment: "rucksack-outdoor", interferenceCost: "moderate", metadata: { modality: "rucking", terrain: "hill" } }),
  swim("swim-easy", "Swim — Easy Lap", { equipment: "pool", metadata: { modality: "swimming", zone: "Z2" } }),
  swim("swim-intervals", "Swim — Intervals", { equipment: "pool", interferenceCost: "low_moderate", metadata: { modality: "swimming" }, experienceMin: 2 }),
  swim("swim-open-water", "Open Water Swim", { equipment: "open-water", metadata: { modality: "swimming" } }),
  m("stair-climber-z2", "Stair Climber — Z2", { pattern: "cardio", primaryRegion: "knee", secondaryRegions: ["hamstring_posterior", "foot_ankle_calf"], primaryMuscles: ["quads", "glutes", "calves"], interferenceCost: "low_moderate", equipment: "stair-machine", metadata: { modality: "stair", zone: "Z2" } }),
  m("elliptical-z2", "Elliptical — Z2", { pattern: "cardio", primaryRegion: "knee", primaryMuscles: ["quads", "glutes", "hamstrings", "calves"], interferenceCost: "low", equipment: "elliptical", metadata: { modality: "elliptical", zone: "Z2", impact: "none" } }),
  m("jump-rope-singles", "Jump Rope — Singles", { pattern: "cardio", primaryRegion: "foot_ankle_calf", primaryMuscles: ["calves", "tibialis"], secondaryMuscles: ["forearms"], interferenceCost: "low_moderate", equipment: "jump-rope", metadata: { modality: "jump-rope", impact: "moderate" } }),
  m("ski-erg", "Ski Erg", { pattern: "cardio", primaryRegion: "lumbar_trunk", secondaryRegions: ["shoulder_scapular"], primaryMuscles: ["lats", "abs", "triceps"], secondaryMuscles: ["chest", "mid_back"], interferenceCost: "low_moderate", equipment: "ski-erg", metadata: { modality: "ski-erg", impact: "none" } }),
];

// ─── plyo / power (18) ───
// Default `functionalRoles: ["power_plyometric"]` so the experience-tier
// gate in `accessory-picker.ts` can recognise these rows out of the seed.
// Loaded / explosive-intent variants (jump-squat, med-ball throws, etc.)
// override per-row with `power_ballistic` — mirroring the post-seed
// tagging in migrations 0023 + 0024.
const plyo = (slug: string, name: string, opts: MoveOpts = {}): NewMovement =>
  m(slug, name, {
    pattern: "plyometric",
    primaryRegion: "knee",
    secondaryRegions: ["foot_ankle_calf", "hamstring_posterior"],
    primaryMuscles: ["quads", "glutes", "calves"],
    secondaryMuscles: ["hamstrings"],
    interferenceCost: "low",
    highStrainTendon: true,
    functionalRoles: ["power_plyometric"],
    // Default plyo band: entry-level (broad-jump, jump-squat, pogo) need
    // at least novice (1) — beginners shouldn't be exposed to high-impact
    // RFD work straight off the bat. Override per-row for moderate/advanced.
    experienceMin: 1,
    experienceMax: 4,
    metadata: { cns_cost: "high", impact: "high", emphasis: "rate-of-force-development" },
    ...opts,
  });

const PLYO: NewMovement[] = [
  plyo("box-jump-low", "Box Jump (low)", { equipment: "box", metadata: { protocol: "ground-contacts-progression" } }),
  plyo("box-jump-high", "Box Jump (high)", { equipment: "box", metadata: { emphasis: "max-vertical" }, experienceMin: 2 }),
  plyo("broad-jump", "Broad Jump", { equipment: "bodyweight" }),
  plyo("depth-jump", "Depth Jump", { equipment: "box", metadata: { emphasis: "reactive-strength", impact: "very_high" }, experienceMin: 3 }),
  plyo("vertical-jump", "Vertical Jump", { equipment: "bodyweight" }),
  plyo("tuck-jump", "Tuck Jump", { equipment: "bodyweight" }),
  plyo("pogo-hop", "Pogo Hop", { equipment: "bodyweight", primaryMuscles: ["calves"], primaryRegion: "foot_ankle_calf", metadata: { emphasis: "achilles-stiffness" } }),
  plyo("single-leg-bound", "Single-Leg Bound", { equipment: "bodyweight", bilateral: false, experienceMin: 3 }),
  plyo("lateral-hop", "Lateral Hop", { equipment: "bodyweight", bilateral: false }),
  plyo("med-ball-slam", "Med Ball Slam", { equipment: "med-ball", primaryMuscles: ["abs", "lats"], highStrainTendon: false, functionalRoles: ["power_ballistic"], metadata: { emphasis: "explosive-trunk" }, experienceMin: 2 }),
  plyo("med-ball-chest-pass", "Med Ball Chest Pass", { equipment: "med-ball", primaryMuscles: ["chest", "triceps", "front_delts"], primaryRegion: "shoulder_scapular", highStrainTendon: false, functionalRoles: ["power_ballistic"] }),
  plyo("med-ball-rotational-throw", "Med Ball Rotational Throw", { equipment: "med-ball", primaryMuscles: ["obliques", "abs"], primaryRegion: "lumbar_trunk", highStrainTendon: false, bilateral: false, functionalRoles: ["power_ballistic"], experienceMin: 2 }),
  // power_plyometric additions (PR #22 follow-up — proposed slugs that didn't exist in the catalog).
  plyo("hurdle-hop", "Hurdle Hop", { equipment: "hurdles", primaryMuscles: ["calves", "quads"], secondaryMuscles: ["glutes", "abs"], primaryRegion: "foot_ankle_calf", metadata: { emphasis: "reactive-strength", impact: "high" }, experienceMin: 3 }),
  plyo("skater-jump", "Skater Jump", { equipment: "bodyweight", primaryMuscles: ["glutes", "quads"], secondaryMuscles: ["abs", "calves", "abductors"], bilateral: false, metadata: { emphasis: "frontal-plane-power", impact: "high" } }),
  plyo("split-squat-jump", "Split Squat Jump", { equipment: "bodyweight", primaryMuscles: ["quads", "glutes"], secondaryMuscles: ["calves", "abs", "hamstrings"], bilateral: false, metadata: { emphasis: "single-leg-power", impact: "high" }, experienceMin: 2 }),
  // power_ballistic additions — loaded / explosive-intent plyometrics. Tagged in 0024.
  plyo("jump-squat", "Jump Squat", { equipment: "barbell-or-bodyweight", primaryMuscles: ["quads", "glutes"], secondaryMuscles: ["calves", "abs", "hamstrings"], isCompound: true, axialLoad: "high", functionalRoles: ["power_plyometric", "power_ballistic"], metadata: { emphasis: "loaded-vertical-power", impact: "high" } }),
  plyo("banded-jump", "Banded Jump", { equipment: "band", primaryMuscles: ["quads", "glutes"], secondaryMuscles: ["calves", "abs", "hamstrings"], functionalRoles: ["power_plyometric", "power_ballistic"], metadata: { emphasis: "eccentric-overload", impact: "high" } }),
  plyo("medicine-ball-overhead-throw", "Med Ball Overhead Throw", { equipment: "med-ball", primaryMuscles: ["glutes", "hamstrings", "lats"], secondaryMuscles: ["abs", "front_delts", "lower_back"], primaryRegion: "hamstring_posterior", secondaryRegions: ["lumbar_trunk", "shoulder_scapular"], highStrainTendon: false, functionalRoles: ["power_ballistic"], metadata: { emphasis: "posterior-chain-throw", impact: "low" }, experienceMin: 2 }),
];

// ─── Olympic lifts (12) ───
// Default `functionalRoles: ["power_olympic"]`. The KB clean-and-jerk row
// overrides per-row with `power_ballistic` to match migration 0024.
const oly = (slug: string, name: string, opts: MoveOpts = {}): NewMovement =>
  m(slug, name, {
    pattern: "olympic",
    primaryRegion: "hamstring_posterior",
    secondaryRegions: ["knee", "lumbar_trunk", "shoulder_scapular"],
    primaryMuscles: ["hamstrings", "glutes", "quads", "traps"],
    secondaryMuscles: ["lower_back", "front_delts", "calves", "forearms"],
    isCompound: true,
    axialLoad: "high",
    highStrainTendon: true,
    functionalRoles: ["power_olympic"],
    // Default Olympic band: even hang variants demand technique above
    // novice level. Per-row overrides bump high-skill derivatives
    // (overhead-squat, drop-snatch, jerks) up to (3, 4).
    experienceMin: 2,
    experienceMax: 4,
    metadata: { cns_cost: "very_high", emphasis: "rate-of-force-development" },
    ...opts,
  });

const OLYMPIC: NewMovement[] = [
  oly("power-clean", "Power Clean", { equipment: "barbell" }),
  oly("hang-clean", "Hang Clean", { equipment: "barbell" }),
  oly("hang-power-clean", "Hang Power Clean", { equipment: "barbell" }),
  oly("clean-pull", "Clean Pull", { equipment: "barbell", metadata: { emphasis: "second-pull-power" } }),
  oly("power-snatch", "Power Snatch", { equipment: "barbell" }),
  oly("hang-snatch", "Hang Snatch", { equipment: "barbell" }),
  oly("snatch-pull", "Snatch Pull", { equipment: "barbell" }),
  oly("push-jerk", "Push Jerk", { equipment: "barbell", primaryMuscles: ["front_delts", "triceps", "quads"], primaryRegion: "shoulder_scapular", experienceMin: 3 }),
  // power_olympic additions (PR #22 follow-up — proposed slugs that didn't exist in the catalog).
  oly("split-jerk", "Split Jerk", { equipment: "barbell", primaryMuscles: ["front_delts", "triceps"], secondaryMuscles: ["quads", "glutes", "abs", "side_delts", "lower_back", "forearms"], primaryRegion: "shoulder_scapular", metadata: { emphasis: "split-stance-overhead-power" }, experienceMin: 3 }),
  oly("dumbbell-snatch", "Dumbbell Snatch", { equipment: "dumbbell", primaryMuscles: ["hamstrings", "glutes", "front_delts", "traps"], secondaryMuscles: ["lower_back", "abs", "quads", "forearms"], bilateral: false, axialLoad: "moderate" }),
  oly("kettlebell-snatch", "Kettlebell Snatch", { equipment: "kettlebell", primaryMuscles: ["hamstrings", "glutes", "front_delts"], secondaryMuscles: ["lower_back", "abs", "traps", "forearms"], bilateral: false, axialLoad: "moderate" }),
  // power_ballistic + olympic-derivative — KB clean into jerk.
  oly("kb-clean-and-jerk", "Kettlebell Clean & Jerk", { equipment: "kettlebell", primaryMuscles: ["hamstrings", "glutes", "front_delts", "triceps"], secondaryMuscles: ["lower_back", "abs", "traps", "quads", "forearms"], axialLoad: "moderate", functionalRoles: ["power_olympic", "power_ballistic"], metadata: { emphasis: "posterior-chain-into-overhead" } }),
];

// ─── tendon / resilience (15) — Baar 2017 HIGH protocols ───
const tendon = (slug: string, name: string, opts: MoveOpts = {}): NewMovement =>
  m(slug, name, {
    pattern: "tendon",
    primaryRegion: "knee",
    secondaryRegions: [],
    primaryMuscles: ["quads"],
    secondaryMuscles: [],
    highStrainTendon: true,
    metadata: { protocol: "isometric-or-hsr", emphasis: "tendon-stiffness" },
    ...opts,
  });

const TENDON: NewMovement[] = [
  tendon("iso-split-squat", "Heavy Isometric Split Squat", { equipment: "barbell-or-db", bilateral: false, secondaryMuscles: ["glutes", "hamstrings", "adductors"], metadata: { protocol: "Baar-isometric-70-80pct-30s-3sets", emphasis: "patellar-tendon" } }),
  tendon("iso-calf-hold", "Heavy Isometric Calf Hold", { equipment: "machine", primaryMuscles: ["calves"], primaryRegion: "foot_ankle_calf", metadata: { protocol: "Baar-isometric-30s-3sets", emphasis: "achilles" } }),
  tendon("iso-wall-sit-heavy", "Heavy Wall Sit", { equipment: "wall-or-weighted", secondaryMuscles: ["adductors"], metadata: { protocol: "isometric-45-60s", emphasis: "patellar-tendon" } }),
  tendon("iso-mid-thigh-pull", "Isometric Mid-Thigh Pull", { equipment: "rack-pins", primaryMuscles: ["hamstrings", "glutes", "traps"], primaryRegion: "hamstring_posterior", metadata: { protocol: "isometric-max-tension" } }),
  tendon("iso-ohp-pin-press", "Isometric Pin OHP", { equipment: "rack-pins", primaryMuscles: ["front_delts", "triceps"], primaryRegion: "shoulder_scapular", metadata: { protocol: "isometric-max-tension" } }),
  tendon("hsr-rdl", "HSR RDL (3s tempo)", { equipment: "barbell", pattern: "hinge", primaryMuscles: ["hamstrings", "glutes"], secondaryMuscles: ["lower_back"], primaryRegion: "hamstring_posterior", secondaryRegions: ["lumbar_trunk"], metadata: { protocol: "Kongsgaard-HSR-3s-3s", tempo: "3-0-3-0" } }),
  tendon("hsr-calf-raise", "HSR Calf Raise (3s tempo)", { equipment: "machine", primaryMuscles: ["calves"], primaryRegion: "foot_ankle_calf", metadata: { protocol: "Kongsgaard-HSR", tempo: "3-0-3-0", emphasis: "achilles" } }),
  // Machine-free Achilles/calf HSR so the running-block Achilles guarantee
  // (ADR 0034) can be satisfied without a calf machine (a runner with only a
  // bar / dumbbells previously fell back to a knee HSR). Single-leg loaded calf
  // raise at the Kongsgaard 3-0-3 tempo.
  tendon("hsr-calf-raise-db", "HSR Calf Raise — DB/BW (3s tempo)", { equipment: "dumbbell-or-bw", bilateral: false, primaryMuscles: ["calves"], primaryRegion: "foot_ankle_calf", metadata: { protocol: "Kongsgaard-HSR", tempo: "3-0-3-0", emphasis: "achilles" } }),
  tendon("hsr-leg-press", "HSR Leg Press (3s tempo)", { equipment: "machine", primaryMuscles: ["quads", "glutes"], secondaryMuscles: ["adductors"], pattern: "squat", isCompound: true, stability: "fixed_path", metadata: { protocol: "Kongsgaard-HSR", tempo: "3-0-3-0" } }),
  tendon("hsr-front-squat", "Slow Front Squat (HSR)", { equipment: "barbell", pattern: "squat", primaryMuscles: ["quads"], secondaryMuscles: ["glutes", "adductors", "lower_back"], secondaryRegions: ["lumbar_trunk"], isCompound: true, axialLoad: "high", metadata: { protocol: "HSR", tempo: "3-0-3-0" } }),
  tendon("eccentric-calf-alfredson", "Alfredson Eccentric Calf", { equipment: "step", primaryMuscles: ["calves"], primaryRegion: "foot_ankle_calf", metadata: { protocol: "Alfredson-1998", emphasis: "achilles-tendinopathy", tempo: "3s-eccentric" } }),
  tendon("eccentric-chin-up", "Eccentric Chin-Up", { equipment: "bar", pattern: "pull", primaryMuscles: ["lats", "biceps"], secondaryMuscles: ["forearms"], primaryRegion: "shoulder_scapular", bodyWeightLoaded: true, metadata: { tempo: "X-5-0-0" } }),
  tendon("nordic-curl-eccentric", "Nordic Curl (eccentric-only)", { equipment: "anchor", primaryMuscles: ["hamstrings"], primaryRegion: "hamstring_posterior", metadata: { emphasis: "hamstring-strain-prevention", eccentric_cost: "very_high" } }),
  tendon("jefferson-curl", "Jefferson Curl", { equipment: "barbell-or-db", pattern: "hinge", primaryMuscles: ["lower_back", "hamstrings"], primaryRegion: "lumbar_trunk", metadata: { protocol: "loaded-mobility", emphasis: "spinal-flexion-tolerance" } }),
  tendon("cossack-squat-loaded", "Loaded Cossack Squat", { equipment: "dumbbell-or-kb", pattern: "squat", bilateral: false, primaryMuscles: ["quads", "adductors", "glutes"], primaryRegion: "adductor_groin", secondaryRegions: ["knee"], metadata: { protocol: "loaded-mobility" } }),
  tendon("copenhagen-side-plank", "Copenhagen Side Plank", { equipment: "bench", primaryMuscles: ["adductors", "obliques"], primaryRegion: "adductor_groin", metadata: { protocol: "isometric", emphasis: "adductor-prehab" } }),
];

// ─── rotator cuff / shoulder care (8) ───
const cuff = (slug: string, name: string, opts: MoveOpts = {}): NewMovement =>
  m(slug, name, {
    pattern: "cuff",
    primaryRegion: "shoulder_scapular",
    secondaryRegions: [],
    primaryMuscles: ["rear_delts"],
    secondaryMuscles: [],
    metadata: { emphasis: "rotator-cuff-prehab" },
    ...opts,
  });

const CUFF: NewMovement[] = [
  cuff("external-rotation-cable", "External Rotation (cable)", { equipment: "cable", bilateral: false }),
  cuff("external-rotation-band", "External Rotation (band)", { equipment: "band", bilateral: false }),
  cuff("external-rotation-db", "External Rotation (DB)", { equipment: "dumbbell-bench", bilateral: false }),
  cuff("internal-rotation-cable", "Internal Rotation (cable)", { equipment: "cable", bilateral: false }),
  cuff("prone-y-raise", "Prone Y-Raise", { equipment: "bench-dumbbells", primaryMuscles: ["rear_delts", "traps"] }),
  cuff("prone-t-raise", "Prone T-Raise", { equipment: "bench-dumbbells", primaryMuscles: ["rear_delts", "mid_back"] }),
  cuff("prone-w-raise", "Prone W-Raise", { equipment: "bench-dumbbells", primaryMuscles: ["rear_delts", "mid_back"] }),
  cuff("scapular-pull-up", "Scapular Pull-Up", { equipment: "bar", primaryMuscles: ["mid_back", "lats"], secondaryMuscles: ["forearms"], metadata: { emphasis: "scap-control" } }),
];

// ─── run / sprint drills (6) ───
const drill = (slug: string, name: string, opts: MoveOpts = {}): NewMovement =>
  m(slug, name, {
    pattern: "drill",
    primaryRegion: "foot_ankle_calf",
    secondaryRegions: ["knee", "hamstring_posterior"],
    primaryMuscles: ["calves", "quads", "hamstrings"],
    secondaryMuscles: ["glutes", "tibialis"],
    interferenceCost: "low_moderate",
    // Drills assume some running base — a true beginner is better served
    // by easy running before adding sprint mechanics work.
    experienceMin: 1,
    experienceMax: 4,
    metadata: { emphasis: "running-form" },
    ...opts,
  });

const DRILLS: NewMovement[] = [
  drill("a-skip", "A-Skip", { equipment: "shoes" }),
  drill("b-skip", "B-Skip", { equipment: "shoes" }),
  drill("butt-kicks", "Butt Kicks", { equipment: "shoes", primaryMuscles: ["hamstrings"] }),
  drill("high-knees", "High Knees", { equipment: "shoes" }),
  drill("strides", "Strides (100m × 6)", { equipment: "shoes", metadata: { emphasis: "neuromuscular-prime", impact: "moderate" } }),
  drill("hill-bounds", "Hill Bounds", { equipment: "outdoor-hill", interferenceCost: "moderate", highStrainTendon: true, metadata: { emphasis: "power-endurance" }, experienceMin: 2 }),
];

export const PATTERNS_PART_3: NewMovement[] = [
  ...CYCLING,
  ...RUNNING,
  ...ROWING,
  ...OTHER_CARDIO,
  ...PLYO,
  ...OLYMPIC,
  ...TENDON,
  ...CUFF,
  ...DRILLS,
];
