/**
 * Movement catalog seed — part 4: library additions (audit 2026-11-20).
 *
 * Fills the gaps found in an audit of the library: push-up and press variants,
 * kettlebell and full-body staples, trunk rotation / flexion work, arm, back and
 * leg variants, machine-free calf and hip work, a few cardio modalities, neck
 * work, carries, and prehab.
 *
 * Conventions that matter here (they are read by other code, not just humans):
 *  - `equipment` is authoritative for the equipment filter (`resolveRequiredEquipment`).
 *    A tag containing "bodyweight" is always available; hardware must be named
 *    (`bar`, `rings`, `cable…`, `machine-…`), never plain `bodyweight`.
 *  - Cardio rows carry `metadata.kind: "cardio_other"` unless the planner may
 *    substitute them for a zoned day; slugs of substitutable rows sort AFTER the
 *    existing candidates of their kind so existing prescriptions do not change.
 *  - Protocol / emphasis text avoids the words that derive-roles turns into
 *    durability-floor roles ("isometric", "hsr", "eccentric") unless intended.
 */
import type { AxialLoad, InterferenceCost, NewMovement, Stability } from "../src/schema/movements";

type MoveOpts = Partial<NewMovement>;

function m(slug: string, displayName: string, opts: MoveOpts = {}): NewMovement {
  return {
    userId: null,
    slug,
    displayName,
    pattern: "isolation",
    primaryRegion: "knee",
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

const pushup = (slug: string, name: string, opts: MoveOpts = {}): NewMovement =>
  m(slug, name, {
    pattern: "press",
    primaryRegion: "shoulder_scapular",
    secondaryRegions: ["elbow_forearm", "lumbar_trunk"],
    primaryMuscles: ["chest", "front_delts", "triceps"],
    secondaryMuscles: ["abs"],
    equipment: "bodyweight",
    isCompound: true,
    bodyWeightLoaded: true,
    metadata: { cns_cost: "low", stim_fatigue_ratio: "high" },
    ...opts,
  });

const press = (slug: string, name: string, opts: MoveOpts = {}): NewMovement =>
  m(slug, name, {
    pattern: "press",
    primaryRegion: "shoulder_scapular",
    secondaryRegions: ["elbow_forearm"],
    primaryMuscles: ["chest", "front_delts", "triceps"],
    secondaryMuscles: ["side_delts"],
    isCompound: true,
    metadata: { cns_cost: "moderate", stim_fatigue_ratio: "moderate" },
    ...opts,
  });

const pull = (slug: string, name: string, opts: MoveOpts = {}): NewMovement =>
  m(slug, name, {
    pattern: "pull",
    primaryRegion: "shoulder_scapular",
    secondaryRegions: ["elbow_forearm"],
    primaryMuscles: ["lats", "mid_back", "biceps"],
    secondaryMuscles: ["rear_delts", "forearms"],
    isCompound: true,
    metadata: { cns_cost: "moderate", stim_fatigue_ratio: "high" },
    ...opts,
  });

const squat = (slug: string, name: string, opts: MoveOpts = {}): NewMovement =>
  m(slug, name, {
    pattern: "squat",
    primaryRegion: "knee",
    secondaryRegions: ["hamstring_posterior", "lumbar_trunk", "foot_ankle_calf"],
    primaryMuscles: ["quads", "glutes"],
    secondaryMuscles: ["hamstrings", "lower_back", "adductors"],
    isCompound: true,
    axialLoad: "high",
    metadata: { eccentric_cost: "moderate", cns_cost: "high", stim_fatigue_ratio: "moderate" },
    ...opts,
  });

const hinge = (slug: string, name: string, opts: MoveOpts = {}): NewMovement =>
  m(slug, name, {
    pattern: "hinge",
    primaryRegion: "hamstring_posterior",
    secondaryRegions: ["lumbar_trunk", "knee"],
    primaryMuscles: ["hamstrings", "glutes", "lower_back"],
    secondaryMuscles: ["lats", "forearms", "traps"],
    isCompound: true,
    axialLoad: "high",
    metadata: { eccentric_cost: "high", cns_cost: "high", stim_fatigue_ratio: "moderate" },
    ...opts,
  });

const carry = (slug: string, name: string, opts: MoveOpts = {}): NewMovement =>
  m(slug, name, {
    pattern: "carry",
    primaryRegion: "lumbar_trunk",
    secondaryRegions: ["elbow_forearm", "shoulder_scapular"],
    primaryMuscles: ["abs", "obliques", "traps", "forearms"],
    secondaryMuscles: ["lower_back", "glutes"],
    isCompound: true,
    axialLoad: "moderate",
    metadata: { cns_cost: "moderate", stim_fatigue_ratio: "high", emphasis: "isometric-stabilisation" },
    ...opts,
  });

const biceps = (slug: string, name: string, opts: MoveOpts = {}): NewMovement =>
  m(slug, name, {
    primaryRegion: "elbow_forearm",
    secondaryRegions: ["shoulder_scapular"],
    primaryMuscles: ["biceps"],
    secondaryMuscles: ["forearms"],
    metadata: { stim_fatigue_ratio: "high" },
    ...opts,
  });

const triceps = (slug: string, name: string, opts: MoveOpts = {}): NewMovement =>
  m(slug, name, {
    primaryRegion: "elbow_forearm",
    secondaryRegions: ["shoulder_scapular"],
    primaryMuscles: ["triceps"],
    metadata: { stim_fatigue_ratio: "high" },
    ...opts,
  });

const delt = (slug: string, name: string, opts: MoveOpts = {}): NewMovement =>
  m(slug, name, {
    primaryRegion: "shoulder_scapular",
    primaryMuscles: ["side_delts"],
    secondaryMuscles: ["traps"],
    metadata: { stim_fatigue_ratio: "high" },
    ...opts,
  });

const legIso = (slug: string, name: string, opts: MoveOpts = {}): NewMovement =>
  m(slug, name, {
    primaryRegion: "knee",
    primaryMuscles: ["quads"],
    metadata: { stim_fatigue_ratio: "high" },
    ...opts,
  });

const core = (slug: string, name: string, opts: MoveOpts = {}): NewMovement =>
  m(slug, name, {
    primaryRegion: "lumbar_trunk",
    primaryMuscles: ["abs"],
    secondaryMuscles: ["obliques"],
    equipment: "bodyweight",
    ...opts,
  });

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
    experienceMin: 3,
    metadata: { cns_cost: "very_high", emphasis: "rate-of-force-development" },
    ...opts,
  });

