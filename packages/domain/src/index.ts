/**
 * @hta/domain — pure TypeScript domain logic.
 *
 * No DB / no I/O / no React. Heavily tested.
 * Implements the testable invariants documented in
 * `docs/knowledge/design-constraints.md` (DC-* identifiers).
 */

export * from "./region-freshness";
export * from "./ewma-series";
export * from "./prescription-set-work";
export * from "./prescribed-snapshot";
export * from "./system-load";
export * from "./movement-load-identity";
export * from "./movement-work-identity";
export * from "./target-load";
export * from "./legacy-system-load-warmup";
export * from "./prescription-fidelity";
export * from "./rehab-section";
export * from "./swimming";
export * from "./swim-import";
export * from "./swim-course";
export * from "./swim-pool-change";
export * from "./swim-schedule";
export * from "./swim-guidance";
export * from "./swim-pool-input";
export * from "./swim-workout-progress";
export * from "./rehab-reps";
export * from "./types";
export * from "./authored-program";
export * from "./training-schedule";
export * from "./movement-safety";
export * from "./swim-import-outcome";
export * from "./swim-standalone-training-state";
