/**
 * The ramp a legacy warm-up block was written against.
 *
 * `buildSystemLoadWarmupItems` used the lifter's own ladder when they had one
 * and the shared ladder otherwise — and substituted the shared ladder for any
 * TM-anchored ramp, because a system-load ramp scales the day's top set. This
 * mirrors that choice so recovery corroborates against the ladder that actually
 * wrote the block (plan §6.9 — the reading side of one derivation).
 */
import { GLOBAL_WARMUP_RAMP } from "@hta/program-core";
import { resolveWarmupPreference, warmupSchemeToRamp } from "@/lib/planner/warmups";

export function legacyWarmupRampFractions(
  storedWarmupScheme: unknown,
): number[] {
  const preference = resolveWarmupPreference(storedWarmupScheme);
  if (preference.mode !== "user") return [...GLOBAL_WARMUP_RAMP.percents];
  const ramp = warmupSchemeToRamp(preference.scheme);
  if ((ramp.anchor ?? "top_set") === "training_max") {
    return [...GLOBAL_WARMUP_RAMP.percents];
  }
  return ramp.percents;
}