const cuff = (slug: string, name: string, opts: MoveOpts = {}): NewMovement =>
  m(slug, name, {
    pattern: "cuff",
    primaryRegion: "shoulder_scapular",
    primaryMuscles: ["rear_delts"],
    metadata: { emphasis: "rotator-cuff-prehab" },
    ...opts,
  });

const cardio = (slug: string, name: string, opts: MoveOpts = {}): NewMovement =>
  m(slug, name, {
    pattern: "cardio",
    primaryRegion: "knee",
    secondaryRegions: ["foot_ankle_calf", "hamstring_posterior"],
    primaryMuscles: ["quads", "glutes"],
    secondaryMuscles: ["hamstrings", "calves"],
    interferenceCost: "moderate",
    metadata: { kind: "cardio_other" },
    ...opts,
  });

const PUSH_UPS: NewMovement[] = [
  pushup("push-up-incline", "Incline Push-Up", { stability: "supported", metadata: { cns_cost: "low", stim_fatigue_ratio: "high", emphasis: "lower-chest-angle-regression" } }),
  pushup("push-up-decline", "Decline Push-Up", { primaryMuscles: ["upper_chest", "front_delts", "triceps"], experienceMin: 1 }),
  pushup("push-up-neutral-grip", "Neutral-Grip Push-Up", { secondaryMuscles: ["abs", "side_delts"], metadata: { cns_cost: "low", stim_fatigue_ratio: "high", emphasis: "wrist-and-shoulder-friendly" } }),
  pushup("push-up-deficit", "Deficit Push-Up", { experienceMin: 1, metadata: { cns_cost: "low", stim_fatigue_ratio: "high", rom_profile: "stretched" } }),
  pushup("push-up-neutral-grip-deficit", "Deficit Neutral-Grip Push-Up", { experienceMin: 1, secondaryMuscles: ["abs", "side_delts"], metadata: { cns_cost: "low", stim_fatigue_ratio: "high", rom_profile: "stretched", emphasis: "wrist-and-shoulder-friendly" } }),
  pushup("push-up-diamond", "Diamond Push-Up", { primaryMuscles: ["triceps", "chest", "front_delts"], experienceMin: 1 }),
  pushup("push-up-archer", "Archer Push-Up", { bilateral: false, experienceMin: 2 }),
  pushup("push-up-hand-release", "Hand-Release Push-Up", { metadata: { cns_cost: "low", stim_fatigue_ratio: "high", emphasis: "dead-stop-reps" } }),
  pushup("push-up-weighted", "Weighted Push-Up", { equipment: "bodyweight-or-loaded", experienceMin: 1 }),
  pushup("push-up-ring", "Ring Push-Up", { equipment: "rings", stability: "free", experienceMin: 2 }),
  pushup("push-up-pike", "Pike Push-Up", { primaryMuscles: ["front_delts", "triceps", "upper_chest"], secondaryMuscles: ["side_delts", "traps"], experienceMin: 1 }),
  pushup("handstand-push-up", "Handstand Push-Up", { equipment: "bodyweight-wall", primaryMuscles: ["front_delts", "triceps", "upper_chest"], secondaryMuscles: ["side_delts", "traps", "abs"], axialLoad: "moderate", experienceMin: 3 }),
  pushup("push-up-clap", "Clap Push-Up", { pattern: "plyometric", highStrainTendon: false, functionalRoles: ["power_plyometric"], experienceMin: 2, metadata: { cns_cost: "moderate", emphasis: "upper-body-rate-of-force-development" } }),
  cuff("scapular-push-up", "Scapular Push-Up", { equipment: "bodyweight", primaryMuscles: ["mid_back", "traps"], secondaryMuscles: ["chest", "front_delts"], metadata: { emphasis: "scap-control" } }),
  cuff("push-up-plus", "Push-Up Plus", { equipment: "bodyweight", primaryMuscles: ["mid_back", "chest"], secondaryMuscles: ["front_delts", "triceps"], metadata: { emphasis: "scap-control" } }),
  cuff("wall-slide", "Wall Slide", { equipment: "bodyweight-wall", primaryMuscles: ["mid_back", "traps"], secondaryMuscles: ["rear_delts"], metadata: { emphasis: "scap-control" } }),
];

