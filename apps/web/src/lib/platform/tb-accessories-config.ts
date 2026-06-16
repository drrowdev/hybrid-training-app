/**
 * Pure, dependency-free config for Tactical Barbell optional accessories
 * (ADR 0048) — safe to import from both the server selector (`tb-accessories.ts`)
 * and the client wizard (`ProgramPicker`). No catalog / equipment imports here, so
 * pulling it into the client bundle stays cheap.
 */

/** The aesthetic / "indirect" muscles a TB user can target with optional accessories. */
export const TB_ACCESSORY_MUSCLES = [
  "biceps",
  "triceps",
  "front_delts",
  "side_delts",
  "rear_delts",
  "chest",
  "lats",
  "traps",
  "forearms",
  "abs",
  "obliques",
  "calves",
] as const;
export type TbAccessoryMuscle = (typeof TB_ACCESSORY_MUSCLES)[number];

/** Human labels for the muscle chips. */
export const TB_ACCESSORY_MUSCLE_LABELS: Record<TbAccessoryMuscle, string> = {
  biceps: "Biceps",
  triceps: "Triceps",
  front_delts: "Front delts",
  side_delts: "Side delts",
  rear_delts: "Rear delts",
  chest: "Chest",
  lats: "Lats / back",
  traps: "Traps",
  forearms: "Forearms / grip",
  abs: "Abs",
  obliques: "Obliques",
  calves: "Calves",
};

/** Default emphasis when the user opts in without choosing muscles — the classic
 * "indirect" set (arms / shoulders / abs / calves) compounds miss. */
export const TB_DEFAULT_ACCESSORY_MUSCLES: TbAccessoryMuscle[] = [
  "biceps",
  "triceps",
  "side_delts",
  "abs",
  "calves",
];

/** Per-template gate + caps (CP-1). `null` = accessories not offered for this template. */
export interface TbAccessoryPlan {
  maxItems: number;
  setsPerItem: number;
}

/**
 * Template gating (ADR 0048). Zulu is the template the book designed to host
 * accessories; Operator/Fighter tolerate a minimum; the specialist templates
 * (Gladiator/Grey-Man) and Mass (which has its own accessory day) are excluded.
 */
export function tbAccessoryPlanForTemplate(templateId: string): TbAccessoryPlan | null {
  switch (templateId) {
    case "zulu":
    case "zulu-ia":
    case "zulu-ht":
      return { maxItems: 3, setsPerItem: 3 };
    case "operator":
    case "fighter":
      return { maxItems: 2, setsPerItem: 3 };
    default:
      return null;
  }
}

/** Validate/normalise a requested muscle list to the allowlist; fall back to default. */
export function resolveTbAccessoryMuscles(requested: readonly string[] | undefined): TbAccessoryMuscle[] {
  const allow = new Set<string>(TB_ACCESSORY_MUSCLES);
  const picked = (requested ?? []).filter((m): m is TbAccessoryMuscle => allow.has(m));
  return picked.length > 0 ? picked : [...TB_DEFAULT_ACCESSORY_MUSCLES];
}
