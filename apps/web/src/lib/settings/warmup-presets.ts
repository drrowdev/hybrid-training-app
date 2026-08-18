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
import { programWarmupOptionLabel } from "@/lib/planner/program-warmup-scheme";

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
 * The "program" entry writes SQL NULL — no stored preference — which is what
 * lets a program apply its own published ramp. Its LABEL is derived from the
 * registry (`programWarmupOptionLabel`), so it names the method it follows
 * rather than describing the mechanism.
 *
 * It stays selectable even when no such program is running. Hiding it would
 * strand a lifter who set a custom ladder: they could not clear it back to
 * automatic, and doing so after starting the program is too late — warm-up
 * changes never rewrite an already-materialised block (ADR 0072).
 */
export const WARMUP_PRESETS: ReadonlyArray<WarmupPreset> = [
  {
    key: "program",
    label: programWarmupOptionLabel(),
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
 * Derive the preset key that matches a stored scheme.
 *
 * A stored ladder maps to its preset, or "custom" when it matches none. NO
 * stored ladder (`null`) is the automatic state, and which option represents
 * it depends on what is actually running:
 *
 * - a program with its own ramp IS active ⇒ `"program"`, because that ramp is
 *   what the lifter is getting;
 * - otherwise ⇒ `"standard"`, because with nothing stored and no program ramp
 *   in play the effective ladder IS the standard one. Showing the program
 *   option as selected there would name a method the lifter isn't running.
 *
 * Either way the selection describes the lifter's CURRENT effective ramp.
 */
export function presetKeyForScheme(
  scheme: WarmupScheme | null,
  options: { programRampActive?: boolean } = {},
): WarmupPresetKey {
  if (scheme == null) {
    return options.programRampActive ? "program" : "standard";
  }
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
