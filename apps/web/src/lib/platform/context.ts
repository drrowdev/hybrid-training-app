/**
 * PlatformContext builder — assembles the read-only shared state a program
 * engine needs (the user's canonical 1RMs + plate rounding) and the movement
 * resolver the adapter uses to turn engine keys back into the user's anchored
 * movements.
 *
 * The 1RM store is `training_maxes` (one_rm_kg per movement); each row is bucketed
 * to an engine key via its movement's StrengthRole. This is the single place the
 * platform reads a user's strength state — it is never mutated here.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PlatformContext } from "@hta/program-core";
import {
  directEngineKeysForSlug,
  ROLE_TO_ENGINE_KEY,
  STATIC_ENGINE_MOVEMENTS,
} from "./movement-keys";
import {
  STRENGTH_ROLE_CANDIDATES,
  type StrengthRole,
} from "@/lib/planner/archetypes";
import type { MovementResolver, ResolvedMovement } from "./adapter";
import {
  resolveWarmupPreference,
  warmupSchemeToRamp,
} from "@/lib/planner/warmups";
import { DEFAULT_ROUNDING_KG } from "./rounding";

export interface PlatformContextBundle {
  ctx: PlatformContext;
  resolveMovement: MovementResolver;
  /** Engine keys that have a usable 1RM anchored (e.g. ["squat","bench","deadlift"]). */
  anchoredKeys: string[];
}

export interface CustomMovementBinding {
  key: string;
  movementId: string;
  slug: string;
  displayName: string;
}

export function validateCustomMovementBindings(
  bindings: CustomMovementBinding[],
  catalog: Array<{ id: string; slug: string; displayName: string }>,
): CustomMovementBinding[] {
  const byId = new Map(catalog.map((movement) => [movement.id, movement]));
  return bindings.map((binding) => {
    const movement = byId.get(binding.movementId);
    if (!movement || movement.slug !== binding.slug) {
      throw new Error(
        `Customized exercise '${binding.displayName}' is no longer available in the exercise library.`,
      );
    }
    return {
      key: binding.key,
      movementId: movement.id,
      slug: movement.slug,
      displayName: movement.displayName,
    };
  });
}

interface TmRow {
  one_rm_kg: string | number | null;
  movement: { id: string; slug: string; display_name: string } | null;
}

interface MovementRow {
  id: string;
  slug: string;
  display_name: string;
}

/**
 * Build the PlatformContext for a user from their training maxes. `roundingKg`
 * defaults to 2.5 kg (1.25 kg plates / pair) unless the user trains in pounds.
 */
