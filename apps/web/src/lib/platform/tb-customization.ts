import { z } from "zod";

export const TB_CUSTOMIZATION_VERSION = 1 as const;
export const DEFAULT_CUSTOM_TB_NAME = "Tactical Barbell - Customized";

const weekdayTypeSchema = z.enum([
  "strength",
  "conditioning",
  "rehab",
  "rest",
]);

const rehabItemSchema = z
  .object({
    movementId: z.string().uuid(),
    movementName: z.string().trim().min(1).max(120),
    side: z.enum(["both", "left", "right"]).optional(),
    sets: z.number().int().min(1).max(20),
    reps: z.number().int().min(1).max(500).optional(),
    holdSeconds: z.number().int().min(1).max(3600).optional(),
    targetWeightKg: z.number().min(0).max(1000).optional(),
    instructions: z.string().trim().max(500).optional(),
  })
  .strict()
  .refine((item) => item.reps != null || item.holdSeconds != null, {
    message: "Each rehab movement needs reps or a hold time.",
  });

export const tbCustomizationSchema = z
  .object({
    version: z.literal(TB_CUSTOMIZATION_VERSION),
    displayName: z.string().trim().min(1).max(120),
    dayTypes: z.array(weekdayTypeSchema).length(7),
    sessionMovements: z.record(
      z.array(
        z
          .object({
            movement: z.string().trim().min(1).max(80),
            kind: z
              .enum(["barbell", "weighted-bw", "bodyweight", "unanchored"])
              .optional(),
          })
          .strict(),
      ).min(1).max(8),
    ),
    rehab: z
      .object({
        items: z.array(rehabItemSchema).min(1).max(20),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const rehabDays = value.dayTypes.filter((day) => day === "rehab").length;
    if (rehabDays > 0 && !value.rehab?.items.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["rehab"],
        message: "Add at least one rehab movement for a rehab day.",
      });
    }
    if (rehabDays === 0 && value.rehab) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["rehab"],
        message: "Choose a rehab day before adding a rehab protocol.",
      });
    }
  });

export type TbCustomizationV1 = z.infer<typeof tbCustomizationSchema>;

export function customizationDays(
  customization: TbCustomizationV1,
  type: z.infer<typeof weekdayTypeSchema>,
): number[] {
  return customization.dayTypes.flatMap((day, index) =>
    day === type ? [index] : [],
  );
}
