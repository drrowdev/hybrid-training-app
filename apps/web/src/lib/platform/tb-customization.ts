import { z } from "zod";

export const TB_CUSTOMIZATION_VERSION = 1 as const;
export const TB_ACTIVATION_CUSTOMIZATION_V2_VERSION = 2 as const;
export const TB_ACTIVATION_CUSTOMIZATION_VERSION = 3 as const;
export const LEGACY_REHAB_PROTOCOL_ID = "protocol-1";
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
    movementId: z.string().uuid().optional(),
    slug: z.string().trim().min(1).max(160).optional(),
    displayName: z.string().trim().min(1).max(160).optional(),
    kind: z
      .enum(["barbell", "weighted-bw", "bodyweight", "unanchored"])
      .optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (!value.movement.startsWith("catalog:")) return;
    if (
      !value.movementId ||
      value.movement !== `catalog:${value.movementId}` ||
      !value.slug ||
      !value.displayName
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Catalog movements require a matching id, slug, and display name.",
      });
    }
  });

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
    version: z.literal(TB_ACTIVATION_CUSTOMIZATION_V2_VERSION),
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

const rehabProtocolSchema = z
  .object({
    id: z
      .string()
      .regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
    name: z.string().trim().min(1).max(120),
    items: z.array(rehabItemSchema).min(1).max(20),
  })
  .strict();

const rehabAssignmentSchema = z
  .object({
    day: z.number().int().min(0).max(6),
    protocolId: z.string().min(1).max(64),
  })
  .strict();

const activationPhaseV3Schema = z
  .object({
    sessions: z.record(activationSessionSchema),
    rehabAssignments: z.array(rehabAssignmentSchema).max(7).default([]),
  })
  .strict()
  .superRefine((value, ctx) => {
    const days = value.rehabAssignments.map((assignment) => assignment.day);
    if (new Set(days).size !== days.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["rehabAssignments"],
        message: "Each day can use at most one rehab protocol.",
      });
    }
  });

export const tbActivationCustomizationV3Schema = z
  .object({
    version: z.literal(TB_ACTIVATION_CUSTOMIZATION_VERSION),
    templateId: z.literal("activation"),
    displayName: z.string().trim().min(1).max(120),
    phases: z
      .object({
        base: activationPhaseV3Schema,
        armor: activationPhaseV3Schema,
        operator: activationPhaseV3Schema,
        vertex: activationPhaseV3Schema,
      })
      .strict(),
    rehabProtocols: z.array(rehabProtocolSchema).max(8).default([]),
  })
  .strict()
  .superRefine((value, ctx) => {
    const protocolIds = value.rehabProtocols.map((protocol) => protocol.id);
    if (new Set(protocolIds).size !== protocolIds.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["rehabProtocols"],
        message: "Rehab protocol ids must be unique.",
      });
    }
    const known = new Set(protocolIds);
    for (const [phase, config] of Object.entries(value.phases)) {
      for (const assignment of config.rehabAssignments) {
        if (!known.has(assignment.protocolId)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [
              "phases",
              phase,
              "rehabAssignments",
            ],
            message: `Rehab protocol '${assignment.protocolId}' does not exist.`,
          });
        }
      }
    }
  });

export const tbCustomizationSchema = z.union([
  tbCustomizationV1Schema,
  tbActivationCustomizationV2Schema,
  tbActivationCustomizationV3Schema,
]);

export type TbCustomizationV1 = z.infer<typeof tbCustomizationV1Schema>;
export type TbActivationCustomizationV2 = z.infer<
  typeof tbActivationCustomizationV2Schema
>;
export type TbActivationCustomizationV3 = z.infer<
  typeof tbActivationCustomizationV3Schema
>;
export type TbActivationCustomization =
  | TbActivationCustomizationV2
  | TbActivationCustomizationV3;
export type TbCustomization = z.infer<typeof tbCustomizationSchema>;

export function isTbCustomizationV1(
  value: TbCustomization,
): value is TbCustomizationV1 {
  return value.version === TB_CUSTOMIZATION_VERSION;
}

export function isTbActivationCustomizationV2(
  value: TbCustomization,
): value is TbActivationCustomizationV2 {
  return value.version === TB_ACTIVATION_CUSTOMIZATION_V2_VERSION;
}

export function isTbActivationCustomizationV3(
  value: TbCustomization,
): value is TbActivationCustomizationV3 {
  return value.version === TB_ACTIVATION_CUSTOMIZATION_VERSION;
}

export function isTbActivationCustomization(
  value: TbCustomization,
): value is TbActivationCustomization {
  return (
    isTbActivationCustomizationV2(value) ||
    isTbActivationCustomizationV3(value)
  );
}

export function activationSessionConfigs(
  customization: TbActivationCustomization,
) {
  return Object.assign(
    {},
    ...Object.values(customization.phases).map((phase) => phase.sessions),
  ) as TbActivationCustomization["phases"]["base"]["sessions"];
}

export type ActivationRehabProtocol = {
  id: string;
  name: string;
  items: z.infer<typeof rehabItemSchema>[];
};

export type ActivationRehabAssignment = {
  day: number;
  protocolId: string;
};

export function activationRehabProtocols(
  customization: TbActivationCustomization,
): ActivationRehabProtocol[] {
  if (isTbActivationCustomizationV3(customization)) {
    return customization.rehabProtocols;
  }
  return customization.rehab
    ? [
        {
          id: LEGACY_REHAB_PROTOCOL_ID,
          name: "Protocol 1",
          items: customization.rehab.items,
        },
      ]
    : [];
}

export function activationRehabAssignments(
  customization: TbActivationCustomization,
  phase: keyof TbActivationCustomization["phases"],
): ActivationRehabAssignment[] {
  if (isTbActivationCustomizationV3(customization)) {
    return customization.phases[phase].rehabAssignments;
  }
  return customization.phases[phase].rehabDays.map((day) => ({
    day,
    protocolId: LEGACY_REHAB_PROTOCOL_ID,
  }));
}

export function effectiveActivationRehabProtocolIds(
  customization: TbActivationCustomization,
  startWeekIndex = 0,
): Set<string> {
  const phaseEnds = {
    base: 3,
    armor: 7,
    operator: 18,
    vertex: 23,
  } as const;
  return new Set(
    (["base", "armor", "operator", "vertex"] as const)
      .filter((phase) => phaseEnds[phase] >= startWeekIndex)
      .flatMap((phase) =>
        activationRehabAssignments(customization, phase).map(
          (assignment) => assignment.protocolId,
        ),
      ),
  );
}

export function customizationDays(
  customization: TbCustomizationV1,
  type: z.infer<typeof weekdayTypeSchema>,
): number[] {
  return customization.dayTypes.flatMap((day, index) =>
    day === type ? [index] : [],
  );
}
