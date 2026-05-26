/**
 * set_logs — per-set strength entries.
 *
 * A set must record SOMETHING (CHECK constraint at SQL level):
 *   - reps × weight_kg (standard strength)
 *   - duration_sec (isometric holds, Baar tendon protocols DC-J4)
 *   - distance_m (sled push / loaded carry)
 *
 * set_kind drives DC-E1 anchor-vs-filler classification at log time.
 */
import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";

export const setKind = pgEnum("set_kind", [
  "warmup",
  "main",
  "back_off",
  "accessory",
  "tendon",
]);

export const setLogs = pgTable(
  "set_logs",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    sessionId: uuid("session_id").notNull(),
    movementId: uuid("movement_id").notNull(),
    setIndex: smallint("set_index").notNull(),
    weightKg: numeric("weight_kg", { precision: 6, scale: 2 }),
    reps: smallint("reps"),
    durationSec: integer("duration_sec"),
    distanceM: integer("distance_m"),
    rpe: numeric("rpe", { precision: 3, scale: 1 }),
    setKind: setKind("set_kind").default("main").notNull(),
    percentOfTm: numeric("percent_of_tm", { precision: 5, scale: 2 }),
    notes: text("notes"),
    // Index into the planned_session.prescription.items array that this
    // set was logged against (when the user tapped a prescription row to
    // prefill the logger). Null for free-form / legacy logs and for
    // sessions with no linked plan. See migration
    // 0036_set_logs_prescription_link.sql.
    prescriptionItemIndex: smallint("prescription_item_index"),
    // Migration 0037: per-set skip with reason. Skipped rows still occupy
    // a slot in the dot strip / "covered" count, but never contribute to
    // tonnage, PR detection, or e1RM. CHECK constraint at the SQL layer
    // restricts the reason to the picker's chip allowlist.
    skipped: boolean("skipped").default(false).notNull(),
    skipReason: text("skip_reason"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
  },
  (t) => ({
    // Migration 0053 — composite history index. Backs PR detection and
    // movement-history queries that filter by movement_id and scan
    // recent rows first. set_logs has no `performed_at` column (that
    // lives on the joined `sessions` row), so we order by `created_at`
    // — which is set at insert time and tracks `sessions.performed_at`
    // closely in practice. Replaces the per-movement-only
    // `set_logs_movement_idx` for ordered scans (the older index is
    // kept; both are cheap).
    movementCreatedAtIdx: index("set_logs_movement_created_at_idx").on(
      t.movementId,
      t.createdAt.desc(),
    ),
  }),
);

export const setLogInsert = createInsertSchema(setLogs);
export const setLogSelect = createSelectSchema(setLogs);
export type SetLog = typeof setLogs.$inferSelect;
export type NewSetLog = typeof setLogs.$inferInsert;
export type SetKind = (typeof setKind.enumValues)[number];

export const SKIP_REASONS = ["pain", "fatigue", "time", "equipment", "other"] as const;
export type SkipReason = (typeof SKIP_REASONS)[number];
