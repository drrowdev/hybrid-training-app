/**
 * Program registry — the platform's catalogue of pluggable training programs.
 *
 * Maps a stable `programId` to its `@hta/program-core` `ProgramEngine`, and
 * exposes a display catalogue for the (future) program picker. This is the single
 * place the platform driver looks up which engine owns a given program instance.
 *
 * Pure: no DB, no React. The archetype engine is intentionally NOT here yet — it
 * will be wrapped as a ProgramEngine and registered in a later step.
 */
import type { ProgramEngine, ProgramMeta } from "@hta/program-core";
import { wendler531Engine } from "@hta/wendler";
import { tacticalBarbellEngine, zuluHtEngine } from "@hta/tacticalbarbell";
import { greenProtocolEngine } from "@hta/green";

/**
 * Every engine the platform can run, keyed by its stable `meta.id`.
 *
 * `zulu-ht` is included because Green Protocol delegates to it and a user could
 * run it as a standalone mass block, but it is flagged non-selectable in the
 * catalogue below (it's a building block, not a headline program).
 */
const ENGINES: ProgramEngine[] = [
  wendler531Engine as ProgramEngine,
  tacticalBarbellEngine as ProgramEngine,
  greenProtocolEngine as ProgramEngine,
  zuluHtEngine as ProgramEngine,
];

const BY_ID = new Map<string, ProgramEngine>(ENGINES.map((e) => [e.meta.id, e]));

/** Look up the engine that owns a program id, or undefined. */
export function getProgramEngine(programId: string): ProgramEngine | undefined {
  return BY_ID.get(programId);
}

/** Whether a program id is known to the platform. */
export function isKnownProgram(programId: string): boolean {
  return BY_ID.has(programId);
}

/** A program as shown in the picker. */
export interface ProgramCatalogEntry extends ProgramMeta {
  /** Whether a user can pick this program directly (vs. an internal building block). */
  selectable: boolean;
}

/** Program ids that exist as engines but are not headline, user-selectable programs. */
const NON_SELECTABLE = new Set<string>(["tactical-barbell-zulu-ht"]);

/**
 * The display catalogue for the program picker. Order is the headline order
 * users should see; non-selectable building blocks are included but flagged.
 */
export const PROGRAM_CATALOG: ProgramCatalogEntry[] = ENGINES.map((e) => ({
  ...e.meta,
  selectable: !NON_SELECTABLE.has(e.meta.id),
}));

/** Just the user-selectable programs, for the picker UI. */
export function selectablePrograms(): ProgramCatalogEntry[] {
  return PROGRAM_CATALOG.filter((p) => p.selectable);
}