const PRESSES: NewMovement[] = [
  press("machine-shoulder-press", "Machine Shoulder Press", { equipment: "machine-shoulder-press", primaryMuscles: ["front_delts", "side_delts", "triceps"], secondaryMuscles: ["upper_chest"], stability: "fixed_path", isSupported: true }),
  press("db-bench-neutral", "Neutral-Grip DB Bench Press", { equipment: "dumbbells-bench" }),
  press("db-bench-incline-neutral", "Neutral-Grip Incline DB Press", { equipment: "dumbbells-incline-bench", primaryMuscles: ["upper_chest", "front_delts", "triceps"] }),
  press("db-bench-single-arm", "Single-Arm DB Bench Press", { equipment: "dumbbell-bench", bilateral: false, secondaryMuscles: ["side_delts", "obliques"], experienceMin: 1 }),
  press("db-floor-press", "DB Floor Press", { equipment: "dumbbells", primaryMuscles: ["chest", "triceps", "front_delts"], metadata: { cns_cost: "moderate", stim_fatigue_ratio: "moderate", rom_profile: "partial" } }),
  press("cable-chest-press-standing", "Standing Cable Chest Press", { equipment: "cable", bilateral: false, secondaryMuscles: ["side_delts", "abs"] }),
  press("cable-chest-press-seated", "Seated Cable Chest Press", { equipment: "cable-bench", stability: "supported" }),
  press("machine-chest-press-incline", "Incline Machine Chest Press", { equipment: "machine-chest-press-incline", primaryMuscles: ["upper_chest", "front_delts", "triceps"], stability: "fixed_path", isSupported: true }),
  press("kb-press", "Kettlebell Press", { equipment: "kettlebell", bilateral: false, primaryMuscles: ["front_delts", "side_delts", "triceps"], secondaryMuscles: ["upper_chest", "obliques"], axialLoad: "moderate" }),
  press("kb-press-bottoms-up", "Bottoms-Up Kettlebell Press", { equipment: "kettlebell", bilateral: false, primaryMuscles: ["front_delts", "triceps", "forearms"], secondaryMuscles: ["side_delts", "obliques"], experienceMin: 2, metadata: { cns_cost: "moderate", stim_fatigue_ratio: "high", emphasis: "shoulder-stability" } }),
  press("spoto-press", "Spoto Press", { equipment: "barbell-bench", experienceMin: 2, metadata: { cns_cost: "high", stim_fatigue_ratio: "moderate", tempo: "1-1-X-0", emphasis: "pause-above-chest" } }),
  press("pin-press-bench", "Bench Pin Press", { equipment: "barbell-bench-pins", experienceMin: 2, metadata: { cns_cost: "high", stim_fatigue_ratio: "moderate", emphasis: "dead-stop-from-pins", rom_profile: "partial" } }),
  press("board-press", "Board Press", { equipment: "barbell-bench", experienceMin: 2, metadata: { cns_cost: "high", stim_fatigue_ratio: "moderate", emphasis: "lockout-strength", rom_profile: "partial" } }),
];

