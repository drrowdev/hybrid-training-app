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

/**
 * Hybrid is a single, fixed generator: a personalised BALANCED strength + cardio
 * plan. It always runs the balanced concurrent engine — there is deliberately NO
 * goal-preset / archetype picker (the legacy six archetypes are not surfaced).
 * The user personalises only the simple knobs in `describeHybridSetup`.
 */
const HYBRID_ARCHETYPE: ArchetypeId = "concurrent_hybrid";

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
 * Hybrid's UNIQUE setup input (wizard step 2 "Loadout"). Hybrid has no template
 * "flavour" to choose like 5/3/1 or TB, so the Loadout step collects its only
 * personalisation: focus muscles (optionally bias accessory volume toward up to
 * two groups). The COMMON inputs — training days/week + start date — are owned by
 * the shared wizard Schedule step (the weekday picker) and must NOT be re-collected
 * here. `daysPerWeek` is supplied to `setup` by the deploy path from the chosen
 * weekdays.
 */
export function describeHybridSetup(): SetupSchema {
  return {
    fields: [
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
        // Hybrid's loading basis. Unlike 5/3/1 (fixed template TM) or TB (off the
        // raw 1RM), Hybrid lets the user pick how hard the main lifts train as a
        // % of their 1RM — the "training max". Seeded onto training_maxes.tm_percent
        // at deploy so every %-of-TM render uses it. Default 90% (top set ≈ 85.5%
        // of 1RM — right at the strength-maintenance floor).
        key: "tmPercent",
        label: "Training intensity (TM%)",
        type: "select",
        defaultValue: "90",
        options: [
          { value: "85", label: "85% — lighter, more reps in reserve" },
          { value: "87.5", label: "87.5%" },
          { value: "90", label: "90% — balanced (recommended)" },
          { value: "92.5", label: "92.5%" },
          { value: "95", label: "95% — heavier, peaking" },
        ],
        help: "Sets your training max as a % of your 1RM. Higher = heavier main lifts.",
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
 * Hybrid hardwires the balanced concurrent engine (`concurrent_hybrid`) — there
 * is no goal-preset choice. Its only unique input is `focusMuscles` (wizard step
 * 2). `daysPerWeek` is injected by the deploy path from the chosen weekdays
 * (wizard step 4, the shared Schedule step) — it is NOT a Hybrid setup field.
 * We adapt the values into the `createBlock` raw shape and run the SHARED
 * `parseCreateBlockInput` so `createBlockSchema` is literally Hybrid's validation
 * schema. Throws on invalid input (the platform catches).
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
    archetype: HYBRID_ARCHETYPE,
    startedOn: v.startedOn,
    daysPerWeek: v.daysPerWeek,
    dayIndexOverrides,
    focusMuscles: v.focusMuscles,
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
  // Distinct resolved MAIN-lift movement ids (primary + dual-main secondary) —
  // the deploy path seeds tm_percent for exactly these.
  const mainMovementIds = Array.from(
    new Set(
      [...built.ctx.resolved.values(), ...built.ctx.resolvedSecondary.values()].map(
        (m) => m.movementId,
      ),
    ),
  );
  return { ok: true, rows, meta: built.meta, mainMovementIds };
}

/**
 * Resolve the Hybrid wizard's chosen training-max percentage into a clamped
 * integer-or-half percentage. Hybrid's loading basis is a % of the user's 1RM
 * (the "training max"); the deploy path seeds it onto `training_maxes.tm_percent`.
 * Unknown / out-of-range input falls back to the 90% default.
 */
export function resolveHybridTmPercent(raw: unknown): number {
  const n = typeof raw === "string" ? Number(raw) : typeof raw === "number" ? raw : NaN;
  if (!Number.isFinite(n) || n < 50 || n > 100) return 90;
  return n;
}

export const hybridProgramEngine: NativeProgramEngine<HybridInstance> = {
  meta: hybridMeta,
  describeSetup: describeHybridSetup,
  setup: setupHybrid,
  timeline: hybridTimeline,
  materializeNative: materializeHybridNative,
};
