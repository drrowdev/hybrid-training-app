import { sql } from "drizzle-orm";
import { check, foreignKey, index, jsonb, pgTable, primaryKey, timestamp, uuid } from "drizzle-orm/pg-core";
import { plannedSessions, trainingBlocks, type Prescription } from "./planner";
import { programInstances } from "./program-instances";
import { swimPlans, swimWorkouts } from "./swimming";

export const swimConditioningBindings = pgTable("swim_conditioning_bindings", {
  userId: uuid("user_id").notNull(),
  plannedSessionId: uuid("planned_session_id").unique("swim_conditioning_bindings_planned_session_id_key"),
  swimWorkoutId: uuid("swim_workout_id").primaryKey(),
  blockId: uuid("block_id"),
  metadata: jsonb("metadata").$type<{
    version: 1; workoutRevision: number; plannedPrescription: Prescription;
    plannedSessionId: string; blockId: string;
  }>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
}, (t) => ({
  ownerBlock: index("swim_conditioning_bindings_owner_block").on(t.userId, t.blockId),
  session: foreignKey({
    name: "swim_conditioning_bindings_session_fkey",
    columns: [t.plannedSessionId], foreignColumns: [plannedSessions.id],
  }).onDelete("set null"),
  block: foreignKey({
    name: "swim_conditioning_bindings_block_fkey",
    columns: [t.blockId], foreignColumns: [trainingBlocks.id],
  }).onDelete("set null"),
  ownedSession: foreignKey({
    name: "swim_conditioning_bindings_owned_session_fkey",
    columns: [t.userId, t.plannedSessionId], foreignColumns: [plannedSessions.userId, plannedSessions.id],
  }),
  ownedWorkout: foreignKey({
    name: "swim_conditioning_bindings_owned_workout_fkey",
    columns: [t.userId, t.swimWorkoutId], foreignColumns: [swimWorkouts.userId, swimWorkouts.id],
  }),
  ownedBlock: foreignKey({
    name: "swim_conditioning_bindings_owned_block_fkey",
    columns: [t.userId, t.blockId], foreignColumns: [trainingBlocks.userId, trainingBlocks.id],
  }),
  metadataCheck: check("swim_conditioning_bindings_metadata_check", sql`(
    jsonb_typeof(${t.metadata}) = 'object' AND ${t.metadata}->'version' = '1'::jsonb
    AND jsonb_typeof(${t.metadata}->'workoutRevision') = 'number'
    AND ${t.metadata}->>'workoutRevision' ~ '^[1-9][0-9]*$'
    AND jsonb_typeof(${t.metadata}->'plannedPrescription') = 'object'
    AND ${t.metadata}->>'plannedSessionId' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    AND ${t.metadata}->>'blockId' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    AND (${t.plannedSessionId} IS NULL OR ${t.metadata}->>'plannedSessionId' = ${t.plannedSessionId}::text)
    AND (${t.blockId} IS NULL OR ${t.metadata}->>'blockId' = ${t.blockId}::text)
    AND ${t.metadata} - ARRAY['version','workoutRevision','plannedPrescription','plannedSessionId','blockId'] = '{}'::jsonb
  ) IS TRUE`),
}));

export const swimConditioningSaves = pgTable("swim_conditioning_saves", {
  userId: uuid("user_id").notNull(),
  requestId: uuid("request_id").notNull(),
  blockId: uuid("block_id"),
  programInstanceId: uuid("program_instance_id"),
  swimPlanId: uuid("swim_plan_id").notNull(),
  metadata: jsonb("metadata").$type<{ fingerprint: string; skipped: number }>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
}, (t) => ({
  ownerRequest: primaryKey({ name: "swim_conditioning_saves_pkey", columns: [t.userId, t.requestId] }),
  block: foreignKey({
    name: "swim_conditioning_saves_block_fkey",
    columns: [t.blockId], foreignColumns: [trainingBlocks.id],
  }).onDelete("set null"),
  instance: foreignKey({
    name: "swim_conditioning_saves_instance_fkey",
    columns: [t.programInstanceId], foreignColumns: [programInstances.id],
  }).onDelete("set null"),
  ownedBlock: foreignKey({
    name: "swim_conditioning_saves_owned_block_fkey",
    columns: [t.userId, t.blockId], foreignColumns: [trainingBlocks.userId, trainingBlocks.id],
  }),
  ownedInstance: foreignKey({
    name: "swim_conditioning_saves_owned_instance_fkey",
    columns: [t.userId, t.programInstanceId], foreignColumns: [programInstances.userId, programInstances.id],
  }),
  ownedSwim: foreignKey({
    name: "swim_conditioning_saves_owned_swim_fkey",
    columns: [t.userId, t.swimPlanId], foreignColumns: [swimPlans.userId, swimPlans.id],
  }),
  metadataCheck: check("swim_conditioning_saves_metadata_check", sql`(
    jsonb_typeof(${t.metadata}) = 'object'
    AND ${t.metadata}->>'fingerprint' ~ '^[0-9a-f]{64}$'
    AND jsonb_typeof(${t.metadata}->'skipped') = 'number'
    AND ${t.metadata}->>'skipped' ~ '^(0|[1-9][0-9]*)$'
    AND ${t.metadata} - ARRAY['fingerprint','skipped'] = '{}'::jsonb
  ) IS TRUE`),
}));
