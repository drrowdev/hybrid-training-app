/**
 * @hta/wendler — a pure, framework-agnostic implementation of Jim Wendler's
 * 5/3/1 methodology. Zero runtime dependencies; every weight is `round(TM × %)`.
 *
 * This package is a faithful port of the standalone wendler-app domain engine
 * (see `wendler-531-engine-spec.md`). It deliberately reproduces the published
 * method EXACTLY rather than synthesising prescriptions — fidelity is the point.
 * Test files double as executable methodology documentation.
 *
 * THIS MODULE = the deterministic prescription math (the per-session set
 * builders). The periodization model (Leader/Anchor blocks, 7th-week cadence
 * recommender), supplemental/assistance resolution, named program templates,
 * deload scaling, and taper compose ON TOP in sibling modules.
 */

// Core domain types
export * from "./types";

// Prescription math
export * from "./rounding";
export * from "./e1rm";
export * from "./training-max";
export * from "./waves";
export * from "./warmup";
export * from "./supplemental";
export * from "./pr-detection";

// Periodization model
export * from "./blocks";
export * from "./seventh-week";

// Named program templates (the 5/3/1 Forever catalog)
export * from "./wendler-templates";

// Assistance model (Push / Pull / Single-leg-Core categories + prescriptions)
export * from "./assistance";

// Platform ProgramEngine adapter (5/3/1 implements @hta/program-core)
export * from "./program";
