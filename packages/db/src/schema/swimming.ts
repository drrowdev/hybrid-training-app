import { sql } from "drizzle-orm";
import {
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sessions, sessionSlot } from "./sessions";
import type {
  SwimSetup, SwimWorkout, SwimObservation, SwimCalibration, SwimActualResult,
} from "@hta/domain";
export type { SwimActualResult } from "@hta/domain";

export type SwimPlanStatus = "active" | "paused" | "finished" | "archived";
export type SwimWorkoutStatus = "scheduled" | "started" | "completed" | "skipped";

export type SwimPlanDefinition = {
  version: 1;
  setup: SwimSetup;
  generatorVersion: string;
};
export type SwimDecisionRecord = {
  id: string;
  kind: "progression" | "assessment" | "schedule" | "setup";
  decision: "accepted" | "rejected" | "overridden";
  recordedAt: string;
  ruleVersion: string;
  generatorVersion: string;
  inputSnapshot: Record<string, unknown>;
  reason?: string;
};
export type SwimPlanState = {
  version: 1;
  observations: SwimObservation[];
  acceptedCalibration: SwimCalibration | null;
  decisions: SwimDecisionRecord[];
  lifecycle?: { from: SwimPlanStatus; to: SwimPlanStatus; recordedAt: string }[];
  pauseSnapshot?: { pausedAt: string; workoutIds: string[] };
};
export type SwimWorkoutDefinition = {
  version: 1;
  original: SwimWorkout;
  issued: SwimWorkout;
  modifications: {
    id: string; recordedAt: string; reason: string; decisionId: string; previous: SwimWorkout;
  }[];
  resultHistory?: { result: SwimActualResult; recordedAt: string; revision: number; notes: string | null }[];
  skip?: { reason: string | null; recordedAt: string };
};

export const swimPlans = pgTable("swim_plans", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid("user_id").notNull(),
  status: text("status").$type<SwimPlanStatus>().notNull().default("active"),
  startedOn: date("started_on").notNull(),
  endsOn: date("ends_on").notNull(),
  revision: integer("revision").notNull().default(1),
  definition: jsonb("definition").$type<SwimPlanDefinition>().notNull(),
  state: jsonb("state").$type<SwimPlanState>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  ownerIdKey: unique("swim_plans_user_id_id_key").on(t.userId, t.id),
  activeKey: uniqueIndex("swim_plans_one_active_per_user").on(t.userId).where(sql`${t.status} = 'active'`),
  ownerStatusIdx: index("swim_plans_owner_status_idx").on(t.userId, t.status),
  statusCheck: check("swim_plans_status_check", sql`${t.status} IN ('active', 'paused', 'finished', 'archived')`),
  revisionCheck: check("swim_plans_revision_check", sql`${t.revision} > 0`),
  dateCheck: check("swim_plans_ends_on_check", sql`${t.endsOn} >= ${t.startedOn}`),
}));

export const swimWorkouts = pgTable("swim_workouts", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid("user_id").notNull(),
  planId: uuid("plan_id").notNull(),
  scheduledDate: date("scheduled_date").notNull(),
  slot: sessionSlot("slot").notNull().default("single"),
  revision: integer("revision").notNull().default(1),
  status: text("status").$type<SwimWorkoutStatus>().notNull().default("scheduled"),
  sessionId: uuid("session_id").unique(),
  definition: jsonb("definition").$type<SwimWorkoutDefinition>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  ownedPlan: foreignKey({
    name: "swim_workouts_owned_plan_fk",
    columns: [t.userId, t.planId],
    foreignColumns: [swimPlans.userId, swimPlans.id],
  }).onDelete("cascade"),
  // Drizzle cannot express column-specific SET NULL. Migration 0145 owns
  // ON DELETE SET NULL (session_id); user_id must survive a session purge.
  ownedSession: foreignKey({
    name: "swim_workouts_owned_session_fk",
    columns: [t.userId, t.sessionId],
    foreignColumns: [sessions.userId, sessions.id],
  }),
  ownerDateIdx: index("swim_workouts_owner_date_idx").on(t.userId, t.scheduledDate, t.id),
  planIdx: index("swim_workouts_plan_idx").on(t.planId, t.scheduledDate),
  statusCheck: check("swim_workouts_status_check", sql`${t.status} IN ('scheduled', 'started', 'completed', 'skipped')`),
  revisionCheck: check("swim_workouts_revision_check", sql`${t.revision} > 0`),
}));

export type SwimPlanRow = typeof swimPlans.$inferSelect;
export type SwimWorkoutRow = typeof swimWorkouts.$inferSelect;
