import { z } from "zod";

const trainingMaxValueSchema = z.number().positive().lte(1000);
export const trainingMaxInputSchema = z.object({
  movementId: z.string().uuid(),
  oneRmKg: z.coerce.number().pipe(trainingMaxValueSchema),
}).strict();

export const trainingMaxEditsSchema = z.array(trainingMaxInputSchema.extend({
  oneRmKg: trainingMaxValueSchema,
})).max(64).refine(
  (edits) => new Set(edits.map((edit) => edit.movementId)).size === edits.length,
  "Each exercise can have only one benchmark.",
);

export type TrainingMaxEdit = z.output<typeof trainingMaxInputSchema>;
