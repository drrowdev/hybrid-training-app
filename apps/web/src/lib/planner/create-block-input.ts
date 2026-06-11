/**
 * Shared, pure (DB-free) parsing of the block-wizard input.
 *
 * The `createBlock` server action used to define `createBlockSchema` inline and
 * map the parsed values into the {@link BuildBlockAssemblyContextInput} by hand.
 * That mapping is the single source of truth for "how wizard input becomes the
 * shared block-assembly context input", so it lives here — OUTSIDE the
 * `"use server"` module — so it can be imported by:
 *   - `createBlock` (the legacy write path), and
 *   - the Hybrid platform program engine (`lib/programs/hybrid`), which must be
 *     parity-identical to `createBlock` by construction (ADR 0046 Phase 0).
 *
 * Keeping it here (a regular module, not a server-action file) is required:
 * Next.js `"use server"` files may only export async functions, so a Zod schema
 * / synchronous helper cannot be exported from `actions.ts`.
 */
import { z } from "zod";
import type { ArchetypeId } from "./archetypes";
import { focusMusclesSchema } from "./focus-muscles";
import {
  dayIndexOverridesSchema,
  type DayIndexOverrides,
} from "./wizard/placements";
import type { BuildBlockAssemblyContextInput } from "./build-block-assembly-context";

/**
 * Wizard input validation. Field rules mirror the DB CHECK constraints and the
 * pre-ADR-0046 inline schema verbatim — do not relax them without updating the
 * planner golden snapshot expectations.
 */
export const createBlockSchema = z.object({
  archetype: z.enum([
    "strength_anchor",
    "endurance_anchor",
    "rebuild",
    "hypertrophy_anchor",
    "concurrent_hybrid",
    "maintenance",
  ] satisfies [ArchetypeId, ...ArchetypeId[]]),
  startedOn: z.string().date(),
  daysPerWeek: z.coerce.number().int().min(1).max(7),
  /**
   * Optional JSON-stringified ``DayIndexOverrides`` from the block wizard's
   * "Lay out your week" step. Persisted on the block row so re-runs honour
   * the user's calendar layout. Shape: ``{ days, twoADay, placements? }``
   * — see ``wizard/placements.ts`` for the canonical schema. The
   * `placements` field is optional during the rollout transition; absent
   * payloads (legacy / mid-flight submissions) fall back to canonical
   * day-template ordering.
   */
  dayIndexOverrides: z.string().optional(),
  /**
   * Wizard "Add power emphasis" toggle (step 2). Optional + coerced from
   * FormData ("true" / "false" / "on" / undefined). When omitted or
   * falsy the block is created with power_emphasis = false.
   */
  powerEmphasis: z
    .union([z.literal("true"), z.literal("false"), z.literal("on"), z.boolean()])
    .optional()
    .transform((v) => v === true || v === "true" || v === "on"),
  /**
   * Phase 1 "external cardio". 'external' tells the materialiser to
   * emit a single placeholder `cardio_external` item per cardio day
   * instead of the archetype's prescribed run. Default 'internal'
   * keeps every legacy + new internal block on the existing path.
   */
  cardioSource: z
    .enum(["internal", "external"])
    .optional()
    .transform((v) => v ?? "internal"),
  /**
   * Free-text label for the external program (e.g. "Runna"). Trimmed
   * and capped at 80 chars; empty strings normalise to null at write
   * time so the DB column stays distinguishable.
   */
  cardioSourceName: z
    .string()
    .trim()
    .max(80)
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null)),
  /**
   * Migration 0079 — per-block focus muscle groups (0–2). Submitted as
   * repeated `focusMuscles` fields (FormData.getAll). Server-side
   * validation mirrors the DB CHECK constraints; the DB is the final
   * guard. See `lib/planner/focus-muscles.ts`.
   */
  focusMuscles: focusMusclesSchema,
  /**
   * ADR 0020 — wizard PRIMARY goal + SECONDARY focus. Optional: the legacy /
   * custom-builder paths and any pre-0082 client omit them, in which case the
   * block is created with NULL goal/secondary and the engine produces the
   * pre-ADR-0020 baseline (no tilt). Raw wizard channel values are stored
   * verbatim; `resolveSecondaryFocus` collapses non-tiltable values to `none`.
   */
  goal: z.enum(["strength", "muscle", "cardio", "resilience"]).optional(),
  secondaryFocus: z
    .enum([
      "strength",
      "muscle",
      "cardio",
      "resilience",
      "skip",
      "maintenance",
      "none",
    ])
    .optional(),
  /**
   * ADR 0024 — per-block accessory volume level. Optional: legacy /
   * custom-builder paths and any pre-0083 client omit it, in which case the
   * block is created with the DB default `'medium'` (the byte-identical
   * pre-ADR-0024 baseline). Bounded enum is the write guard.
   */
  accessoryVolume: z.enum(["low", "medium", "high"]).optional(),
});