const PULLS: NewMovement[] = [
  pull("pull-up-wide", "Wide-Grip Pull-Up", { equipment: "bar", bodyWeightLoaded: true, primaryMuscles: ["lats", "mid_back"], experienceMin: 1 }),
  pull("pull-up-ring", "Ring Pull-Up", { equipment: "rings", bodyWeightLoaded: true, experienceMin: 2 }),
  pull("pull-up-assisted-machine", "Assisted Pull-Up (machine)", { equipment: "machine-assisted", stability: "fixed_path", isSupported: true }),
  pull("pull-up-band-assisted", "Band-Assisted Pull-Up", { equipment: "bar", primaryMuscles: ["lats", "mid_back", "biceps"] }),
  pull("lat-pulldown-wide-overhand", "Lat Pulldown (wide overhand)", { equipment: "cable-pulldown", primaryMuscles: ["lats", "mid_back"], stability: "supported" }),
  pull("lat-pulldown-underhand", "Lat Pulldown (underhand)", { equipment: "cable-pulldown", primaryMuscles: ["lats", "biceps"], stability: "supported" }),
  pull("machine-high-row", "Machine High Row", { equipment: "machine-high-row", stability: "fixed_path", isSupported: true, primaryMuscles: ["lats", "mid_back"], secondaryMuscles: ["biceps", "rear_delts"] }),
  pull("cable-row-single-arm", "Single-Arm Cable Row", { equipment: "cable", bilateral: false, secondaryMuscles: ["rear_delts", "forearms", "obliques"] }),
  pull("cable-row-rope", "Cable Row (rope)", { equipment: "cable-rope", primaryMuscles: ["mid_back", "rear_delts", "lats"], secondaryMuscles: ["biceps"] }),
  pull("smith-row", "Smith Machine Row", { equipment: "smith", axialLoad: "moderate", secondaryMuscles: ["rear_delts", "forearms", "lower_back"], secondaryRegions: ["elbow_forearm", "lumbar_trunk"] }),
  pull("t-bar-row-chest-supported", "Chest-Supported T-Bar Row", { equipment: "t-bar-chest-supported", stability: "supported", isSupported: true, primaryMuscles: ["mid_back", "lats"] }),
  pull("towel-hang", "Towel Hang", { equipment: "bar", pattern: "isolation", isCompound: false, primaryRegion: "elbow_forearm", secondaryRegions: ["shoulder_scapular"], primaryMuscles: ["forearms"], secondaryMuscles: ["lats"], metadata: { emphasis: "grip-endurance", protocol: "hold-timed" } }),
  pull("fat-grip-dead-hang", "Fat-Grip Dead Hang", { equipment: "bar", pattern: "isolation", isCompound: false, primaryRegion: "elbow_forearm", secondaryRegions: ["shoulder_scapular"], primaryMuscles: ["forearms"], secondaryMuscles: ["lats"], metadata: { emphasis: "grip-endurance", protocol: "hold-timed" } }),
];

const ARMS_AND_DELTS: NewMovement[] = [
  biceps("reverse-curl-ez", "Reverse Curl (EZ)", { equipment: "ez-bar", primaryMuscles: ["forearms", "biceps"], secondaryMuscles: [] }),
  biceps("hammer-curl-cross-body", "Cross-Body Hammer Curl", { equipment: "dumbbells", bilateral: false, primaryMuscles: ["biceps", "forearms"], secondaryMuscles: [] }),
  biceps("zottman-curl", "Zottman Curl", { equipment: "dumbbells", primaryMuscles: ["biceps", "forearms"], secondaryMuscles: [] }),
  biceps("cable-curl-bayesian", "Bayesian Cable Curl", { equipment: "cable", bilateral: false, metadata: { stim_fatigue_ratio: "high", rom_profile: "stretched" } }),
  biceps("cable-curl-bar", "Cable Curl (straight bar)", { equipment: "cable-bar" }),
  biceps("preacher-curl-machine", "Preacher Curl (machine)", { equipment: "machine-preacher-curl", stability: "fixed_path", isSupported: true }),
  triceps("pushdown-single-arm", "Single-Arm Cable Pushdown", { equipment: "cable", bilateral: false }),
  triceps("tri-ext-cross-body-db", "Cross-Body Triceps Extension (DB)", { equipment: "dumbbell", bilateral: false }),
  triceps("dip-machine", "Machine Dip", { equipment: "machine-dip", pattern: "press", isCompound: true, primaryMuscles: ["triceps", "chest", "front_delts"], secondaryMuscles: [], primaryRegion: "shoulder_scapular", secondaryRegions: ["elbow_forearm"], stability: "fixed_path", isSupported: true }),
  delt("lateral-raise-bent-over-db", "Bent-Over Lateral Raise (DB)", { equipment: "dumbbells", primaryMuscles: ["rear_delts"], secondaryMuscles: ["mid_back", "traps"] }),
  delt("cable-rear-delt-fly", "Cable Rear Delt Fly", { equipment: "cable", primaryMuscles: ["rear_delts"], secondaryMuscles: ["mid_back"], bilateral: false }),
  delt("lateral-raise-cable-behind-back", "Behind-the-Back Cable Lateral Raise", { equipment: "cable", bilateral: false }),
  delt("cable-y-raise", "Cable Y-Raise", { equipment: "cable", primaryMuscles: ["side_delts", "rear_delts", "traps"], secondaryMuscles: ["mid_back"] }),
];

