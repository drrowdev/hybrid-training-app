import { z } from "zod";

export const TB_CUSTOMIZATION_VERSION = 1 as const;
export const TB_ACTIVATION_CUSTOMIZATION_VERSION = 2 as const;
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

const movementReplacementSchema = z
  .object({
    movement: z.string().trim().min(1).max(80),
    kind: z
      .enum(["barbell", "weighted-bw", "bodyweight", "unanchored"])
      .optional(),
  })
  .strict();

export const tbCustomizationV1Schema = z
  .object({
    version: z.literal(TB_CUSTOMIZATION_VERSION),
    displayName: z.string().trim().min(1).max(120),
    dayTypes: z.array(weekdayTypeSchema).length(7),
    sessionMovements: z.record(
      z.array(
        movementReplacementSchema,
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

const activationSessionSchema = z
  .object({
    day: z.number().int().min(0).max(6),
    enabled: z.boolean(),
    movementOverrides: z
      .record(movementReplacementSchema.nullable())
      .default({}),
  })
  .strict();

const activationPhaseSchema = z
  .object({
    sessions: z.record(activationSessionSchema),
    rehabDays: z.array(z.number().int().min(0).max(6)).max(7).default([]),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (new Set(value.rehabDays).size !== value.rehabDays.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["rehabDays"],
        message: "Rehab days must be distinct.",
      });
    }
  });

export const tbActivationCustomizationV2Schema = z
  .object({
    version: z.literal(TB_ACTIVATION_CUSTOMIZATION_VERSION),
    templateId: z.literal("activation"),
    displayName: z.string().trim().min(1).max(120),
    phases: z
      .object({
        base: activationPhaseSchema,
        armor: activationPhaseSchema,
        operator: activationPhaseSchema,
        vertex: activationPhaseSchema,
      })
      .strict(),
    rehab: z
      .object({
        items: z.array(rehabItemSchema).min(1).max(20),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const rehabDays = Object.values(value.phases).reduce(
      (sum, phase) => sum + phase.rehabDays.length,
      0,
    );
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

export const tbCustomizationSchema = z.union([
  tbCustomizationV1Schema,
  tbActivationCustomizationV2Schema,
]);

export type TbCustomizationV1 = z.infer<typeof tbCustomizationV1Schema>;
export type TbActivationCustomizationV2 = z.infer<
  typeof tbActivationCustomizationV2Schema
>;
export type TbCustomization = z.infer<typeof tbCustomizationSchema>;

export function isTbCustomizationV1(
  value: TbCustomization,
): value is TbCustomizationV1 {
  return value.version === TB_CUSTOMIZATION_VERSION;
}

export function isTbActivationCustomizationV2(
  value: TbCustomization,
): value is TbActivationCustomizationV2 {
  return value.version === TB_ACTIVATION_CUSTOMIZATION_VERSION;
}

export function activationSessionConfigs(
  customization: TbActivationCustomizationV2,
) {
  return Object.assign(
    {},
    ...Object.values(customization.phases).map((phase) => phase.sessions),
  ) as TbActivationCustomizationV2["phases"]["base"]["sessions"];
}

export function customizationDays(
  customization: TbCustomizationV1,
  type: z.infer<typeof weekdayTypeSchema>,
): number[] {
  return customization.dayTypes.flatMap((day, index) =>
    day === type ? [index] : [],
  );
}