export type CreateBlockParsed = z.infer<typeof createBlockSchema>;

export type ParseCreateBlockInputResult =
  | {
      ok: true;
      /** The shared block-assembly input (what `buildBlockAssemblyContext` takes). */
      input: BuildBlockAssemblyContextInput;
      /** The validated raw values — `createBlock` still needs these for the row insert. */
      parsed: CreateBlockParsed;
      /** The parsed day-index overrides (also persisted on the block row). */
      dayIndexOverrides: DayIndexOverrides | null;
    }
  | { ok: false; error: string };

/**
 * Validate raw wizard values and derive the {@link BuildBlockAssemblyContextInput}.
 *
 * This is the ONE place wizard input → shared context input is mapped, so the
 * legacy `createBlock` path and the Hybrid program engine produce byte-identical
 * inputs by construction. The `dayIndexOverrides` JSON string is parsed +
 * validated here too; bad JSON / shape silently drops to `null` (a block can
 * still be created without overrides), matching the pre-ADR-0046 behaviour.
 *
 * Optional `goal` / `secondaryFocus` / `accessoryVolume` keys are only included
 * when actually present, to respect `exactOptionalPropertyTypes`.
 */
export function parseCreateBlockInput(
  raw: Record<string, unknown>,
): ParseCreateBlockInputResult {
  const parsed = createBlockSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  // Parse + validate the dayIndexOverrides JSON payload (wizard step 5).
  // Accepts both the legacy `{ days, twoADay }` shape and the post-fix
  // `{ days, twoADay, placements }` shape — Zod's optional `placements`
  // makes the transition safe for any submission that races the deploy.
  let dayIndexOverrides: DayIndexOverrides | null = null;
  if (parsed.data.dayIndexOverrides) {
    try {
      const rawOverrides: unknown = JSON.parse(parsed.data.dayIndexOverrides);
      const result = dayIndexOverridesSchema.safeParse(rawOverrides);
      if (result.success) {
        dayIndexOverrides = result.data;
      }
    } catch {
      // Bad JSON — silently drop; the block can still be created without overrides.
    }
  }

  const input: BuildBlockAssemblyContextInput = {
    archetypeId: parsed.data.archetype,
    startedOn: parsed.data.startedOn,
    daysPerWeek: parsed.data.daysPerWeek,
    dayIndexOverrides,
    powerEmphasis: parsed.data.powerEmphasis,
    focusMuscles: parsed.data.focusMuscles,
    cardioSource: parsed.data.cardioSource,
    cardioSourceName: parsed.data.cardioSourceName,
    ...(parsed.data.goal !== undefined ? { goal: parsed.data.goal } : {}),
    ...(parsed.data.secondaryFocus !== undefined
      ? { secondaryFocus: parsed.data.secondaryFocus }
      : {}),
    ...(parsed.data.accessoryVolume !== undefined
      ? { accessoryVolume: parsed.data.accessoryVolume }
      : {}),
  };

  return { ok: true, input, parsed: parsed.data, dayIndexOverrides };
}
