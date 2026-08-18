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
import { tacticalBarbellEngine, zuluHtEngine } from "@hta/tacticalbarbell";
import { hyroxEngine } from "@hta/hyrox";
import { greenProtocolEngine } from "@hta/green";
import { GLOBAL_WARMUP_RAMP } from "@hta/program-core";
import {
  fractionToPercent,
  DEFAULT_WARMUP_SCHEME,
  type WarmupScheme,
  type WarmupAnchor,
  type WarmupPreference,
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
 * The shared 40/60/80%-of-the-work-set ramp in app scheme space. DERIVED from
 * `@hta/program-core`'s `GLOBAL_WARMUP_RAMP` — the same ramp those engines fall
 * back to when no user ladder is supplied — so the swap path and the generation
 * path cannot drift apart (plan §6.9).
 */
export const GLOBAL_ANCHORED_WARMUP_SCHEME: WarmupScheme =
  schemeFromEngineConfig(GLOBAL_WARMUP_RAMP);

/**
 * Program id → the warm-up ramp that program falls back to when the lifter has
 * expressed NO preference of their own. Keyed off each engine's `meta.id` so a
 * key can never drift from the registry.
 *
 * 5/3/1 is the only entry that publishes a ramp as part of its method. The rest
 * are registered deliberately, with the SHARED ramp their engines already use:
 * without an entry, `warmupSchemeForProgram` would fall through to the app
 * default and a swap would rebuild a movement's ladder differently from the way
 * the session was generated. Registering them keeps the two in lockstep.
 *
 * Green delegates its strength days to the Tactical Barbell and Zulu/HT engines
 * (`@hta/green` `prescribe`), so it inherits the same shared ramp.
 */
export const PROGRAM_WARMUP_SCHEMES: Readonly<Record<string, WarmupScheme>> =
  Object.freeze({
    [wendler531Engine.meta.id]: TRAINING_MAX_ANCHORED_WARMUP_SCHEME,
    [tacticalBarbellEngine.meta.id]: GLOBAL_ANCHORED_WARMUP_SCHEME,
    [zuluHtEngine.meta.id]: GLOBAL_ANCHORED_WARMUP_SCHEME,
    [hyroxEngine.meta.id]: GLOBAL_ANCHORED_WARMUP_SCHEME,
    [greenProtocolEngine.meta.id]: GLOBAL_ANCHORED_WARMUP_SCHEME,
  });

/** True when the program publishes its own warm-up ladder. */
export function programOwnsWarmupScheme(
  programId: string | null | undefined,
): boolean {
  return programId != null && programId in PROGRAM_WARMUP_SCHEMES;
}

/** A program whose ramp is part of its published method, not the app's default. */
export type ProgramWarmupOwner = {
  id: string;
  name: string;
  scheme: WarmupScheme;
};

/**
 * The programs whose OWN ramp an explicit user ladder displaces.
 *
 * DERIVED, not listed: a program qualifies when its registered default differs
 * from the shared app ramp. Registering a program that simply inherits the
 * shared routine (Tactical Barbell, Zulu/HT, HYROX, Green) therefore does NOT
 * add it here — nothing methodological is being overruled in that case.
 *
 * Drives the DC-K4 warning on the warm-up settings screen: choosing a ladder is
 * an override of a principle-derived default, so the lifter is told which
 * method's ramp it replaces rather than having it changed silently.
 */
export function programsWithOwnWarmupRamp(): ProgramWarmupOwner[] {
  const named: Record<string, string> = {
    [wendler531Engine.meta.id]: wendler531Engine.meta.name,
    [tacticalBarbellEngine.meta.id]: tacticalBarbellEngine.meta.name,
    [zuluHtEngine.meta.id]: zuluHtEngine.meta.name,
    [hyroxEngine.meta.id]: hyroxEngine.meta.name,
    [greenProtocolEngine.meta.id]: greenProtocolEngine.meta.name,
  };
  return Object.entries(PROGRAM_WARMUP_SCHEMES)
    .filter(([, scheme]) => !schemesEqual(scheme, GLOBAL_ANCHORED_WARMUP_SCHEME))
    .map(([id, scheme]) => ({ id, name: named[id] ?? id, scheme }));
}

function schemesEqual(a: WarmupScheme, b: WarmupScheme): boolean {
  return (
    a.setCount === b.setCount &&
    a.anchor === b.anchor &&
    a.percentLadder.every((v, i) => v === b.percentLadder[i]) &&
    a.repLadder.every((v, i) => v === b.repLadder[i])
  );
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
 * The lifter's OWN ladder wins whenever they have expressed one — including
 * `setCount: 0` ("skip warm-ups"), and including inside 5/3/1. A program's
 * published ramp is a DEFAULT for lifters who have never touched the setting,
 * not a mandate.
 *
 * `preference` must come from `resolveWarmupPreference` on the RAW stored
 * column. Passing a resolved `WarmupScheme` here cannot work: the resolver has
 * already turned NULL into the default ladder, so "never chose" and "chose the
 * default" arrive identical and the program ramp could never apply.
 */
export function warmupSchemeForProgram(
  programId: string | null | undefined,
  preference: WarmupPreference,
): WarmupScheme {
  if (preference.mode === "user") return preference.scheme;
  if (programId == null) return DEFAULT_WARMUP_SCHEME;
  return PROGRAM_WARMUP_SCHEMES[programId] ?? DEFAULT_WARMUP_SCHEME;
}