const LEGS_AND_HIPS: NewMovement[] = [
  squat("leg-press-single-leg", "Single-Leg Leg Press", { equipment: "machine-leg-press", bilateral: false, axialLoad: "low", stability: "fixed_path" }),
  squat("hack-squat-reverse", "Reverse Hack Squat", { equipment: "machine-hack-reverse", axialLoad: "moderate", stability: "fixed_path", primaryMuscles: ["glutes", "quads"] }),
  squat("heel-elevated-goblet-squat", "Heel-Elevated Goblet Squat", { equipment: "dumbbell-or-kb", axialLoad: "moderate", stability: "supported", metadata: { eccentric_cost: "moderate", cns_cost: "moderate", stim_fatigue_ratio: "high", emphasis: "quad-biased-upright" } }),
  squat("step-up-lateral", "Lateral Step-Up", { equipment: "bodyweight", bilateral: false, axialLoad: "low", bodyWeightLoaded: true, primaryMuscles: ["quads", "glutes", "abductors"], secondaryMuscles: ["adductors", "hamstrings"], metadata: { eccentric_cost: "low", cns_cost: "low", stim_fatigue_ratio: "moderate", emphasis: "frontal-plane-single-leg" } }),
  squat("shrimp-squat", "Shrimp Squat", { equipment: "bodyweight", bilateral: false, axialLoad: "low", experienceMin: 3, metadata: { eccentric_cost: "high", cns_cost: "moderate", stim_fatigue_ratio: "moderate", rom_profile: "deep" } }),
  squat("thruster-bb", "Barbell Thruster", { equipment: "barbell", experienceMin: 2, secondaryRegions: ["hamstring_posterior", "lumbar_trunk", "shoulder_scapular"], secondaryMuscles: ["front_delts", "triceps", "abs", "lower_back"], interferenceCost: "moderate", metadata: { eccentric_cost: "moderate", cns_cost: "high", stim_fatigue_ratio: "low", emphasis: "squat-to-press" } }),
  squat("thruster-db", "DB Thruster", { equipment: "dumbbells", axialLoad: "moderate", experienceMin: 1, secondaryRegions: ["hamstring_posterior", "lumbar_trunk", "shoulder_scapular"], secondaryMuscles: ["front_delts", "triceps", "abs", "lower_back"], interferenceCost: "moderate", metadata: { eccentric_cost: "moderate", cns_cost: "moderate", stim_fatigue_ratio: "low", emphasis: "squat-to-press" } }),
  squat("overhead-squat", "Overhead Squat", { equipment: "barbell", experienceMin: 3, secondaryMuscles: ["hamstrings", "lower_back", "adductors", "traps", "front_delts", "abs"], secondaryRegions: ["hamstring_posterior", "lumbar_trunk", "foot_ankle_calf", "shoulder_scapular"], metadata: { eccentric_cost: "moderate", cns_cost: "high", stim_fatigue_ratio: "moderate", emphasis: "mobility-and-stability" } }),
  hinge("kb-deadlift", "Kettlebell Deadlift", { equipment: "kettlebell", axialLoad: "moderate", primaryMuscles: ["hamstrings", "glutes"], secondaryMuscles: ["lower_back", "forearms", "quads"], metadata: { eccentric_cost: "low", cns_cost: "low", stim_fatigue_ratio: "high" } }),
  hinge("rdl-trap-bar", "Trap Bar Romanian Deadlift", { equipment: "trap-bar", primaryMuscles: ["hamstrings", "glutes"], secondaryMuscles: ["lower_back", "lats", "forearms", "traps"], metadata: { eccentric_cost: "high", cns_cost: "moderate", stim_fatigue_ratio: "moderate" } }),
  hinge("hip-thrust-machine", "Machine Hip Thrust", { equipment: "machine-hip-thrust", axialLoad: "low", stability: "fixed_path", primaryMuscles: ["glutes"], secondaryMuscles: ["hamstrings"], isSupported: true }),
  hinge("hip-thrust-db", "DB Hip Thrust", { equipment: "dumbbells-bench", axialLoad: "low", stability: "supported", primaryMuscles: ["glutes"], secondaryMuscles: ["hamstrings"] }),
  hinge("glute-ham-raise", "Glute-Ham Raise", { equipment: "machine-glute-ham", axialLoad: "low", stability: "supported", primaryMuscles: ["hamstrings", "glutes"], secondaryMuscles: ["lower_back", "calves"], highStrainTendon: true, experienceMin: 2, metadata: { eccentric_cost: "high", cns_cost: "moderate", stim_fatigue_ratio: "high" } }),
  hinge("snatch-grip-deadlift", "Snatch-Grip Deadlift", { equipment: "barbell", primaryMuscles: ["hamstrings", "glutes", "lower_back", "traps"], experienceMin: 2, metadata: { eccentric_cost: "high", cns_cost: "high", stim_fatigue_ratio: "moderate", rom_profile: "extended" } }),
  legIso("calf-raise-leg-press", "Leg Press Calf Raise", { equipment: "machine-leg-press", primaryRegion: "foot_ankle_calf", primaryMuscles: ["calves"], stability: "fixed_path" }),
  legIso("calf-raise-smith", "Smith Machine Calf Raise", { equipment: "smith", primaryRegion: "foot_ankle_calf", primaryMuscles: ["calves"], stability: "fixed_path" }),
  legIso("calf-raise-donkey", "Donkey Calf Raise", { equipment: "bodyweight-or-loaded", primaryRegion: "foot_ankle_calf", primaryMuscles: ["calves"], stability: "free", metadata: { stim_fatigue_ratio: "high", rom_profile: "stretched" } }),
  legIso("peroneal-raise-band", "Peroneal Raise (band eversion)", { equipment: "band", primaryRegion: "foot_ankle_calf", primaryMuscles: ["calves"], secondaryMuscles: ["tibialis"], bilateral: false, stability: "free", metadata: { emphasis: "ankle-stability" } }),
  legIso("cable-hip-adduction", "Cable Hip Adduction", { equipment: "cable-ankle", bilateral: false, primaryRegion: "adductor_groin", primaryMuscles: ["adductors"], stability: "free" }),
  legIso("terminal-knee-extension-band", "Banded Terminal Knee Extension", { equipment: "band", primaryMuscles: ["quads"], stability: "free", metadata: { emphasis: "knee-rehab-strength", stim_fatigue_ratio: "high" } }),
  legIso("adductor-squeeze-ball", "Adductor Ball Squeeze", { equipment: "ball", primaryRegion: "adductor_groin", primaryMuscles: ["adductors"], stability: "free", metadata: { protocol: "static-hold", emphasis: "groin-prehab" } }),
  legIso("bridge-walkout", "Hamstring Bridge Walk-Out", { equipment: "bodyweight", primaryRegion: "hamstring_posterior", primaryMuscles: ["hamstrings", "glutes"], stability: "free", experienceMin: 1, metadata: { stim_fatigue_ratio: "high", emphasis: "machine-free-hamstring" } }),
];

