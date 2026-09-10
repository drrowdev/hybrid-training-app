import { z } from "zod";
import { REHAB_REPS_MAX } from "@hta/domain";

const repCountSchema = z.number().int().min(1).max(REHAB_REPS_MAX);

export const rehabProtocolItemSchema = z
  .object({
    movementId: z.string().uuid(),
    movementName: z.string().trim().min(1).max(120),
    side: z.enum(["both", "left", "right"]).optional(),
    sets: z.number().int().min(1).max(20),
    reps: repCountSchema.optional(),
    repRange: z
      .object({ min: repCountSchema, max: repCountSchema })
      .strict()
      .refine((range) => range.min <= range.max, {
        message: "Enter the lower rep count first.",
      })
      .optional(),
    holdSeconds: z.number().int().min(1).max(3600).optional(),
    targetWeightKg: z.number().min(0).max(1000).optional(),
    instructions: z.string().trim().max(500).optional(),
  })
  .strict()
  .refine((item) => item.reps != null || item.holdSeconds != null, {
    message: "Enter reps or a hold time.",
    path: ["reps"],
  })
  .refine((item) => !item.repRange || item.reps === item.repRange.min, {
    message: "The rep count must match the start of the rep range.",
    path: ["repRange"],
  });

export type RehabProtocolItem = z.infer<typeof rehabProtocolItemSchema>;
