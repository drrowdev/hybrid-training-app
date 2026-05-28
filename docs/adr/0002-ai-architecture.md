# ADR 0002 — AI architecture (Explain v1 + BYOAI)

**Status:** Accepted
**Date:** 2026-05-28
**Phase:** D (Phase D AI planning pass; predates any AI code on `main`)

## Context

The engine on `main` already produces rich, structured reasoning surface area: per-region freshness (ATL/CTL ladder), bucket pressure, the 3-factor ceiling chain (`baseCeiling × recoveryMultiplier × confidenceBias`, CP-4), override audit log, taper recommendation, and tier-detection contributors. Today these are surfaced as cards on `/app`, `/app/stats/engine`, and `/app/freshness`. None of that reasoning is queryable in natural language. The user can read the cards; they cannot ask "why is this week deload?" without bouncing between three pages.

`docs/knowledge/ai-roadmap.md` entry **#7 — AI chat surface (FAB + conversation backend)** parked the feature behind a dedicated planning pass and listed 8 open questions (backend model, conversation persistence, grounding, allowed actions, privacy, voice, fallback, quality bar). This ADR resolves all 8 by locking the architecture for the first AI capability in this app — an **Explain-only**, **read-only**, single-orchestrator chat surface powered by **BYOAI** keys, multi-provider from day one, with an eval harness and observability stack shipped in v1. The ADR is the planning gate; the implementation lands as two follow-up PRs (see "Implementation split" below) and is explicitly **not** part of this PR.

The AI tier is treated as just another engine subsystem under the CP-1..CP-5 calibration policy (`hybrid-training-design-constraints.md`): no prompt-derived training advice may bypass the existing ceiling, region-freshness, or bucket-pressure logic, and any prompt or snapshot constant carries the same heuristic-pending-data discipline as engine code.

## Decisions

| Topic | Decision | Why |
|---|---|---|
| Paywall | **Free + BYOAI**; managed-key subscription tier explicitly deferred | Defers Stripe (consistent with ADR 0001); lets us ship AI without absorbing token cost or building quota infra. Schema reserves `byoai_unlocked_at` so a future one-time-payment unlock slots in without migration |
| First capability | **Explain-only** chat surface; one tool (`getEngineSnapshot`); **read-only** contract (no write tools, no plan mutation) | Smallest shippable wedge over the existing reasoning surface area. Read-only is a hard contract: no edit-proposal tools, no log-set tools. Closes ai-roadmap #7 Q4 (allowed actions) |
| Provider abstraction | Thin `LlmProvider` interface; initial providers: `AnthropicProvider`, `OpenAiProvider`, `GeminiProvider` | BYOAI forces multi-provider from day one. Normalising at the boundary keeps the orchestrator, tool layer, and eval harness provider-agnostic. Closes ai-roadmap #7 Q1 (backend model) |
| Key storage | Supabase Vault for value; only vault ref + provider enum + `byoai_unlocked_at` in `profiles`; key never returned to client | Encryption at rest is table stakes; client never re-reads its own key. Closes ai-roadmap #7 Q5 (privacy) for credential handling |
| Snapshot tiering | **90d daily** detail → **90d–1y weekly** aggregates → **>1y monthly** aggregates; **PR timeline full** regardless of age; embedded curated knowledge (5 archetypes + CP-1..CP-5 policy + 30-row CP-2 constants table) | Bounded context window; recency-weighted resolution; embeds the small finite catalogue instead of RAG. Closes ai-roadmap #7 Q3 (grounding) |
| Conversation persistence | `chat_threads` + `chat_messages` + `memories` tables; full verbatim history per thread until a future compaction step (out of v1); RLS-enforced | One row per turn, one thread per conversation, a separate `memories` table for AI-curated persistent facts. Closes ai-roadmap #7 Q2 (conversation persistence) |
| Privacy | Master AI opt-in toggle in Settings → AI; default to provider's training-opt-out flag; never log raw prompt / tool args / response text in our observability stack | User-controlled data egress, vendor-default no-training. Closes ai-roadmap #7 Q5 (privacy) for data handling. Voice is plain-language and brand-pure per DC-Q1 / DC-Q6 — closes ai-roadmap #7 Q6 |
| Eval harness | Replay-first; sha256-keyed cassettes; three matchers (`assertResponseShape`, `assertElementRules`, `assertOrdering`); three modes (replay / strict / refresh); 5 hand-authored fixtures at launch | Shipped in v1, not deferred. Closes ai-roadmap #7 Q8 (quality bar before launch) |
| Observability | Per-LLM-call structured log: `prompt_hash`, `tool_calls`, `validation_result`, `retry_count`, `latency_ms`, `usage`, `provider`, `user_id`, `error_code` | Shipped in v1. Same `prompt_hash` key as eval cassettes — production logs grow the fixture corpus directly. Closes ai-roadmap #7 Q7 (fallback) by making degraded states observable and returning typed error codes the UI can render |
| Retry / tool-call limits | Max **2 retries** per turn on validation failure; max **6 tool calls** per turn (cap; v1 has 1 tool so we will not hit it) | Bounded blast radius per turn; bounded provider cost per turn |

