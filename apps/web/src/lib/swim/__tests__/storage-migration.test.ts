import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  calibrationSnapshot, estimateCriticalSwimSpeed, parseSwimActualResult, swimRegionExposure,
  SWIM_ASSESSMENT_VERSION, SWIM_SUPPORTED_ASSESSMENT_VERSIONS, type SwimStroke,
} from "@hta/domain";
import { MUSCLE_TO_REGION } from "../../limitations/region";

const sql = readFileSync(fileURLToPath(new URL(
  "../../../../../../packages/db/drizzle/0145_standalone_pool_swimming.sql",
  import.meta.url,
)), "utf8");
const rollback = () => readFileSync(fileURLToPath(new URL(
  "../../../../../../packages/db/rollbacks/0145_standalone_pool_swimming.down.sql",
  import.meta.url,
)), "utf8");

function functionBody(name: string) {
  const start = sql.indexOf(`CREATE FUNCTION public.${name}(`);
  const end = sql.indexOf("CREATE FUNCTION public.", start + 1);
  return sql.slice(start, end === -1 ? undefined : end);
}

describe("ADR0079 swimming SQL boundary", () => {
  it("adds independently owned plans without manufacturing a primary program", () => {
    expect(sql).toContain("CREATE TABLE public.swim_plans");
    expect(sql).toContain("CREATE TABLE public.swim_workouts");
    expect(sql).not.toMatch(/(?:INSERT INTO|UPDATE|ALTER TABLE) public\.(training_blocks|program_instances|training_seasons|planned_sessions)/);
    expect(sql).toMatch(/ON public\.swim_plans \(user_id\) WHERE status = 'active'/);
  });

  it("enforces both owner links and keeps only the session link nullable after purge", () => {
    expect(sql).toContain("ON public.sessions (user_id, id)");
    expect(sql).toContain("FOREIGN KEY (user_id, plan_id)");
    expect(sql).toContain("FOREIGN KEY (user_id, session_id)");
    expect(sql).toContain("ON DELETE SET NULL (session_id)");
    expect(sql.match(/REFERENCES auth\.users\(id\) ON DELETE CASCADE/g)).toHaveLength(2);
  });

  it("retains RLS even inside the authenticated RPC mutation boundary", () => {
    expect(sql).toContain("CREATE ROLE swim_writer NOLOGIN NOINHERIT NOBYPASSRLS");
    expect(sql.match(/ENABLE ROW LEVEL SECURITY/g)).toHaveLength(2);
    expect(sql).not.toMatch(/FORCE ROW LEVEL SECURITY/);
    expect(sql.match(/WITH CHECK \(\(SELECT auth\.uid\(\)\) = user_id\)/g)).toHaveLength(2);
    expect(sql).toContain("REVOKE ALL ON public.swim_plans, public.swim_workouts FROM PUBLIC, anon, authenticated");
    expect(sql).toContain("SET row_security = on");
    expect(sql).not.toContain("set_config(");
    expect(sql).not.toMatch(/GRANT[^;]+TO service_role/);
  });

  it("locks the session before checking all cardio additions and changes", () => {
    expect(sql).toMatch(/swim_guard_cardio[\s\S]*FROM public\.sessions WHERE id = v_session_id FOR UPDATE;[\s\S]*SELECT EXISTS/);
    expect(sql).toContain("BEFORE INSERT OR UPDATE OR DELETE ON public.cardio_logs");
    expect(sql).toContain("NEW.swim_result IS NOT NULL AND NOT v_linked");
    expect(sql).toContain("NEW.swim_result IS NULL OR NEW.modality <> 'swimming'");
    expect(sql).toContain("session_id = NEW.session_id AND id <> NEW.id");
    expect(sql).toContain("Swimming summary does not match native actuals.");
  });

  it("blocks generic completion and strength mutations but retains trash and account cascade", () => {
    expect(sql).toContain("BEFORE UPDATE OR DELETE ON public.sessions");
    expect(sql).toContain("BEFORE INSERT OR UPDATE OR DELETE ON public.set_logs");
    expect(sql).toContain("BEFORE INSERT OR UPDATE OR DELETE ON public.session_movements");
    expect(sql).toContain("IF NOT FOUND AND TG_OP = 'DELETE'");
    expect(sql).toContain("ARRAY['deleted_at','notes','title','fatigue','soreness'");
    expect(sql).toContain("current_user <> 'swim_writer'");
    expect(sql).toContain("NEW.definition := NEW.definition - 'resultHistory'");
    expect(sql).toContain("'bucket_coeffs','region_coeffs','performed_at','updated_at'");
    expect(sql).toContain("CREATE TRIGGER sessions_swim_source_revision");
    expect(sql).toContain("new_session.deleted_at IS DISTINCT FROM old_session.deleted_at");
    expect(sql).toContain("new_session.performed_at IS DISTINCT FROM old_session.performed_at");
    expect(sql).toContain("UPDATE public.swim_plans AS plan SET revision = plan.revision + 1");
    expect(sql).not.toContain("40P01");
  });

  it("invalidates service purges after all session rows without broadening authenticated privileges", () => {
    const source = functionBody("swim_invalidate_session_source");
    expect(source).toContain("SECURITY DEFINER");
    expect(source).not.toContain("auth.uid()");
    expect(source).toContain("plan.user_id IN (SELECT user_id FROM swim_old_sessions)");
    expect(source).toContain("workout.user_id = old_session.user_id");
    expect(source).toContain("ORDER BY id FOR UPDATE");
    expect(source).toContain("AFTER DELETE ON public.sessions");
    expect(source).toContain("REFERENCING OLD TABLE AS swim_old_sessions");
    expect(source.match(/FOR EACH STATEMENT/g)).toHaveLength(2);
    expect(source).toContain("FROM PUBLIC, anon, authenticated, service_role, swim_writer");
    const writerOwnership = sql.slice(sql.lastIndexOf("GRANT CREATE ON SCHEMA public TO swim_writer"));
    expect(writerOwnership).not.toContain("'swim_invalidate_session_source'");
    expect(rollback()).toContain("DROP TRIGGER IF EXISTS sessions_swim_purge_revision");
  });

  it.each(["swim_complete_workout", "swim_edit_result"])("%s locks session, plan, workout in that order", (name) => {
    const locks = [...functionBody(name).matchAll(/FROM public\.(\w+)[^;]*FOR UPDATE/g)];
    expect(locks.slice(0, 3).map((match) => match[1])).toEqual([
      "sessions", "swim_plans", "swim_workouts",
    ]);
  });

  it("avoids waiting on a purge-held workout from a plan-first path", () => {
    for (const name of ["swim_start_workout", "swim_skip_workout", "swim_update_plan", "swim_resume_plan"]) {
      expect(functionBody(name)).toMatch(/status = 'scheduled' AND session_id IS NULL[^;]*FOR UPDATE/);
    }
    const start = functionBody("swim_start_workout");
    expect(start.indexOf("RETURN to_jsonb(v_workout)")).toBeLessThan(start.indexOf("FOR UPDATE"));
    expect(start.indexOf("hashtextextended('swim-start:'")).toBeLessThan(start.indexOf("RETURN to_jsonb(v_workout)"));
    expect(start.match(/RETURN to_jsonb\(v_workout\)/g)).toHaveLength(2);
    expect(start.slice(start.indexOf("FOR UPDATE"), start.indexOf("INSERT INTO public.sessions")))
      .not.toContain("RETURN to_jsonb(v_workout)");
    const cardio = functionBody("swim_guard_cardio");
    expect(cardio.indexOf("OLD.swim_result IS NOT NULL")).toBeLessThan(cardio.indexOf("FOR v_session_id IN"));
    expect(cardio.indexOf("RAISE EXCEPTION")).toBeLessThan(cardio.indexOf("FOR v_session_id IN"));
  });

  it("rechecks limitations at start with the same active-row and muscle rules", () => {
    expect(sql).toContain("PERFORM public.swim_assert_start_safety(v_workout.definition->'issued')");
    expect(sql).toContain("BEFORE INSERT OR UPDATE OR DELETE ON public.limitations");
    expect(sql.match(/hashtextextended\('swim-safety:'/g)).toHaveLength(2);
    const safety = sql.slice(sql.indexOf("CREATE FUNCTION public.swim_assert_start_safety("), sql.indexOf("CREATE FUNCTION public.swim_create_plan("));
    expect(safety).toContain("WHERE user_id = auth.uid() AND resolved_at IS NULL");
    expect(safety).not.toContain("EXCEPTION WHEN");
    expect(safety).not.toContain("severity =");
    expect(safety).not.toContain("INTERVAL '6 hours'");
    expect(safety).toContain("THEN 'swim-intervals' ELSE 'swim-easy'");
    expect(safety).toContain("item.value->>'effort' NOT IN ('easy','steady')");
    expect(safety).toContain("v_muscle_filter_bypassed := v_movement_ids <@ v_allowed_ids");
    expect(safety).toContain("blocked.id = ANY(v_movement_ids) AND NOT (blocked.id = ANY(v_allowed_ids))");
    expect(safety).toContain("SELECT region FROM active WHERE region IS NOT NULL");
    expect(safety).toContain("WHERE NOT v_muscle_filter_bypassed");
    expect(safety).toContain("IF v_movement_ids IS NULL OR cardinality(v_movement_ids) = 0");
    const muscles = Object.fromEntries(
      [...safety.matchAll(/\('(\w+)', '(\w+)'\)/g)].map(([, muscle, region]) => [muscle, region]),
    );
    expect(muscles).toEqual(MUSCLE_TO_REGION);
  });

  it("keeps the SQL stroke-region safety map aligned with the pure domain", () => {
    const rows = [...sql.matchAll(/\('(\w+)', '(\w+)', ARRAY\[([^\]]+)\]\)/g)];
    expect(rows).toHaveLength(7);
    for (const [, stroke, primary, values] of rows) {
      const canonical = swimRegionExposure(stroke as SwimStroke, []);
      expect(primary).toBe(canonical.primaryRegion);
      const regions = [...values!.matchAll(/'(\w+)'/g)].map(([, region]) => region).sort();
      expect(regions).toEqual([canonical.primaryRegion, ...canonical.secondaryRegions].sort());
    }
    expect(sql).toContain("v_regions := v_regions || ARRAY['foot_ankle_calf']");
    expect(sql).toContain("array_append(v_regions, 'elbow_forearm')");
    expect(sql).toContain("array_append(v_regions, 'shoulder_scapular')");
    expect(sql).toContain("WHERE r = v_primary OR r NOT IN ('adductor_groin','knee','hamstring_posterior','foot_ankle_calf')");
  });

  it("DC-SW9 retains a kick set's lower-body regions when a pull buoy is selected", () => {
    expect(functionBody("swim_prescription_regions"))
      .toContain("IF v_item->'equipment' ? 'pull_buoy' AND v_item->>'stroke' <> 'kick' THEN");
    expect(swimRegionExposure("kick", ["pull_buoy"])).toEqual({
      primaryRegion: "knee",
      secondaryRegions: ["lumbar_trunk", "hamstring_posterior", "foot_ankle_calf"],
    });
    expect(swimRegionExposure("freestyle", ["pull_buoy"])).toEqual({
      primaryRegion: "shoulder_scapular",
      secondaryRegions: ["elbow_forearm", "lumbar_trunk"],
    });
  });

  it("reuses a started session before considering stale start revisions", () => {
    const start = sql.slice(sql.indexOf("CREATE FUNCTION public.swim_start_workout("));
    expect(start.indexOf("IF v_workout.session_id IS NOT NULL")).toBeLessThan(
      start.indexOf("v_workout.revision IS DISTINCT FROM p_expected_revision"),
    );
    expect(start).toContain("INSERT INTO public.sessions (user_id, title, slot)");
    expect(start).toContain("Restore this session before opening it.");
  });

  it("rejects stale edits and freezes all issued targets after start", () => {
    expect(sql).toContain("USING ERRCODE = '40001'");
    expect(sql).toContain("AND status = 'scheduled' AND session_id IS NULL");
    expect(sql).toContain("public.swim_validate_workout_append(v_workout.definition, v_update->'definition')");
    expect(sql).toContain("public.swim_validate_state_append(v_plan.state, p_state)");
  });

  it("keeps plan identity immutable and rechecks issued course/generator on every future replacement", () => {
    const update = functionBody("swim_update_plan");
    expect(update).toContain("p_definition IS DISTINCT FROM v_plan.definition");
    expect(sql.match(/PERFORM public\.swim_validate_plan_binding/g)).toHaveLength(2);
    expect(update).toContain("public.swim_validate_plan_binding(p_definition, v_update->'definition', p_state, v_workout.definition)");
    const binding = functionBody("swim_validate_plan_binding");
    expect(binding).toContain("IS DISTINCT FROM p_plan->'setup'->'course'");
    expect(binding).toContain("IS DISTINCT FROM p_plan->>'generatorVersion'");
  });

  it("preserves omitted notes independently while allowing an explicit null to clear them", () => {
    const edit = functionBody("swim_edit_result");
    expect(edit).toContain("p_notes_supplied boolean DEFAULT false");
    expect(edit.match(/notes = CASE WHEN p_notes_supplied THEN p_notes ELSE notes END/g)).toHaveLength(2);
    expect(rollback()).toContain("swim_edit_result(uuid, integer, jsonb, text, boolean, boolean)");
  });

  it("checks completed-session replay before touching incoming actuals or UUIDs", () => {
    const completion = sql.slice(sql.indexOf("CREATE FUNCTION public.swim_complete_workout("));
    expect(completion.indexOf("IF v_session.completed_at IS NOT NULL")).toBeLessThan(
      completion.indexOf("public.swim_validate_result(p_result)"),
    );
    expect(completion.indexOf("IF v_session.completed_at IS NOT NULL")).toBeLessThan(
      completion.indexOf("v_workout.revision IS DISTINCT FROM p_expected_revision"),
    );
    expect(completion).toContain("'transitioned', false");
    expect(completion).toContain("public.complete_training_session_with_transition(v_session.id, p_notes, p_completion_entry_id)");
    expect(completion).not.toMatch(/EXCEPTION WHEN/);
  });

  it("uses bounded integral arithmetic and preserves exact normalized course identity", () => {
    expect(sql).toContain("v_value <> trunc(v_value)");
    expect(sql).toContain("p_course->'denominator', 1, 10000");
    expect(sql).toContain("v_n < 5 * v_d OR v_n > 100 * v_d");
    expect(sql).toContain("v_a % v_b");
    expect(sql).toContain("IF v_a <> 1");
    expect(sql).toContain("p_workout->'totalLengths', 1, 2000");
    expect(sql).toContain("p_workout->'estimatedMs', 1, 86400000");
  });

  it("stores known-time accounting without restoring a guessed duration for an unknown pace", () => {
    const prescription = functionBody("swim_validate_prescription");
    expect(prescription).toContain("p_workout->'budget'->'minutes', 1, 240");
    expect(prescription).toContain("p_workout->'budget'->'accountedMs', 0, 86400000");
    expect(prescription).not.toContain("->>'basis'");
    expect(prescription).toContain("IF p_workout->'estimatedMs' <> 'null'::jsonb");
    expect(prescription).toContain("p_workout->'snapshot'->'calibration' = 'null'::jsonb");
    expect(prescription).toContain("p_workout->'estimatedMs' IS DISTINCT FROM p_workout->'budget'->'accountedMs'");
  });

  it("DC-SW6 rejects an accepted pace at or faster than the short trial while retaining half-millisecond rates", () => {
    const calibration = functionBody("swim_validate_verified_calibration");
    expect(calibration).toContain("v_t400 <= v_t200 * 2");
    expect(calibration).toContain("v_t400 >= v_t200 * 2.5");
    expect(calibration).toContain("(v_t400 - v_t200) / 2 NOT BETWEEN 30000 AND 600000");
    expect(calibration).toContain("(p_cal->>'msPer100')::numeric <> (v_t400 - v_t200) / 2");
    expect(calibration).not.toMatch(/swim_bounded_integer\([^;]*msPer100/);
    expect(functionBody("swim_validate_observation")).toContain("(p_observation->>'observedOn')::date");
  });

  it("DC-SW2 requires verified supported pace sources without rejecting unverified observational history", () => {
    expect(SWIM_SUPPORTED_ASSESSMENT_VERSIONS).toEqual([SWIM_ASSESSMENT_VERSION]);
    const calibration = functionBody("swim_validate_verified_calibration");
    expect(calibration).toContain("p_cal->'observation'->'verified' IS DISTINCT FROM 'true'::jsonb");
    expect(calibration).toContain(`p_cal->>'version' IS DISTINCT FROM '${SWIM_ASSESSMENT_VERSION}'`);
    expect(calibration).toContain(`p_cal->'observation'->>'version' IS DISTINCT FROM '${SWIM_ASSESSMENT_VERSION}'`);
    expect(functionBody("swim_validate_observation")).not.toContain("->'verified'");
    expect(functionBody("swim_validate_observation")).not.toContain("swim_validate_verified_calibration");
    expect(functionBody("swim_validate_plan")).toContain("public.swim_validate_verified_calibration(v_cal)");
    const snapshot = functionBody("swim_validate_snapshot");
    expect(snapshot).not.toContain("swim_validate_verified_calibration");
    expect(snapshot).not.toContain("->'observation'");
    expect(snapshot).toContain("p_snapshot->'calibration'->>'version' IS DISTINCT FROM 'swim-css-1'");
    expect(snapshot).toContain("p_snapshot->'versions'->>'assessment' IS DISTINCT FROM 'swim-css-1'");
    const binding = functionBody("swim_validate_plan_binding");
    expect(binding).toContain("public.swim_validate_verified_calibration(v_source)");
    expect(binding).toContain("p_state->'acceptedCalibration'");
    expect(binding).toContain("p_previous->'issued'->'snapshot'->'calibration'");
    expect(functionBody("swim_validate_result_course")).toContain("v_issued_cal");
    expect(functionBody("swim_validate_prescription")).toContain("public.swim_validate_snapshot(p_workout->'snapshot')");
    expect(functionBody("swim_validate_result")).toContain("public.swim_validate_snapshot(p_result->'snapshot')");
    expect(rollback()).toContain("swim_validate_plan_binding(jsonb, jsonb, jsonb, jsonb)");
  });

  it("DC-SW2 compact snapshots preserve valid half-millisecond calibration without embedding the observation", () => {
    const estimated = estimateCriticalSwimSpeed({
      protocol: "css_200_400", version: SWIM_ASSESSMENT_VERSION, verified: true,
      observedOn: "2026-09-05", course: { numerator: 25, denominator: 1, unit: "m" },
      stroke: "freestyle", equipment: [],
      trials: [
        { distance: 200, lengths: 8, timeMs: 200_000 },
        { distance: 400, lengths: 16, timeMs: 440_001 },
      ],
    });
    expect(estimated.ok).toBe(true);
    if (!estimated.ok) throw new Error(estimated.error.message);
    const { msPer100, unit, protocol, observedOn, heuristic, version } = calibrationSnapshot(estimated.value);
    const compact = { msPer100, unit, protocol, observedOn, heuristic, version };
    expect(msPer100).toBe(120_000.5);
    expect(parseSwimActualResult({
      version: 1, lengths: 3, timeMs: 120_005, rpe: 5, completion: "completed",
      snapshot: {
        course: estimated.value.course, strokes: ["freestyle"], equipment: [], protocol,
        calibration: compact,
        versions: { model: "swim-model-1", generator: "swim-rpc-test", assessment: version },
      },
      provenance: { source: "manual", recordedAt: "2026-09-05T12:00:00.000Z" },
    })).toMatchObject({
      ok: true, value: { snapshot: { calibration: compact } },
    });
  });

  it("has a fail-loud rollback rather than deleting native history", () => {
    expect(rollback()).toContain("Refusing to roll back 0145_standalone_pool_swimming");
    expect(rollback()).toContain("swim_result IS NOT NULL");
    expect(rollback()).toContain("DROP TRIGGER IF EXISTS cardio_logs_swim_guard");
    expect(rollback()).not.toMatch(/DELETE FROM|TRUNCATE|DROP .*CASCADE/i);
    for (const [, name] of sql.matchAll(/CREATE FUNCTION public\.(swim_\w+)\(/g)) {
      expect(rollback()).toContain(`DROP FUNCTION IF EXISTS public.${name}(`);
    }
    expect(rollback()).toContain("LOCK TABLE public.swim_plans, public.swim_workouts, public.cardio_logs IN ACCESS EXCLUSIVE MODE");
  });

  it("resumes only reviewed remaining dates and invalidates stale source-history proposals", () => {
    expect(sql).toContain("CREATE FUNCTION public.swim_resume_plan(");
    expect(sql).toContain("jsonb_array_length(p_workouts) <> v_remaining");
    expect(sql).toContain("v_update->'definition' IS DISTINCT FROM v_workout.definition");
    expect(sql).toContain("p_old->'lifecycle' IS DISTINCT FROM p_new->'lifecycle'");
    expect(sql).toContain("p_old->'pauseSnapshot' IS DISTINCT FROM p_new->'pauseSnapshot'");
    expect(sql).toContain("AND scheduled_date >= public.swim_local_today()");
    expect(sql).toContain("v_plan.state->'pauseSnapshot'->'workoutIds' @> jsonb_build_array(v_workout.id)");
    expect(sql).toContain("public.swim_local_today()");
    expect(sql.match(/UPDATE public\.swim_plans SET revision = revision \+ 1/g)).toHaveLength(4);
  });
});