const FULL_BODY: NewMovement[] = [
  oly("clean", "Clean", { equipment: "barbell", experienceMin: 3 }),
  oly("snatch", "Snatch", { equipment: "barbell", experienceMin: 3 }),
  oly("clean-and-jerk", "Clean & Jerk", { equipment: "barbell", experienceMin: 3, primaryMuscles: ["hamstrings", "glutes", "quads", "front_delts"], secondaryMuscles: ["traps", "triceps", "lower_back", "calves", "forearms"] }),
  oly("clean-and-press", "Clean and Press", { equipment: "barbell", experienceMin: 3, primaryMuscles: ["hamstrings", "glutes", "front_delts", "traps"], secondaryMuscles: ["quads", "triceps", "lower_back", "forearms"] }),
  oly("db-hang-clean", "DB Hang Clean", { equipment: "dumbbells", experienceMin: 2, axialLoad: "moderate", highStrainTendon: false }),
  oly("kb-clean", "Kettlebell Clean", { equipment: "kettlebell", bilateral: false, experienceMin: 1, axialLoad: "moderate", highStrainTendon: false }),
  hinge("kb-swing-single-arm", "Single-Arm KB Swing", { equipment: "kettlebell", bilateral: false, axialLoad: "moderate", primaryMuscles: ["glutes", "hamstrings"], secondaryMuscles: ["lower_back", "forearms", "abs", "obliques"], experienceMin: 1, metadata: { eccentric_cost: "low", cns_cost: "moderate", stim_fatigue_ratio: "high" } }),
  m("turkish-get-up", "Turkish Get-Up", { equipment: "kettlebell", pattern: "isolation", primaryRegion: "shoulder_scapular", secondaryRegions: ["lumbar_trunk", "knee"], primaryMuscles: ["front_delts", "abs", "glutes"], secondaryMuscles: ["obliques", "quads", "traps"], isCompound: true, bilateral: false, axialLoad: "moderate", experienceMin: 1, metadata: { cns_cost: "moderate", stim_fatigue_ratio: "moderate", emphasis: "full-body-stability" } }),
  m("kb-windmill", "Kettlebell Windmill", { equipment: "kettlebell", pattern: "isolation", primaryRegion: "lumbar_trunk", secondaryRegions: ["shoulder_scapular", "hamstring_posterior"], primaryMuscles: ["obliques", "abs"], secondaryMuscles: ["glutes", "hamstrings", "front_delts"], bilateral: false, experienceMin: 2, metadata: { stim_fatigue_ratio: "moderate", emphasis: "loaded-mobility" } }),
  carry("carry-sandbag", "Sandbag Carry", { equipment: "sandbag", secondaryMuscles: ["lower_back", "glutes", "biceps"] }),
  carry("carry-bear-hug-sandbag", "Bear-Hug Sandbag Carry", { equipment: "sandbag", primaryMuscles: ["abs", "obliques", "biceps", "forearms"], secondaryMuscles: ["lower_back", "glutes", "traps"] }),
  carry("carry-front-rack", "Front-Rack Carry", { equipment: "dumbbell-or-kb", primaryMuscles: ["abs", "obliques", "upper_chest", "forearms"], secondaryMuscles: ["lower_back", "glutes", "traps", "front_delts"], bilateral: true, experienceMin: 1 }),
];

