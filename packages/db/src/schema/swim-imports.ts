import { sql } from "drizzle-orm";
import { check, foreignKey, integer, jsonb, pgTable, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import type { SwimImportEvidence, SwimWorkout } from "@hta/domain";
import { swimWorkouts } from "./swimming";

export const swimConnections = pgTable("swim_connections", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid("user_id").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
}, (t) => ({
  ownerId: unique("swim_connections_user_id_id_key").on(t.userId, t.id),
  activeOwner: uniqueIndex("swim_connections_one_active_per_user").on(t.userId).where(sql`${t.revokedAt} IS NULL`),
  tokenCheck: check("swim_connections_token_hash_check", sql`${t.tokenHash} ~ '^[0-9a-f]{64}$'`),
}));

export const swimImports = pgTable("swim_imports", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid("user_id").notNull(),
  connectionId: uuid("connection_id").notNull(),
  activityId: text("activity_id").notNull(),
  revision: integer("revision").notNull(),
  contentHash: text("content_hash").notNull(),
  evidence: jsonb("evidence").$type<SwimImportEvidence>().notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  ownedConnection: foreignKey({
    name: "swim_imports_owned_connection_fk",
    columns: [t.userId, t.connectionId],
    foreignColumns: [swimConnections.userId, swimConnections.id],
  }),
  ownerRevision: unique("swim_imports_owner_activity_revision_key").on(t.userId, t.activityId, t.revision),
  ownedActivity: unique("swim_imports_owned_activity_id_key").on(t.userId, t.activityId, t.id),
  ownerContent: unique("swim_imports_owner_activity_content_key").on(t.userId, t.activityId, t.contentHash),
  revisionCheck: check("swim_imports_revision_check", sql`${t.revision} > 0`),
  activityCheck: check("swim_imports_activity_id_check", sql`${t.activityId} ~ '^[0-9]{1,24}$'`),
  hashCheck: check("swim_imports_content_hash_check", sql`${t.contentHash} ~ '^[0-9a-f]{64}$'`),
  evidenceCheck: check("swim_imports_evidence_check", sql`public.swim_import_evidence_valid(${t.evidence}) AND ${t.activityId} = ${t.evidence}->>'activityId'`),
}));

export const swimImportMatches = pgTable("swim_import_matches", {
  id: uuid("id").primaryKey(),
  userId: uuid("user_id").notNull(),
  activityId: text("activity_id").notNull(),
  importId: uuid("import_id").notNull(),
  workoutId: uuid("workout_id"),
  revision: integer("revision").notNull(),
  metadata: jsonb("metadata").$type<{
    previousMatchId: string | null;
    workout: { revision: number; date: string; title: string; issued: SwimWorkout } | null;
  }>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  ownerRevision: unique("swim_import_matches_owner_revision_key").on(t.userId, t.activityId, t.revision),
  ownedImport: foreignKey({
    name: "swim_import_matches_owned_import_fk",
    columns: [t.userId, t.activityId, t.importId],
    foreignColumns: [swimImports.userId, swimImports.activityId, swimImports.id],
  }),
  ownedWorkout: foreignKey({
    name: "swim_import_matches_owned_workout_fk",
    columns: [t.userId, t.workoutId],
    foreignColumns: [swimWorkouts.userId, swimWorkouts.id],
  }),
  revisionCheck: check("swim_import_matches_revision_check", sql`${t.revision} > 0`),
  metadataCheck: check("swim_import_matches_metadata_check", sql`jsonb_typeof(${t.metadata}) = 'object'`),
}));
