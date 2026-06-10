/**
 * @hta/tb-conditioning — the Tactical Barbell II named-session library.
 *
 * A structured, faithful catalogue of TB2's conditioning sessions: Endurance,
 * HIC (#1–20), General Conditioning (#25–36 / GC #1–12), Power Development
 * (#37–40), Core/Grip finishers, and Challenge sessions. These are the concrete
 * workouts that fill Green Protocol's generic Hill / Speed / SE slots.
 *
 * Pure data — no DB, no UI, no deps.
 */
import type { TbNamedSession, TbConditioningCategory, TbZone, TbEquipment } from "./types";
import { ENDURANCE_SESSIONS } from "./endurance";
import { HIC_SESSIONS } from "./hic";
import { GC_SESSIONS, POWER_SESSIONS } from "./gc-power";
import { FINISHER_SESSIONS, CHALLENGE_SESSIONS } from "./finishers-challenges";

export * from "./types";
export { ENDURANCE_SESSIONS } from "./endurance";
export { HIC_SESSIONS } from "./hic";
export { GC_SESSIONS, POWER_SESSIONS } from "./gc-power";
export { FINISHER_SESSIONS, CHALLENGE_SESSIONS } from "./finishers-challenges";

/** The full library, in taxonomy order. */
export const TB_CONDITIONING_SESSIONS: TbNamedSession[] = [
  ...ENDURANCE_SESSIONS,
  ...HIC_SESSIONS,
  ...GC_SESSIONS,
  ...POWER_SESSIONS,
  ...FINISHER_SESSIONS,
  ...CHALLENGE_SESSIONS,
];

const BY_ID = new Map(TB_CONDITIONING_SESSIONS.map((s) => [s.id, s]));

export function getTbSession(id: string): TbNamedSession | undefined {
  return BY_ID.get(id);
}

export function sessionsByCategory(category: TbConditioningCategory): TbNamedSession[] {
  return TB_CONDITIONING_SESSIONS.filter((s) => s.category === category);
}

export function sessionsByZone(zone: TbZone): TbNamedSession[] {
  return TB_CONDITIONING_SESSIONS.filter((s) => s.zone === zone);
}

/** Sessions performable with the given equipment on hand (subset match). */
export function sessionsByEquipment(available: TbEquipment[]): TbNamedSession[] {
  const have = new Set(available);
  return TB_CONDITIONING_SESSIONS.filter((s) => s.equipment.every((e) => have.has(e)));
}

/**
 * Green Protocol's grids use generic slots ("Hill", "Speed", "SE"). This maps a
 * GP slot to the TB2 sessions that legitimately fill it, so the app can offer a
 * real pick-list with full prescriptions for a given day.
 */
export type GreenSlot = "hill" | "speed" | "se" | "hic" | "endurance";

export function suggestForGreenSlot(slot: GreenSlot): TbNamedSession[] {
  switch (slot) {
    case "hill":
      // Hill-based work capacity / SE sprints.
      return TB_CONDITIONING_SESSIONS.filter((s) => s.equipment.includes("hill"));
    case "speed":
      // Run/sprint interval & threshold work (not hill-based).
      return TB_CONDITIONING_SESSIONS.filter(
        (s) =>
          s.category === "hic" &&
          !s.equipment.includes("hill") &&
          (s.zone === "anaerobic" || s.zone === "threshold") &&
          (s.equipment.includes("run") || s.equipment.includes("sprint") || s.equipment.includes("treadmill")),
      );
    case "se":
      // Strength-endurance: SE circuits + GC circuits + finishers.
      return TB_CONDITIONING_SESSIONS.filter(
        (s) => s.zone === "strength-endurance" || s.category === "gc",
      );
    case "hic":
      return sessionsByCategory("hic");
    case "endurance":
      return sessionsByCategory("endurance");
  }
}
