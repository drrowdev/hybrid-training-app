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
  bike("bike-indoor-threshold", "Indoor Bike — Threshold", { equipment: "stationary-bike", interferenceCost: "low_moderate", metadata: { modality: "cycling", zone: "Z4", duration_target_min: 30 } }),
  bike("bike-indoor-vo2-4x4", "Indoor Bike — VO2 4×4", { equipment: "stationary-bike", interferenceCost: "moderate", metadata: { modality: "cycling", zone: "Z5", protocol: "4x4min-3min-recovery" } }),
  bike("bike-indoor-sprints", "Indoor Bike — Sprint Intervals", { equipment: "stationary-bike", interferenceCost: "low", metadata: { modality: "cycling", protocol: "alactic-30s-on-90s-off", emphasis: "alactic" } }),
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
  run("run-tempo", "Tempo Run", { equipment: "shoes", interferenceCost: "moderate_high", metadata: { modality: "running", zone: "Z3" } }),
  run("run-threshold", "Threshold Run", { equipment: "shoes", interferenceCost: "moderate_high", metadata: { modality: "running", zone: "Z4" } }),
  run("run-vo2-4x4", "VO2 Intervals — 4×4", { equipment: "shoes", interferenceCost: "high", metadata: { modality: "running", zone: "Z5", protocol: "4x4min" } }),
  run("run-vo2-1k-repeats", "VO2 1k Repeats", { equipment: "shoes-track", interferenceCost: "high", metadata: { modality: "running", protocol: "5-8x1km" } }),
  run("run-hill-sprints", "Hill Sprints", { equipment: "outdoor-hill", interferenceCost: "variable", highStrainTendon: false, metadata: { modality: "running", emphasis: "alactic-power", impact: "high" } }),
  run("run-track-400", "Track 400s", { equipment: "track", interferenceCost: "high", metadata: { modality: "running", protocol: "8-12x400m" } }),
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
  row("erg-threshold", "Erg Row — Threshold", { equipment: "erg", interferenceCost: "moderate", metadata: { modality: "rowing", zone: "Z4" } }),
  row("erg-intervals-500", "Erg Row — 500m Intervals", { equipment: "erg", interferenceCost: "moderate", metadata: { modality: "rowing", protocol: "6-10x500m" } }),
  row("erg-sprints-30-30", "Erg Row — 30/30 Sprints", { equipment: "erg", interferenceCost: "moderate", metadata: { modality: "rowing", protocol: "tabata-style" } }),
  row("erg-2k-tt", "Erg Row — 2k Time Trial", { equipment: "erg", interferenceCost: "high", metadata: { modality: "rowing", emphasis: "max-effort-test" } }),
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
  sled("sled-push-heavy", "Sled Push — Heavy", { equipment: "sled", metadata: { modality: "sled", emphasis: "strength-cardio-hybrid" } }),
  sled("sled-drag-light", "Sled Drag — Light", { equipment: "sled" }),
  sled("sled-drag-heavy", "Sled Drag — Heavy", { equipment: "sled" }),
  sled("sled-drag-backwards", "Backwards Sled Drag", { equipment: "sled", primaryMuscles: ["quads", "calves"], metadata: { modality: "sled", emphasis: "VMO-knee-rehab" } }),
  ruck("ruck-light", "Rucking — Light Load", { equipment: "rucksack", metadata: { modality: "rucking", load_kg: 10 } }),
  ruck("ruck-heavy", "Rucking — Heavy Load", { equipment: "rucksack", metadata: { modality: "rucking", load_kg: 20 } }),
  ruck("ruck-hill", "Hill Rucking", { equipment: "rucksack-outdoor", interferenceCost: "moderate", metadata: { modality: "rucking", terrain: "hill" } }),
  swim("swim-easy", "Swim — Easy Lap", { equipment: "pool", metadata: { modality: "swimming", zone: "Z2" } }),
  swim("swim-intervals", "Swim — Intervals", { equipment: "pool", interferenceCost: "low_moderate", metadata: { modality: "swimming" } }),
  swim("swim-open-water", "Open Water Swim", { equipment: "open-water", metadata: { modality: "swimming" } }),
  m("stair-climber-z2", "Stair Climber — Z2", { pattern: "cardio", primaryRegion: "knee", secondaryRegions: ["hamstring_posterior", "foot_ankle_calf"], primaryMuscles: ["quads", "glutes", "calves"], interferenceCost: "low_moderate", equipment: "stair-machine", metadata: { modality: "stair", zone: "Z2" } }),
  m("elliptical-z2", "Elliptical — Z2", { pattern: "cardio", primaryRegion: "knee", primaryMuscles: ["quads", "glutes", "hamstrings", "calves"], interferenceCost: "low", equipment: "elliptical", metadata: { modality: "elliptical", impact: "none" } }),
  m("jump-rope-singles", "Jump Rope — Singles", { pattern: "cardio", primaryRegion: "foot_ankle_calf", primaryMuscles: ["calves", "tibialis"], secondaryMuscles: ["forearms"], interferenceCost: "low_moderate", equipment: "jump-rope", metadata: { modality: "jump-rope", impact: "moderate" } }),
  m("ski-erg", "Ski Erg", { pattern: "cardio", primaryRegion: "lumbar_trunk", secondaryRegions: ["shoulder_scapular"], primaryMuscles: ["lats", "abs", "triceps"], secondaryMuscles: ["chest", "mid_back"], interferenceCost: "low_moderate", equipment: "ski-erg", metadata: { modality: "ski-erg", impact: "none" } }),
];

