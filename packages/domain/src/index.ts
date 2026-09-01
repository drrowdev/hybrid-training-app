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
export * from "./target-load";
export * from "./prescription-fidelity";
export * from "./rehab-section";
export * from "./types";
