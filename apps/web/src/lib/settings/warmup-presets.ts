/**
 * Warmup-scheme presets + preset ↔ scheme mapping helpers.
 *
 * Shared between the settings client component and the unit tests so
 * the preset list has exactly one source of truth.
 */
import {
  isLegacyDefaultWarmupScheme,
  type WarmupScheme,
} from "@/lib/planner/warmups";

export type WarmupPresetKey =
  | "program"
  | "standard"
  | "long"
  | "quick"
  | "skip"
  | "custom";

export type WarmupPreset = {
  key: WarmupPresetKey;
  label: string;
  /**
   * The ladder this preset writes, or `null` for "follow the program" — which
   * clears the stored preference so each program's own ramp applies again.
   */
  scheme: WarmupScheme | null;
};

/**
 * Practitioner-consensus presets. Every `percentLadder` is a percentage of
 * the top working set (the same semantic used by `generateWarmupItems`).
 * "custom" carries the standard ladder as its editable starting point.
 *
 * "program" is deliberately FIRST and is the state of a lifter who has never
 * touched this screen. It exists so that picking a ladder stays reversible:
 * without it, an explicit choice could never be withdrawn and a program's own
 * ramp could never be restored.
 */
export const WARMUP_PRESETS: ReadonlyArray<WarmupPreset> = [
  {
    key: "program",
    label: "Follow the program",
    scheme: null,
  },
  {
    key: "standard",
    label: "Standard 3-set",
    scheme: { setCount: 3, percentLadder: [40, 60, 80], repLadder: [5, 5, 3] },
  },
  {
    key: "long",
    label: "Long 4-set",
    scheme: { setCount: 4, percentLadder: [30, 50, 70, 85], repLadder: [5, 5, 3, 1] },
  },
  {
    key: "quick",
    label: "Quick 2-set",
    scheme: { setCount: 2, percentLadder: [50, 75], repLadder: [5, 3] },
  },
  {
    key: "skip",
    label: "Skip warmups",
    scheme: { setCount: 0, percentLadder: [], repLadder: [] },
  },
  {
    key: "custom",
    label: "Custom",
    scheme: { setCount: 3, percentLadder: [40, 60, 80], repLadder: [5, 5, 3] },
  },
];

function arraysEqual(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function schemesEqual(a: WarmupScheme, b: WarmupScheme): boolean {
  return (
    a.setCount === b.setCount &&
    arraysEqual(a.percentLadder, b.percentLadder) &&
    arraysEqual(a.repLadder, b.repLadder)
  );
}

/**
 * Derive the preset key that matches a stored scheme — returns
 * "custom" when nothing matches one of the curated presets, and
 * "program" when nothing is stored at all (the lifter has expressed no
 * preference, so every program uses its own ramp). Used by the settings UI to
 * pre-select the right option on reload.
 */
export function presetKeyForScheme(scheme: WarmupScheme | null): WarmupPresetKey {
  if (scheme == null) return "program";
  // Migration 0039 left the old implicit default materialized in some
  // profiles. Treat that exact payload as Standard so those users are not
  // stranded on the old ramp or relabelled as Custom.
  if (isLegacyDefaultWarmupScheme(scheme)) return "standard";
  for (const p of WARMUP_PRESETS) {
    if (p.key === "custom" || p.scheme == null) continue;
    if (schemesEqual(p.scheme, scheme)) return p.key;
  }
  return "custom";
}

export function presetByKey(key: WarmupPresetKey): WarmupPreset {
  const found = WARMUP_PRESETS.find((p) => p.key === key);
  if (!found) throw new Error(`Unknown warmup preset: ${key}`);
  return found;
}
