/**
 * limitation_events — append-only audit log for limitation lifecycle
 * transitions (started, resolved, reopened). Introduced in migration
 * 0070 to give the limitations table a true lifecycle beyond
 * `resolved_at` toggling, and to surface a per-limitation timeline.
 *
 * Insert paths:
 *   - createLimitation         → kind='started'
 *   - resolveLimitation(id)    → kind='resolved'
 *   - reopenLimitation(id)     → kind='reopened'
 *
 * The 0070 migration also backfills synthetic 'started' / 'resolved'
 * events for every pre-existing row so the timeline isn't blank for
 * legacy data.
 *
 * Mutability: rows are immutable by RLS — no UPDATE policy. Deletes
 * happen exclusively via cascade from the parent limitation row.
 */
import { sql } from "drizzle-orm";
import {
  check,
  index,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

export type LimitationEventKind = "started" | "resolved" | "reopened";

export const limitationEvents = pgTable(
  "limitation_events",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    limitationId: uuid("limitation_id").notNull(),
    userId: uuid("user_id").notNull(),
    kind: text("kind").$type<LimitationEventKind>().notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
  },
  (t) => ({
    kindCheck: check(
      "limitation_events_kind_check",
      sql`${t.kind} IN ('started', 'resolved', 'reopened')`,
    ),
    limitationIdx: index("limitation_events_limitation_id_idx").on(
      t.limitationId,
      t.occurredAt,
    ),
    userIdx: index("limitation_events_user_idx").on(t.userId, t.occurredAt),
  }),
);

export type LimitationEvent = typeof limitationEvents.$inferSelect;
export type NewLimitationEvent = typeof limitationEvents.$inferInsert;
