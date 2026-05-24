/**
 * Shared cross-package types for the bodyweight skill-tree DAG.
 *
 * Re-exports the table-derived types from the schema modules so
 * consumers (planner, engine, UI) don't have to know which schema
 * file each type lives in.
 */

export type {
  MovementFamily,
  MovementNode,
  NewMovementNode,
} from "./schema/movement-nodes";

export { MOVEMENT_FAMILIES } from "./schema/movement-nodes";

export type {
  BwProgress,
  NewBwProgress,
  CleanRepHistoryEntry,
} from "./schema/bw-progress";
