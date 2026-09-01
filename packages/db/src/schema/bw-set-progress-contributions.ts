/**
 * bw_set_progress_contributions — durable source attribution for bodyweight
 * progress. One row tracks the node and TUT credited by one set log.
 */
import { sql } from "drizzle-orm";
import { index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { movementNodes } from "./movement-nodes";
import { setLogs } from "./set-logs";

export const bwSetProgressContributions = pgTable(
  "bw_set_progress_contributions",
  {
    setLogId: uuid("set_log_id")
      .primaryKey()
      .references(() => setLogs.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull(),
    family: text("family").notNull(),
    nodeId: uuid("node_id")
      .notNull()
      .references(() => movementNodes.id, { onDelete: "restrict" }),
    tutSeconds: integer("tut_seconds").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
  },
  (t) => ({
    userFamilyIdx: index("bw_set_progress_contributions_user_family_idx").on(
      t.userId,
      t.family,
    ),
  }),
);

export type BwSetProgressContribution =
  typeof bwSetProgressContributions.$inferSelect;
export type NewBwSetProgressContribution =
  typeof bwSetProgressContributions.$inferInsert;
