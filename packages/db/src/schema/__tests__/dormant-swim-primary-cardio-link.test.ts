import { describe, expect, it } from "vitest";
import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";
import { plannedSessions } from "../planner";
import { swimWorkouts } from "../swimming";

describe("ADR0079 dormant primary cardio schema (DC-SW5/SW7/SW8/SW9)", () => {
  it("matches nullable uniqueness and composite ownership without changing old date/slot fields", () => {
    const config = getTableConfig(swimWorkouts);
    expect(swimWorkouts.plannedSessionId.name).toBe("planned_session_id");
    expect(swimWorkouts.plannedSessionId.getSQLType()).toBe("uuid");
    expect(swimWorkouts.plannedSessionId.notNull).toBe(false);
    expect(swimWorkouts.plannedSessionId.hasDefault).toBe(false);
    expect(swimWorkouts.plannedSessionId.isUnique).toBe(true);
    expect(swimWorkouts.plannedSessionId.uniqueName).toBe("swim_workouts_planned_session_id_unique");
    const ownerKey = getTableConfig(plannedSessions).uniqueConstraints
      .find((key) => key.name === "planned_sessions_user_id_id_key")!;
    expect(ownerKey.columns.map((column) => column.name)).toEqual(["user_id", "id"]);
    const link = config.foreignKeys.find((key) => key.getName() === "swim_workouts_owned_planned_session_fk")!;
    expect(link.reference().columns.map((column) => column.name)).toEqual(["user_id", "planned_session_id"]);
    expect(link.reference().foreignColumns.map((column) => column.name)).toEqual(["user_id", "id"]);
    expect(link.reference().foreignTable).toBe(plannedSessions);
    expect(link.onDelete).toBe("no action"); // Column-specific SET NULL belongs to migration 0149.
    expect(swimWorkouts.userId.notNull).toBe(true);
    expect(swimWorkouts.scheduledDate.notNull).toBe(true);
    expect(swimWorkouts.slot.notNull).toBe(true);
    expect(swimWorkouts.slot.default).toBe("single");
  });

  it("declares an unconditional NULL check, not a caller-dependent activation gate", () => {
    const check = getTableConfig(swimWorkouts).checks
      .find((constraint) => constraint.name === "swim_workouts_primary_cardio_link_dormant_check")!;
    expect(new PgDialect().sqlToQuery(check.value).sql)
      .toBe('"swim_workouts"."planned_session_id" IS NULL');
  });
});
