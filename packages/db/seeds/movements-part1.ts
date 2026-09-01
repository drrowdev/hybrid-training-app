/**
 * Movement catalog seed — part 1: strength patterns (squat / hinge / press / pull / carry).
 *
 * Every helper constructor (`squat`, `hinge`, `press`, `pull`, `carry`)
 * carries a per-category default `experienceMin` / `experienceMax` band
 * (PR W2 — Option B). Rows that diverge from the category default
 * specify their own band inline. Rules of thumb:
 *
 *   - Core barbell lifts (`back-squat-*`, `conventional-deadlift`,
 *     `bench-press-flat`, `ohp-standing`, `rdl-bb`, `pendlay-row` …)
 *     stay at the universal default `(0, 4)`.
 *   - Beginner regressions (`goblet-squat`, `kb-deadlift`, machine work,
 *     DB bench) live at `(0, 2)` — appropriate up through intermediate.
 *   - Variations-of-variations (paused / tempo / deficit / Anderson)
 *     gate at `(2, 4)`.
 *   - Advanced unilateral / loaded BW (`pistol-squat`, `archer-pull-up`,
 *     `weighted-pull-up`) gate at `(2, 4)`.
 *   - High-skill BW (muscle-up, planche, front lever, handstand
 *     press) gate at `(3, 4)`.
 *
 * See `experience-tier-scope.md` §3 Option B + §5.2 + the curation
 * rules block in the W2 PR description.
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

const SQUAT: NewMovement[] = [
  squat("back-squat-high-bar", "Back Squat (high-bar)", { equipment: "barbell" }),
  squat("back-squat-low-bar", "Back Squat (low-bar)", { equipment: "barbell", primaryMuscles: ["quads", "glutes", "hamstrings"], metadata: { cns_cost: "high", emphasis: "posterior-chain" } }),
  squat("front-squat", "Front Squat", { equipment: "barbell", primaryMuscles: ["quads", "upper_chest"], secondaryMuscles: ["glutes", "abs", "lower_back", "adductors"], highStrainTendon: true }),
  squat("ssb-squat", "Safety Bar Squat", { equipment: "barbell-ssb" }),
  squat("zercher-squat", "Zercher Squat", { equipment: "barbell", primaryMuscles: ["quads", "glutes", "upper_chest"], secondaryMuscles: ["biceps", "lower_back", "adductors"], experienceMin: 2 }),
  squat("box-squat", "Box Squat", { equipment: "barbell-box", metadata: { eccentric_cost: "low", emphasis: "concentric" } }),
  squat("landmine-squat-to-box", "Landmine Squat to a Box", {
    equipment: "barbell-box",
    axialLoad: "moderate",
    stability: "supported",
    isSupported: true,
    interferenceCost: "low_moderate",
    metadata: {
      eccentric_cost: "low",
      cns_cost: "moderate",
      stim_fatigue_ratio: "high",
      emphasis: "upright-controlled-depth",
    },
  }),
  squat("paused-back-squat", "Paused Back Squat", { equipment: "barbell", metadata: { tempo: "1-3-X-0" }, experienceMin: 2 }),
  squat("tempo-back-squat", "Tempo Back Squat", { equipment: "barbell", metadata: { tempo: "3-0-X-0", eccentric_cost: "high" }, experienceMin: 2 }),
  squat("bulgarian-split-squat-db", "Bulgarian Split Squat (DB)", { equipment: "dumbbells-bench", bilateral: false, axialLoad: "moderate", highStrainTendon: true }),
  squat("bulgarian-split-squat-bb", "Bulgarian Split Squat (BB)", { equipment: "barbell-bench", bilateral: false, axialLoad: "high", experienceMin: 2 }),
  // One dumbbell instead of two. The offset load is resisted isometrically by
  // the lateral trunk, which is why `obliques` is tagged on top of the helper's
  // defaults — an oblique or trunk limitation should catch this where it would
  // not catch the symmetrical two-dumbbell version.
  //
  // Deliberately NOT tagged `anti_rotation` despite that demand being real.
  // The Hybrid archetype requires `single_leg` AND `anti_rotation` weekly and
  // resolves them in that order, deduplicating by movement id only — so a row
  // carrying both roles could be seated as the trunk-stability slot in a
  // session that already took a Bulgarian split squat for the leg slot, and the
  // lifter would lose their trunk work entirely. The trunk demand here is
  // incidental to leg work; on a suitcase carry it IS the exercise.
  //
  // `highStrainTendon` matches the two-dumbbell sibling: same knee position,
  // same deep-flexion loading, and the flag feeds the tissue/impact stress
  // bucket. Flagging one and not the other would be incoherent.
  squat("bulgarian-split-squat-db-single-arm", "Bulgarian Split Squat (single-arm DB)", { equipment: "dumbbell-bench", bilateral: false, axialLoad: "moderate", highStrainTendon: true, secondaryMuscles: ["hamstrings", "lower_back", "adductors", "obliques"], metadata: { eccentric_cost: "moderate", cns_cost: "moderate", stim_fatigue_ratio: "moderate", emphasis: "offset-load" } }),
  squat("split-squat-db", "Split Squat (DB)", { equipment: "dumbbells", bilateral: false, axialLoad: "moderate" }),
  squat("split-squat-bb", "Split Squat (BB)", { equipment: "barbell", bilateral: false, axialLoad: "high", experienceMin: 2 }),
  // Lunges — the stepping cousins of the static split squat. The catalog had
  // none, while `movement-muscle-map.ts`, `accessory-schema.md` and migration
  // 0019 all already referenced them, so the single-leg pool was thinner than
  // every consumer assumed. Attributes track the split-squat pair; the step
  // makes them less stable, so no `stability: "supported"`. Reverse stepping
  // shifts load off the front knee onto the hip, hence the differing emphasis.
  squat("forward-lunge", "Forward Lunge", { equipment: "bodyweight", bilateral: false, axialLoad: "low", bodyWeightLoaded: true, metadata: { eccentric_cost: "moderate", cns_cost: "low", stim_fatigue_ratio: "moderate", emphasis: "front-knee-loaded" } }),
  squat("forward-lunge-db", "Forward Lunge (DB)", { equipment: "dumbbells", bilateral: false, axialLoad: "moderate", metadata: { eccentric_cost: "moderate", cns_cost: "moderate", stim_fatigue_ratio: "moderate", emphasis: "front-knee-loaded" } }),
  squat("forward-lunge-bb", "Forward Lunge (BB)", { equipment: "barbell", bilateral: false, axialLoad: "high", experienceMin: 2, metadata: { eccentric_cost: "moderate", cns_cost: "high", stim_fatigue_ratio: "moderate", emphasis: "front-knee-loaded" } }),
  squat("reverse-lunge", "Reverse Lunge", { equipment: "bodyweight", bilateral: false, axialLoad: "low", bodyWeightLoaded: true, metadata: { eccentric_cost: "moderate", cns_cost: "low", stim_fatigue_ratio: "moderate", emphasis: "hip-loaded-knee-friendly" } }),
  squat("reverse-lunge-db", "Reverse Lunge (DB)", { equipment: "dumbbells", bilateral: false, axialLoad: "moderate", metadata: { eccentric_cost: "moderate", cns_cost: "moderate", stim_fatigue_ratio: "moderate", emphasis: "hip-loaded-knee-friendly" } }),
  squat("reverse-lunge-bb", "Reverse Lunge (BB)", { equipment: "barbell", bilateral: false, axialLoad: "high", experienceMin: 2, metadata: { eccentric_cost: "moderate", cns_cost: "high", stim_fatigue_ratio: "moderate", emphasis: "hip-loaded-knee-friendly" } }),
  // Walking lunge — the travelling forward lunge. Same tissue demand, so the
  // muscle tags match `forward-lunge`; only the emphasis differs.
  squat("walking-lunge", "Walking Lunge", { equipment: "bodyweight", bilateral: false, axialLoad: "low", bodyWeightLoaded: true, metadata: { eccentric_cost: "moderate", cns_cost: "low", stim_fatigue_ratio: "moderate", emphasis: "travelling-quad-glute" } }),
  squat("walking-lunge-db", "Walking Lunge (DB)", { equipment: "dumbbells", bilateral: false, axialLoad: "moderate", metadata: { eccentric_cost: "moderate", cns_cost: "moderate", stim_fatigue_ratio: "moderate", emphasis: "travelling-quad-glute" } }),
  squat("walking-lunge-bb", "Walking Lunge (BB)", { equipment: "barbell", bilateral: false, axialLoad: "high", experienceMin: 2, metadata: { eccentric_cost: "moderate", cns_cost: "high", stim_fatigue_ratio: "moderate", emphasis: "travelling-quad-glute" } }),
  // Step-up — the lowest-impact loaded single-leg option (no deep front-knee
  // flexion, no floor contact for the trailing leg). The box it needs isn't
  // representable: the equipment inventory has no box/bench field, and a
  // `bodyweight-box` tag would additionally read as externally loaded to
  // `carriesExternalLoad`. So the implement is tagged plainly and the box is
  // named in the setup text, matching `atg-split-squat`'s handling.
  // Adductors stay tagged (helper default) even though a step-up is only
  // mildly groin-loading: the limitation filter keys off muscle tags, and
  // dropping the tag to keep step-ups available under an adductor flag would
  // silently overrule a safety gate rather than let the user allow-list it.
  squat("step-up", "Step-Up", { equipment: "bodyweight", bilateral: false, axialLoad: "low", bodyWeightLoaded: true, metadata: { eccentric_cost: "low", cns_cost: "low", stim_fatigue_ratio: "moderate", emphasis: "low-impact-single-leg" } }),
  squat("step-up-db", "Step-Up (DB)", { equipment: "dumbbells", bilateral: false, axialLoad: "moderate", metadata: { eccentric_cost: "low", cns_cost: "moderate", stim_fatigue_ratio: "moderate", emphasis: "low-impact-single-leg" } }),
  squat("step-up-bb", "Step-Up (BB)", { equipment: "barbell", bilateral: false, axialLoad: "high", experienceMin: 2, metadata: { eccentric_cost: "low", cns_cost: "high", stim_fatigue_ratio: "moderate", emphasis: "low-impact-single-leg" } }),
  // Curtsy lunge — crossing behind loads the frontal-plane hip, so it also
  // tags abductors and carries `adductor_groin` as a secondary region. The
  // cross-behind step needs balance and hip control, hence experienceMin 1.
  squat("curtsy-lunge", "Curtsy Lunge", { equipment: "bodyweight", bilateral: false, axialLoad: "low", bodyWeightLoaded: true, secondaryMuscles: ["hamstrings", "lower_back", "adductors", "abductors"], secondaryRegions: ["hamstring_posterior", "lumbar_trunk", "foot_ankle_calf", "adductor_groin"], experienceMin: 1, metadata: { eccentric_cost: "moderate", cns_cost: "low", stim_fatigue_ratio: "moderate", emphasis: "frontal-plane-hip" } }),
  squat("curtsy-lunge-db", "Curtsy Lunge (DB)", { equipment: "dumbbells", bilateral: false, axialLoad: "moderate", secondaryMuscles: ["hamstrings", "lower_back", "adductors", "abductors"], secondaryRegions: ["hamstring_posterior", "lumbar_trunk", "foot_ankle_calf", "adductor_groin"], experienceMin: 1, metadata: { eccentric_cost: "moderate", cns_cost: "moderate", stim_fatigue_ratio: "moderate", emphasis: "frontal-plane-hip" } }),
  // Lateral lunge — a frontal-plane movement that lengthens the trailing
  // adductor under load, so the groin is the PRIMARY region (mirroring
  // `cossack-squat-loaded`), not a secondary one. Region matters here because
  // `affected-movements.ts` matches a limitation on primary_region only.
  squat("lateral-lunge", "Lateral Lunge", { equipment: "bodyweight", bilateral: false, axialLoad: "low", bodyWeightLoaded: true, primaryRegion: "adductor_groin", secondaryRegions: ["knee", "hamstring_posterior", "lumbar_trunk"], primaryMuscles: ["quads", "adductors", "glutes"], secondaryMuscles: ["hamstrings"], metadata: { eccentric_cost: "moderate", cns_cost: "low", stim_fatigue_ratio: "moderate", emphasis: "frontal-plane-groin" } }),
  squat("lateral-lunge-db", "Lateral Lunge (DB)", { equipment: "dumbbells", bilateral: false, axialLoad: "moderate", primaryRegion: "adductor_groin", secondaryRegions: ["knee", "hamstring_posterior", "lumbar_trunk"], primaryMuscles: ["quads", "adductors", "glutes"], secondaryMuscles: ["hamstrings"], metadata: { eccentric_cost: "moderate", cns_cost: "moderate", stim_fatigue_ratio: "moderate", emphasis: "frontal-plane-groin" } }),
  squat("atg-split-squat", "ATG Split Squat", { equipment: "bodyweight", bilateral: false, axialLoad: "low", primaryMuscles: ["quads", "glutes", "adductors"], metadata: { rom_profile: "deep" } }),
  squat("cossack-squat", "Cossack Squat", { equipment: "bodyweight-or-loaded", bilateral: false, axialLoad: "low", primaryMuscles: ["quads", "adductors", "glutes"], secondaryMuscles: ["hamstrings"] }),
  squat("goblet-squat", "Goblet Squat", { equipment: "dumbbell-or-kb", axialLoad: "moderate", stability: "supported" }),
  squat("sissy-squat", "Sissy Squat", { equipment: "bodyweight-or-machine", axialLoad: "low", primaryMuscles: ["quads"], highStrainTendon: true, experienceMin: 2 }),
  squat("pendulum-squat", "Pendulum Squat", { equipment: "machine-pendulum", axialLoad: "moderate", stability: "fixed_path" }),
  squat("hack-squat", "Hack Squat", { equipment: "machine-hack", axialLoad: "moderate", stability: "fixed_path" }),
  squat("leg-press-45", "Leg Press (45°)", { equipment: "machine-leg-press", axialLoad: "low", stability: "fixed_path", isCompound: true }),
  squat("leg-press-vertical", "Leg Press (vertical)", { equipment: "machine-leg-press", axialLoad: "low", stability: "fixed_path", isCompound: true }),
  squat("smith-squat", "Smith Machine Squat", { equipment: "smith", axialLoad: "high", stability: "fixed_path" }),
  squat("belt-squat", "Belt Squat", { equipment: "machine-belt-squat", axialLoad: "low" }),
  squat("pistol-squat", "Pistol Squat", { equipment: "bodyweight", bilateral: false, axialLoad: "low", experienceMin: 2 }),
  squat("spanish-squat", "Spanish Squat", { equipment: "band-anchor", axialLoad: "low", highStrainTendon: true, primaryMuscles: ["quads"], metadata: { emphasis: "patellar-tendon-isometric-protocol", tempo: "isometric-30s" } }),
  squat("wall-sit", "Wall Sit", { equipment: "bodyweight-wall", axialLoad: "low", primaryMuscles: ["quads"], metadata: { protocol: "isometric-tendon", tempo: "isometric-30-60s" } }),
];

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

const HINGE: NewMovement[] = [
  hinge("conventional-deadlift", "Conventional Deadlift", { equipment: "barbell" }),
  hinge("sumo-deadlift", "Sumo Deadlift", { equipment: "barbell", primaryMuscles: ["hamstrings", "glutes", "adductors", "lower_back"] }),
  hinge("trap-bar-deadlift", "Trap Bar Deadlift", { equipment: "trap-bar", primaryMuscles: ["quads", "glutes", "hamstrings", "lower_back"] }),
  hinge("deficit-deadlift", "Deficit Deadlift", { equipment: "barbell", metadata: { emphasis: "off-floor-strength", eccentric_cost: "high" }, experienceMin: 2 }),
  hinge("block-pull-deadlift", "Block Pull Deadlift", { equipment: "barbell-blocks", metadata: { emphasis: "lockout-strength" }, experienceMin: 2 }),
  // Distinct from `block-pull-deadlift`: the bar rests on rack pins (usually at
  // or above the knee), not on blocks, so the range and the loads differ. They
  // used to share one catalog row, which let a rack-pull 1RM re-anchor the
  // lifter's Deadlift role — see migration 0132.
  hinge("rack-pull", "Rack Pull", { equipment: "barbell-rack", metadata: { emphasis: "lockout-strength", rom_profile: "partial" }, experienceMin: 2 }),
  hinge("paused-deadlift", "Paused Deadlift", { equipment: "barbell", metadata: { tempo: "off-floor-pause-2s" }, experienceMin: 2 }),
  hinge("rdl-bb", "Romanian Deadlift (BB)", { equipment: "barbell", primaryMuscles: ["hamstrings", "glutes"], secondaryMuscles: ["lower_back", "lats"], metadata: { eccentric_cost: "high" } }),
  hinge("rdl-db", "Romanian Deadlift (DB)", { equipment: "dumbbells", primaryMuscles: ["hamstrings", "glutes"], secondaryMuscles: ["lats", "forearms", "traps", "lower_back"], axialLoad: "moderate" }),
  hinge("deficit-rdl", "Deficit RDL", { equipment: "barbell", metadata: { rom_profile: "deep" }, experienceMin: 2 }),
  hinge("single-leg-rdl", "Single-Leg RDL", { equipment: "dumbbell-or-kb", bilateral: false, axialLoad: "moderate", primaryMuscles: ["hamstrings", "glutes"], secondaryMuscles: ["abductors", "lower_back"], experienceMin: 2 }),
  hinge("stiff-leg-deadlift", "Stiff-Leg Deadlift", { equipment: "barbell" }),
  hinge("good-morning", "Good Morning", { equipment: "barbell", primaryMuscles: ["hamstrings", "lower_back", "glutes"] }),
  hinge("seated-good-morning", "Seated Good Morning", { equipment: "barbell", primaryMuscles: ["lower_back", "hamstrings"], secondaryMuscles: ["lats", "forearms", "traps", "glutes"], experienceMin: 2 }),
  hinge("hip-thrust-bb", "Barbell Hip Thrust", { equipment: "barbell-bench", primaryMuscles: ["glutes"], secondaryMuscles: ["hamstrings"], axialLoad: "low", stability: "supported" }),
  hinge("hip-thrust-b-stance", "B-Stance Hip Thrust", { equipment: "barbell-bench", bilateral: false, primaryMuscles: ["glutes"], axialLoad: "low" }),
  hinge("single-leg-hip-thrust", "Single-Leg Hip Thrust", { equipment: "bench", bilateral: false, primaryMuscles: ["glutes"], axialLoad: "low" }),
  hinge("glute-bridge-bb", "Barbell Glute Bridge", { equipment: "barbell", primaryMuscles: ["glutes"], axialLoad: "low" }),
  hinge("back-extension-45", "45° Back Extension", { equipment: "ghd-machine", primaryMuscles: ["lower_back", "glutes", "hamstrings"], axialLoad: "moderate", stability: "supported" }),
  // Distinct from the 45°: the GHD holds the torso HORIZONTAL, so the lever is
  // longest at the top and the range is larger. Different apparatus, different
  // strength curve — plenty of gyms have both.
  //
  // The `hinge(...)` helper is built around the deadlift, so its defaults are
  // overridden rather than inherited: no `knee` secondary region (the knees are
  // anchored, not loaded), no lats/forearms/traps (nothing is being held), and
  // no high cns_cost. Axial load matches the 45°.
  hinge("back-extension-ghd", "GHD Back Extension", { equipment: "ghd-machine", primaryMuscles: ["lower_back", "glutes", "hamstrings"], secondaryMuscles: [], secondaryRegions: ["lumbar_trunk"], axialLoad: "moderate", stability: "supported", metadata: { eccentric_cost: "moderate", cns_cost: "low", stim_fatigue_ratio: "moderate", emphasis: "horizontal-lever" } }),
  hinge("reverse-hyper", "Reverse Hyperextension", { equipment: "machine-reverse-hyper", primaryMuscles: ["lower_back", "glutes"], axialLoad: "low", stability: "supported" }),
  hinge("kb-swing-russian", "Russian KB Swing", { equipment: "kettlebell", primaryMuscles: ["glutes", "hamstrings"], secondaryMuscles: ["lower_back", "abs"], axialLoad: "moderate" }),
  hinge("kb-swing-american", "American KB Swing", { equipment: "kettlebell", primaryMuscles: ["glutes", "hamstrings", "side_delts"], secondaryMuscles: ["lats", "forearms", "traps", "lower_back"], axialLoad: "moderate" }),
  hinge("cable-pull-through", "Cable Pull-Through", { equipment: "cable", primaryMuscles: ["glutes", "hamstrings"], axialLoad: "low", stability: "supported" }),
];

const press = (slug: string, name: string, opts: MoveOpts = {}): NewMovement =>
  m(slug, name, {
    pattern: "press",
    primaryRegion: "shoulder_scapular",
    secondaryRegions: ["elbow_forearm"],
    primaryMuscles: ["chest", "front_delts", "triceps"],
    secondaryMuscles: ["side_delts"],
    isCompound: true,
    axialLoad: "low",
    metadata: { cns_cost: "high", stim_fatigue_ratio: "moderate" },
    ...opts,
  });

const PRESS: NewMovement[] = [
  press("bench-press-flat", "Bench Press (flat)", { equipment: "barbell-bench" }),
  press("bench-press-incline", "Incline Bench Press", { equipment: "barbell-incline-bench", primaryMuscles: ["upper_chest", "front_delts", "triceps"] }),
  press("bench-press-decline", "Decline Bench Press", { equipment: "barbell-decline-bench", primaryMuscles: ["chest", "triceps"] }),
  press("bench-press-paused", "Paused Bench Press", { equipment: "barbell-bench", metadata: { tempo: "1-3-X-0" }, experienceMin: 2 }),
  press("close-grip-bench", "Close-Grip Bench Press", { equipment: "barbell-bench", primaryMuscles: ["triceps", "chest", "front_delts"] }),
  press("wide-grip-bench", "Wide-Grip Bench Press", { equipment: "barbell-bench", primaryMuscles: ["chest", "front_delts"], secondaryMuscles: ["side_delts", "triceps"] }),
  press("db-bench-flat", "DB Bench Press (flat)", { equipment: "dumbbells-bench" }),
  press("db-bench-incline", "DB Bench Press (incline)", { equipment: "dumbbells-incline-bench", primaryMuscles: ["upper_chest", "front_delts", "triceps"] }),
  press("db-bench-decline", "DB Bench Press (decline)", { equipment: "dumbbells-decline-bench", primaryMuscles: ["chest", "triceps"] }),
  press("ohp-standing", "Standing Overhead Press", { equipment: "barbell", primaryMuscles: ["front_delts", "triceps"], secondaryMuscles: ["side_delts", "upper_chest", "abs", "lower_back"], secondaryRegions: ["elbow_forearm", "lumbar_trunk"], axialLoad: "high" }),
  press("ohp-seated", "Seated Overhead Press", { equipment: "barbell", primaryMuscles: ["front_delts", "triceps"], secondaryMuscles: ["side_delts"], axialLoad: "high", stability: "supported" }),
  press("push-press", "Push Press", { equipment: "barbell", primaryMuscles: ["front_delts", "triceps"], secondaryMuscles: ["side_delts", "lower_back"], secondaryRegions: ["elbow_forearm", "lumbar_trunk"], axialLoad: "high" }),
  press("db-shoulder-press-seated", "Seated DB Shoulder Press", { equipment: "dumbbells-bench", primaryMuscles: ["front_delts", "triceps"], secondaryMuscles: ["side_delts"] }),
  press("db-shoulder-press-standing", "Standing DB Shoulder Press", { equipment: "dumbbells", primaryMuscles: ["front_delts", "triceps"], secondaryMuscles: ["side_delts", "lower_back"], secondaryRegions: ["elbow_forearm", "lumbar_trunk"], axialLoad: "moderate" }),
  press("arnold-press", "Arnold Press", { equipment: "dumbbells", primaryMuscles: ["front_delts", "side_delts", "triceps"] }),
  press("landmine-press-half-kneeling", "Half-Kneeling Landmine Press", { equipment: "landmine", bilateral: false, primaryMuscles: ["front_delts", "upper_chest", "triceps"] }),
  press("landmine-press-standing", "Standing Landmine Press", { equipment: "landmine", primaryMuscles: ["front_delts", "upper_chest", "triceps"], secondaryMuscles: ["side_delts", "lower_back"], secondaryRegions: ["elbow_forearm", "lumbar_trunk"] }),
  press("dip-parallel", "Parallel Bar Dip", { equipment: "dip-bars", bodyWeightLoaded: true, primaryMuscles: ["chest", "triceps", "front_delts"] }),
  // The pressing counterpart to `weighted-pull-up`, and tracked the same way:
  // its own movement so it carries its own history and loaded max.
  //
  // The tag is the BELT, not the bars. `requirementFromEquipmentTag` matches by
  // substring, and `dip-belt` is the only string that routes to the lifter's
  // tracked dip belt — the belt is the scarce item anyway. A tag the resolver
  // doesn't recognise returns null and the slug heuristic takes over, which for
  // this slug falls through to `bodyweight_or_generic`: available to everyone,
  // belt or no belt.
  press("weighted-dip", "Weighted Dip", { equipment: "dip-belt", bodyWeightLoaded: true, primaryMuscles: ["chest", "triceps", "front_delts"], metadata: { cns_cost: "high", stim_fatigue_ratio: "moderate", emphasis: "max-strength" }, experienceMin: 2 }),
  press("dip-ring", "Ring Dip", { equipment: "rings", bodyWeightLoaded: true, primaryMuscles: ["chest", "triceps"], experienceMin: 2 }),
  press("dip-bench", "Bench Dip", { equipment: "bench", primaryMuscles: ["triceps", "front_delts"] }),
  press("machine-chest-press", "Machine Chest Press", { equipment: "machine-chest-press", stability: "fixed_path" }),
  press("smith-bench-press", "Smith Machine Bench Press", { equipment: "smith-bench", stability: "fixed_path" }),
  press("floor-press", "Floor Press", { equipment: "barbell-floor", primaryMuscles: ["chest", "triceps"], metadata: { emphasis: "lockout" }, experienceMin: 2 }),
  press("z-press", "Z-Press", { equipment: "barbell-floor-seated", primaryMuscles: ["front_delts", "triceps", "abs"], secondaryMuscles: ["side_delts", "lower_back"], secondaryRegions: ["elbow_forearm", "lumbar_trunk"], axialLoad: "high", experienceMin: 2 }),
];

const pull = (slug: string, name: string, opts: MoveOpts = {}): NewMovement =>
  m(slug, name, {
    pattern: "pull",
    primaryRegion: "shoulder_scapular",
    secondaryRegions: ["elbow_forearm"],
    primaryMuscles: ["lats", "mid_back", "biceps"],
    secondaryMuscles: ["rear_delts", "forearms"],
    isCompound: true,
    axialLoad: "low",
    metadata: { cns_cost: "moderate", stim_fatigue_ratio: "high" },
    ...opts,
  });

const PULL: NewMovement[] = [
  pull("pull-up-overhand", "Pull-Up (overhand)", { equipment: "bar", bodyWeightLoaded: true }),
  pull("chin-up", "Chin-Up", { equipment: "bar", bodyWeightLoaded: true, primaryMuscles: ["lats", "biceps"] }),
  pull("pull-up-neutral", "Neutral-Grip Pull-Up", { equipment: "bar-neutral", bodyWeightLoaded: true }),
  pull("weighted-pull-up", "Weighted Pull-Up", { equipment: "bar-belt", bodyWeightLoaded: true, metadata: { emphasis: "max-strength" }, experienceMin: 2 }),
  pull("archer-pull-up", "Archer Pull-Up", { equipment: "bar", bilateral: false, experienceMin: 2 }),
  pull("lat-pulldown-wide", "Lat Pulldown (wide grip)", { equipment: "cable-pulldown", stability: "fixed_path" }),
  pull("lat-pulldown-neutral", "Lat Pulldown (neutral grip)", { equipment: "cable-pulldown", stability: "fixed_path" }),
  pull("lat-pulldown-narrow", "Lat Pulldown (narrow grip)", { equipment: "cable-pulldown", primaryMuscles: ["lats", "biceps"], stability: "fixed_path" }),
  pull("single-arm-pulldown", "Single-Arm Pulldown", { equipment: "cable", bilateral: false, stability: "supported" }),
  pull("bb-row-overhand", "Barbell Row (overhand)", { equipment: "barbell", primaryMuscles: ["mid_back", "lats", "rear_delts"], secondaryMuscles: ["rear_delts", "forearms", "biceps", "lower_back"], secondaryRegions: ["elbow_forearm", "lumbar_trunk"], axialLoad: "moderate" }),
  pull("bb-row-underhand", "Barbell Row (underhand)", { equipment: "barbell", primaryMuscles: ["lats", "mid_back", "biceps"], secondaryMuscles: ["rear_delts", "forearms", "lower_back"], secondaryRegions: ["elbow_forearm", "lumbar_trunk"], axialLoad: "moderate" }),
  pull("pendlay-row", "Pendlay Row", { equipment: "barbell", primaryMuscles: ["mid_back", "lats", "rear_delts"], secondaryMuscles: ["rear_delts", "forearms", "biceps", "lower_back"], secondaryRegions: ["elbow_forearm", "lumbar_trunk"], axialLoad: "moderate" }),
  pull("seal-row-bb", "Seal Row (BB)", { equipment: "barbell-bench-high", stability: "supported", axialLoad: "low" }),
  pull("seal-row-db", "Seal Row (DB)", { equipment: "dumbbells-bench-high", stability: "supported", axialLoad: "low" }),
  pull("chest-supported-row-db", "Chest-Supported DB Row", { equipment: "dumbbells-incline-bench", stability: "supported", axialLoad: "low" }),
  pull("chest-supported-row-machine", "Chest-Supported Machine Row", { equipment: "machine-row", stability: "fixed_path", axialLoad: "low" }),
  pull("t-bar-row", "T-Bar Row", { equipment: "t-bar", primaryMuscles: ["mid_back", "lats"], secondaryMuscles: ["rear_delts", "forearms", "biceps", "lower_back"], secondaryRegions: ["elbow_forearm", "lumbar_trunk"], axialLoad: "moderate" }),
  pull("db-row-single-arm", "Single-Arm DB Row", { equipment: "dumbbell-bench", bilateral: false, stability: "supported" }),
  pull("cable-row-seated", "Seated Cable Row", { equipment: "cable-row", stability: "supported", axialLoad: "low" }),
  pull("cable-row-low", "Low Cable Row", { equipment: "cable", stability: "supported", primaryMuscles: ["lats", "mid_back"], secondaryMuscles: ["rear_delts", "forearms", "biceps"] }),
  pull("inverted-row", "Inverted Row", { equipment: "bar-or-rings", bodyWeightLoaded: true, primaryMuscles: ["mid_back", "lats", "biceps"] }),
  pull("face-pull", "Face Pull", { equipment: "cable-rope", primaryMuscles: ["rear_delts", "mid_back"], secondaryMuscles: ["traps"], isCompound: false }),
  pull("meadows-row", "Meadows Row", { equipment: "landmine", bilateral: false, primaryMuscles: ["lats", "mid_back"], secondaryMuscles: ["rear_delts", "forearms", "biceps", "lower_back"], secondaryRegions: ["elbow_forearm", "lumbar_trunk"], experienceMin: 2 }),
  pull("kroc-row", "Kroc Row", { equipment: "dumbbell-bench", bilateral: false, experienceMin: 2 }),
];

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

const CARRY: NewMovement[] = [
  carry("farmer-carry-db", "Farmer Carry (DB)", { equipment: "dumbbells" }),
  carry("farmer-carry-trap-bar", "Farmer Carry (Trap Bar)", { equipment: "trap-bar" }),
  carry("farmer-carry-kb", "Farmer Carry (KB)", { equipment: "kettlebells" }),
  carry("suitcase-carry", "Suitcase Carry", { equipment: "dumbbell-or-kb", bilateral: false, primaryMuscles: ["obliques", "abs", "forearms"] }),
  carry("overhead-carry", "Overhead Carry", { equipment: "dumbbell-or-kb", primaryMuscles: ["front_delts", "side_delts", "abs", "traps"] }),
  carry("zercher-carry", "Zercher Carry", { equipment: "barbell", primaryMuscles: ["abs", "upper_chest", "biceps"], axialLoad: "high" }),
];

export const PATTERNS_PART_1: NewMovement[] = [
  ...SQUAT,
  ...HINGE,
  ...PRESS,
  ...PULL,
  ...CARRY,
];
