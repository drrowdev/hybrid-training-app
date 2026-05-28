/**
 * Shared input contracts for the AI server actions. Lives in its
 * own module so the Zod schemas can be imported from unit tests
 * without dragging the `"use server"` action surface in.
 */
import { z } from "zod";

export const providerSchema = z.enum(["anthropic", "openai", "gemini"]);

export const setKeySchema = z.object({
  provider: providerSchema,
  plaintextKey: z.string().trim().min(8).max(512),
  /**
   * Optional model ID. `null` (or omitted) tells the action to fall
   * back to the Recommended-tier default for the chosen provider. A
   * non-null string is validated by `setByoaiKey` against the
   * provider's live `/models` listing.
   */
  model: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .nullable()
    .optional(),
});

export type ProviderName = z.infer<typeof providerSchema>;
export type SetKeyInput = z.infer<typeof setKeySchema>;
