/**
 * getKnowledge — embedded reference knowledge for the AI host.
 *
 * Pure compile-time constant from `@/lib/ai/knowledge.ts`: archetype
 * summaries + the CP-1..CP-5 calibration policy + the constants table.
 * No DB read; returns a deterministic payload.
 *
 * Bounded by source-file size (well under the 5k-token budget per the
 * ADR §"Initial 8 tools" cap).
 */
import { z } from "zod";
import {
  ARCHETYPES_SUMMARY,
  CALIBRATION_POLICY_TEXT,
  CONSTANTS_TABLE_TEXT,
} from "@/lib/ai/knowledge";
import type { Tool } from "./types";

const archetypeSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
});

const outputSchema = z.object({
  archetypes: z.array(archetypeSchema),
  calibration_policy: z.string(),
  constants_table: z.string(),
});

const inputSchema = z.object({}).strict();

type Input = z.infer<typeof inputSchema>;
type Output = z.infer<typeof outputSchema>;

export const getKnowledge: Tool<Input, Output> = {
  name: "getKnowledge",
  description:
    "Returns embedded reference knowledge: archetype descriptions, the calibration policy (CP-1 through CP-5), and the engine constants table.",
  inputSchema,
  outputSchema,
  async handler() {
    return {
      archetypes: ARCHETYPES_SUMMARY.map((a) => ({
        id: a.id,
        name: a.name,
        description: a.description,
      })),
      calibration_policy: CALIBRATION_POLICY_TEXT,
      constants_table: CONSTANTS_TABLE_TEXT,
    };
  },
};
