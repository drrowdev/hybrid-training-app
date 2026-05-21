/**
 * strava_connections — OAuth token store + sync state for the read-only
 * Strava ingest. One row per user.
 *
 * Tokens are stored as plaintext because Supabase row-level security
 * already scopes reads to auth.uid(); adding column-level encryption is a
 * follow-up if the threat model widens.
 */
import { sql } from "drizzle-orm";
import { bigint, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const stravaConnections = pgTable("strava_connections", {
  userId: uuid("user_id").primaryKey(),
  athleteId: bigint("athlete_id", { mode: "number" }).notNull(),
  accessToken: text("access_token").notNull(),
  refreshToken: text("refresh_token").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  scopes: text("scopes").default("read,activity:read").notNull(),
  connectedAt: timestamp("connected_at", { withTimezone: true })
    .default(sql`now()`)
    .notNull(),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
  lastSyncError: text("last_sync_error"),
});

export type StravaConnection = typeof stravaConnections.$inferSelect;
export type NewStravaConnection = typeof stravaConnections.$inferInsert;