const CORE: NewMovement[] = [
  core("crunch-floor", "Crunch"),
  core("sit-up", "Sit-Up"),
  core("v-up", "V-Up", { experienceMin: 1, secondaryMuscles: ["obliques", "quads"] }),
  core("russian-twist", "Russian Twist", { primaryMuscles: ["obliques", "abs"], secondaryMuscles: [], equipment: "bodyweight-or-loaded", metadata: { emphasis: "rotational-trunk" } }),
  core("cable-woodchop", "Cable Woodchop", { equipment: "cable", primaryMuscles: ["obliques", "abs"], secondaryMuscles: ["front_delts", "glutes"], bilateral: false, metadata: { emphasis: "rotational-power" } }),
  core("landmine-rotation", "Landmine Rotation", { equipment: "landmine", primaryMuscles: ["obliques", "abs"], secondaryMuscles: ["front_delts", "glutes"], experienceMin: 1, metadata: { emphasis: "rotational-power" } }),
  core("l-sit", "L-Sit", { equipment: "parallettes-or-floor", primaryMuscles: ["abs"], secondaryMuscles: ["quads", "triceps", "front_delts"], experienceMin: 2, metadata: { protocol: "static-hold", emphasis: "compression-strength" } }),
  core("mountain-climber", "Mountain Climber", { primaryMuscles: ["abs"], secondaryMuscles: ["obliques", "front_delts", "quads"], metadata: { emphasis: "trunk-conditioning" } }),
  core("bear-crawl", "Bear Crawl", { primaryMuscles: ["abs", "front_delts"], secondaryMuscles: ["obliques", "quads", "triceps"], metadata: { emphasis: "trunk-conditioning" } }),
  core("lying-leg-raise", "Lying Leg Raise", { primaryMuscles: ["abs"], secondaryMuscles: ["obliques", "quads"], metadata: { emphasis: "lower-abs" } }),
  core("side-bend-db", "Weighted Side Bend (DB)", { equipment: "dumbbell", primaryMuscles: ["obliques"], secondaryMuscles: ["abs", "forearms"], bilateral: false }),
  core("windshield-wiper-hanging", "Hanging Windshield Wiper", { equipment: "bar", primaryMuscles: ["obliques", "abs"], secondaryMuscles: ["lats", "forearms"], experienceMin: 3, metadata: { protocol: "anti-rotation", emphasis: "rotational-control" } }),
  core("mcgill-curl-up", "McGill Curl-Up", { primaryMuscles: ["abs"], secondaryMuscles: ["obliques"], metadata: { protocol: "static-hold", emphasis: "spine-sparing-flexion" } }),
  m("neck-flexion", "Neck Flexion", { equipment: "bodyweight-or-loaded", primaryRegion: "shoulder_scapular", primaryMuscles: ["neck"], secondaryMuscles: [], metadata: { stim_fatigue_ratio: "moderate", emphasis: "neck-strength" } }),
  m("neck-extension", "Neck Extension", { equipment: "bodyweight-or-loaded", primaryRegion: "shoulder_scapular", primaryMuscles: ["neck", "traps"], secondaryMuscles: [], metadata: { stim_fatigue_ratio: "moderate", emphasis: "neck-strength" } }),
];

