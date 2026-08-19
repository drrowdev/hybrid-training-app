# AGENTS.md

Conventions for any AI assistant (or future-self) working on this codebase.

## Read first

1. `docs/knowledge/hybrid-training-app-plan.md` — scope, architecture, phasing
2. `docs/knowledge/design-constraints.md` — 108 testable engine invariants (DC-* identifiers). **This is the contract every change must respect.**
3. `docs/knowledge/hybrid-training-index.md` — catalog of the wiki
4. `docs/knowledge/hybrid-training-log.md` — append-only chronological record

The three research papers (`hybrid-training-research-{v1,v2,new}.md`) are **raw sources** — never edited.

## Engineering rules

- **Branching:** trunk-based. Feature branch → PR → CI passes → merge to `main`. No long-lived branches.
- **Migrations:** every PR that changes schema includes a Drizzle migration in `packages/db/drizzle/`. Backwards-compatible only on main.
- **Domain code is pure:** `packages/domain` has no DB, no React, no I/O. Tests run in milliseconds.
- **Engine code respects DC-*:** every constraint in `design-constraints.md` that touches the engine has at least one Vitest test in `packages/domain` or `packages/engine` that fails if the constraint is violated. Cite the DC-* identifier in the test description.
- **Schema discipline (plan §6.8):** before adding a top-level column, answer (a) what removes it? (b) is it observable from outside the engine? If both no, put it in a `definition`/`metadata` JSONB blob. ADR required for any new top-level column.
- **Single home for derived state (plan §6.9):** every derived value has one canonical function in `packages/domain` or `packages/engine`. UI imports; never re-derives.
- **RLS on every user-data table:** every table with `user_id` has a `USING (auth.uid() = user_id)` policy. Verified by the multi-user e2e test in `apps/web`.
- **Methodology purity (plan §1, owner-confirmed):** zero external program names in catalog, data model, or engine.
- **Override-and-warn, never silent overrule (DC-K4):** when a user overrides a principle-derived default, the engine records the override and shows a warning. Hard blocks reserved for safety (tendon refractory, active-limitation gates, RLS/auth violations).

## UI copy

Write what the control does. Nothing else.

**No unsolicited explanation.** Before shipping any user-facing string, ask: would a competent user, looking at this control, have asked this question? If no, cut it.

Two specific bans:

- **No pre-emptive reassurance.** Never state what a setting *doesn't* affect, won't break, or leaves unchanged. Denying a consequence invents the fear — "your sets work exactly the same" implies they might not have.
- **No implementation narration.** Describe the user's action, never the engine's mechanics. Words like *engine-owned*, *mapped*, *derived*, *canonical*, *materialized*, *protected* belong in code and comments, never in the UI.

Corollaries:

- A label and a control state already communicate. Don't restate them in prose.
- Explain a rule only where it **blocks** the user — in the validation error, at the moment of failure. Not pre-emptively, in a card, on every visit.
- Interpolate display labels into user-facing strings, never raw keys or slugs.
- Default to deleting a sentence. If a reviewer can't name the question it answers, it goes.
- Don't pin removable copy in a test. A test asserting on a sentence makes that sentence permanent; assert on behaviour instead.

Applies to AI-authored copy in particular: writing UI immediately after reading the implementation makes internal mechanics feel salient. They are not.

## Wiki maintenance

The `docs/knowledge/` directory follows the Karpathy personal-knowledge-base pattern (plan §6.10):

- **Raw sources** (immutable) — the three `hybrid-training-research-*.md` files. Never edited.
- **Wiki pages** (LLM-maintained) — the plan, design constraints, eventual per-archetype / per-bucket / per-region pages.
- **Index + log** — `hybrid-training-index.md` (catalog) and `hybrid-training-log.md` (append-only `## [YYYY-MM-DD] kind | title` record).

Operations:

- **Ingest** — when a new source enters `docs/knowledge/`, update affected wiki pages, append to `log.md`.
- **Query** — read the wiki first; cite sources via the wiki's resolved citations.
- **Lint** — periodic health check for contradictions, stale claims, orphan pages. Run quarterly.

Every ingest / refine / decision / lint pass MUST append a log entry. Every new wiki page MUST be added to the index.

## Commit hygiene

- Conventional Commits style preferred: `feat(scope): ...`, `fix(scope): ...`, `chore: ...`, `docs: ...`.
- **Always include the AI-coauthor trailer when an AI assistant wrote or substantively edited the commit:**

  ```
  Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>
  ```

- PR descriptions reference any DC-* / OC-* identifiers touched and link to the relevant section of `design-constraints.md`.

## Tests

- **Unit / domain** — Vitest in `packages/domain` and `packages/engine`. Coverage ≥ 80%.
- **Integration** — Vitest + a real Postgres test instance (Docker locally, testcontainers in CI). RLS policies tested explicitly.
- **E2E** — Playwright in `apps/web`. Critical paths: auth + log + program-run.
- **Multi-user E2E** — at least one test that mutates state from two browser contexts and verifies the server-canonical state. Catches sync-style races that single-user testing misses.

## When to ask the project owner

(Per plan §10 signal-quality criteria.)

- Anything affecting multi-tenancy or RLS — RLS bugs are catastrophic; don't guess.
- Scope creep (the answer is almost always "defer to backlog").
- Library choices that meaningfully affect hosting cost.
- Any user-data migration (always pause, write the down-migration too).
- Privacy / GDPR questions.
- Ambiguity in `design-constraints.md` interpretation.

Don't ask about: internal naming, micro-library choices (`clsx` vs `classnames`), test-framework config, file structure inside `packages/`.