// ─── plyo / power (12) ───
const plyo = (slug: string, name: string, opts: MoveOpts = {}): NewMovement =>
  m(slug, name, {
    pattern: "plyometric",
    primaryRegion: "knee",
    secondaryRegions: ["foot_ankle_calf", "hamstring_posterior"],
    primaryMuscles: ["quads", "glutes", "calves"],
    secondaryMuscles: ["hamstrings"],
    interferenceCost: "low",
    highStrainTendon: true,
    metadata: { cns_cost: "high", impact: "high", emphasis: "rate-of-force-development" },
    ...opts,
  });

const PLYO: NewMovement[] = [
  plyo("box-jump-low", "Box Jump (low)", { equipment: "box", metadata: { protocol: "ground-contacts-progression" } }),
  plyo("box-jump-high", "Box Jump (high)", { equipment: "box", metadata: { emphasis: "max-vertical" } }),
  plyo("broad-jump", "Broad Jump", { equipment: "bodyweight" }),
  plyo("depth-jump", "Depth Jump", { equipment: "box", metadata: { emphasis: "reactive-strength", impact: "very_high" } }),
  plyo("vertical-jump", "Vertical Jump", { equipment: "bodyweight" }),
  plyo("tuck-jump", "Tuck Jump", { equipment: "bodyweight" }),
  plyo("pogo-hop", "Pogo Hop", { equipment: "bodyweight", primaryMuscles: ["calves"], primaryRegion: "foot_ankle_calf", metadata: { emphasis: "achilles-stiffness" } }),
  plyo("single-leg-bound", "Single-Leg Bound", { equipment: "bodyweight", bilateral: false }),
  plyo("lateral-hop", "Lateral Hop", { equipment: "bodyweight", bilateral: false }),
  plyo("med-ball-slam", "Med Ball Slam", { equipment: "med-ball", primaryMuscles: ["abs", "lats"], highStrainTendon: false, metadata: { emphasis: "explosive-trunk" } }),
  plyo("med-ball-chest-pass", "Med Ball Chest Pass", { equipment: "med-ball", primaryMuscles: ["chest", "triceps", "front_delts"], primaryRegion: "shoulder_scapular", highStrainTendon: false }),
  plyo("med-ball-rotational-throw", "Med Ball Rotational Throw", { equipment: "med-ball", primaryMuscles: ["obliques", "abs"], primaryRegion: "lumbar_trunk", highStrainTendon: false, bilateral: false }),
];

