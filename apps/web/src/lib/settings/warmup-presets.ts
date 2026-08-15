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
  | "standard"
  | "long"
  | "quick"
  | "skip"
  | "custom";

export type WarmupPreset = {
  key: WarmupPresetKey;
  label: string;
  scheme: WarmupScheme;
};

/**
 * Practitioner-consensus presets. Every `percentLadder` is a percentage of
 * the top working set (the same semantic used by `generateWarmupItems`).
 * "custom" carries the standard ladder as its editable starting point.
 */
export const WARMUP_PRESETS: ReadonlyArray<WarmupPreset> = [
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
 * "custom" when nothing matches one of the curated presets. Used by
 * the settings UI to pre-select the right radio on reload.
 */
export function presetKeyForScheme(scheme: WarmupScheme): WarmupPresetKey {
  // Migration 0039 left the old implicit default materialized in some
  // profiles. Treat that exact payload as Standard so those users are not
  // stranded on the old ramp or relabelled as Custom.
  if (isLegacyDefaultWarmupScheme(scheme)) return "standard";
  for (const p of WARMUP_PRESETS) {
    if (p.key === "custom") continue;
    if (schemesEqual(p.scheme, scheme)) return p.key;
  }
  return "custom";
}

export function presetByKey(key: WarmupPresetKey): WarmupPreset {
  const found = WARMUP_PRESETS.find((p) => p.key === key);
  if (!found) throw new Error(`Unknown warmup preset: ${key}`);
  return found;
}
