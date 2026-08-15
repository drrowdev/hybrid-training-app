/**
 * Program-owned warm-up schemes.
 *
 * The app-wide default ladder (`DEFAULT_WARMUP_SCHEME`) is anchored to the
 * day's top working set, and that stays the default for the native planner and
 * for every program with no published warm-up of its own. A program that DOES
 * publish one owns it: this module is the single place (plan §6.9) that maps a
 * platform program id to the scheme the app must use for its sessions, so the
 * planner, the swap rebuild and any future regeneration path all agree.
 *
 * The only entry today is the 5/3/1-family engine, whose ramp is a FIXED
 * 40/50/60% of the Training Max × 5/5/3 — flat across the 5s / 3s / 5/3/1
 * weeks. The numbers are DERIVED from the engine's own `TRAINING_MAX_WARMUP`
 * (0..1 fractions → the percent space `WarmupScheme` stores), never restated
 * here, so the two can't drift.
 *
 * Pure: no DB, no React. Callers resolve the owning program id and hand it in.
 */
import { TRAINING_MAX_WARMUP, wendler531Engine } from "@hta/wendler";
import {
  fractionToPercent,
  type WarmupScheme,
  type WarmupAnchor,
} from "./warmups";

/** Translate an engine `WarmupConfig` into the app's stored scheme shape. */
function schemeFromEngineConfig(config: {
  percents: number[];
  reps: number[];
  anchor?: WarmupAnchor;
}): WarmupScheme {
  return {
    setCount: config.percents.length,
    percentLadder: config.percents.map(fractionToPercent),
    repLadder: [...config.reps],
    ...(config.anchor != null ? { anchor: config.anchor } : {}),
  };
}

/**
 * 5/3/1's own ramp, in app scheme space: 40/50/60% of the TRAINING MAX × 5/5/3.
 * A 200 kg TM therefore warms up 80/100/120 kg in every week of the wave.
 */
export const TRAINING_MAX_ANCHORED_WARMUP_SCHEME: WarmupScheme =
  schemeFromEngineConfig(TRAINING_MAX_WARMUP);

/**
 * Program id → the warm-up scheme that program prescribes. Keyed off the
 * engine's own `meta.id` so the key can never drift from the registry.
 */
export const PROGRAM_WARMUP_SCHEMES: Readonly<Record<string, WarmupScheme>> =
  Object.freeze({
    [wendler531Engine.meta.id]: TRAINING_MAX_ANCHORED_WARMUP_SCHEME,
  });

/** True when the program publishes its own warm-up ladder. */
export function programOwnsWarmupScheme(
  programId: string | null | undefined,
): boolean {
  return programId != null && programId in PROGRAM_WARMUP_SCHEMES;
}

/**
 * Pull the owning block's program id out of a `planned_sessions` row selected
 * with a `training_blocks!inner(program_id)` embed. PostgREST returns the embed
 * as an object for a many-to-one relationship, but typed clients sometimes
 * surface it as a one-element array — accept both, and `null` for an archetype
 * block (no program id) or a row selected without the embed.
 */
export function programIdFromJoinedBlock(row: unknown): string | null {
  if (!row || typeof row !== "object") return null;
  const embedded = (row as { training_blocks?: unknown }).training_blocks;
  const block = Array.isArray(embedded) ? embedded[0] : embedded;
  if (!block || typeof block !== "object") return null;
  const programId = (block as { program_id?: unknown }).program_id;
  return typeof programId === "string" && programId.length > 0 ? programId : null;
}

/**
 * The scheme to use for a session owned by `programId`.
 *
 * A program with a published ramp wins over the user's global ladder — running
 * that template means running its warm-up. Everything else (native archetype
 * blocks, quick sessions, programs with no published ramp, unknown ids) keeps
 * the user's own scheme, including `setCount: 0` ("skip warm-ups").
 */
export function warmupSchemeForProgram(
  programId: string | null | undefined,
  userScheme: WarmupScheme,
): WarmupScheme {
  if (programId == null) return userScheme;
  return PROGRAM_WARMUP_SCHEMES[programId] ?? userScheme;
}