// ─── Olympic lifts (8) ───
const oly = (slug: string, name: string, opts: MoveOpts = {}): NewMovement =>
  m(slug, name, {
    pattern: "olympic",
    primaryRegion: "hamstring_posterior",
    secondaryRegions: ["knee", "lumbar_trunk", "shoulder_scapular"],
    primaryMuscles: ["hamstrings", "glutes", "quads", "traps"],
    secondaryMuscles: ["lower_back", "front_delts", "calves"],
    isCompound: true,
    axialLoad: "high",
    highStrainTendon: true,
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
  oly("push-jerk", "Push Jerk", { equipment: "barbell", primaryMuscles: ["front_delts", "triceps", "quads"], primaryRegion: "shoulder_scapular" }),
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
  tendon("iso-split-squat", "Heavy Isometric Split Squat", { equipment: "barbell-or-db", bilateral: false, metadata: { protocol: "Baar-isometric-70-80pct-30s-3sets", emphasis: "patellar-tendon" } }),
  tendon("iso-calf-hold", "Heavy Isometric Calf Hold", { equipment: "machine", primaryMuscles: ["calves"], primaryRegion: "foot_ankle_calf", metadata: { protocol: "Baar-isometric-30s-3sets", emphasis: "achilles" } }),
  tendon("iso-wall-sit-heavy", "Heavy Wall Sit", { equipment: "wall-or-weighted", metadata: { protocol: "isometric-45-60s", emphasis: "patellar-tendon" } }),
  tendon("iso-mid-thigh-pull", "Isometric Mid-Thigh Pull", { equipment: "rack-pins", primaryMuscles: ["hamstrings", "glutes", "traps"], primaryRegion: "hamstring_posterior", metadata: { protocol: "isometric-max-tension" } }),
  tendon("iso-ohp-pin-press", "Isometric Pin OHP", { equipment: "rack-pins", primaryMuscles: ["front_delts", "triceps"], primaryRegion: "shoulder_scapular", metadata: { protocol: "isometric-max-tension" } }),
  tendon("hsr-rdl", "HSR RDL (3s tempo)", { equipment: "barbell", pattern: "hinge", primaryMuscles: ["hamstrings", "glutes"], primaryRegion: "hamstring_posterior", metadata: { protocol: "Kongsgaard-HSR-3s-3s", tempo: "3-0-3-0" } }),
  tendon("hsr-calf-raise", "HSR Calf Raise (3s tempo)", { equipment: "machine", primaryMuscles: ["calves"], primaryRegion: "foot_ankle_calf", metadata: { protocol: "Kongsgaard-HSR", tempo: "3-0-3-0", emphasis: "achilles" } }),
  tendon("hsr-leg-press", "HSR Leg Press (3s tempo)", { equipment: "machine", primaryMuscles: ["quads", "glutes"], pattern: "squat", isCompound: true, stability: "fixed_path", metadata: { protocol: "Kongsgaard-HSR", tempo: "3-0-3-0" } }),
  tendon("hsr-front-squat", "Slow Front Squat (HSR)", { equipment: "barbell", pattern: "squat", primaryMuscles: ["quads"], isCompound: true, axialLoad: "high", metadata: { protocol: "HSR", tempo: "3-0-3-0" } }),
  tendon("eccentric-calf-alfredson", "Alfredson Eccentric Calf", { equipment: "step", primaryMuscles: ["calves"], primaryRegion: "foot_ankle_calf", metadata: { protocol: "Alfredson-1998", emphasis: "achilles-tendinopathy", tempo: "3s-eccentric" } }),
  tendon("eccentric-chin-up", "Eccentric Chin-Up", { equipment: "bar", pattern: "pull", primaryMuscles: ["lats", "biceps"], primaryRegion: "shoulder_scapular", bodyWeightLoaded: true, metadata: { tempo: "X-5-0-0" } }),
  tendon("nordic-curl-eccentric", "Nordic Curl (eccentric-only)", { equipment: "anchor", primaryMuscles: ["hamstrings"], primaryRegion: "hamstring_posterior", metadata: { emphasis: "hamstring-strain-prevention", eccentric_cost: "very_high" } }),
  tendon("jefferson-curl", "Jefferson Curl", { equipment: "barbell-or-db", pattern: "hinge", primaryMuscles: ["lower_back", "hamstrings"], primaryRegion: "lumbar_trunk", metadata: { protocol: "loaded-mobility", emphasis: "spinal-flexion-tolerance" } }),
  tendon("cossack-squat-loaded", "Loaded Cossack Squat", { equipment: "dumbbell-or-kb", pattern: "squat", bilateral: false, primaryMuscles: ["quads", "adductors", "glutes"], primaryRegion: "adductor_groin", metadata: { protocol: "loaded-mobility" } }),
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
  cuff("scapular-pull-up", "Scapular Pull-Up", { equipment: "bar", primaryMuscles: ["mid_back", "lats"], metadata: { emphasis: "scap-control" } }),
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
    metadata: { emphasis: "running-form" },
    ...opts,
  });

const DRILLS: NewMovement[] = [
  drill("a-skip", "A-Skip", { equipment: "shoes" }),
  drill("b-skip", "B-Skip", { equipment: "shoes" }),
  drill("butt-kicks", "Butt Kicks", { equipment: "shoes", primaryMuscles: ["hamstrings"] }),
  drill("high-knees", "High Knees", { equipment: "shoes" }),
  drill("strides", "Strides (100m × 6)", { equipment: "shoes", metadata: { emphasis: "neuromuscular-prime", impact: "moderate" } }),
  drill("hill-bounds", "Hill Bounds", { equipment: "outdoor-hill", interferenceCost: "moderate", highStrainTendon: true, metadata: { emphasis: "power-endurance" } }),
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
