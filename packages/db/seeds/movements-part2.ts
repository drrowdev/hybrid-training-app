/**
 * Movement catalog seed — part 2: isolation work (arms / shoulders / chest / back / legs / core / grip).
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

// ─── biceps (12) ───
const biceps = (slug: string, name: string, opts: MoveOpts = {}): NewMovement =>
  m(slug, name, {
    pattern: "isolation",
    primaryRegion: "elbow_forearm",
    secondaryRegions: ["shoulder_scapular"],
    primaryMuscles: ["biceps"],
    secondaryMuscles: ["forearms"],
    metadata: { stim_fatigue_ratio: "high" },
    ...opts,
  });

const BICEPS: NewMovement[] = [
  biceps("bb-curl", "Barbell Curl", { equipment: "barbell" }),
  biceps("ez-bar-curl", "EZ-Bar Curl", { equipment: "ez-bar" }),
  biceps("db-curl-standing", "Standing DB Curl", { equipment: "dumbbells" }),
  biceps("db-curl-seated", "Seated DB Curl", { equipment: "dumbbells-bench", stability: "supported" }),
  biceps("alternating-db-curl", "Alternating DB Curl", { equipment: "dumbbells", bilateral: false }),
  biceps("hammer-curl", "Hammer Curl", { equipment: "dumbbells", primaryMuscles: ["biceps", "forearms"] }),
  biceps("incline-db-curl", "Incline DB Curl", { equipment: "dumbbells-incline-bench", stability: "supported", metadata: { rom_profile: "stretched" } }),
  biceps("preacher-curl-ez", "Preacher Curl (EZ)", { equipment: "preacher-ez", stability: "supported" }),
  biceps("preacher-curl-db", "Preacher Curl (DB)", { equipment: "preacher-dumbbell", bilateral: false, stability: "supported" }),
  biceps("spider-curl", "Spider Curl", { equipment: "preacher-or-incline", stability: "supported" }),
  biceps("cable-curl-rope", "Cable Curl (rope)", { equipment: "cable-rope", primaryMuscles: ["biceps", "forearms"] }),
  biceps("concentration-curl", "Concentration Curl", { equipment: "dumbbell", bilateral: false, stability: "supported" }),
];

// ─── triceps (12) ───
const triceps = (slug: string, name: string, opts: MoveOpts = {}): NewMovement =>
  m(slug, name, {
    pattern: "isolation",
    primaryRegion: "elbow_forearm",
    secondaryRegions: ["shoulder_scapular"],
    primaryMuscles: ["triceps"],
    secondaryMuscles: [],
    metadata: { stim_fatigue_ratio: "high" },
    ...opts,
  });

const TRICEPS: NewMovement[] = [
  triceps("pushdown-rope", "Tricep Pushdown (rope)", { equipment: "cable-rope" }),
  triceps("pushdown-bar", "Tricep Pushdown (bar)", { equipment: "cable-bar" }),
  triceps("pushdown-v-handle", "Tricep Pushdown (V-handle)", { equipment: "cable-v" }),
  triceps("overhead-tri-ext-db-single", "Overhead Tri Ext (single DB)", { equipment: "dumbbell", bilateral: false }),
  triceps("overhead-tri-ext-db-two-hand", "Overhead Tri Ext (two-hand DB)", { equipment: "dumbbell", metadata: { rom_profile: "stretched" } }),
  triceps("overhead-tri-ext-cable", "Overhead Tri Ext (cable)", { equipment: "cable-rope" }),
  triceps("overhead-tri-ext-ez", "Overhead Tri Ext (EZ-bar)", { equipment: "ez-bar" }),
  triceps("skull-crusher-ez", "Skull Crusher (EZ)", { equipment: "ez-bar-bench" }),
  triceps("skull-crusher-db", "Skull Crusher (DB)", { equipment: "dumbbells-bench" }),
  triceps("jm-press", "JM Press", { equipment: "barbell-bench", primaryMuscles: ["triceps", "chest"], isCompound: true, experienceMin: 2 }),
  triceps("tate-press", "Tate Press", { equipment: "dumbbells-bench" }),
  triceps("kickback-db", "Tricep Kickback (DB)", { equipment: "dumbbell", bilateral: false }),
];

// ─── forearm / grip (6) ───
const grip = (slug: string, name: string, opts: MoveOpts = {}): NewMovement =>
  m(slug, name, {
    pattern: "isolation",
    primaryRegion: "elbow_forearm",
    secondaryRegions: [],
    primaryMuscles: ["forearms"],
    secondaryMuscles: [],
    ...opts,
  });

const GRIP: NewMovement[] = [
  grip("wrist-curl-db", "Wrist Curl (DB)", { equipment: "dumbbells" }),
  grip("wrist-curl-bb", "Wrist Curl (BB)", { equipment: "barbell" }),
  grip("reverse-wrist-curl", "Reverse Wrist Curl", { equipment: "dumbbells-or-bb" }),
  grip("plate-pinch", "Plate Pinch", { equipment: "plates", metadata: { protocol: "isometric" } }),
  grip("captains-of-crush", "Captains of Crush", { equipment: "gripper", bilateral: false }),
  grip("dead-hang", "Dead Hang", { equipment: "bar", bodyWeightLoaded: true, metadata: { protocol: "isometric-tendon" } }),
];

// ─── shoulder isolation (10) ───
const sholder = (slug: string, name: string, opts: MoveOpts = {}): NewMovement =>
  m(slug, name, {
    pattern: "isolation",
    primaryRegion: "shoulder_scapular",
    secondaryRegions: [],
    primaryMuscles: ["side_delts"],
    secondaryMuscles: ["traps"],
    metadata: { stim_fatigue_ratio: "high" },
    ...opts,
  });

const SHOULDER_ISO: NewMovement[] = [
  sholder("lateral-raise-db", "Lateral Raise (DB)", { equipment: "dumbbells" }),
  sholder("lateral-raise-cable", "Lateral Raise (cable)", { equipment: "cable", bilateral: false, stability: "supported" }),
  sholder("lateral-raise-machine", "Lateral Raise (machine)", { equipment: "machine-lateral", stability: "fixed_path" }),
  sholder("leaning-lateral-raise", "Leaning Lateral Raise", { equipment: "dumbbell", bilateral: false }),
  sholder("rear-delt-fly-db", "Rear Delt Fly (DB)", { equipment: "dumbbells-bench", primaryMuscles: ["rear_delts"], secondaryMuscles: ["mid_back"] }),
  sholder("rear-delt-fly-machine", "Reverse Pec Deck", { equipment: "machine-reverse-pec", primaryMuscles: ["rear_delts"], stability: "fixed_path" }),
  sholder("y-raise", "Y-Raise", { equipment: "dumbbells", primaryMuscles: ["rear_delts", "traps"] }),
  sholder("front-raise-db", "Front Raise (DB)", { equipment: "dumbbells", primaryMuscles: ["front_delts"] }),
  sholder("upright-row-bb", "Upright Row (BB)", { equipment: "barbell", primaryMuscles: ["side_delts", "traps"], secondaryMuscles: ["biceps"] }),
  sholder("cuban-press", "Cuban Press", { equipment: "dumbbells", primaryMuscles: ["rear_delts", "side_delts"], metadata: { emphasis: "cuff-prehab" } }),
];

// ─── chest isolation (8) ───
const chestIso = (slug: string, name: string, opts: MoveOpts = {}): NewMovement =>
  m(slug, name, {
    pattern: "isolation",
    primaryRegion: "shoulder_scapular",
    secondaryRegions: ["elbow_forearm"],
    primaryMuscles: ["chest"],
    secondaryMuscles: ["front_delts"],
    metadata: { stim_fatigue_ratio: "high" },
    ...opts,
  });

const CHEST_ISO: NewMovement[] = [
  chestIso("cable-fly-mid", "Cable Fly (mid)", { equipment: "cable", stability: "supported" }),
  chestIso("cable-fly-high-to-low", "Cable Fly (high-to-low)", { equipment: "cable", stability: "supported", primaryMuscles: ["chest"] }),
  chestIso("cable-fly-low-to-high", "Cable Fly (low-to-high)", { equipment: "cable", stability: "supported", primaryMuscles: ["upper_chest"] }),
  chestIso("db-fly-flat", "DB Fly (flat)", { equipment: "dumbbells-bench" }),
  chestIso("db-fly-incline", "DB Fly (incline)", { equipment: "dumbbells-incline-bench", primaryMuscles: ["upper_chest"] }),
  chestIso("pec-deck", "Pec Deck", { equipment: "machine-pec-deck", stability: "fixed_path" }),
  chestIso("push-up", "Push-Up", { equipment: "bodyweight", bodyWeightLoaded: true, isCompound: true, primaryMuscles: ["chest", "front_delts", "triceps"] }),
  chestIso("svend-press", "Svend Press", { equipment: "plate", primaryMuscles: ["chest"] }),
];

// ─── back isolation (8) ───
const backIso = (slug: string, name: string, opts: MoveOpts = {}): NewMovement =>
  m(slug, name, {
    pattern: "isolation",
    primaryRegion: "shoulder_scapular",
    secondaryRegions: [],
    primaryMuscles: ["lats"],
    secondaryMuscles: ["mid_back"],
    metadata: { stim_fatigue_ratio: "high" },
    ...opts,
  });

const BACK_ISO: NewMovement[] = [
  backIso("straight-arm-pulldown", "Straight-Arm Pulldown", { equipment: "cable", primaryMuscles: ["lats"] }),
  backIso("pullover-db", "DB Pullover", { equipment: "dumbbell-bench", primaryMuscles: ["lats", "chest"], stability: "supported" }),
  backIso("pullover-cable", "Cable Pullover", { equipment: "cable", primaryMuscles: ["lats"] }),
  backIso("shrug-bb", "Barbell Shrug", { equipment: "barbell", primaryMuscles: ["traps"], secondaryMuscles: ["forearms"], axialLoad: "moderate" }),
  backIso("shrug-db", "DB Shrug", { equipment: "dumbbells", primaryMuscles: ["traps"], secondaryMuscles: ["forearms"] }),
  backIso("shrug-trap-bar", "Trap Bar Shrug", { equipment: "trap-bar", primaryMuscles: ["traps"], axialLoad: "moderate" }),
  backIso("kelso-shrug", "Kelso Shrug", { equipment: "dumbbells-incline-bench", primaryMuscles: ["mid_back", "traps"], stability: "supported" }),
  backIso("band-pull-apart", "Band Pull-Apart", { equipment: "band", primaryMuscles: ["rear_delts", "mid_back"] }),
];

// ─── leg isolation (16) ───
const legIso = (slug: string, name: string, opts: MoveOpts = {}): NewMovement =>
  m(slug, name, {
    pattern: "isolation",
    primaryRegion: "knee",
    secondaryRegions: [],
    primaryMuscles: ["quads"],
    secondaryMuscles: [],
    stability: "fixed_path",
    metadata: { stim_fatigue_ratio: "high" },
    ...opts,
  });

const LEG_ISO: NewMovement[] = [
  legIso("leg-extension", "Leg Extension", { equipment: "machine-leg-ext", highStrainTendon: true, metadata: { emphasis: "patellar-tendon-loaded", stim_fatigue_ratio: "high" } }),
  legIso("leg-extension-single", "Single-Leg Extension", { equipment: "machine-leg-ext", bilateral: false, highStrainTendon: true }),
  legIso("leg-curl-lying", "Lying Leg Curl", { equipment: "machine-leg-curl-lying", primaryRegion: "hamstring_posterior", primaryMuscles: ["hamstrings"] }),
  legIso("leg-curl-seated", "Seated Leg Curl", { equipment: "machine-leg-curl-seated", primaryRegion: "hamstring_posterior", primaryMuscles: ["hamstrings"] }),
  legIso("leg-curl-single", "Single-Leg Curl", { equipment: "machine-leg-curl", bilateral: false, primaryRegion: "hamstring_posterior", primaryMuscles: ["hamstrings"] }),
  legIso("nordic-ham-curl", "Nordic Ham Curl", { equipment: "bodyweight-anchor", primaryRegion: "hamstring_posterior", primaryMuscles: ["hamstrings"], highStrainTendon: true, stability: "free", metadata: { eccentric_cost: "very_high", emphasis: "hamstring-strain-prevention" }, experienceMin: 2 }),
  legIso("reverse-nordic-curl", "Reverse Nordic Curl", { equipment: "bodyweight", primaryMuscles: ["quads"], highStrainTendon: true, stability: "free", metadata: { rom_profile: "stretched", emphasis: "rectus-femoris" } }),
  legIso("glute-kickback-cable", "Glute Kickback (cable)", { equipment: "cable-ankle", bilateral: false, primaryMuscles: ["glutes"], primaryRegion: "hamstring_posterior", stability: "supported" }),
  legIso("glute-kickback-machine", "Glute Kickback (machine)", { equipment: "machine-glute-kickback", primaryMuscles: ["glutes"], primaryRegion: "hamstring_posterior" }),
  legIso("hip-abduction-machine", "Hip Abduction (machine)", { equipment: "machine-abduction", primaryMuscles: ["abductors", "glutes"] }),
  legIso("hip-abduction-band", "Hip Abduction (band)", { equipment: "band", primaryMuscles: ["abductors"], stability: "free" }),
  legIso("hip-adduction-machine", "Hip Adduction (machine)", { equipment: "machine-adduction", primaryMuscles: ["adductors"], primaryRegion: "adductor_groin" }),
  legIso("copenhagen-plank", "Copenhagen Plank", { equipment: "bench", primaryMuscles: ["adductors", "abs", "obliques"], primaryRegion: "adductor_groin", stability: "free", metadata: { protocol: "isometric" }, experienceMin: 2 }),
  legIso("calf-raise-standing", "Standing Calf Raise", { equipment: "machine-or-bw", primaryMuscles: ["calves"], primaryRegion: "foot_ankle_calf", highStrainTendon: true }),
  legIso("calf-raise-seated", "Seated Calf Raise", { equipment: "machine-seated-calf", primaryMuscles: ["calves"], primaryRegion: "foot_ankle_calf", metadata: { emphasis: "soleus" } }),
  legIso("tibialis-raise", "Tibialis Raise", { equipment: "bodyweight-or-band", primaryMuscles: ["tibialis"], primaryRegion: "foot_ankle_calf" }),
];

// ─── core / abs (15) ───
const core = (slug: string, name: string, opts: MoveOpts = {}): NewMovement =>
  m(slug, name, {
    pattern: "isolation",
    primaryRegion: "lumbar_trunk",
    secondaryRegions: [],
    primaryMuscles: ["abs"],
    secondaryMuscles: ["obliques"],
    ...opts,
  });

const CORE: NewMovement[] = [
  core("plank", "Plank", { equipment: "bodyweight", metadata: { protocol: "isometric" } }),
  core("rkc-plank", "RKC Plank", { equipment: "bodyweight", metadata: { protocol: "isometric-max-tension" } }),
  core("side-plank", "Side Plank", { equipment: "bodyweight", bilateral: false, primaryMuscles: ["obliques", "abs"], metadata: { protocol: "isometric" } }),
  core("ab-wheel-kneeling", "Ab Wheel (kneeling)", { equipment: "ab-wheel", primaryMuscles: ["abs", "lats"], metadata: { eccentric_cost: "high" } }),
  core("ab-wheel-standing", "Ab Wheel (standing)", { equipment: "ab-wheel", primaryMuscles: ["abs", "lats"], experienceMin: 2 }),
  core("hanging-knee-raise", "Hanging Knee Raise", { equipment: "bar", bodyWeightLoaded: true }),
  core("hanging-leg-raise", "Hanging Leg Raise", { equipment: "bar", bodyWeightLoaded: true, primaryMuscles: ["abs", "obliques"] }),
  core("toes-to-bar", "Toes-to-Bar", { equipment: "bar", primaryMuscles: ["abs", "lats"], isCompound: true }),
  core("dragon-flag", "Dragon Flag", { equipment: "bench", primaryMuscles: ["abs", "lower_back"], experienceMin: 2 }),
  core("weighted-decline-situp", "Weighted Decline Situp", { equipment: "decline-bench-plate" }),
  core("cable-crunch", "Cable Crunch", { equipment: "cable-rope", stability: "supported" }),
  core("pallof-press", "Pallof Press", { equipment: "cable-or-band", primaryMuscles: ["obliques", "abs"], stability: "supported", metadata: { protocol: "anti-rotation" } }),
  core("dead-bug", "Dead Bug", { equipment: "bodyweight" }),
  core("hollow-body-hold", "Hollow Body Hold", { equipment: "bodyweight", metadata: { protocol: "isometric" } }),
  core("bird-dog", "Bird Dog", { equipment: "bodyweight", primaryMuscles: ["abs", "lower_back", "glutes"], bilateral: false }),
];

// ─── prehab: hip-stabiliser (glute-med / frontal plane) + ankle/foot (8) ───
// Closes a catalog gap surfaced by the role-coverage audit: the durability /
// functional picker needs machine-free `hip_stabilizer` + `ankle_foot`
// candidates (endurance_anchor requires 2 of each per week). Tagged
// automatically by `deriveAccessoryRoles` (slug + region rules).
const PREHAB: NewMovement[] = [
  m("clamshell-band", "Clamshell (band)", { equipment: "band", primaryRegion: "hamstring_posterior", primaryMuscles: ["abductors", "glutes"], bilateral: false, experienceMax: 2, metadata: { emphasis: "glute-med-prehab" } }),
  m("monster-walk-band", "Monster Walk (band)", { equipment: "band", primaryRegion: "hamstring_posterior", primaryMuscles: ["abductors", "glutes"], metadata: { emphasis: "glute-med-prehab" } }),
  m("side-lying-hip-abduction", "Side-Lying Hip Abduction", { equipment: "bodyweight-or-loaded", primaryRegion: "hamstring_posterior", primaryMuscles: ["abductors", "glutes"], bilateral: false }),
  m("single-leg-glute-bridge", "Single-Leg Glute Bridge", { equipment: "bodyweight", primaryRegion: "hamstring_posterior", primaryMuscles: ["glutes"], secondaryMuscles: ["hamstrings"], bilateral: false, metadata: { emphasis: "glute-stability" } }),
  m("fire-hydrant", "Fire Hydrant", { equipment: "bodyweight-or-band", primaryRegion: "hamstring_posterior", primaryMuscles: ["glutes", "abductors"], bilateral: false }),
  m("single-leg-calf-raise", "Single-Leg Calf Raise", { equipment: "bodyweight-or-loaded", primaryRegion: "foot_ankle_calf", primaryMuscles: ["calves"], bilateral: false, highStrainTendon: true }),
  m("heel-walk", "Heel Walk", { equipment: "bodyweight", primaryRegion: "foot_ankle_calf", primaryMuscles: ["tibialis"], metadata: { emphasis: "tibialis-anterior" } }),
  m("ankle-dorsiflexion-band", "Banded Dorsiflexion", { equipment: "band", primaryRegion: "foot_ankle_calf", primaryMuscles: ["tibialis"] }),
  m("short-foot-drill", "Short Foot Drill", { equipment: "bodyweight", primaryRegion: "foot_ankle_calf", primaryMuscles: ["tibialis"], metadata: { emphasis: "foot-intrinsics" } }),
];

export const PATTERNS_PART_2: NewMovement[] = [
  ...BICEPS,
  ...TRICEPS,
  ...GRIP,
  ...SHOULDER_ISO,
  ...CHEST_ISO,
  ...BACK_ISO,
  ...LEG_ISO,
  ...CORE,
  ...PREHAB,
];