const CARDIO: NewMovement[] = [
  cardio("assault-bike-intervals", "Assault Bike — Intervals", { equipment: "air-bike", interferenceCost: "moderate", metadata: { kind: "cardio_other", modality: "air-bike", protocol: "intervals-20s-40s", impact: "none" } }),
  cardio("assault-bike-z2", "Assault Bike — Z2", { equipment: "air-bike", interferenceCost: "low", metadata: { kind: "cardio_other", modality: "air-bike", zone: "Z2", impact: "none" } }),
  cardio("walk-incline-treadmill", "Incline Treadmill Walk", { equipment: "treadmill", primaryRegion: "foot_ankle_calf", secondaryRegions: ["knee", "hamstring_posterior"], primaryMuscles: ["calves", "glutes", "quads"], secondaryMuscles: ["hamstrings"], interferenceCost: "low", metadata: { kind: "cardio_other", modality: "walking", zone: "Z2", impact: "low" } }),
  cardio("walk-easy", "Easy Walk", { equipment: "shoes", primaryRegion: "foot_ankle_calf", secondaryRegions: ["knee", "hamstring_posterior"], primaryMuscles: ["calves", "quads", "glutes"], secondaryMuscles: ["hamstrings"], interferenceCost: "very_low", metadata: { kind: "cardio_other", modality: "walking", zone: "Z1", impact: "low" } }),
  cardio("hike", "Hike", { equipment: "shoes-outdoor", primaryRegion: "foot_ankle_calf", secondaryRegions: ["knee", "hamstring_posterior"], primaryMuscles: ["calves", "quads", "glutes"], secondaryMuscles: ["hamstrings"], interferenceCost: "low", metadata: { kind: "cardio_other", modality: "walking", zone: "Z2", impact: "low", terrain: "trail" } }),
  cardio("run-z2-trail", "Trail Run — Z2", { equipment: "shoes-trail", primaryRegion: "foot_ankle_calf", secondaryRegions: ["knee", "hamstring_posterior"], primaryMuscles: ["calves", "quads", "hamstrings", "glutes"], secondaryMuscles: ["tibialis"], interferenceCost: "moderate", experienceMin: 1, metadata: { modality: "running", zone: "Z2", terrain: "trail", impact: "moderate" } }),
  cardio("run-vo2-treadmill-intervals", "Treadmill — VO2 Intervals", { equipment: "treadmill", primaryRegion: "foot_ankle_calf", secondaryRegions: ["knee", "hamstring_posterior"], primaryMuscles: ["calves", "quads", "hamstrings", "glutes"], secondaryMuscles: ["tibialis"], interferenceCost: "high", experienceMin: 2, metadata: { modality: "running", zone: "Z5", protocol: "vo2-4x4", impact: "high" } }),
  cardio("bike-sweet-spot", "Bike — Sweet Spot", { equipment: "stationary-bike", interferenceCost: "low_moderate", experienceMin: 1, metadata: { modality: "cycling", zone: "Z3", protocol: "2x20min-sweet-spot", impact: "very_low" } }),
  cardio("ski-erg-intervals", "Ski Erg — Intervals", { equipment: "ski-erg", primaryRegion: "lumbar_trunk", secondaryRegions: ["shoulder_scapular"], primaryMuscles: ["lats", "abs", "triceps"], secondaryMuscles: ["chest", "mid_back"], interferenceCost: "moderate", experienceMin: 2, metadata: { modality: "ski-erg", zone: "Z5", protocol: "vo2-4x4", impact: "none" } }),
  cardio("battle-ropes", "Battle Ropes", { equipment: "battle-ropes", primaryRegion: "shoulder_scapular", secondaryRegions: ["lumbar_trunk"], primaryMuscles: ["front_delts", "side_delts", "abs"], secondaryMuscles: ["lats", "forearms", "quads"], interferenceCost: "low_moderate", metadata: { kind: "cardio_other", modality: "conditioning", protocol: "intervals-20s-40s", impact: "none" } }),
  cardio("burpee", "Burpee", { equipment: "bodyweight", primaryRegion: "knee", secondaryRegions: ["foot_ankle_calf", "shoulder_scapular", "lumbar_trunk"], primaryMuscles: ["quads", "chest", "front_delts"], secondaryMuscles: ["triceps", "abs", "glutes", "calves"], isCompound: true, bodyWeightLoaded: true, interferenceCost: "moderate", metadata: { kind: "cardio_other", modality: "calisthenics", impact: "high", emphasis: "full-body-conditioning" } }),
];

export const PATTERNS_PART_4: NewMovement[] = [
  ...PUSH_UPS,
  ...PRESSES,
  ...PULLS,
  ...ARMS_AND_DELTS,
  ...LEGS_AND_HIPS,
  ...FULL_BODY,
  ...CORE,
  ...CARDIO,
];
