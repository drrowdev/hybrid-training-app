// Generated from pinned DDL by generate-modular-catalog.py; do not edit.
export const MODULAR_CATALOG_MANIFEST = {
  "migrations": [
    {
      "tag": "0156_modular_training_schedule",
      "hash": "3abc85a3b89a385daa3025ed44aeabb63da0b505b2b4019f0ace79efc9f03ea0",
      "folderMillis": 1790085600000
    },
    {
      "tag": "0157_standalone_swim_import_outcomes",
      "hash": "87cca48269603d79a8205b0ca41ff6c56006da1dcdf1997ef6bdb904c68e5ba4",
      "folderMillis": 1790125200000
    },
    {
      "tag": "0158_independent_program_ownership",
      "hash": "ac8b735ba7f9b587fc841ba5a6f60808641b9511eafbc714b58e40d92eadde09",
      "folderMillis": 1790142000000
    }
  ],
  "keys": [
    "column:public.swim_current_import_outcomes.created_at",
    "column:public.swim_current_import_outcomes.id",
    "column:public.swim_current_import_outcomes.match_id",
    "column:public.swim_current_import_outcomes.metadata",
    "column:public.swim_current_import_outcomes.revision",
    "column:public.swim_current_import_outcomes.user_id",
    "column:public.swim_current_import_outcomes.workout_id",
    "column:public.swim_import_outcome_activity.claim_import_id",
    "column:public.swim_import_outcome_activity.claim_recording_date",
    "column:public.swim_import_outcome_activity.current_match_id",
    "column:public.swim_import_outcome_activity.definition",
    "column:public.swim_import_outcome_activity.id",
    "column:public.swim_import_outcome_activity.latest_import_id",
    "column:public.swim_import_outcome_activity.matched_import_id",
    "column:public.swim_import_outcome_activity.matched_workout_revision",
    "column:public.swim_import_outcome_activity.native_completed_at",
    "column:public.swim_import_outcome_activity.outcome_id",
    "column:public.swim_import_outcome_activity.outcome_match_id",
    "column:public.swim_import_outcome_activity.outcome_metadata",
    "column:public.swim_import_outcome_activity.plan_id",
    "column:public.swim_import_outcome_activity.plan_status",
    "column:public.swim_import_outcome_activity.recording_date",
    "column:public.swim_import_outcome_activity.revision",
    "column:public.swim_import_outcome_activity.scheduled_date",
    "column:public.swim_import_outcome_activity.session_id",
    "column:public.swim_import_outcome_activity.slot",
    "column:public.swim_import_outcome_activity.status",
    "column:public.swim_import_outcome_activity.user_id",
    "column:public.swim_import_outcome_activity.visible_session_id",
    "column:public.swim_import_outcomes.created_at",
    "column:public.swim_import_outcomes.id",
    "column:public.swim_import_outcomes.match_id",
    "column:public.swim_import_outcomes.metadata",
    "column:public.swim_import_outcomes.revision",
    "column:public.swim_import_outcomes.user_id",
    "column:public.swim_import_outcomes.workout_id",
    "column:public.swim_plan_rehab_bindings.created_at",
    "column:public.swim_plan_rehab_bindings.local_protocol_id",
    "column:public.swim_plan_rehab_bindings.plan_id",
    "column:public.swim_plan_rehab_bindings.rehab_protocol_id",
    "column:public.swim_plan_rehab_bindings.user_id",
    "column:public.training_blocks.program_kind",
    "constraint:public.program_instances.program_instances_parent_consistency",
    "constraint:public.rehab_protocols.rehab_protocols_user_id_id_key",
    "constraint:public.swim_import_matches.swim_import_matches_owned_workout_id_key",
    "constraint:public.swim_import_outcomes.swim_import_outcomes_check",
    "constraint:public.swim_import_outcomes.swim_import_outcomes_owned_match_fk",
    "constraint:public.swim_import_outcomes.swim_import_outcomes_owned_workout_fk",
    "constraint:public.swim_import_outcomes.swim_import_outcomes_owner_revision_key",
    "constraint:public.swim_import_outcomes.swim_import_outcomes_pkey",
    "constraint:public.swim_import_outcomes.swim_import_outcomes_revision_check",
    "constraint:public.swim_import_outcomes.swim_import_outcomes_user_id_fkey",
    "constraint:public.swim_plan_rehab_bindings.swim_plan_rehab_bindings_local_protocol_id_check",
    "constraint:public.swim_plan_rehab_bindings.swim_plan_rehab_bindings_owned_plan_fk",
    "constraint:public.swim_plan_rehab_bindings.swim_plan_rehab_bindings_owned_protocol_fk",
    "constraint:public.swim_plan_rehab_bindings.swim_plan_rehab_bindings_pkey",
    "constraint:public.swim_plan_rehab_bindings.swim_plan_rehab_bindings_plan_id_rehab_protocol_id_key",
    "constraint:public.swim_plan_rehab_bindings.swim_plan_rehab_bindings_user_id_fkey",
    "constraint:public.training_blocks.training_blocks_parent_consistency",
    "constraint:public.training_blocks.training_blocks_program_kind_check",
    "constraint:public.training_blocks.training_blocks_user_id_id_key",
    "function:public.check_program_parent_consistency",
    "function:public.commit_program_progression",
    "function:public.complete_program_if_settled",
    "function:public.guard_program_block_identity",
    "function:public.guard_program_instance_identity",
    "function:public.guard_program_prescription",
    "function:public.guard_swim_rehab_session",
    "function:public.independent_program_schedule_commit",
    "function:public.independent_programs_ready",
    "function:public.set_swim_rehab_bindings",
    "function:public.start_planned_session_atomically",
    "function:public.start_swim_rehab_session",
    "function:public.swim_confirm_import_outcome",
    "function:public.swim_import_outcomes_ready",
    "function:public.sync_program_instance_lifecycle",
    "function:public.training_schedule_commit",
    "function:public.training_schedule_lock",
    "function:public.training_schedule_snapshot",
    "function:public.validate_owned_rehab_items",
    "index:public.program_instances_one_active_orphan",
    "index:public.program_instances_one_active_per_block",
    "index:public.rehab_protocols_user_id_id_key",
    "index:public.swim_import_matches_owned_workout_id_key",
    "index:public.swim_import_outcomes_owner_revision_key",
    "index:public.swim_import_outcomes_pkey",
    "index:public.swim_plan_rehab_bindings_owner_idx",
    "index:public.swim_plan_rehab_bindings_pkey",
    "index:public.swim_plan_rehab_bindings_plan_id_rehab_protocol_id_key",
    "index:public.swim_plan_rehab_bindings_protocol_idx",
    "index:public.training_blocks_one_active_legacy",
    "index:public.training_blocks_one_active_per_kind",
    "index:public.training_blocks_user_id_id_key",
    "policy:public.swim_import_outcomes.swim_import_outcomes_owner",
    "policy:public.swim_plan_rehab_bindings.swim_plan_rehab_bindings_owner",
    "relation:public.swim_current_import_outcomes",
    "relation:public.swim_import_outcome_activity",
    "relation:public.swim_import_outcomes",
    "relation:public.swim_plan_rehab_bindings",
    "trigger:public.cardio_logs.cardio_logs_schedule_lock",
    "trigger:public.planned_sessions.planned_sessions_program_prescription",
    "trigger:public.planned_sessions.planned_sessions_schedule_lock",
    "trigger:public.program_instances.program_instances_parent_consistency",
    "trigger:public.program_instances.program_instances_program_identity",
    "trigger:public.program_instances.program_instances_schedule_lock",
    "trigger:public.program_rehab_bindings.program_rehab_bindings_schedule_lock",
    "trigger:public.rehab_protocols.rehab_protocols_schedule_lock",
    "trigger:public.season_blocks.season_blocks_schedule_lock",
    "trigger:public.sessions.sessions_schedule_lock",
    "trigger:public.sessions.sessions_swim_rehab_origin",
    "trigger:public.set_logs.set_logs_schedule_lock",
    "trigger:public.swim_plan_rehab_bindings.swim_plan_rehab_bindings_schedule_lock",
    "trigger:public.swim_plans.swim_plans_schedule_lock",
    "trigger:public.swim_workouts.swim_workouts_schedule_lock",
    "trigger:public.training_blocks.training_blocks_instance_lifecycle",
    "trigger:public.training_blocks.training_blocks_parent_consistency",
    "trigger:public.training_blocks.training_blocks_program_identity",
    "trigger:public.training_blocks.training_blocks_schedule_lock",
    "trigger:public.training_seasons.training_seasons_schedule_lock"
  ],
  "functions": [
    {
      "name": "check_program_parent_consistency",
      "owner": "current_user",
      "definer": true,
      "config": [
        "search_path=pg_catalog, public"
      ]
    },
    {
      "name": "commit_program_progression",
      "owner": "current_user",
      "definer": false,
      "config": [
        "search_path=pg_catalog, public"
      ]
    },
    {
      "name": "complete_program_if_settled",
      "owner": "current_user",
      "definer": false,
      "config": [
        "search_path=pg_catalog, public"
      ]
    },
    {
      "name": "guard_program_block_identity",
      "owner": "current_user",
      "definer": false,
      "config": [
        "search_path=pg_catalog, public"
      ]
    },
    {
      "name": "guard_program_instance_identity",
      "owner": "current_user",
      "definer": false,
      "config": [
        "search_path=pg_catalog, public"
      ]
    },
    {
      "name": "guard_program_prescription",
      "owner": "current_user",
      "definer": false,
      "config": [
        "search_path=pg_catalog, public"
      ]
    },
    {
      "name": "guard_swim_rehab_session",
      "owner": "current_user",
      "definer": false,
      "config": [
        "search_path=pg_catalog, public"
      ]
    },
    {
      "name": "independent_program_schedule_commit",
      "owner": "current_user",
      "definer": false,
      "config": [
        "search_path=pg_catalog, public"
      ]
    },
    {
      "name": "independent_programs_ready",
      "owner": "current_user",
      "definer": false,
      "config": [
        "search_path=pg_catalog, public"
      ]
    },
    {
      "name": "set_swim_rehab_bindings",
      "owner": "current_user",
      "definer": false,
      "config": [
        "search_path=pg_catalog, public"
      ]
    },
    {
      "name": "start_planned_session_atomically",
      "owner": "current_user",
      "definer": false,
      "config": [
        "search_path=pg_catalog, public"
      ]
    },
    {
      "name": "start_swim_rehab_session",
      "owner": "current_user",
      "definer": false,
      "config": [
        "search_path=pg_catalog, public"
      ]
    },
    {
      "name": "swim_confirm_import_outcome",
      "owner": "swim_writer",
      "definer": true,
      "config": [
        "search_path=pg_catalog, public",
        "row_security=on"
      ]
    },
    {
      "name": "swim_import_outcomes_ready",
      "owner": "current_user",
      "definer": false,
      "config": [
        "search_path=pg_catalog"
      ]
    },
    {
      "name": "sync_program_instance_lifecycle",
      "owner": "current_user",
      "definer": false,
      "config": [
        "search_path=pg_catalog, public"
      ]
    },
    {
      "name": "training_schedule_commit",
      "owner": "current_user",
      "definer": false,
      "config": [
        "search_path=pg_catalog, public"
      ]
    },
    {
      "name": "training_schedule_lock",
      "owner": "current_user",
      "definer": false,
      "config": [
        "search_path=pg_catalog, public"
      ]
    },
    {
      "name": "training_schedule_snapshot",
      "owner": "current_user",
      "definer": false,
      "config": [
        "search_path=pg_catalog, public"
      ]
    },
    {
      "name": "validate_owned_rehab_items",
      "owner": "current_user",
      "definer": false,
      "config": [
        "search_path=pg_catalog, public"
      ]
    }
  ]
} as const;
