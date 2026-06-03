/**
 * ADR 0024 — accessory volume level (Low / Medium / High).
 *
 * A per-block lever for how MUCH accessory work a strength day carries,
 * deliberately split from the EFFORT axis (ADR 0016's compound proximity-to-
 * failure dial). "Minimalism" is simply the `low` end of this control on a
 * strength-leaning block: keep the heavy compounds, trim accessory breadth.
 *
 *   - low    : one fewer aesthetic accessory movement (trims BREADTH, not
 *              depth — the kept movements keep their full set count). The
 *              picker fills durability → functional → aesthetic in priority
 *              order, so a `-1` item budget only ever drops the lowest-value
 *              AESTHETIC pick; the durability / functional floor is untouched.
 *   - medium : the byte-identical identity (`NO_TILT`). Default for every
 *              block / legacy row, so the golden master and the ADR
 *              0011/0015/0016/0020/0022 pins stay green.
 *   - high   : one extra aesthetic movement AND one extra set per movement,
 *              pushing toward the 10–20 effective-sets/muscle/week productive
 *              zone (Baz-Valle 2022) — bounded by the ADR 0020 duration
 *              governor so a tilted day still fits the session budget.
 *
 * CROSS-ARCHETYPE. The level rides on top of EACH archetype's own accessory
 * profile (rep range, movement bias, functional / durability requirements,
 * AMRAP), so it shifts only the AMOUNT, never the CHARACTER. Because it is a
 * delta on each archetype's own base, "Low" on Strength (2 → 1 aesthetic item)
 * is automatically leaner than "Low" on Hypertrophy (4 → 3) with no
 * priority-specific branching. Archetypes that ship zero aesthetic accessories
 * by design (Maintenance) are a full no-op at every level.
 *
 * Calibration policy: the ±1 item / +1 set magnitudes are CP-1 [DEF→cal]
 * Stage-A heuristics — directionally grounded (Schoenfeld 2019 low-volume;
 * Currier 2023 BJSM network MA; Baz-Valle 2022 weekly-set landmarks) but
 * un-tuned against real `accessory_volume` × outcome data. The duration
 * governor is the hard safety bound on the upward (`high`) direction.
 */
import type { SecondaryVolumeTilt } from "./secondary-focus";

export type AccessoryVolumeLevel = "low" | "medium" | "high";

export const ACCESSORY_VOLUME_VALUES: readonly AccessoryVolumeLevel[] = [
  "low",
  "medium",
  "high",
] as const;

const ACCESSORY_VOLUME_SET: ReadonlySet<string> = new Set(
  ACCESSORY_VOLUME_VALUES,
);

/**
 * Coerce a raw DB / form value into a valid `AccessoryVolumeLevel`. Anything
 * unrecognised (null, legacy, undeclared) collapses to `"medium"` so the
 * engine keeps byte-identical pre-ADR-0024 behaviour.
 */
export function resolveAccessoryVolumeLevel(
  raw: string | null | undefined,
): AccessoryVolumeLevel {
  return raw != null && ACCESSORY_VOLUME_SET.has(raw)
    ? (raw as AccessoryVolumeLevel)
    : "medium";
}

/**
 * The raw aesthetic-profile delta for a level, before any per-archetype floor.
 * Reuses the ADR 0020 `SecondaryVolumeTilt` shape so the two tilts compose
 * additively at the same assembler site. `medium` is the `{ 0, 0 }` identity.
 *
 * CP-1 [DEF→cal] magnitudes.
 */
export function accessoryVolumeTilt(
  level: AccessoryVolumeLevel,
): SecondaryVolumeTilt {
  switch (level) {
    case "low":
      return { itemsPerSessionDelta: -1, setsPerItemDelta: 0 };
    case "high":
      return { itemsPerSessionDelta: 1, setsPerItemDelta: 1 };
    case "medium":
    default:
      return { itemsPerSessionDelta: 0, setsPerItemDelta: 0 };
  }
}

/** A floored accessory-volume bonus pair applied to the picker profile. */
export interface VolumeBonus {
  /** Added to the aesthetic `itemsPerSession` budget (can be negative). */
  itemBonus: number;
  /** Added to each aesthetic movement's `setsPerItem` (floored at 2 sets). */
  setBonus: number;
}

/**
 * Floor a raw `(itemBonus, setBonus)` against an archetype's OWN accessory
 * profile so a downward tilt never strips the last aesthetic movement and
 * never drops a movement below 2 working sets:
 *
 *   - An archetype that ships zero aesthetic items (Maintenance) is a full
 *     no-op — there is nothing to scale.
 *   - Otherwise at least ONE aesthetic movement always survives, so `low` is a
 *     no-op on archetypes whose base is already 1 (Endurance / Rebuild) and
 *     trims exactly one on Strength (2 → 1) / Hypertrophy (4 → 3) / Concurrent
 *     (2 → 1).
 *   - Sets-per-movement never falls below 2 (a lone set is too weak a
 *     stimulus — minimalism trims breadth, not depth).
 */
function floorBonus(
  aestheticBaseItems: number,
  baseSetsPerItem: number,
  rawItemBonus: number,
  rawSetBonus: number,
): VolumeBonus {
  if (aestheticBaseItems <= 0) {
    return { itemBonus: 0, setBonus: 0 };
  }
  const items = Math.max(1, aestheticBaseItems + rawItemBonus);
  const sets = Math.max(2, baseSetsPerItem + rawSetBonus);
  return { itemBonus: items - aestheticBaseItems, setBonus: sets - baseSetsPerItem };
}

/**
 * Compose the accessory-volume level with the (already-resolved) secondary-
 * focus tilt and produce the duration-governor candidate ladder — fullest
 * first. The assembler prices each candidate with `estimateSessionSeconds` and
 * keeps the fullest one that fits the session-duration cap (ADR 0020).
 *
 * Only a NET-POSITIVE volume can blow the budget, so a `medium`/`low` (or any
 * net-≤-identity) result yields a SINGLE candidate — the picker runs exactly
 * once and the path is byte-identical to the pre-tilt assembler. The
 * `medium` + secondary-`muscle` case reproduces the exact pre-ADR-0024
 * three-rung ladder, preserving every ADR 0020 pin.
 */
export function accessoryVolumeCandidates(args: {
  aestheticBaseItems: number;
  baseSetsPerItem: number;
  level: AccessoryVolumeLevel;
  secondary: SecondaryVolumeTilt;
}): VolumeBonus[] {
  const lvl = accessoryVolumeTilt(args.level);
  const full = floorBonus(
    args.aestheticBaseItems,
    args.baseSetsPerItem,
    lvl.itemsPerSessionDelta + args.secondary.itemsPerSessionDelta,
    lvl.setsPerItemDelta + args.secondary.setsPerItemDelta,
  );

  const rungs: VolumeBonus[] = [
    { itemBonus: full.itemBonus, setBonus: full.setBonus },
  ];
  // Trim the extra movement first, then the extra set — never below the
  // floored identity. Non-positive bonuses skip the loops (single candidate).
  let i = full.itemBonus;
  let s = full.setBonus;
  while (i > 0) {
    i -= 1;
    rungs.push({ itemBonus: i, setBonus: s });
  }
  while (s > 0) {
    s -= 1;
    rungs.push({ itemBonus: i, setBonus: s });
  }
  return rungs;
}
