import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  fileURLToPath(
    new URL(
      "../../../../../packages/db/drizzle/0143_atomic_user_workflows.sql",
      import.meta.url,
    ),
  ),
  "utf8",
);
const rollback = readFileSync(
  fileURLToPath(
    new URL(
      "../../../../../packages/db/rollbacks/0143_atomic_user_workflows.down.sql",
      import.meta.url,
    ),
  ),
  "utf8",
);
const platformActions = readFileSync(
  fileURLToPath(new URL("../platform/actions.ts", import.meta.url)),
  "utf8",
);
const seasonActions = readFileSync(
  fileURLToPath(new URL("../seasons/actions.ts", import.meta.url)),
  "utf8",
);
const sessionActions = readFileSync(
  fileURLToPath(new URL("../sessions/actions.ts", import.meta.url)),
  "utf8",
);
const sessionPage = readFileSync(
  fileURLToPath(new URL("../../app/app/sessions/[id]/page.tsx", import.meta.url)),
  "utf8",
);
const hyroxCompletion = readFileSync(
  fileURLToPath(new URL("../hyrox/complete-action.ts", import.meta.url)),
  "utf8",
);
const wellnessActions = readFileSync(
  fileURLToPath(new URL("../wellness/actions.ts", import.meta.url)),
  "utf8",
);
const settingsActions = readFileSync(
  fileURLToPath(new URL("../settings/actions.ts", import.meta.url)),
  "utf8",
);

