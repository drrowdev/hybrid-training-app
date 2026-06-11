/**
 * Hybrid — the native (block-level) platform program (ADR 0046 Phase 0).
 *
 * Hybrid REPLACES the legacy "pick one of six archetypes" generator with a
 * single pluggable program. The six archetypes become GOAL PRESETS selected in
 * setup (`archetypeId`), not separate programs.
 *
 * Parity is STRUCTURAL, not coincidental: `materializeNative` calls the exact
 * same shared `buildBlockAssemblyContext` + `assembleBlockSessions` that the
 * legacy `createBlock` server action uses, and `setup` reuses the SAME wizard
 * input mapper (`parseCreateBlockInput`, which wraps `createBlockSchema`). So
 * the only genuinely new surface this engine introduces is:
 *   - the instance ⇄ shared-input mapping (`toContextInput`, identity), and
 *   - the pure `timeline` calendar skeleton.
 * Both are pinned by `__tests__/parity.test.ts`.
 */
import type {
  ProgramMeta,
  SetupSchema,
  ProgramSetupInput,
  PlatformContext,
  PlannedSessionSpec,
  PlannedSessionKind,
} from "@hta/program-core";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ARCHETYPES,
  daySlot,
  daysForFrequency,
  type ArchetypeId,
} from "@/lib/planner/archetypes";
import { foldDualMainLifts } from "@/lib/planner/main-lift-folding";
import { applyPlacementsToActiveDays } from "@/lib/planner/wizard/placements";
import {
  FOCUS_MUSCLE_ALLOWLIST,
  FOCUS_MUSCLE_LABEL,
} from "@/lib/planner/focus-muscles";
import {
  buildBlockAssemblyContext,
  type BuildBlockAssemblyContextInput,
} from "@/lib/planner/build-block-assembly-context";
import { assembleBlockSessions } from "@/lib/planner/assemble-block-sessions";
import { parseCreateBlockInput } from "@/lib/planner/create-block-input";
import type {
  NativeProgramEngine,
  NativeMaterializeResult,
} from "@/lib/platform/native-engine";

/** The 6 archetype goal presets, in wizard display order. */
const HYBRID_ARCHETYPE_IDS = [
  "strength_anchor",
  "endurance_anchor",
  "rebuild",
  "hypertrophy_anchor",
  "concurrent_hybrid",
  "maintenance",
] as const satisfies readonly ArchetypeId[];

/**
 * The Hybrid program instance. It is EXACTLY the
 * {@link BuildBlockAssemblyContextInput} fields — every one is already
 * JSON-serialisable (strings / numbers / boolean / array / the plain
 * `DayIndexOverrides` object), so the instance round-trips through
 * `program_instances` losslessly and `toContextInput` is the identity map.
 */
export type HybridInstance = BuildBlockAssemblyContextInput;

export const hybridMeta: ProgramMeta = {
  id: "hybrid",
  name: "Hybrid",
  family: "hybrid",
  summary: "A personalised concurrent strength + cardio plan built from your goals.",
};

/**
 * The wizard fields Hybrid collects. These mirror `createBlockSchema`'s
 * non-FormData fields (the authoritative validation still runs in `setup` via
 * the shared `parseCreateBlockInput`).
 */
export function describeHybridSetup(): SetupSchema {
  return {
    fields: [
      {
        key: "archetypeId",
        label: "Goal preset",
        type: "select",
        required: true,
        options: HYBRID_ARCHETYPE_IDS.map((id) => ({
          value: id,
          label: ARCHETYPES[id].name,
        })),
        help: "The training emphasis to build your block around.",
      },
      {
        key: "daysPerWeek",
        label: "Training days per week",
        type: "number",
        required: true,
        defaultValue: 4,
        help: "How many days a week you can train (1–7).",
      },
      {
        key: "focusMuscles",
        label: "Focus muscles",
        type: "multi-select",
        maxSelections: 2,
        options: FOCUS_MUSCLE_ALLOWLIST.map((m) => ({
          value: m,
          label: FOCUS_MUSCLE_LABEL[m],
        })),
        help: "Optionally bias accessory volume toward up to two muscle groups.",
      },
      {
        key: "secondaryFocus",
        label: "Secondary focus",
        type: "select",
        options: [
          { value: "strength", label: "Strength" },
          { value: "muscle", label: "Muscle" },
          { value: "cardio", label: "Cardio" },
          { value: "resilience", label: "Resilience" },
          { value: "maintenance", label: "Maintenance" },
          { value: "skip", label: "Skip" },
          { value: "none", label: "None" },
        ],
        help: "An optional secondary channel that tilts accessory volume.",
      },
      {
        key: "accessoryVolume",
        label: "Accessory volume",
        type: "select",
        defaultValue: "medium",
        options: [
          { value: "low", label: "Low" },
          { value: "medium", label: "Medium" },
          { value: "high", label: "High" },
        ],
        help: "Per-block accessory volume level.",
      },
      {
        key: "powerEmphasis",
        label: "Add power emphasis",
        type: "boolean",
        defaultValue: false,
        help: "Bias the main-lift waves toward explosive/power work.",
      },
    ],
  };
}

