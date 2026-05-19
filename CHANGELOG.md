# Changelog

All notable changes to this project will be documented in this file.
The format is loosely based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added — Phase 1 starting point: movement catalog (commit pending)

- **0002_movement_metadata migration** applied live to Supabase: 22-value `muscle` enum (DC-T1 priorities), `axial_load` enum (DC-D3), `stability` enum (DC-O5), 7 new columns on `movements` (`primary_muscles`, `secondary_muscles`, `high_strain_tendon`, `axial_load`, `stability`, `bilateral`, `body_weight_loaded`). GIN indexes on muscle arrays for the aesthetics dashboard.
- **`packages/db/seeds/`**: 275-movement seed catalog organised into 3 files (strength patterns / isolation / cardio+plyo+olympic+tendon+cuff+drills), with category-helper builders for terse per-movement overrides. Includes 28 squat, 24 hinge, 24 press, 25 pull, 6 carry, 87 isolation, 38 cardio (cycling/running/rowing/sled/ruck/swim/etc.), 12 plyometric, 8 Olympic, 9 tendon-resilience (Baar isometric / Kongsgaard HSR / Alfredson eccentric protocols), 8 rotator-cuff, 6 run drills, 6 grip. 42 flagged `high_strain_tendon` for DC-J5 6h refractory.
- **Seed runner** (`pnpm --filter @hta/db db:seed`): idempotent upsert via `ON CONFLICT (user_id, slug) DO UPDATE`, with pre-flight sanity checks (no duplicate slugs, every non-carry movement has ≥ 1 primary muscle) and post-seed `\dt`-style verification by pattern.
- **Seed-shape Vitest suite** (`seeds/movements.test.ts`): 24/24 pass — uniqueness, region coverage, primary-muscle coverage per priority (every DC-T1 muscle has ≥ 3 movements), Olympic-implies-compound, cardio-has-interference-cost.

### Phase 0 → Phase 1 transition
Phase 0 closed (live at https://hybrid-training-app-web.vercel.app). Phase 1 movement-catalog foundation now in place. Next: `sessions` + `set_logs` + `cardio_logs` + `wellness` tables + the logging UI.