## Out of scope for v1

The following are deliberate non-goals. Each line names the ai-roadmap #7 sub-question it resolves by exclusion.

- **Managed-key subscription tier** — deferred (Q1 partial; BYOAI ships now, platform-paid tokens are a future ADR).
- **Write-capable tools** — no edit-proposal tool, no log-set tool, no plan-mutation tool, no override-from-chat (Q4: read-only).
- **Sidecar action chips / inline accept buttons** — explicit non-goal v1.
- **Proactive triggers** — no AMRAP-completion trigger, no race-window trigger, no block-completion trigger, no welcome-back trigger. The user always initiates (Q4 / Q7).
- **Multi-orchestrator dispatch** — single orchestrator at launch. No persona stack, no role hierarchy, no parallel sub-agents (Q6).
- **Clinical / safety escalation logic** — no red-flag symptom routing, no medical-advice paths. Explain v1 does not reason about pain pathology; injury-aware ceilings remain the engine's job per CP-4 and the active-limitations contract (Q5 / Q6).
- **Classify, Quick-log, and other AI capabilities** — Explain is the only AI feature v1.
- **Conversation compaction** — full verbatim per thread until we hit a token budget; the compaction step is documented but unimplemented (Q2).
- **Per-data-class redaction** ("don't send wellness data") — master opt-in only at launch; per-class toggles are a follow-up (Q5).
- **Local-LLM fallback (Ollama / llama.cpp)** — out of scope; BYOAI hosted only (Q1).

## Architecture

### `LlmProvider` interface

A single provider-agnostic surface; each concrete provider adapts to its native SDK.

```ts
interface LlmProvider {
  chat(args: {
    system: string;
    messages: ChatMessage[];
    tools: ToolSchema[];
    stream: true;
  }): AsyncIterator<LlmEvent>;
}

type LlmEvent =
  | { type: "text_delta";       delta: string }
  | { type: "tool_call";        id: string; name: string; args: unknown }
  | { type: "tool_result_ack";  id: string }
  | { type: "done";             usage: { inputTokens: number; outputTokens: number; cacheHit: boolean } };
```

- **Streaming via SSE** between server and browser; the server consumes the provider's native stream and re-emits the normalised `LlmEvent` shape.
- **Tool schema** is declared once in a JSON-schema-like shape and translated per provider.
- **Errors** are normalised to the discriminated-union response contract: `{ ok: true, data } | { ok: false, errorCode, errors }`, with `errorCode ∈ rate_limited | provider_unavailable | invalid_key | validation_failed | tool_failed | quota_exceeded | unknown`.

### Prompting convention

- **Static system prompt** versioned in repo (`apps/web/src/lib/ai/prompts/system.v1.ts`). Bumping the version invalidates eval cassettes for that prompt hash.
- **Dynamic user prompt** assembled per turn from the snapshot + memories + the user's message.
- **Schema-enforced output**: the orchestrator parses the model's structured response against a Zod schema. On parse failure, retry within the same turn (max 2 retries, per "Retry / tool-call limits"). Failed-after-retry returns `errorCode = "validation_failed"`.

### `getEngineSnapshot` tool

One tool at launch; read-only; server-executed under the caller's RLS context. Returns a typed `EngineSnapshot`:

