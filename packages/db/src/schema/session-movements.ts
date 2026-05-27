/**
 * session_movements — freestyle ("+ Add off-plan movement") additions
 * persisted server-side so they survive a refresh and so the user can
 * remove a mistakenly-added card before any set is logged.
 *
 * See migration `0059_session_movements.sql` for the rationale on the
 * composite PK, the denormalised `user_id` (RLS + faster filters), and
 * the hard-delete-only policy.
 */
import { sql } from "drizzle-orm";
import {
  index,
  pgTable,
  primaryKey,
  smallint,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";

export const sessionMovements = pgTable(
  "session_movements",
  {
    sessionId: uuid("session_id").notNull(),
    movementId: uuid("movement_id").notNull(),
    userId: uuid("user_id").notNull(),
    sortOrder: smallint("sort_order").notNull().default(0),
    addedAt: timestamp("added_at", { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.sessionId, t.movementId] }),
    sessionIdx: index("session_movements_session_idx").on(t.sessionId),
    userIdx: index("session_movements_user_idx").on(t.userId),
  }),
);

export const sessionMovementInsert = createInsertSchema(sessionMovements);
export const sessionMovementSelect = createSelectSchema(sessionMovements);
export type SessionMovement = typeof sessionMovements.$inferSelect;
export type NewSessionMovement = typeof sessionMovements.$inferInsert;