/**
 * Identity mapping from the instance to the shared block-assembly input. The
 * instance IS that input, so this exists only as the explicit, named seam the
 * parity test pins (and so the engine never silently reshapes the instance).
 */
export function toContextInput(instance: HybridInstance): BuildBlockAssemblyContextInput {
  return instance;
}

/**
 * Validate + normalise the wizard values into a {@link HybridInstance}.
 *
 * The wizard collects values under hybrid-native keys (`archetypeId`, a parsed
 * `focusMuscles` array, an optional `dayIndexOverrides` object OR JSON string).
 * To guarantee BYTE-IDENTICAL field normalisation with `createBlock`, we adapt
 * those values into the `createBlock` raw shape and run the SHARED
 * `parseCreateBlockInput` — so `createBlockSchema` is literally Hybrid's
 * validation schema. Throws on invalid input (the platform catches).
 */
export function setupHybrid(
  input: ProgramSetupInput,
  _ctx: PlatformContext,
): HybridInstance {
  const v = input.values;

  // `dayIndexOverrides` may arrive as the already-parsed object or a JSON
  // string. Normalise to the JSON-string shape `createBlockSchema` expects so
  // the shared parser owns the (single) JSON → DayIndexOverrides validation.
  let dayIndexOverrides: string | undefined;
  const rawOverrides = v.dayIndexOverrides;
  if (typeof rawOverrides === "string") {
    dayIndexOverrides = rawOverrides;
  } else if (rawOverrides && typeof rawOverrides === "object") {
    dayIndexOverrides = JSON.stringify(rawOverrides);
  }

  const parsed = parseCreateBlockInput({
    archetype: v.archetypeId,
    startedOn: v.startedOn,
    daysPerWeek: v.daysPerWeek,
    dayIndexOverrides,
    powerEmphasis: v.powerEmphasis,
    cardioSource: v.cardioSource,
    cardioSourceName: v.cardioSourceName,
    focusMuscles: v.focusMuscles,
    goal: v.goal,
    secondaryFocus: v.secondaryFocus,
    accessoryVolume: v.accessoryVolume,
  });

  if (!parsed.ok) {
    throw new Error(parsed.error);
  }
  return parsed.input;
}

/**
 * Pure calendar skeleton for the instance — NO DB. Reproduces `createBlock`'s
 * day grid (`foldDualMainLifts(daysForFrequency(...))` then placement remap)
 * and enumerates one spec per active day per week.
 *
 * NOTE: `allowsTwoADays` is a USER PROFILE setting, not part of the instance,
 * so the skeleton passes `false`. The AUTHORITATIVE grid (including two-a-days)
 * is built inside `materializeNative` via `buildBlockAssemblyContext`, which
 * reads the profile; `timeline` is only the calendar skeleton used for
 * rendering/grouping before materialisation.
 */
export function hybridTimeline(instance: HybridInstance): PlannedSessionSpec[] {
  const archetype = ARCHETYPES[instance.archetypeId as keyof typeof ARCHETYPES];
  const canonical = foldDualMainLifts(
    archetype,
    daysForFrequency(archetype, instance.daysPerWeek, /* allowsTwoADays */ false),
  );
  const activeDays = applyPlacementsToActiveDays(
    canonical,
    instance.dayIndexOverrides?.placements ?? null,
  );

  const specs: PlannedSessionSpec[] = [];
  let index = 0;
  for (let week = 0; week < archetype.weeks; week++) {
    const weekProfile = archetype.weekProfiles.find((w) => w.weekIndex === week);
    const kind: PlannedSessionKind =
      weekProfile?.intensityLabel === "Deload" ? "deload" : "training";
    for (const day of activeDays) {
      const slot = daySlot(day);
      specs.push({
        ref: `w${week}-d${day.dayIndex}-${slot}`,
        index: index++,
        label: `${archetype.name} · Wk ${week + 1} · ${day.title}`,
        kind,
        weekday: day.dayIndex,
        tags: [`archetype:${archetype.id}`, `kind:${day.kind}`, `slot:${slot}`],
      });
    }
  }
  return specs;
}

/**
 * Materialise the WHOLE block at once by composing the SAME shared functions
 * `createBlock` uses — making downstream output parity structural.
 */
export async function materializeHybridNative(
  instance: HybridInstance,
  supabase: SupabaseClient,
  userId: string,
  blockId: string,
): Promise<NativeMaterializeResult> {
  const built = await buildBlockAssemblyContext(supabase, userId, toContextInput(instance));
  if (!built.ok) return { ok: false, error: built.error };
  const rows = assembleBlockSessions(built.ctx, blockId, userId);
  return { ok: true, rows, meta: built.meta };
}

export const hybridProgramEngine: NativeProgramEngine<HybridInstance> = {
  meta: hybridMeta,
  describeSetup: describeHybridSetup,
  setup: setupHybrid,
  timeline: hybridTimeline,
  materializeNative: materializeHybridNative,
};
