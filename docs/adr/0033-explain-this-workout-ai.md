# ADR 0033 — "Explain this workout" conversational AI (session-grounded)

Status: Accepted (2026-06-06)
Supersedes: none
Related: ADR 0002 (in-app AI chat + eval harness), ADR 0003 (MCP server + tool
catalogue); the per-accessory deterministic rationale (PR #333,
`accessory-rationale.ts`); the engine-reasoning ✦ "why" sparks (PR #329)

## Context

The engine selects every accessory deterministically (durability role,
functional-role requirement, or the largest open per-muscle volume gap) and now
records that reason on each prescription item (`notes`), surfaced per movement as
a ✦ "why" spark. Users asked to go further — to ask *why this whole session is
programmed the way it is* and ask follow-ups.

The risk in bolting an LLM onto this is that it just **reformats the
deterministic message** in another voice, adding latency and cost but no value.
The user directive was explicit: the AI must receive the **same factors that
drive workout generation** (profile, archetype/focus, plan progress, prior-block
performance, readiness, interference) and **synthesise** across them.

We already have the infrastructure from ADR 0002/0003: a read-only tool
catalogue, orchestrator v2, system prompt v2, BYOAI-vaulted keys, `hasAiAccess`
gating, the MCP dual-path, and the replay-only eval harness.

## Decision

A session-grounded explanation feature built entirely on the existing read-only
AI surface. The reasons stay **deterministic**; the AI is a thin natural-language
layer that **narrates and connects** them — it never invents reasons.

1. **`getSessionDetail` tool** (9th catalogue tool, dual-path in-app + MCP).
   Backed by `loadSessionDetail`, which returns one session's ordered movements
   (each with its deterministic `why`) plus a compact **`generationContext`**
   mirroring the generator's inputs: athlete (tier/equipment/limitations/
   bodyweight), goal (archetype + focus muscles + secondary focus + accessory
   volume + power emphasis), plan position (phase via `deloadWeekIndexFor`,
   deload proximity, skip/early flags), performance (ceiling + recovered weeks),
   readiness (bucket pressure + region freshness). Read-only; every query pinned
   to `userId`; each context sub-helper wrapped so a missing piece degrades to
   null. No new engine math — assembly of existing sources.

2. **Session context through the chat stack.** `/api/ai/chat` accepts an optional
   `context_session_id`; the orchestrator appends ONE steering line to the system
   prompt only when present. When absent, `systemPrompt === SYSTEM_PROMPT` by
   reference, so `prompt_hash` and the provider stream are **byte-identical** to a
   non-session turn (the deterministic eval pins hold).

3. **Prompt contract ("synthesize, don't restate").** A new system-prompt section
   requires the model to call `getSessionDetail` and add insight by synthesising
   across `generationContext`, never inventing biomechanics/numbers, honest about
   gaps, read-only.

4. **Entry point.** An `AskWhyButton` (✦ accent) on `/app/sessions/[id]`. AI on →
   dispatches a validated `sxc:ask-coach` event that opens the chat pre-seeded
   (ChatPanel auto-sends once, guarded). AI off → links to Settings → AI (no
   inline nudge; the value proposition is a separate benefits-list work item).

5. **Eval guard.** A 6th replay fixture (`explain-this-session`) pins the expected
   behaviour: the answer must call `getSessionDetail` and reference plan-phase +
   readiness factors (`wave`, `fresh`) — an anti-paraphrase check that a future
   real recording (refresh mode) must keep satisfying.

## Consequences

- The "intelligence" remains the deterministic engine; BYOAI-off users still get
  the real reasons (the ✦ sparks). The AI only adds conversational depth.
- No new engine constants; no CP-2 rows. Selection logic, sets/reps/intensity and
  ordering are untouched — the only prescription-output change in the whole
  feature is populating the previously-empty `notes` (PR #333).
- Structurally read-only (no write tools exist), so the model cannot mutate a
  plan; RLS pinned per query; observability stays metadata-only.
- Deferred (tracked separately): `priorBlockAdherence` and a `concurrentInterference`
  scalar in `generationContext`; follow-up chips + Today/plan-drawer entry points
  (P2); a proactive daily brief (P3); the AI benefits list on Settings → AI.

## Confidence

High on the architecture (reuses shipped, tested infrastructure) and on the
read-only/RLS posture. The synthesis-quality of real model output is unproven
until a live recording replaces the synthetic cassette — the eval fixture exists
precisely to lock that contract when it does.