export async function buildPlatformContext(
  supabase: Pick<SupabaseClient, "from">,
  userId: string,
  opts: {
    roundingKg?: number;
    gender?: "male" | "female";
    customMovements?: CustomMovementBinding[];
  } = {},
): Promise<PlatformContextBundle> {
  const [
    { data, error },
    { data: profile, error: profileError },
  ] = await Promise.all([
    supabase
      .from("training_maxes")
      .select("one_rm_kg, movement:movements(id, slug, display_name)")
      .eq("user_id", userId),
    supabase.from("profiles").select("warmup_scheme, bodyweight_kg").eq("id", userId).maybeSingle(),
  ]);
  if (error) throw new Error(`buildPlatformContext: ${error.message}`);
  if (profileError) throw new Error(`buildPlatformContext: ${profileError.message}`);
  const warmupSchemeRaw = (profile as { warmup_scheme?: unknown } | null)
    ?.warmup_scheme;
  // Weighted pull-ups / dips are anchored on a bodyweight-inclusive max, so an
  // engine cannot turn a percentage of one into a belt load without this.
  const bodyweightRaw = (profile as { bodyweight_kg?: string | number | null } | null)
    ?.bodyweight_kg;
  const bodyweightKg = bodyweightRaw == null ? NaN : Number(bodyweightRaw);

  const oneRepMaxes: Record<string, number> = {};
  const resolved = new Map<string, ResolvedMovement>();

  const tmRows = (data ?? []) as unknown as TmRow[];
  for (const row of tmRows) {
    const mv = row.movement;
    if (!mv) continue;
    const engineKeys = directEngineKeysForSlug(mv.slug);
    if (engineKeys.length === 0) continue;
    const oneRm = row.one_rm_kg == null ? NaN : Number(row.one_rm_kg);
    for (const engineKey of engineKeys) {
      if (Number.isFinite(oneRm) && oneRm > 0) {
        oneRepMaxes[engineKey] = oneRm;
      }
      resolved.set(engineKey, {
        movementId: mv.id,
        slug: mv.slug,
        displayName: STATIC_ENGINE_MOVEMENTS[engineKey]?.displayName ?? mv.display_name,
      });
    }
  }

  // Canonical strength roles may have several catalog variants with saved
  // maxes. Pick deterministically using the same candidate order as the picker;
  // never let query row order decide whether (for example) Push Press overwrites
  // Overhead Press or Block Pull Deadlift overwrites conventional Deadlift.
  const tmBySlug = new Map(
    tmRows.flatMap((row) => {
      const movement = row.movement;
      const oneRm = row.one_rm_kg == null ? NaN : Number(row.one_rm_kg);
      return movement && Number.isFinite(oneRm) && oneRm > 0
        ? [[movement.slug, { movement, oneRm }] as const]
        : [];
    }),
  );
  for (const [role, candidates] of Object.entries(STRENGTH_ROLE_CANDIDATES) as [
    StrengthRole,
    string[],
  ][]) {
    const selected = candidates
      .map((slug) => tmBySlug.get(slug))
      .find((entry) => entry != null);
    if (!selected) continue;
    const engineKey = ROLE_TO_ENGINE_KEY[role];
    const staticDefinition = STATIC_ENGINE_MOVEMENTS[engineKey];
    oneRepMaxes[engineKey] = selected.oneRm;
    resolved.set(engineKey, {
      movementId: selected.movement.id,
      slug: selected.movement.slug,
      displayName:
        staticDefinition?.slug === selected.movement.slug
          ? (staticDefinition.displayName ?? selected.movement.display_name)
          : selected.movement.display_name,
    });
  }

  const staticSlugs = [...new Set(Object.values(STATIC_ENGINE_MOVEMENTS).map((m) => m.slug))];
  const { data: catalog, error: catalogError } = await supabase
    .from("movements")
    .select("id, slug, display_name")
    .is("user_id", null)
    .in("slug", staticSlugs);
  if (catalogError) throw new Error(`buildPlatformContext: ${catalogError.message}`);

  const catalogBySlug = new Map(
    ((catalog ?? []) as unknown as MovementRow[]).map((movement) => [movement.slug, movement]),
  );
  for (const [engineKey, definition] of Object.entries(STATIC_ENGINE_MOVEMENTS)) {
    const movement = catalogBySlug.get(definition.slug);
    if (!movement || resolved.has(engineKey)) continue;
    resolved.set(engineKey, {
      movementId: movement.id,
      slug: movement.slug,
      displayName: definition.displayName ?? movement.display_name,
    });
  }

  const oneRmByMovementId = new Map(
    tmRows.flatMap((row) => {
      const movement = row.movement;
      const oneRm = row.one_rm_kg == null ? NaN : Number(row.one_rm_kg);
      return movement && Number.isFinite(oneRm) && oneRm > 0
        ? [[movement.id, oneRm] as const]
        : [];
    }),
  );
  for (const movement of opts.customMovements ?? []) {
    resolved.set(movement.key, {
      movementId: movement.movementId,
      slug: movement.slug,
      displayName: movement.displayName,
    });
    const oneRm = oneRmByMovementId.get(movement.movementId);
    if (oneRm != null) oneRepMaxes[movement.key] = oneRm;
  }

  const resolveMovement: MovementResolver = (engineKey) => resolved.get(engineKey);

  // The lifter's own warm-up ladder, supplied to the engines ONLY when they
  // have actually chosen one. Read raw (not via `resolveWarmupScheme`) because
  // NULL — "never touched the setting" — is what tells an engine to keep its
  // own published ramp. See `resolveWarmupPreference`.
  const preference = resolveWarmupPreference(warmupSchemeRaw);
  const warmupRamp =
    preference.mode === "user" ? warmupSchemeToRamp(preference.scheme) : undefined;

  return {
    ctx: {
      oneRepMaxes,
      roundingKg: opts.roundingKg ?? DEFAULT_ROUNDING_KG,
      ...(Number.isFinite(bodyweightKg) && bodyweightKg > 0 ? { bodyweightKg } : {}),
      ...(opts.gender ? { gender: opts.gender } : {}),
      ...(warmupRamp ? { warmupRamp } : {}),
    },
    resolveMovement,
    anchoredKeys: Object.keys(oneRepMaxes),
  };
}