- **Memories** — current `memories` rows for this user.
- **Profile** — experience tier, equipment access, archetype preferences, declared active limitations (PR #182).
- **Active block** — current archetype + prescription for the next 2 weeks.
- **Recent 90 days, daily detail** — per-day strength sessions, cardio sessions, recovery entries, wellness check-ins, RPE.
- **90 days – 1 year, weekly aggregates** — weekly tonnage, weekly cardio minutes, weekly adherence.
- **>1 year, monthly aggregates** — monthly tonnage trend, monthly cardio trend.
- **PR timeline** — full history regardless of age (cheap, finite, valuable for "best ever" queries).
- **Engine state** — current bucket pressure, region freshness ATL/CTL, ceiling-explain output, taper recommendation.
- **Embedded knowledge** — the 5 archetype descriptions (`balanced_hybrid_build`, `strength_biased_hybrid`, `aesthetic_hybrid`, `engine_biased_hybrid`, `rebuild_return`), the CP-1..CP-5 calibration policy, and the 30-row CP-2 constants table.

The snapshot is built **once per turn** and shared across any subsequent tool calls within that turn, so multi-call turns do not re-query the database.

### Schema additions

```sql
-- profiles (existing table — additive columns)
alter table profiles add column byoai_provider     text;        -- 'anthropic' | 'openai' | 'gemini' | null
alter table profiles add column byoai_key_vault_id text;        -- Supabase Vault reference, never returned to client
alter table profiles add column byoai_unlocked_at  timestamptz; -- reserved for future one-time-payment unlock
alter table profiles add column ai_opt_in          boolean not null default false;

-- new tables
create table chat_threads (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  title       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table chat_messages (
  id            uuid primary key default gen_random_uuid(),
  thread_id     uuid not null references chat_threads(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  role          text not null,                       -- 'user' | 'assistant' | 'tool'
  content       text,
  tool_calls    jsonb,
  tool_results  jsonb,
  created_at    timestamptz not null default now()
);

create table memories (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  text        text not null,
  category    text not null,                         -- 'preference' | 'fact' | 'goal' | 'constraint' | 'context'
  created_at  timestamptz not null default now()
);

create table byoai_key_events (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  event       text not null,                         -- 'set' | 'replace' | 'clear'
  provider    text,
  created_at  timestamptz not null default now()
);
```

RLS on all four tables: user reads / writes only own rows. `byoai_key_vault_id` is **not** exposed via the client API; only a derived boolean `byoai_configured` is selectable. Every `set` / `replace` / `clear` on the BYOAI key writes a row to `byoai_key_events`.

### Access gating

A single server-side helper:

```ts
function hasAiAccess(profile: Profile): boolean {
  return profile.ai_opt_in === true
      && profile.byoai_provider !== null
      && profile.byoai_key_vault_id !== null;
}
```

Consulted on every AI route (chat send, thread list, snapshot tool, key management). UI hides AI surfaces for users where this returns false; the API returns `errorCode = "quota_exceeded"` if it is ever bypassed.

### Privacy contract

- Settings → AI panel surfaces: which provider is configured, what data classes flow per query (profile, sessions, wellness, engine state, memories), and links to each provider's training-opt-out documentation.
- Outbound calls set the provider's training-opt-out header where available (Anthropic and OpenAI both expose API-level opt-out as default).
- Master switch `ai_opt_in` gates the whole feature. Off → no AI routes accept work, FAB is hidden.
- **Never logged** to our observability stack: raw user message text, raw tool arguments, raw assistant response text. Only metadata (counts, hashes, names, codes, latencies, token usage).

### Eval harness

- **Fixtures** under `apps/web/tests/ai/fixtures/*.json`: input prompt + tool allowlist + expected element rules.
- **Cassettes** keyed by `sha256(systemPrompt + userPrompt + toolSchema)`, stored under `apps/web/tests/ai/cassettes/`.
- **Matchers**: `assertResponseShape` (Zod schema), `assertElementRules` (presence / absence of structural elements — e.g., must cite at least one bucket name when explaining deload), `assertOrdering` (relative order of elements in the response, when ordering carries meaning).
- **Modes**:
  - `replay` (default in CI, ~10s, no network) — fail if no cassette exists for the hash.
  - `strict` (pre-commit) — replay + fail if any prompt hash drifted vs cassette index; prevents accidental prompt edits.
  - `refresh` (manual, ~1 min/case) — live provider call, persists a new cassette, intended use when prompts intentionally change.
- **Assert behaviour, not output text.** No regex on natural language; only structured-response assertions.
- **Initial corpus**: 5 hand-authored fixtures covering: deload explanation, ceiling explanation, taper-window question, "why this archetype", and "what should I do today" (engine-grounded).
- **Growth path**: production observability records `prompt_hash` per call; cases worth replaying are promoted into the fixture corpus.

### Observability

Per-LLM-call structured row in `ai_call_logs` (server-side only; no client write path):

| Field | Type | Notes |
|---|---|---|
| `prompt_hash` | text | sha256 — same key the eval cassettes use |
| `tool_calls` | jsonb | array of `{ name, count }`; no args |
| `validation_result` | text | `ok` / `retry` / `failed` |
| `retry_count` | int | 0 / 1 / 2 |
| `latency_ms` | int | end-to-end including retries |
| `usage` | jsonb | `{ inputTokens, outputTokens, cacheHit }` |
| `provider` | text | `anthropic` / `openai` / `gemini` |
| `user_id` | uuid | for billing-like rollups |
| `error_code` | text | nullable; one of the normalised codes above |

**Never logged**: raw prompt content, raw tool args, raw response text.

## Consequences

- **Schema migrations**: four additive `profiles` columns + three new tables (`chat_threads`, `chat_messages`, `memories`) + one event-log table (`byoai_key_events`) + one operations table (`ai_call_logs`). All gated by RLS; vault refs never client-visible. Drizzle migration + `packages/db/integration-tests/rls.mjs` extension required.
- **Two implementation PRs** (see split below). No AI surface ships before both land.
- **Prompt versioning hygiene** becomes mandatory: every prompt edit bumps a version constant and is expected to invalidate cassettes — strict-mode CI will catch drive-by prompt edits.
- **Eval + observability cost is paid upfront**, not deferred. The team owns 5 fixtures from day one and grows the corpus from production hashes.
- **Multi-provider testing surface**: cassettes are provider-agnostic, but provider adapter unit tests exist per provider. Adding a fourth provider is a localised PR (new adapter + tests), not an architectural change.
- **No managed-key revenue in v1**. BYOAI is free; cost is the provider's problem until the future managed-tier ADR.
- **CP-1..CP-5 still binds**: the AI tier cannot introduce constants that bypass the calibration policy; embedded knowledge in the snapshot is sourced from the same constraint files and stays in sync via a compile-time import, not a parallel copy.

## Implementation split

Both PRs are out of scope for this ADR — this PR ships the doc only.

- **PR 1 — Foundations.** Schema migrations (profile columns, vault refs, chat tables, key-events table, call-log table) + `LlmProvider` interface + three provider adapters (Anthropic, OpenAI, Gemini) + Settings → AI panel for BYOAI key entry + privacy disclosure copy + `hasAiAccess` gate + RLS test extensions. **No chat surface, no FAB, no orchestrator.**
- **PR 2 — Explain surface.** Chat FAB on `/app/*` + thread + message persistence + `getEngineSnapshot` tool wired to the snapshot builder + SSE streaming + system prompt v1 + Zod-schema retry loop + eval harness skeleton with 5 fixtures + observability logging. Ships the user-visible AI feature.

## Verification

The ADR is correctly implemented after both PRs land iff:

1. `hasAiAccess(profile)` returns false until the user has opted in **and** stored a BYOAI key; the FAB does not render and the AI routes return `quota_exceeded` for those users.
2. `packages/db/integration-tests/rls.mjs` proves a user cannot read another user's `chat_threads`, `chat_messages`, `memories`, `byoai_key_events`, or `byoai_key_vault_id`, and that no API path returns `byoai_key_vault_id` to the client.
3. The eval harness runs in CI in `replay` mode (≤ 30s, no network) and passes all 5 fixtures across all three provider adapters; `strict` mode catches a deliberate prompt edit in a pre-commit test.
4. The `ai_call_logs` table contains a row per turn with `prompt_hash`, `validation_result`, `retry_count`, `latency_ms`, `usage`, `provider`, and `user_id` populated — and contains **no** raw prompt, raw tool args, or raw response content (grep-asserted in a privacy test).
5. A manual "why is this week deload?" question on a seeded account produces a structured response that cites the bucket name, the freshness band, and the active block, and writes a `chat_messages` row plus an `ai_call_logs` row.

## Open follow-ups

Each will get its own ADR or PR when picked up.

- **Managed-key subscription tier** — platform-paid tokens, quota, Stripe wiring.
- **Classify capability** — second AI feature; e.g., auto-categorising session notes.
- **Quick-log capability** — natural-language session entry; first write-capable surface.
- **Write-capable tools** — design of the override-and-warn contract for chat-initiated mutations (DC-K4 alignment).
- **Multi-orchestrator dispatch** — only if/when capability count justifies it; v1 stays single-orchestrator.
- **Proactive triggers** — engine-initiated chat suggestions (AMRAP completion, race window, block boundary, welcome-back).
- **Conversation compaction** — token-budget-triggered summarisation of long threads; current v1 keeps full verbatim.
- **Per-data-class privacy toggles** — "don't send wellness data" and similar fine-grained opt-outs.
- **Local-LLM fallback** — Ollama / llama.cpp option for fully-local operation.

---

*Resolved ai-roadmap #7 open questions: Q1 (backend model) — BYOAI hosted; managed tier deferred. Q2 (conversation persistence) — Supabase tables, verbatim, RLS-scoped. Q3 (grounding) — tiered snapshot + embedded knowledge, no RAG. Q4 (allowed actions) — read-only, one tool. Q5 (privacy) — master opt-in, vault-encrypted keys, never-log raw content, default training-opt-out. Q6 (voice) — plain-language, brand-pure (DC-Q1 / DC-Q6). Q7 (fallback) — normalised error codes, observable degraded states, UI hides FAB on no-access. Q8 (quality bar) — replay-first eval harness with 5 fixtures shipped v1.*
