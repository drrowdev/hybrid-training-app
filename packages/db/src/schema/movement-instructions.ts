/**
 * movement_instructions — per-movement how-to content for the in-workout
 * exercise library (migration 0098).
 *
 * 1:1 with a seed movement, kept in a side table so the engine's hot catalog
 * SELECTs stay lean — this payload is fetched only when the detail sheet opens.
 * Content is deliberately terse: a one-line summary, a setup line, a few
 * imperative steps, a couple of cues, and (only when genuinely useful) a common
 * mistake. The seed loader keys by the stable movement slug and resolves it to
 * `movement_id` per environment.
 */
import { sql } from "drizzle-orm";
import {
  boolean,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { createSelectSchema } from "drizzle-zod";
import { movements } from "./movements";

export const movementInstructions = pgTable("movement_instructions", {
  movementId: uuid("movement_id")
    .primaryKey()
    .references(() => movements.id, { onDelete: "cascade" }),
  /** One tight line: what it is / what it trains. */
  summary: text("summary").notNull(),
  /** One line: how to get into position before the first rep. */
  setup: text("setup"),
  /** 3–6 terse imperative steps. */
  steps: jsonb("steps").$type<string[]>().default([]).notNull(),
  /** 1–3 short focus cues. */
  cues: jsonb("cues").$type<string[]>().default([]).notNull(),
  /** 0–2 specific common mistakes (only when genuinely useful). */
  commonMistakes: jsonb("common_mistakes").$type<string[]>().default([]).notNull(),
  /** Provenance, e.g. 'seed-v1'. */
  source: text("source").default("seed-v1").notNull(),
  /** Internal: spot-checked by a human. */
  reviewed: boolean("reviewed").default(false).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .default(sql`now()`)
    .notNull(),
});

export const movementInstructionSelect = createSelectSchema(movementInstructions);
export type MovementInstruction = typeof movementInstructions.$inferSelect;
export type NewMovementInstruction = typeof movementInstructions.$inferInsert;