describe("0143 atomic user workflows migration", () => {
  it("keeps exactly one visible active program graph under concurrent deployments", () => {
    expect(migration).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS training_blocks_one_visible_active_per_user[\s\S]*WHERE status = 'active' AND deleted_at IS NULL/,
    );
    expect(migration).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS program_instances_one_visible_active_per_user[\s\S]*WHERE status = 'active' AND deleted_at IS NULL/,
    );
    expect(migration).toMatch(
      /deploy_program_instance_atomically[\s\S]*SECURITY INVOKER[\s\S]*pg_advisory_xact_lock[\s\S]*UPDATE public\.training_blocks[\s\S]*UPDATE public\.program_instances[\s\S]*INSERT INTO public\.training_blocks[\s\S]*INSERT INTO public\.planned_sessions[\s\S]*INSERT INTO public\.program_instances/,
    );
    expect(migration).toMatch(
      /UPDATE public\.training_blocks[\s\S]*WHERE user_id = v_user_id[\s\S]*AND status = 'active';[\s\S]*UPDATE public\.program_instances[\s\S]*WHERE user_id = v_user_id[\s\S]*AND status = 'active';/,
    );
  });

  it("rolls the whole deployment or program edit back when a required write fails", () => {
    expect(migration).toMatch(
      /deploy_program_instance_atomically[\s\S]*GET DIAGNOSTICS v_rows = ROW_COUNT;[\s\S]*IF v_rows > 1 THEN[\s\S]*Couldn''t align training maxes\./,
    );
    expect(migration).toMatch(
      /update_program_instance_atomically[\s\S]*rewrite_planned_sessions_atomically[\s\S]*UPDATE public\.training_blocks[\s\S]*Couldn''t align training maxes\.[\s\S]*UPDATE public\.program_instances[\s\S]*Active program instance not found\./,
    );
  });

  it("replaces seasons atomically and serializes concurrent replacements", () => {
    expect(migration).toMatch(
      /create_training_season_atomically[\s\S]*SECURITY INVOKER[\s\S]*pg_advisory_xact_lock[\s\S]*UPDATE public\.training_seasons[\s\S]*INSERT INTO public\.training_seasons[\s\S]*INSERT INTO public\.season_blocks/,
    );
    expect(migration).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS training_seasons_one_visible_active_per_user[\s\S]*WHERE status = 'active' AND deleted_at IS NULL/,
    );
  });

  it("records completion transitions and gates replay-safe one-time work", () => {
    expect(migration).toMatch(
      /RETURNS TABLE\(user_id uuid, transitioned boolean\)[\s\S]*FOR UPDATE[\s\S]*completed_at IS NOT NULL[\s\S]*SELECT v_user_id, false[\s\S]*completed_at IS NULL[\s\S]*SELECT v_user_id, true/,
    );
    expect(migration).toContain(
      "complete_training_session_with_transition",
    );
    expect(migration).not.toContain(
      "DROP FUNCTION IF EXISTS public.complete_training_session(uuid, text);",
    );
    expect(sessionActions).toContain("completion = Array.isArray(data)");
  });

  it("replaces HYROX actuals and completion data in one owned transaction", () => {
    expect(migration).toMatch(
      /replace_hyrox_session_actuals[\s\S]*SECURITY INVOKER[\s\S]*session\.user_id = v_user_id[\s\S]*FOR UPDATE[\s\S]*DELETE FROM public\.set_logs[\s\S]*DELETE FROM public\.cardio_logs[\s\S]*INSERT INTO public\.cardio_logs[\s\S]*INSERT INTO public\.set_logs[\s\S]*UPDATE public\.sessions/,
    );
  });

  it("writes each dated bodyweight log and the current profile value together", () => {
    expect(migration).toMatch(
      /log_bodyweight_atomically[\s\S]*SECURITY INVOKER[\s\S]*auth\.uid\(\)[\s\S]*pg_advisory_xact_lock[\s\S]*INSERT INTO public\.wellness[\s\S]*ON CONFLICT \(user_id, date\) DO UPDATE[\s\S]*UPDATE public\.profiles[\s\S]*GET DIAGNOSTICS v_rows = ROW_COUNT;[\s\S]*Couldn''t update bodyweight\./,
    );
  });

  it("reconciles bodyweight progress from each persisted set-log mutation", () => {
    expect(migration).toMatch(
      /reconcile_bw_progress_for_set_log[\s\S]*pg_advisory_xact_lock[\s\S]*accumulated_tut_seconds = GREATEST\([\s\S]*replace_bw_history_entry/,
    );
    expect(migration).toMatch(
      /CREATE TRIGGER set_logs_reconcile_bw_progress_trg[\s\S]*AFTER INSERT OR UPDATE ON public\.set_logs[\s\S]*reconcile_bw_progress_from_set_log/,
    );
    expect(migration).toContain(
      "Historical values remain NULL rather than guessed.",
    );
    expect(migration).toContain("'node_id', v_recorded_node_id");
    expect(migration).not.toContain(
      "progress.current_node_id::text = v_bw->>'nodeId'",
    );
    expect(migration).toContain("Preserve existing TUT.");
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS public.bw_set_progress_contributions");
    expect(migration).toContain("BEFORE DELETE ON public.set_logs");
    expect(migration).toContain("p_remove_contribution boolean DEFAULT true");
    expect(migration).toContain("p_is_update boolean DEFAULT false");
    expect(migration).toContain(
      "NOT (p_is_update AND v_recorded_node_id IS NULL)",
    );
    expect(migration).toMatch(
      /ADD COLUMN IF NOT EXISTS external_load_kg numeric\(6, 2\)[\s\S]*p_external_load_kg[\s\S]*NEW\.external_load_kg/,
    );
  });

  it("has a guarded rollback for all added database objects", () => {
    expect(rollback).toContain("Refusing to roll back 0143_atomic_user_workflows");
    expect(rollback).toContain("DROP TRIGGER IF EXISTS set_logs_reconcile_bw_progress_trg");
    expect(rollback).toContain("DROP FUNCTION IF EXISTS public.deploy_program_instance_atomically");
    expect(rollback).toContain("DROP FUNCTION IF EXISTS public.create_training_season_atomically");
    expect(rollback).toContain("DROP FUNCTION IF EXISTS public.replace_hyrox_session_actuals");
    expect(rollback).toContain("set_logs.external_load_kg contains recorded data");
    expect(rollback).toContain("DROP INDEX IF EXISTS public.training_blocks_one_visible_active_per_user");
  });

  it("routes every affected caller through the atomic database boundary", () => {
    expect(platformActions.match(/deploy_program_instance_atomically/g)).toHaveLength(2);
    expect(platformActions).toContain("update_program_instance_atomically");
    expect(seasonActions).toContain("create_training_season_atomically");
    expect(hyroxCompletion).toContain("replace_hyrox_session_actuals");
    expect(sessionActions).toContain('error.code === "PGRST202"');
    expect(sessionActions).toContain("if (transitioned) {");
    expect(sessionActions).toContain("atomic_user_workflows_ready");
    expect(sessionPage).toContain('"atomic_user_workflows_ready"');
    expect(sessionPage).toContain("const externalLoadBySetId");
    expect(sessionActions).not.toContain("applyBwSetSideEffects");
    expect(wellnessActions).toContain('rpc("log_bodyweight_atomically"');
    expect(settingsActions).toContain('rpc("log_bodyweight_atomically"');
    expect(wellnessActions).toContain("isMissingRpc(error)");
    expect(settingsActions).toContain("isMissingRpc(error)");
    expect(platformActions).toContain("isMissingRpc(atomicDeployment.error)");
    expect(hyroxCompletion).toContain("isMissingRpc(error)");
    expect(rollback).toContain("DROP FUNCTION IF EXISTS public.log_bodyweight_atomically");
  });
});
