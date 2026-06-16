/**
 * cardio_logs — per-cardio-block entries on a session.
 *
 * One session can hold multiple cardio blocks (e.g. easy warm-up +
 * intervals). movement_id points to a catalog cardio entry where
 * possible; Strava-pulled activities may carry external_source + the
 * raw strava_activity_id even without a movement match.
 */
import { sql } from "drizzle-orm";
import {
  integer,
  jsonb,
  numeric,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";

export const cardioLogs = pgTable(
  "cardio_logs",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    sessionId: uuid("session_id").notNull(),
    /** Nullable — Strava activity may not have a catalog match. */
    movementId: uuid("movement_id"),
    blockIndex: smallint("block_index").default(0).notNull(),
    modality: text("modality").notNull(),
    durationSec: integer("duration_sec").notNull(),
    distanceKm: numeric("distance_km", { precision: 7, scale: 3 }),
    avgHrBpm: smallint("avg_hr_bpm"),
    maxHrBpm: smallint("max_hr_bpm"),
    avgPaceSecPerKm: integer("avg_pace_sec_per_km"),
    avgPowerW: smallint("avg_power_w"),
    hrZones: jsonb("hr_zones").$type<Record<string, number>>(),
    /**
     * Band-independent bpm→seconds distribution from the per-second HR
     * stream (migration 0109). Lets a zone-config change re-bucket
     * `hr_zones` for past activities locally via `zonesFromHistogram`,
     * with no Strava re-fetch. Null on stream-less / manual rows.
     */
    hrHistogram: jsonb("hr_histogram").$type<Record<string, number>>(),
    /** Strava integration (DC-D4 modality tagging + DC-J8 mileage ramp). */
    stravaActivityId: text("strava_activity_id"),
    externalSource: text("external_source"),
    rpe: numeric("rpe", { precision: 3, scale: 1 }),
    notes: text("notes"),
    /**
     * Phase 2 "external cardio" — classifier output. Mirrors the
     * `cardio_*` PrescriptionItemKind set (cardio_z2 / cardio_threshold /
     * cardio_vo2 / cardio_alactic / cardio_mixed). Populated by the
     * Strava sync on import; null on legacy rows. See migration 0065
     * and `apps/web/src/lib/integrations/strava/classify-cardio.ts`.
     */
    inferredKind: text("inferred_kind"),
    /** 0..1 confidence — UI dims the badge below 0.7. */
    inferredConfidence: numeric("inferred_confidence", { precision: 3, scale: 2 }),
    // Offline-logging idempotency key (migration 0097). See set_logs.client_log_id.
    clientLogId: uuid("client_log_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
  },
  (t) => ({
    // Migration 0097 — unique idempotency key for offline replay.
    clientLogIdKey: uniqueIndex("cardio_logs_client_log_id_key").on(t.clientLogId),
  }),
);

export const cardioLogInsert = createInsertSchema(cardioLogs);
export const cardioLogSelect = createSelectSchema(cardioLogs);
export type CardioLog = typeof cardioLogs.$inferSelect;
export type NewCardioLog = typeof cardioLogs.$inferInsert;
